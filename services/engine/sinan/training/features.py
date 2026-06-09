"""特征面板:把「单一 asof 截面」的因子矩阵堆叠成 ML 训练所需的 date×code 长表。

纯组合现有积木(FactorContext + compute_factor_matrix),不新增取数路径:
- 每个交易日 T 各自 FactorContext(asof=T) → compute_factor_matrix(已去极值/标准化/方向,且
  统计量只在当日截面内算,红线#1)→ 加 date 列 → 纵向堆叠。
- 列集固定为 factors 全集(某日某因子降级则该日该列为 null,不静默、不补 0)。

红线#1(无未来函数):特征仅经 DataLayer.asof(只见 <=T),T 日特征不依赖任何 date>T 的数据
(由 data.asof 黄金测试守护)。本模块绝不读取未来价 —— 前向收益是 labels.py 的职责,两者严禁混用。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Sequence

import polars as pl

from ..data import DataLayer
from ..factors import FactorContext
from ..factors.library import DEFAULT_FACTORS, Factor
from ..factors.score import compute_factor_matrix


@dataclass
class FeaturePanel:
    panel: pl.DataFrame  # 长表:date, stock_code, f_<name>...(降级处为 null)
    feature_cols: list[str]  # 固定特征列(factors 全集)
    degraded_days: dict[str, int] = field(default_factory=dict)  # 因子名 → 降级天数(诚实上报)
    n_dates: int = 0


def build_feature_panel(
    data: DataLayer,
    codes: Sequence[str],
    dates: Sequence[str],
    factors: list[Factor] = DEFAULT_FACTORS,
) -> FeaturePanel:
    """构造 date×code 特征长表。dates 为升序交易日;codes 为股票池。

    返回的 panel 每行 = 某日某股的标准化因子向量;某因子当日无有效数据则该列 null。
    """
    feature_cols = [f"f_{f.name}" for f in factors]
    uniq_dates = sorted(set(dates))
    frames: list[pl.DataFrame] = []
    degraded_days: dict[str, int] = {}

    for d in uniq_dates:
        ctx = FactorContext(data, d, codes)
        matrix, effective, _degraded = compute_factor_matrix(ctx, factors)
        # 补齐缺失(降级)列为 null,保证各日列集一致可纵向堆叠。
        missing = [c for c in feature_cols if c not in matrix.columns]
        if missing:
            matrix = matrix.with_columns(
                [pl.lit(None, dtype=pl.Float64).alias(c) for c in missing]
            )
        matrix = matrix.with_columns(pl.lit(d).alias("date")).select(
            ["date", "stock_code", *feature_cols]
        )
        frames.append(matrix)
        for f in factors:
            if f.name not in effective:
                degraded_days[f.name] = degraded_days.get(f.name, 0) + 1

    if not frames:
        panel = pl.DataFrame(
            schema={
                "date": pl.Utf8,
                "stock_code": pl.Utf8,
                **{c: pl.Float64 for c in feature_cols},
            }
        )
    else:
        panel = pl.concat(frames, how="vertical")

    return FeaturePanel(
        panel=panel,
        feature_cols=feature_cols,
        degraded_days=degraded_days,
        n_dates=len(uniq_dates),
    )
