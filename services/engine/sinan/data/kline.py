"""K 线取数(本地 parquet,PIT 安全)。供行情页 KLineChart。

红线#1:历史 K 线一律走 data.asof —— 只见 trade_date<=end 的数据;追加任何
end 之后的行都不改变 kline(end=T) 的输出(黄金不变式由 test_kline 守护)。
前复权基线取「窗口内最新一日」的复权因子,故 asof(T) 只依赖 date<=T 的数据,
基线随 T 推移而变是前复权的应有之义,不是未来函数。
"""

from __future__ import annotations

import polars as pl

from .datalayer import DataLayer

_OHLC = ("open", "high", "low", "close")
_PRICE_FIELDS = ("stock_code", "trade_date", "open", "high", "low", "close", "volume", "amount")


def forward_adjust(prices: pl.DataFrame, adj: pl.DataFrame) -> tuple[pl.DataFrame, bool]:
    """前复权:OHLC × (adj_factor / 基线),基线 = 窗口内最新一日的 adj_factor。

    返回 (复权后 df, degraded)。adj 缺失(整体或部分)→ 该部分按原值并标 degraded(诚实降级)。
    成交量/额不复权(仅价格连续化,供视觉对比)。
    """
    if prices.is_empty() or adj.is_empty() or "adj_factor" not in adj.columns:
        return prices, True
    merged = prices.join(adj.select(["trade_date", "adj_factor"]), on="trade_date", how="left")
    n_null = int(merged["adj_factor"].null_count())
    if n_null == merged.height:
        return prices, True  # 完全无复权因子
    nonnull = merged.sort("trade_date")["adj_factor"].drop_nulls()
    base = nonnull.tail(1)[0] if not nonnull.is_empty() else None
    if base in (None, 0):
        return prices, True
    ratio = pl.col("adj_factor").fill_null(base) / base  # 缺失日按基线(ratio=1,保留原值)
    out = merged.with_columns([(pl.col(c) * ratio).round(4).alias(c) for c in _OHLC]).drop(
        "adj_factor"
    )
    return out, n_null > 0  # 部分缺失也算降级


def kline(
    data: DataLayer,
    code: str,
    *,
    start: str = "",
    end: str = "99999999",
    limit: int = 500,
    adjust: str = "qfq",
) -> tuple[list[dict], bool]:
    """取某股 [start, end](含端点)最后 limit 根日 K。返回 (rows, degraded)。

    end 默认 '99999999' —— 对 'YYYYMMDD' 与 'YYYY-MM-DD' 两种日期串都是通用字典序上界。
    adjust='qfq' 前复权 / 'none' 原始。空缓存返回 ([], False)。
    """
    prices = data.asof("price", end, fields=list(_PRICE_FIELDS), codes=[code])
    if prices.is_empty():
        return [], False
    if start:
        prices = prices.filter(pl.col("trade_date") >= start)
    prices = prices.sort("trade_date")
    degraded = False
    if adjust == "qfq":
        adj = data.asof(
            "adj_factor", end, fields=["stock_code", "trade_date", "adj_factor"], codes=[code]
        )
        prices, degraded = forward_adjust(prices, adj)
        prices = prices.sort("trade_date")
    if limit and prices.height > limit:
        prices = prices.tail(limit)
    return prices.select(list(_PRICE_FIELDS)).to_dicts(), degraded
