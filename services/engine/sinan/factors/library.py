"""因子库(M1 最小集)。每因子纯函数 f(ctx)->DataFrame[stock_code,value],
声明 group / direction(+1 大=好,-1 反向取负)/ required_caps(缺则降级)。"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

import polars as pl

from sinan_contracts import Capability
from .context import FactorContext

_EMPTY = pl.DataFrame(schema={"stock_code": pl.Utf8, "value": pl.Float64})


@dataclass(frozen=True)
class Factor:
    name: str
    group: str  # value / quality / momentum / northbound
    direction: int  # +1 或 -1
    required_caps: Capability
    fn: Callable[[FactorContext], pl.DataFrame]

    def compute(self, ctx: FactorContext) -> pl.DataFrame:
        df = self.fn(ctx)
        return df if not df.is_empty() else _EMPTY


# ── 价值 ────────────────────────────────────────────────────────────────
def _ep(ctx: FactorContext) -> pl.DataFrame:
    db = ctx.latest("daily_basic", ["stock_code", "pe_ttm"])
    if db.is_empty():
        return _EMPTY
    return db.with_columns(
        pl.when(pl.col("pe_ttm") > 0).then(1.0 / pl.col("pe_ttm")).otherwise(None).alias("value")
    ).select("stock_code", "value")


def _bp(ctx: FactorContext) -> pl.DataFrame:
    db = ctx.latest("daily_basic", ["stock_code", "pb"])
    if db.is_empty():
        return _EMPTY
    return db.with_columns(
        pl.when(pl.col("pb") > 0).then(1.0 / pl.col("pb")).otherwise(None).alias("value")
    ).select("stock_code", "value")


# ── 质量(财务,ann_date PIT)────────────────────────────────────────────
def _roe(ctx: FactorContext) -> pl.DataFrame:
    fin = ctx.latest_financial("fundamental", ["stock_code", "roe"])
    if fin.is_empty():
        return _EMPTY
    return fin.rename({"roe": "value"}).select("stock_code", "value")


# ── 动量(后复权)────────────────────────────────────────────────────────
def _lagged(df: pl.DataFrame, col: str, n: int, mode: str) -> pl.DataFrame:
    """每只股票取 col 的 (最新值, 最新值前 n 行)。mode: 'ret'=比值-1,'diff'=差。"""
    if df.is_empty():
        return _EMPTY
    g = (
        df.sort(["stock_code", "trade_date"])
        .group_by("stock_code", maintain_order=True)
        .agg(
            pl.col(col).last().alias("_last"),
            pl.col(col).shift(n).last().alias("_lag"),
        )
    )
    if mode == "ret":
        expr = pl.when(pl.col("_lag") > 0).then(pl.col("_last") / pl.col("_lag") - 1.0).otherwise(None)
    else:
        expr = pl.col("_last") - pl.col("_lag")
    return g.with_columns(expr.alias("value")).select("stock_code", "value")


def _mom20(ctx: FactorContext) -> pl.DataFrame:
    px = ctx.history("price", ["stock_code", "trade_date", "close"])
    if px.is_empty():
        return _EMPTY
    adj = ctx.history("adj_factor", ["stock_code", "trade_date", "adj_factor"])
    if not adj.is_empty():
        px = px.join(adj, on=["stock_code", "trade_date"], how="left").with_columns(
            (pl.col("close") * pl.col("adj_factor").fill_null(1.0)).alias("hfq")
        )
    else:
        px = px.with_columns(pl.col("close").alias("hfq"))
    return _lagged(px, "hfq", 20, "ret")


# ── 北向(可能缺失 → 降级)───────────────────────────────────────────────
def _north_chg5(ctx: FactorContext) -> pl.DataFrame:
    nb = ctx.history("northbound", ["stock_code", "trade_date", "north_hold_ratio"])
    if nb.is_empty():
        return _EMPTY
    return _lagged(nb, "north_hold_ratio", 5, "diff")


DEFAULT_FACTORS: list[Factor] = [
    Factor("ep", "value", +1, Capability.DAILY_BASIC, _ep),
    Factor("bp", "value", +1, Capability.DAILY_BASIC, _bp),
    Factor("roe", "quality", +1, Capability.FUNDAMENTAL, _roe),
    Factor("mom20", "momentum", +1, Capability.DAILY_OHLCV, _mom20),
    Factor("north_chg5", "northbound", +1, Capability.NORTHBOUND, _north_chg5),
]
