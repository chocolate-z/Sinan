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
    # 时序回看(交易日数):该因子经 ctx.history 需要的最大历史窗口。0=只用 latest 截面(无需历史);
    # None=未知/需全历史(自定义 DSL 因子可写任意窗口)。build_feature_panel 据此决定逐日窗口:
    # 全部已知 → 取 max 裁剪历史(提速);任一 None → 不裁剪(保正确,绝不少取致静默降级,红线#3)。
    lookback: int | None = 0
    # 展示用元数据(因子库 UI 用,不影响计算):中文名、类别、一句话说明。category 是给用户看的归类,
    # 比内部 group 细(动量/价值/质量/成长/情绪/波动/资金流/反转);留空则前端回退用 group。
    label: str = ""
    category: str = ""
    desc: str = ""

    def compute(self, ctx: FactorContext) -> pl.DataFrame:
        df = self.fn(ctx)
        return df if not df.is_empty() else _EMPTY


# ── 价值 / 规模(估值截面,daily_basic 最新一行)─────────────────────────────
def _ratio_factor(ctx: FactorContext, col: str) -> pl.DataFrame:
    """1/col(col>0 才有意义):PE→EP、PB→BP、PS→SP 同一套倒数估值因子。"""
    db = ctx.latest("daily_basic", ["stock_code", col])
    if db.is_empty():
        return _EMPTY
    return db.with_columns(
        pl.when(pl.col(col) > 0).then(1.0 / pl.col(col)).otherwise(None).alias("value")
    ).select("stock_code", "value")


def _ep(ctx: FactorContext) -> pl.DataFrame:
    return _ratio_factor(ctx, "pe_ttm")


def _bp(ctx: FactorContext) -> pl.DataFrame:
    return _ratio_factor(ctx, "pb")


def _sp(ctx: FactorContext) -> pl.DataFrame:  # 销售收益率 = 1/PS
    return _ratio_factor(ctx, "ps_ttm")


def _dy(ctx: FactorContext) -> pl.DataFrame:  # 股息率(dv_ttm 已是 TTM 收益率)
    db = ctx.latest("daily_basic", ["stock_code", "dv_ttm"])
    if db.is_empty():
        return _EMPTY
    return db.rename({"dv_ttm": "value"}).select("stock_code", "value")


def _size(ctx: FactorContext) -> pl.DataFrame:  # ln 流通市值(direction=-1 → 偏好小盘)
    db = ctx.latest("daily_basic", ["stock_code", "circ_mv"])
    if db.is_empty():
        return _EMPTY
    return db.with_columns(
        pl.when(pl.col("circ_mv") > 0).then(pl.col("circ_mv").log()).otherwise(None).alias("value")
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


def _hfq(ctx: FactorContext) -> pl.DataFrame:
    """后复权收盘:close × adj_factor(缺复权因子则用原始收盘)。供动量/反转/波动复用。"""
    px = ctx.history("price", ["stock_code", "trade_date", "close"])
    if px.is_empty():
        return px
    adj = ctx.history("adj_factor", ["stock_code", "trade_date", "adj_factor"])
    if not adj.is_empty():
        px = px.join(adj, on=["stock_code", "trade_date"], how="left").with_columns(
            (pl.col("close") * pl.col("adj_factor").fill_null(1.0)).alias("hfq")
        )
    else:
        px = px.with_columns(pl.col("close").alias("hfq"))
    return px


def _mom(ctx: FactorContext, n: int) -> pl.DataFrame:
    """n 日动量 = 后复权收盘的 n 日涨幅。反转因子复用它(再靠 direction=-1 翻向)。"""
    return _lagged(_hfq(ctx), "hfq", n, "ret")


def _mom20(ctx: FactorContext) -> pl.DataFrame:
    return _mom(ctx, 20)


def _mom60(ctx: FactorContext) -> pl.DataFrame:
    return _mom(ctx, 60)


def _reversal5(ctx: FactorContext) -> pl.DataFrame:  # direction=-1:近 5 日跌得多的反弹倾向
    return _mom(ctx, 5)


def _vol20(ctx: FactorContext) -> pl.DataFrame:  # 近 20 日收益波动(direction=-1:低波动占优)
    px = _hfq(ctx)
    if px.is_empty():
        return _EMPTY
    px = px.sort(["stock_code", "trade_date"]).with_columns(
        (pl.col("hfq") / pl.col("hfq").shift(1).over("stock_code") - 1.0).alias("_ret")
    )
    # 取每股最近 20 个有效日收益的标准差;tail(20) 而非依赖窗口 → 有界==无界逐值相等。
    return (
        px.group_by("stock_code", maintain_order=True)
        .agg(pl.col("_ret").drop_nulls().tail(20).std().alias("value"))
        .select("stock_code", "value")
    )


# ── 流动性(daily_basic 时序)──────────────────────────────────────────────
def _turn20(ctx: FactorContext) -> pl.DataFrame:  # 近 20 日平均换手(direction=-1:低换手占优)
    db = ctx.history("daily_basic", ["stock_code", "trade_date", "turnover_rate"])
    if db.is_empty():
        return _EMPTY
    return (
        db.sort(["stock_code", "trade_date"])
        .group_by("stock_code", maintain_order=True)
        .agg(pl.col("turnover_rate").drop_nulls().tail(20).mean().alias("value"))
        .select("stock_code", "value")
    )


# ── 北向(可能缺失 → 降级)───────────────────────────────────────────────
def _north_chg5(ctx: FactorContext) -> pl.DataFrame:
    nb = ctx.history("northbound", ["stock_code", "trade_date", "north_hold_ratio"])
    if nb.is_empty():
        return _EMPTY
    return _lagged(nb, "north_hold_ratio", 5, "diff")


def _north_chg20(ctx: FactorContext) -> pl.DataFrame:
    nb = ctx.history("northbound", ["stock_code", "trade_date", "north_hold_ratio"])
    if nb.is_empty():
        return _EMPTY
    return _lagged(nb, "north_hold_ratio", 20, "diff")


DEFAULT_FACTORS: list[Factor] = [
    # lookback = 该因子经 ctx.history 需要的回看窗(0=只用 latest 截面);特征面板取所有因子 max+缓冲。
    # direction:+1 大=好;-1 反向(规模/反转/波动/换手取负,使「大=好」)。末三项给因子库 UI 用。
    # ── 价值 ──
    Factor("ep", "value", +1, Capability.DAILY_BASIC, _ep, lookback=0,
           label="盈利收益率 EP", category="价值", desc="1/PE,越高越便宜"),
    Factor("bp", "value", +1, Capability.DAILY_BASIC, _bp, lookback=0,
           label="账面市值比 BP", category="价值", desc="1/PB,越高越便宜"),
    Factor("sp", "value", +1, Capability.DAILY_BASIC, _sp, lookback=0,
           label="销售收益率 SP", category="价值", desc="1/PS,营收相对市值,越高越便宜"),
    Factor("dy", "value", +1, Capability.DAILY_BASIC, _dy, lookback=0,
           label="股息率", category="价值", desc="近 12 个月股息率,越高越好"),
    # ── 规模(小盘溢价,反向)──
    Factor("size", "size", -1, Capability.DAILY_BASIC, _size, lookback=0,
           label="规模(小盘)", category="规模", desc="流通市值对数,偏好小盘(反向)"),
    # ── 质量 ──
    Factor("roe", "quality", +1, Capability.FUNDAMENTAL, _roe, lookback=0,
           label="ROE 质量", category="质量", desc="净资产收益率,越高质量越好"),
    # ── 动量 / 反转 ──
    Factor("mom20", "momentum", +1, Capability.DAILY_OHLCV, _mom20, lookback=20,
           label="20日动量", category="动量", desc="过去 20 日累计涨幅"),
    Factor("mom60", "momentum", +1, Capability.DAILY_OHLCV, _mom60, lookback=60,
           label="60日动量", category="动量", desc="过去 60 日累计涨幅"),
    Factor("reversal5", "reversal", -1, Capability.DAILY_OHLCV, _reversal5, lookback=5,
           label="短期反转", category="反转", desc="近 5 日跌多的反弹倾向(反向)"),
    # ── 波动 ──
    Factor("vol20", "volatility", -1, Capability.DAILY_OHLCV, _vol20, lookback=20,
           label="20日波动", category="波动", desc="近 20 日收益波动率,低波动占优(反向)"),
    # ── 流动性 ──
    Factor("turn20", "liquidity", -1, Capability.DAILY_BASIC, _turn20, lookback=20,
           label="20日换手", category="流动性", desc="近 20 日平均换手率,低换手占优(反向)"),
    # ── 资金流(北向,可能缺失 → 降级)──
    Factor("north_chg5", "northbound", +1, Capability.NORTHBOUND, _north_chg5, lookback=5,
           label="北向5日变动", category="资金流", desc="近 5 日北向持股比例变动"),
    Factor("north_chg20", "northbound", +1, Capability.NORTHBOUND, _north_chg20, lookback=20,
           label="北向20日变动", category="资金流", desc="近 20 日北向持股比例变动"),
]


def factor_meta() -> list[dict]:
    """因子库元数据(给 api/前端列因子用,不含计算逻辑)。每项:名、中文名、类别、内部组、方向、说明、
    所需数据能力(缺则该因子会降级)。前端据此画因子库表(类别分组 + 名 + 说明)。"""
    return [
        {
            "name": f.name,
            "label": f.label or f.name,
            "category": f.category or f.group,
            "group": f.group,
            "direction": f.direction,
            "desc": f.desc,
            "required_cap": f.required_caps.name,
        }
        for f in DEFAULT_FACTORS
    ]
