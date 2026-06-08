"""横截面处理(同一交易日截面内):MAD 去极值、zscore 标准化。

关键纪律:所有统计量(中位数/均值/std/MAD)只在当日截面内计算,绝不用全样本统计量
(那是经典未来函数)。nulls 在标准化后保持为 null(不强行填补,由合成层按 coverage 处理)。
"""

from __future__ import annotations

import polars as pl


def winsorize_mad(s: pl.Series, n: float = 3.0) -> pl.Series:
    """MAD 去极值:clip(median ± n·1.4826·MAD)。MAD 退化为 0 时回退到 n·std。"""
    x = s.cast(pl.Float64)
    med = x.median()
    if med is None:
        return x
    mad = (x - med).abs().median()
    if mad is None or mad == 0:
        std = x.std()
        if not std:
            return x
        lo, hi = med - n * std, med + n * std
    else:
        scale = 1.4826 * mad
        lo, hi = med - n * scale, med + n * scale
    return x.clip(lo, hi)


def zscore(s: pl.Series) -> pl.Series:
    """横截面 z-score。std=0 时返回全 0(保持长度);nulls 保持 null。"""
    x = s.cast(pl.Float64)
    mean = x.mean()
    std = x.std()
    if std is None or std == 0:
        return pl.Series(s.name, [0.0] * len(s), dtype=pl.Float64)
    return (x - mean) / std
