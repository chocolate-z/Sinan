"""自定义指标自测:白名单安全沙箱拒恶意表达式 + 合法求值 + 防未来函数穿越测试 + 内置指标。"""

from datetime import date, timedelta

import polars as pl
import pytest

from sinan.indicators import (
    BUILTIN_INDICATORS,
    UnsafeExpression,
    compile_expr,
    crossing_test,
    eval_compiled,
    evaluate,
    validate,
)

CODES = ["600519.SH", "000001.SZ", "600036.SH", "000333.SZ"]


def _panel(n=30):
    start = date(2024, 1, 1)
    rows = []
    for ci, code in enumerate(CODES):
        for di in range(n):
            d = (start + timedelta(days=di)).isoformat()
            close = 10.0 + ci + di * 0.1
            rows.append({
                "stock_code": code, "trade_date": d,
                "close": close, "pct_change": 0.01 + ci * 0.001,
                "pe_ttm": 10.0 + ci * 3 + di * 0.01, "pb": 1.0 + ci * 0.5,
                "turnover_rate": 1.5 + ci * 0.2,
                "roe": 5.0 + ci * 2.0,
                "north_hold_ratio": 1.0 + ci * 0.3 + di * (0.01 + ci * 0.005),
            })
    return pl.DataFrame(rows)


# ── 安全沙箱:恶意/非法表达式必须被拒 ────────────────────────────────────
MALICIOUS = [
    "__import__('os')",
    "close.__class__",
    "open.read()",            # 属性访问
    "[x for x in close]",     # 推导式
    "(lambda: 1)()",          # lambda
    "foo(close)",             # 未知函数
    "close + bar",            # 未知字段
    "delay(close, -1)",       # 负滞后(会引入未来)
    "close[0]",               # 下标
]


@pytest.mark.parametrize("expr", MALICIOUS)
def test_malicious_rejected(expr):
    with pytest.raises(UnsafeExpression):
        compile_expr(expr)
    assert validate(expr).ok is False


# ── 合法表达式可编译可求值 ───────────────────────────────────────────────
def test_valid_expression_compiles_and_evaluates():
    expr = "zscore(-pe_ttm) * 0.4 + zscore(roe) * 0.4 + rank(ts_delta(north_hold_ratio, 5)) * 0.2"
    res = validate(expr)
    assert res.ok is True
    panel = _panel()
    out = evaluate(panel, expr, asof=panel["trade_date"].max())
    assert out.height == len(CODES)
    assert "value" in out.columns


def test_rsi_builtin_dsl():
    panel = _panel()
    out = evaluate(panel, "rsi(close, 14)", asof=panel["trade_date"].max())
    assert out.height == len(CODES)


# ── 防未来函数:穿越测试 ─────────────────────────────────────────────────
def test_crossing_test_passes_for_backward_expr():
    panel = _panel()
    asof = panel["trade_date"].to_list()[24]
    assert crossing_test(panel, "ts_mean(close, 5)", asof) is True
    res = validate(panel=panel, asof=asof, expr_str="ts_mean(close, 5)") if False else validate("ts_mean(close, 5)", panel, asof)
    assert res.ok is True
    assert res.lookahead_ok is True


def test_crossing_test_detects_future_leak():
    """机制验证:前视表达式(forward shift)在截断 >T 后结果改变 → 被穿越测试判定为未来函数。
    DSL 不暴露前视算子,这里用底层 forward 表达式证明穿越测试有牙齿。"""
    panel = _panel()
    asof = panel["trade_date"].to_list()[24]
    forward = pl.col("close").shift(-1).over("stock_code")  # 引用未来一日
    full = eval_compiled(panel, forward, asof)
    trunc = eval_compiled(panel.filter(pl.col("trade_date") <= asof), forward, asof)
    assert not full.equals(trunc), "穿越测试应能区分前视表达式"


# ── 内置指标 ─────────────────────────────────────────────────────────────
def test_all_builtin_indicators_compile():
    for name, (_, expr) in BUILTIN_INDICATORS.items():
        compile_expr(expr)  # 不抛即通过


def test_builtin_ma_matches_manual():
    panel = _panel()
    asof = panel["trade_date"].max()
    a = evaluate(panel, "ma(close, 5)", asof)
    b = evaluate(panel, "ts_mean(close, 5)", asof)
    assert a.equals(b)
