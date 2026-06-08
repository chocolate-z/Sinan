"""多因子合成打分:单因子 → 横截面处理(去极值/标准化/方向)→ 等权合成 → percentile。

降级永不静默:某因子无有效数据(如免费源缺北向)即丢弃,权重由剩余因子重分配(等权),
并在 coverage / degraded 报告中标注,供信号详情与日志诚实告知用户「预期更低」。
"""

from __future__ import annotations

from dataclasses import dataclass, field

import polars as pl

from .context import FactorContext
from .cross_section import winsorize_mad, zscore
from .library import DEFAULT_FACTORS, Factor


@dataclass
class ScoreResult:
    scores: pl.DataFrame  # stock_code, score, percentile, f_<name>...
    coverage: float  # 生效因子数 / 应有因子数
    effective: list[str] = field(default_factory=list)
    degraded: list[str] = field(default_factory=list)


def compute_factor_matrix(
    ctx: FactorContext, factors: list[Factor] = DEFAULT_FACTORS
) -> tuple[pl.DataFrame, list[str], list[str]]:
    base = pl.DataFrame({"stock_code": ctx.codes})
    effective: list[str] = []
    degraded: list[str] = []

    for f in factors:
        col = f"f_{f.name}"
        df = f.compute(ctx).rename({"value": col})
        base = base.join(df, on="stock_code", how="left")
        if col not in base.columns:
            base = base.with_columns(pl.lit(None, dtype=pl.Float64).alias(col))

        if base[col].drop_nulls().len() < 2:
            degraded.append(f"{f.name}({f.group}) 无有效数据,已降级")
            base = base.drop(col)
            continue

        # 横截面:去极值 → 标准化 → 方向统一(反向因子取负,使「大=好」)。
        processed = zscore(winsorize_mad(base[col])) * float(f.direction)
        base = base.with_columns(processed.alias(col))
        effective.append(f.name)

    return base, effective, degraded


def composite_score(matrix: pl.DataFrame, effective: list[str]) -> pl.DataFrame:
    cols = [f"f_{n}" for n in effective]
    if not cols:
        return matrix.with_columns(
            pl.lit(None, dtype=pl.Float64).alias("score"),
            pl.lit(None, dtype=pl.Float64).alias("percentile"),
        )
    scored = matrix.with_columns(pl.mean_horizontal(cols).alias("score"))
    n = max(scored["score"].drop_nulls().len(), 1)
    scored = scored.with_columns(
        (pl.col("score").rank(method="average") / n).alias("percentile")
    )
    return scored.sort("score", descending=True, nulls_last=True)


def score_universe(ctx: FactorContext, factors: list[Factor] = DEFAULT_FACTORS) -> ScoreResult:
    matrix, effective, degraded = compute_factor_matrix(ctx, factors)
    scored = composite_score(matrix, effective)
    coverage = len(effective) / len(factors) if factors else 0.0
    return ScoreResult(scores=scored, coverage=coverage, effective=effective, degraded=degraded)
