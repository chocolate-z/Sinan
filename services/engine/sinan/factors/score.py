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


def _with_custom(factors: list[Factor], custom: list[dict] | None) -> tuple[list[Factor], list[str]]:
    """把启用的自定义 DSL 因子([{name,expr,group?}])包成 Factor 追加到内置因子后。

    表达式无效(沙箱拒)→ 跳过并如实记 degraded,不静默(红线#3)。延迟 import 避免循环。
    """
    if not custom:
        return list(factors), []
    from .custom import custom_factor

    out = list(factors)
    degraded: list[str] = []
    for c in custom:
        try:
            out.append(custom_factor(c["name"], c["expr"], c.get("group", "custom")))
        except Exception as e:  # noqa: BLE001
            degraded.append(f"{c.get('name', '?')}:表达式无效({e})")
    return out, degraded


def score_universe(
    ctx: FactorContext,
    factors: list[Factor] = DEFAULT_FACTORS,
    custom: list[dict] | None = None,
) -> ScoreResult:
    """等权多因子合成打分。custom = 启用的自定义 DSL 因子,与内置因子并列进等权(M4 v3)。"""
    all_factors, custom_degraded = _with_custom(factors, custom)
    matrix, effective, degraded = compute_factor_matrix(ctx, all_factors)
    scored = composite_score(matrix, effective)
    coverage = len(effective) / len(all_factors) if all_factors else 0.0
    return ScoreResult(
        scores=scored, coverage=coverage, effective=effective, degraded=degraded + custom_degraded
    )


def model_score_universe(
    ctx: FactorContext, model: dict, factors: list[Factor] = DEFAULT_FACTORS
) -> ScoreResult:
    """用已训练线性模型(系数 JSON,M3)给全市场打分:score = intercept + Σ coef·f。

    红线#1:特征走同一 compute_factor_matrix(asof PIT,只见 <=T);模型仅线性加权,绝不引入未来。
    缺失特征列(当日降级)按 0(z-score 截面中性值)计,诚实不补强;percentile 由模型分横截面排名。
    模型无可匹配特征列时退化为常数分(无区分度),不静默造假。
    """
    matrix, effective, degraded = compute_factor_matrix(ctx, factors)
    feature_cols = list(model.get("feature_cols", []))
    coef = list(model.get("coef", []))
    intercept = float(model.get("intercept", 0.0))

    expr = pl.lit(intercept, dtype=pl.Float64)
    for col, w in zip(feature_cols, coef):
        if col in matrix.columns:
            expr = expr + pl.col(col).fill_null(0.0) * float(w)
    scored = matrix.with_columns(expr.alias("score"))
    n = max(scored["score"].drop_nulls().len(), 1)
    scored = scored.with_columns((pl.col("score").rank(method="average") / n).alias("percentile"))
    scored = scored.sort("score", descending=True, nulls_last=True)

    coverage = len(effective) / len(factors) if factors else 0.0
    return ScoreResult(scores=scored, coverage=coverage, effective=effective, degraded=degraded)
