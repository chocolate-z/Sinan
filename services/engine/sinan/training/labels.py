"""前向收益标签:label[T] = 后复权收盘 hfq[T+horizon] / hfq[T] - 1。

⚠️ 红线#1 最高泄漏风险区。纪律:
- 标签是「未来」收益,**只能用于 label,绝不可混入任何特征**(features.py 经 asof 只见 <=T)。
- 防泄漏的根本机制不在本文件,而在切分:walk_forward 的 purge >= label_horizon 保证
  「训练样本标签的前瞻窗(train_end..train_end+horizon)」与「测试样本的特征(>=train_end+purge)」
  不重叠。本文件只负责诚实计算前向收益,最后 horizon 个交易日因无未来 → label 为 null(不编造)。
- 前向位移按「每只股票自身的已交易日序列」shift(-horizon)(与因子 mom20 的 _lagged 同口径),
  停牌缺日不补、不前向填充。
"""

from __future__ import annotations

from typing import Sequence

import polars as pl

from ..data import DataLayer

# 取「全部可见历史」用,asof 上界(YYYYMMDD 比较恒成立);训练为离线历史计算,非泄漏。
_FAR_FUTURE = "99999999"


def build_forward_return_labels(
    data: DataLayer,
    codes: Sequence[str],
    horizon: int,
) -> pl.DataFrame:
    """返回长表 [date, stock_code, label]。label 为 (date, code) 的未来 horizon 日后复权收益。

    horizon 必须 >= 1。最后 horizon 个交易日(每股各自)无未来价 → label = null。
    """
    if horizon < 1:
        raise ValueError(f"label horizon 必须 >= 1,收到 {horizon}")

    px = data.asof(
        "price", _FAR_FUTURE, fields=["stock_code", "trade_date", "close"], codes=codes
    )
    if px.is_empty():
        return pl.DataFrame(
            schema={"date": pl.Utf8, "stock_code": pl.Utf8, "label": pl.Float64}
        )

    adj = data.asof(
        "adj_factor", _FAR_FUTURE, fields=["stock_code", "trade_date", "adj_factor"], codes=codes
    )
    if not adj.is_empty():
        px = px.join(adj, on=["stock_code", "trade_date"], how="left").with_columns(
            (pl.col("close") * pl.col("adj_factor").fill_null(1.0)).alias("hfq")
        )
    else:
        px = px.with_columns(pl.col("close").alias("hfq"))

    px = px.sort(["stock_code", "trade_date"]).with_columns(
        pl.col("hfq").shift(-horizon).over("stock_code").alias("_fwd")
    )
    px = px.with_columns(
        pl.when(pl.col("hfq") > 0)
        .then(pl.col("_fwd") / pl.col("hfq") - 1.0)
        .otherwise(None)
        .alias("label")
    )
    return px.select(
        pl.col("trade_date").alias("date"),
        pl.col("stock_code"),
        pl.col("label"),
    )
