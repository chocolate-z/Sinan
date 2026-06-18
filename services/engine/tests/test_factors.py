"""M1 因子/打分自测:防未来函数黄金测试 + 横截面处理 + 北向缺失降级。"""

from datetime import date, timedelta

import polars as pl

from sinan.data import DataLayer, store
from sinan.factors import FactorContext, score_universe
from sinan.factors.cross_section import winsorize_mad, zscore
from sinan.factors.library import DEFAULT_FACTORS
from sinan.factors.score import compute_factor_matrix

CODES = ["600519.SH", "000001.SZ", "600036.SH", "000333.SZ", "601318.SH", "600000.SH"]


def _dates(n: int):
    start = date(2024, 1, 1)
    return [(start + timedelta(days=i)).isoformat() for i in range(n)]


def _build_frames(dates, *, with_northbound=True, future_after=None):
    """构造合成数据帧。future_after:在该日之后再加一期「未来公告」财务行(应不可见)。"""
    price, adj, basic, north = [], [], [], []
    for ci, code in enumerate(CODES):
        for di, d in enumerate(dates):
            close = 10.0 + ci + di * 0.1 + ci * 0.01
            price.append({
                "stock_code": code, "trade_date": d,
                "open": close * 0.99, "high": close * 1.01, "low": close * 0.98,
                "close": close, "volume": 1000.0 + di, "amount": close * 1000.0,
            })
            adj.append({"stock_code": code, "trade_date": d, "adj_factor": 1.0})
            basic.append({
                "stock_code": code, "trade_date": d,
                "pe_ttm": 10.0 + ci * 3 + di * 0.01, "pb": 1.0 + ci * 0.5,
                # 以下随股票/时间变化,让 sp/dy/size/turn20 等扩充因子有真实横截面区分度(原来是常数)。
                "ps_ttm": 4.0 + ci * 0.5, "total_mv": 1e6 * (ci + 1),
                "circ_mv": 8e5 * (ci + 1), "turnover_rate": 1.0 + ci * 0.3 + di * 0.01,
                "dv_ttm": 1.0 + ci * 0.4,
            })
            if with_northbound:
                north.append({
                    "stock_code": code, "trade_date": d,
                    "north_hold_ratio": 1.0 + ci * 0.3 + di * (0.01 + ci * 0.005),
                })

    fundamental = []
    for ci, code in enumerate(CODES):
        # 已公告(可见)的一期
        fundamental.append({
            "stock_code": code, "end_date": "2023-12-31", "ann_date": "2024-01-05",
            "roe": 5.0 + ci * 2.0,
        })
        if future_after:
            # 未来公告:报告期更新但公告日在 future_after 之后,asof 前不可见
            fundamental.append({
                "stock_code": code, "end_date": "2024-03-31", "ann_date": "2099-01-01",
                "roe": 999.0,
            })

    frames = {
        "price": pl.DataFrame(price),
        "adj_factor": pl.DataFrame(adj),
        "daily_basic": pl.DataFrame(basic),
        "fundamental": pl.DataFrame(fundamental),
    }
    if with_northbound:
        frames["northbound"] = pl.DataFrame(north)
    return frames


def _write(cache, frames, *, max_trade_date=None):
    for ds, df in frames.items():
        if max_trade_date and ds != "fundamental":
            df = df.filter(pl.col("trade_date") <= max_trade_date)
        if max_trade_date and ds == "fundamental":
            df = df.filter(pl.col("ann_date") <= max_trade_date)
        store.write_dataset(cache, ds, df)


def test_expanded_factors_effective_window_invariant_and_no_future(tmp_path):
    """扩充因子(sp/dy/size/mom60/reversal5/vol20/turn20/north_chg20)三件套:
    ① 都能算出有效值(不报错、不全降级);② 有界窗口==无界(lookback 设对);③ 无未来函数。"""
    dates = _dates(90)  # 够 mom60(60)/vol20 的回看窗
    T = dates[80]
    frames = _build_frames(dates, future_after=T)
    full = tmp_path / "full"
    _write(full, frames)
    trunc = tmp_path / "trunc"
    _write(trunc, frames, max_trade_date=T)

    # ① 新因子都进了 effective(有横截面区分度,没因数据缺失/报错被吞)
    _, effective, degraded = compute_factor_matrix(
        FactorContext(DataLayer(full), T, CODES), DEFAULT_FACTORS
    )
    for name in ["sp", "dy", "size", "mom60", "reversal5", "vol20", "turn20", "north_chg20"]:
        assert name in effective, f"扩充因子 {name} 没生效(降级了):{degraded}"

    # ② 有界 lookback(生产口径 max+5=65)与无界,因子矩阵逐值相等 —— 证明各因子 lookback 设够。
    mw, _, _ = compute_factor_matrix(
        FactorContext(DataLayer(full), T, CODES, lookback=65), DEFAULT_FACTORS
    )
    mu, _, _ = compute_factor_matrix(
        FactorContext(DataLayer(full), T, CODES, lookback=None), DEFAULT_FACTORS
    )
    assert mw.sort("stock_code").equals(mu.sort("stock_code")), "有界窗口与无界不一致 → 某因子 lookback 太小"

    # ③ 同一 T,截断 >T 数据后合成分逐值相等(含全部新因子)
    a = score_universe(FactorContext(DataLayer(full), T, CODES)).scores.select(
        ["stock_code", "score"]
    ).sort("stock_code")
    b = score_universe(FactorContext(DataLayer(trunc), T, CODES)).scores.select(
        ["stock_code", "score"]
    ).sort("stock_code")
    assert a.equals(b), "截断未来数据后打分变化 → 扩充因子里有未来函数"


def test_golden_no_future_function(tmp_path):
    """对历史日 T,截断 >T 数据重算打分,结果与全量一致(走 data.asof)。"""
    dates = _dates(70)
    T = dates[64]  # 之后还有 5 天「未来」数据;65 日历史够 mom60(60)等长窗因子全生效
    frames = _build_frames(dates, future_after=T)

    cache_full = tmp_path / "full"
    _write(cache_full, frames)  # 含 T 之后数据 + 未来公告财务
    cache_trunc = tmp_path / "trunc"
    _write(cache_trunc, frames, max_trade_date=T)  # 仅 <=T

    full = score_universe(FactorContext(DataLayer(cache_full), T, CODES))
    trunc = score_universe(FactorContext(DataLayer(cache_trunc), T, CODES))

    cols = ["stock_code", "score", "percentile"]
    a = full.scores.select(cols).sort("stock_code")
    b = trunc.scores.select(cols).sort("stock_code")
    assert a.equals(b), "asof(T) 打分受到了 >T 未来数据影响 —— 未来函数!"
    assert full.coverage == 1.0
    assert set(full.effective) == {f.name for f in DEFAULT_FACTORS}  # 够窗口 → 全部内置因子生效


def test_financial_uses_announced_not_reported(tmp_path):
    """财务按 ann_date 取:未来公告(ann>T)的报告期绝不进入打分。"""
    dates = _dates(30)
    T = dates[24]
    frames = _build_frames(dates, future_after=T)
    cache = tmp_path / "c"
    _write(cache, frames)
    # roe 因子值应来自已公告期(roe≈5+2ci),绝非 future 行的 999
    dl = DataLayer(cache)
    fin = dl.asof("fundamental", T, fields=["stock_code", "roe"], codes=CODES)
    assert fin["roe"].max() < 100, "用到了未公告的未来财务(roe=999)"


def test_degrade_when_northbound_missing(tmp_path):
    """免费源无北向:north_chg5/north_chg20 降级丢弃,权重重分配,coverage 标注。"""
    dates = _dates(70)
    T = dates[64]
    frames = _build_frames(dates, with_northbound=False)
    cache = tmp_path / "c"
    _write(cache, frames)

    res = score_universe(FactorContext(DataLayer(cache), T, CODES))
    assert "north_chg5" not in res.effective and "north_chg20" not in res.effective
    n_north = sum(1 for f in DEFAULT_FACTORS if "north" in f.name)  # 两个北向因子都降级
    assert abs(res.coverage - (len(DEFAULT_FACTORS) - n_north) / len(DEFAULT_FACTORS)) < 1e-9
    assert any("north_chg5" in d for d in res.degraded)
    # 仍能产出打分(基于剩余 4 因子)
    assert res.scores["score"].drop_nulls().len() == len(CODES)


def test_score_universe_with_custom_factor(tmp_path):
    """自定义 DSL 因子进等权打分:与内置因子并列贡献综合分;无效表达式如实降级不崩。"""
    dates = _dates(30)
    T = dates[24]
    cache = tmp_path / "c"
    _write(cache, _build_frames(dates))

    custom = [{"name": "mom10c", "expr": "close / delay(close, 10) - 1", "group": "custom"}]
    res = score_universe(FactorContext(DataLayer(cache), T, CODES), custom=custom)
    assert "mom10c" in res.effective  # 自定义因子进了等权合成
    assert "f_mom10c" in res.scores.columns
    assert "mom20" in res.effective  # 内置因子仍在
    assert res.scores["score"].drop_nulls().len() == len(CODES)

    # 无效表达式 → 沙箱拒 → 进 degraded,不崩、不入 effective(红线#3)。
    bad = score_universe(
        FactorContext(DataLayer(cache), T, CODES),
        custom=[{"name": "evil", "expr": "__import__('os')"}],
    )
    assert any("evil" in d for d in bad.degraded)
    assert "evil" not in bad.effective


def test_score_universe_builtin_subset_and_weight(tmp_path):
    """v2 因子库:builtin={名:权重} 只用列出的内置因子,开关/调权真正生效;None=全部内置等权(老行为)。"""
    dates = _dates(70)
    T = dates[64]
    cache = tmp_path / "c"
    _write(cache, _build_frames(dates))

    def ctx():
        return FactorContext(DataLayer(cache), T, CODES)

    # 子集:只启用 ep/bp,其余内置不进合成(开关生效)。
    sub = score_universe(ctx(), builtin={"ep": 1.0, "bp": 1.0})
    assert set(sub.effective) == {"ep", "bp"}
    assert sub.coverage == 1.0  # 应有 2 个、生效 2 个
    assert sub.scores["score"].drop_nulls().len() == len(CODES)

    # 空配置 = 全部禁用 → 诚实空打分,绝不造分(红线#3)。
    none = score_universe(ctx(), builtin={})
    assert none.effective == []
    assert none.scores["score"].drop_nulls().len() == 0

    # 调权真正进合成:压不同权重 → 综合分变化(否则调权只是 UI 摆设)。
    equal = score_universe(ctx(), builtin={"ep": 1.0, "bp": 1.0})
    tilted = score_universe(ctx(), builtin={"ep": 5.0, "bp": 1.0})
    a = equal.scores.sort("stock_code")["score"].to_list()
    b = tilted.scores.sort("stock_code")["score"].to_list()
    assert a != b

    # builtin=None → 老行为:全部内置等权。
    full = score_universe(ctx())
    assert set(full.effective) == {f.name for f in DEFAULT_FACTORS}


def test_composite_score_weighting():
    """加权合成(M4 自定义因子权重):按行跳 null 的加权均值;weight=0 剔除;全 0 退回等权。"""
    import pytest

    from sinan.factors.score import composite_score

    m = pl.DataFrame({"stock_code": ["A", "B", "C"], "f_a": [1.0, 0.0, -1.0], "f_b": [-1.0, 0.0, 1.0]})
    eff = ["a", "b"]

    # 等权(weights=None):mean(f_a,f_b) = [0,0,0]。
    s0 = composite_score(m, eff)["score"].to_list()
    assert s0 == pytest.approx([0.0, 0.0, 0.0])

    # a 权重 2、b 权重 1:(2·f_a + 1·f_b)/3。
    sw = composite_score(m, eff, {"a": 2.0, "b": 1.0}).sort("stock_code")["score"].to_list()
    assert sw == pytest.approx([(2 * 1 - 1) / 3, 0.0, (2 * -1 + 1) / 3])

    # b 权重 0 = 从合成剔除 → score 退化为 f_a。
    sb0 = composite_score(m, eff, {"a": 1.0, "b": 0.0}).sort("stock_code")["score"].to_list()
    assert sb0 == pytest.approx([1.0, 0.0, -1.0])

    # 全 0 权重 → 兜底等权(不产出全 null 假分)。
    sz = composite_score(m, eff, {"a": 0.0, "b": 0.0})["score"].to_list()
    assert sz == pytest.approx([0.0, 0.0, 0.0])

    # 按行跳 null:A 行 f_b 缺失 → 仅用 f_a(den=2,num=2·f_a → score=f_a)。
    mn = pl.DataFrame({"stock_code": ["A", "B"], "f_a": [1.0, 2.0], "f_b": [None, 2.0]})
    sn = composite_score(mn, eff, {"a": 2.0, "b": 1.0}).sort("stock_code")["score"].to_list()
    assert sn[0] == pytest.approx(1.0)  # A:f_b null → 跳过,score=f_a=1.0
    assert sn[1] == pytest.approx(2.0)  # B:(2·2+1·2)/3=2.0


def test_score_universe_custom_weight_scales_contribution(tmp_path):
    """自定义因子权重驱动合成:weight=1.0 与不传完全一致(零回归);weight≠1.0 放大其贡献改综合分。"""
    import pytest

    dates = _dates(30)
    T = dates[24]
    cache = tmp_path / "c"
    _write(cache, _build_frames(dates))
    EXPR = "close / delay(close, 10) - 1"

    def run(weight=None):
        c = {"name": "mom10c", "expr": EXPR, "group": "custom"}
        if weight is not None:
            c["weight"] = weight
        r = score_universe(FactorContext(DataLayer(cache), T, CODES), custom=[c])
        return r.scores.sort("stock_code")["score"].to_list()

    s_default, s_w1, s_w3 = run(), run(1.0), run(3.0)
    assert s_w1 == pytest.approx(s_default)  # weight=1.0 走等权路径,零回归
    assert s_w3 != pytest.approx(s_default)  # weight=3.0 放大自定义因子贡献 → 综合分变化


def test_cross_section_winsor_and_zscore():
    s = pl.Series("x", [1.0, 2.0, 3.0, 4.0, 100.0])  # 100 为极端值
    w = winsorize_mad(s, n=3.0)
    assert w.max() < 100.0  # 极端值被收缩
    z = zscore(pl.Series("x", [1.0, 2.0, 3.0, 4.0, 5.0]))
    assert abs(z.mean()) < 1e-9
    assert abs(z.std() - 1.0) < 1e-6
