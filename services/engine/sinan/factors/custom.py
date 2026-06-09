"""自定义 DSL 因子 → Factor 适配(M4 v3)。

把用户写的安全表达式(indicators 沙箱:白名单字段 + 仅回看算子)包装成与内置因子同构的 Factor,
即可直接进入 compute_factor_matrix / 因子质检 / 打分。

红线#1(无未来函数)双保险:
- PIT:面板取数全经 FactorContext(只见 <=asof;财务按 ann_date),T 日因子值不依赖任何 date>T 数据。
- DSL:operators 只暴露回看算子(rolling/shift 正向),结构上写不出前视;eval 仅在 <=asof 面板上算。
求值失败(字段缺失/语法)→ 降级空,如实(不补强)。
"""

from __future__ import annotations

import polars as pl

from sinan_contracts import Capability

from ..indicators.safe_eval import compile_expr
from ..indicators.validate import eval_compiled
from .context import FactorContext
from .library import Factor

_EMPTY = pl.DataFrame(schema={"stock_code": pl.Utf8, "value": pl.Float64})

_PRICE = ["stock_code", "trade_date", "open", "high", "low", "close", "volume", "amount"]
_BASIC = [
    "stock_code", "trade_date", "pe_ttm", "pb", "ps_ttm",
    "total_mv", "circ_mv", "turnover_rate", "dv_ttm",
]


def _build_dsl_panel(ctx: FactorContext) -> pl.DataFrame | None:
    """构造 DSL 求值长面板 [stock_code, trade_date, <白名单字段>](全经 ctx,<=asof,PIT)。"""
    px = ctx.history("price", _PRICE)
    if px.is_empty():
        return None
    panel = px.sort(["stock_code", "trade_date"]).with_columns(
        pl.col("volume").alias("vol"),
        (pl.col("close") / pl.col("close").shift(1).over("stock_code") - 1.0).alias("pct_change"),
    )
    basic = ctx.history("daily_basic", _BASIC)
    if not basic.is_empty():
        panel = panel.join(basic, on=["stock_code", "trade_date"], how="left")
    roe = ctx.latest_financial("fundamental", ["stock_code", "roe"])  # asof 最新一期,按股广播
    if not roe.is_empty():
        panel = panel.join(roe, on="stock_code", how="left")
    nb = ctx.history("northbound", ["stock_code", "trade_date", "north_hold_ratio"])
    if not nb.is_empty():
        panel = panel.join(nb, on=["stock_code", "trade_date"], how="left")
    return panel


def custom_factor(name: str, expr_str: str, group: str = "custom", direction: int = 1) -> Factor:
    """把 DSL 表达式编译成 Factor。expr 不安全(白名单外)→ compile_expr 抛 UnsafeExpression(调用方处理)。"""
    compiled = compile_expr(expr_str)  # 解析期静态校验(防注入/前视算子)

    def fn(ctx: FactorContext) -> pl.DataFrame:
        panel = _build_dsl_panel(ctx)
        if panel is None or panel.is_empty():
            return _EMPTY
        try:
            return eval_compiled(panel, compiled, asof=ctx.asof)
        except Exception:  # noqa: BLE001 字段缺失(如免费源无北向)/求值错 → 降级空,如实
            return _EMPTY

    return Factor(
        name=name, group=group, direction=direction, required_caps=Capability.DAILY_OHLCV, fn=fn
    )
