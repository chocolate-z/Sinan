"""通达信(TDX)公式子系统:解析 / 语义正确性(SMA 递归、CROSS、LLV/HHV)/ 无未来函数 / 扫描。

重点锁死两个「假绿」坑(工作流挖出):
- SMA(X,N,M) 是递归加权(α=M/N),非 rolling_mean、非 ewm(span);N 非整数(3.2)不取整。
- CROSS(A,B) 比前一根 vs 当前根,只在上穿瞬间为真。
红线#1 黄金测试:asof(T) 的输出只依赖 ≤T 数据(追加未来数据不变)。
"""

import polars as pl
import pytest

from sinan.tdx import evaluate_one, scan, validate
from sinan.tdx.errors import TdxUnsafeError
from sinan.tdx.evaluator import compile_program

USER_FORMULA = (
    "N:=5;\n"
    "VAR1:4*SMA((CLOSE-LLV(LOW,N))/(HHV(HIGH,N)-LLV(LOW,N))*100,5,1)-"
    "3*SMA(SMA((CLOSE-LLV(LOW,N))/(HHV(HIGH,N)-LLV(LOW,N))*100,5,1),3.2,1),coloryellow,LINETHICK0;\n"
    "VAR2:8,colorgreen,LINETHICK0;\n"
    "准备拉升: IF(CROSS(VAR1,VAR2),80,0),STICK,COLOR0000CC,LINETHICK2;\n"
    "压住庄家: IF(VAR1<=8,25,0),STICK,colorwhite,LINETHICK2;\n"
    "DRAWTEXT(CROSS(VAR1,VAR2),80,'建仓'),COLOR00FFFF;\n"
    "VARO5:=LLV(LOW,27);\n"
    "VARO6:=HHV(HIGH,34);\n"
    "VARO7:=EMA((CLOSE-VARO5)/(VARO6-VARO5)*4,4)*25;\n"
    "建仓区: IF((VARO7<10),80,100) ,COLOR00CCFF,LINETHICK1;\n"
)


def _panel(closes, *, code="600000.SH", start_day=1):
    n = len(closes)
    dates = [f"2024-01-{start_day + i:02d}" for i in range(n)]
    return pl.DataFrame(
        {
            "stock_code": [code] * n,
            "trade_date": dates,
            "open": closes,
            "high": [c + 1 for c in closes],
            "low": [c - 1 for c in closes],
            "close": list(map(float, closes)),
            "volume": [1.0] * n,
            "amount": [1.0] * n,
        }
    ).sort(["stock_code", "trade_date"])


def _col(panel, src, name):
    c = compile_program(src)
    return panel.sort(["stock_code", "trade_date"]).select(c.outputs[name].expr.alias("v"))["v"].to_list()


def _sma_ref(xs, n, m):
    y, prev = [], None
    for x in xs:
        prev = x if prev is None else (m * x + (n - m) * prev) / n
        y.append(prev)
    return y


def _ema_ref(xs, n):
    a = 2.0 / (n + 1.0)
    y, prev = [], None
    for x in xs:
        prev = x if prev is None else a * x + (1 - a) * prev
        y.append(prev)
    return y


# ── 语义正确性(假绿坑)──────────────────────────────────────────────────────
def test_sma_is_recursive_not_rolling_mean():
    closes = [10, 11, 9, 12, 13, 8, 14, 15, 10, 11]
    p = _panel(closes)
    got = _col(p, "OUT: SMA(CLOSE, 5, 1);", "OUT")
    want = _sma_ref([float(c) for c in closes], 5, 1)
    assert got == pytest.approx(want, abs=1e-9)
    # 与 rolling_mean(5) 必须不同(否则就是踩了坑)
    rolling = p.select(pl.col("close").rolling_mean(5, min_periods=1))["close"].to_list()
    assert got != pytest.approx(rolling, abs=1e-6)


def test_sma_non_integer_n_kept_as_float():
    """SMA(...,3.2,1):N=3.2 绝不能取整成 3 —— α=1/3.2 与 α=1/3 显著不同。"""
    closes = [10, 12, 11, 13, 9, 14, 8, 15, 10, 16]
    p = _panel(closes)
    got = _col(p, "OUT: SMA(CLOSE, 3.2, 1);", "OUT")
    want = _sma_ref([float(c) for c in closes], 3.2, 1)
    assert got == pytest.approx(want, abs=1e-9)
    wrong_int = _sma_ref([float(c) for c in closes], 3, 1)  # 若取整 → 这个
    assert got != pytest.approx(wrong_int, abs=1e-3)


def test_ema_alpha_two_over_n_plus_one():
    closes = [10, 11, 9, 12, 13, 8, 14]
    got = _col(_panel(closes), "OUT: EMA(CLOSE, 4);", "OUT")
    assert got == pytest.approx(_ema_ref([float(c) for c in closes], 4), abs=1e-9)


def test_llv_hhv_include_current_bar():
    lows = [5, 3, 8, 2, 9]
    p = _panel(lows)  # low = close-1
    got = _col(p, "OUT: LLV(LOW, 3);", "OUT")
    # 含当前根,min_periods=1 起步:[4, 2, 2, 1, 1](low=close-1)
    assert got == [4.0, 2.0, 2.0, 1.0, 1.0]


def test_cross_is_crossing_moment_not_持续():
    # A 自下穿上 B=10:A=[8,9,11,12] → 仅第 3 根(9<=10 且 11>10)为金叉
    p = _panel([8, 9, 11, 12])
    got = _col(p, "OUT: IF(CROSS(CLOSE, 10), 1, 0);", "OUT")
    assert got == [0.0, 0.0, 1.0, 0.0]  # 只在上穿瞬间,不是持续 CLOSE>10


def test_ref_is_backward_shift():
    got = _col(_panel([10, 11, 12, 13]), "OUT: REF(CLOSE, 1);", "OUT")
    assert got == [None, 10.0, 11.0, 12.0]


# ── 安全 / 红线 ──────────────────────────────────────────────────────────────
def test_negative_ref_rejected_as_future_function():
    r = validate("OUT: REF(CLOSE, -1);")
    assert r["ok"] is False and any("未来函数" in e for e in r["errors"])
    with pytest.raises(TdxUnsafeError):
        compile_program("OUT: REF(CLOSE, -1);")


def test_unknown_function_rejected():
    r = validate("OUT: ZIGZAG(CLOSE, 5);")
    assert r["ok"] is False and any("ZIGZAG" in e for e in r["errors"])


def test_no_future_function_invariant():
    """红线#1 黄金测试:asof=T 的 VAR1 只依赖 ≤T;追加未来数据不改变 T 处的值。"""
    closes = [10, 11, 9, 12, 13, 8, 14, 15, 10, 11, 16, 9]
    src = "N:=5; VAR1: SMA((CLOSE-LLV(LOW,N))/(HHV(HIGH,N)-LLV(LOW,N))*100, 5, 1);"
    full = _col(_panel(closes), src, "VAR1")
    truncated = _col(_panel(closes[:8]), src, "VAR1")  # 只到第 8 根
    assert full[:8] == pytest.approx(truncated, abs=1e-9)  # 前 8 根逐位一致


# ── 解析用户真实公式 ─────────────────────────────────────────────────────────
def test_user_formula_validates():
    r = validate(USER_FORMULA)
    assert r["ok"] is True, r["errors"]
    # 输出线齐全(含 DRAWTEXT 的 '建仓' 信号)
    assert "准备拉升" in r["outputs"]
    assert "压住庄家" in r["outputs"]
    assert "建仓区" in r["outputs"]
    assert "建仓" in r["outputs"]  # DRAWTEXT 条件抽取为信号
    assert "建仓" in r["signals"]


# ── 端到端扫描 ───────────────────────────────────────────────────────────────
def test_scan_returns_triggered_stocks(tmp_path):
    from sinan.data import DataLayer, store

    # A 股:今日金叉(CLOSE 上穿 10);B 股:无金叉
    for code, closes in [("600000.SH", [8, 9, 11]), ("600001.SH", [12, 13, 14])]:
        n = len(closes)
        store.write_dataset(
            tmp_path,
            "price",
            pl.DataFrame(
                {
                    "stock_code": [code] * n,
                    "trade_date": [f"2024-01-0{i + 1}" for i in range(n)],
                    "open": closes,
                    "high": [c + 1 for c in closes],
                    "low": [c - 1 for c in closes],
                    "close": list(map(float, closes)),
                    "volume": [1.0] * n,
                    "amount": [1.0] * n,
                }
            ),
        )
    res = scan(
        DataLayer(tmp_path),
        ["600000.SH", "600001.SH"],
        "建仓: CROSS(CLOSE, 10);",
        "2024-01-03",
        signal="建仓",
    )
    assert res["asof"] == "2024-01-03"
    assert [h["stock_code"] for h in res["hits"]] == ["600000.SH"]  # 只 A 触发
    assert res["scanned"] == 2


def test_evaluate_one_returns_bars_and_lines(tmp_path):
    """单股求值:K 线 + 公式各输出线(供 K 线 + 副图叠加)。"""
    from sinan.data import DataLayer, store

    closes = [8, 9, 11, 10]  # 第 3 根 CLOSE 上穿 10
    store.write_dataset(
        tmp_path,
        "price",
        pl.DataFrame(
            {
                "stock_code": ["600000.SH"] * 4,
                "trade_date": ["2024-01-01", "2024-01-02", "2024-01-03", "2024-01-04"],
                "open": closes,
                "high": [c + 1 for c in closes],
                "low": [c - 1 for c in closes],
                "close": list(map(float, closes)),
                "volume": [1.0] * 4,
                "amount": [1.0] * 4,
            }
        ),
    )
    res = evaluate_one(
        DataLayer(tmp_path),
        "600000.SH",
        "线: MA(CLOSE,2); 建仓: CROSS(CLOSE, 10);",
        "2024-01-04",
        display_bars=10,
    )
    assert res["code"] == "600000.SH" and len(res["bars"]) == 4
    assert res["bars"][-1]["close"] == 10.0
    assert "线" in res["lines"] and "建仓" in res["lines"]
    assert "建仓" in res["signal_outputs"]
    # CROSS 在第 3 根(index 2)为真
    assert [i for i, x in enumerate(res["lines"]["建仓"]) if x] == [2]
