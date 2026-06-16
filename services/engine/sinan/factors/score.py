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


def composite_score(
    matrix: pl.DataFrame, effective: list[str], weights: dict[str, float] | None = None
) -> pl.DataFrame:
    """合成分。weights=None 走等权(mean_horizontal,零回归);否则按因子权重加权。

    加权口径 = 逐行「跳 null 的加权均值」:score = Σ(w·f) / Σ(w),仅对该行非 null 的因子求和
    (与 mean_horizontal 逐行跳 null 语义一致;全 null 行 → null,不补强)。权重缺省 1.0;
    某因子 weight=0 等价从合成中剔除;总权重<=0(全 0)→ 退回等权,绝不产出全 null 假分。
    """
    cols = [f"f_{n}" for n in effective]
    if not cols:
        return matrix.with_columns(
            pl.lit(None, dtype=pl.Float64).alias("score"),
            pl.lit(None, dtype=pl.Float64).alias("percentile"),
        )
    if weights is None:
        score_expr = pl.mean_horizontal(cols)
    else:
        ws = [float(weights.get(n, 1.0)) for n in effective]
        if sum(ws) <= 0:  # 全 0/负 → 等权兜底(避免除零得全 null)
            score_expr = pl.mean_horizontal(cols)
        else:
            num = pl.sum_horizontal([pl.col(c).fill_null(0.0) * w for c, w in zip(cols, ws)])
            den = pl.sum_horizontal(
                [pl.when(pl.col(c).is_not_null()).then(w).otherwise(0.0) for c, w in zip(cols, ws)]
            )
            score_expr = pl.when(den > 0).then(num / den).otherwise(None)
    scored = matrix.with_columns(score_expr.alias("score"))
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


def run_eod_lookback(model: dict | None, custom: list[dict] | None) -> int | None:
    """run_eod 逐日 FactorContext 的有界窗口:把回测/实盘逐日「重扫 ≤asof 全历史」降为「只取每股最近
    窗口」(O(N²)→O(N·窗口)),PIT 安全、逐值不变。内置/模型路径 → 内置因子 max 回看 + 5 缓冲行裁剪;
    自定义因子在场(DSL 闭包回看窗口未知)→ None 不裁剪(保正确,红线#1)。与训练 _resolve_lookback 同
    口径;正确性由 test_training_data 黄金测试(有界==无界逐值相等)覆盖。"""
    factors = list(DEFAULT_FACTORS) if model else _with_custom(DEFAULT_FACTORS, custom)[0]
    lbs = [f.lookback for f in factors]
    return None if any(lb is None for lb in lbs) else max(lbs, default=0) + 5


def score_universe(
    ctx: FactorContext,
    factors: list[Factor] = DEFAULT_FACTORS,
    custom: list[dict] | None = None,
    builtin: dict[str, float] | None = None,
) -> ScoreResult:
    """多因子合成打分。custom = 启用的自定义 DSL 因子,与内置因子并列(M4 v3)。

    builtin(v2 内置因子可配):{因子名: 权重} = 启用的内置因子及其权重。None → 全部内置启用、各 1.0
    (旧行为完全不变);给了就只用其中列出的内置因子,并按各自权重合成(内置/自定义统一走加权)。

    权重口径:内置取 builtin 里的值(None 时恒 1.0);自定义取各自 weight(缺省 1.0)。
    全为 1.0 时退回等权路径(零回归);存在 ≠1.0 权重才走加权合成。
    """
    base = [f for f in factors if f.name in builtin] if builtin is not None else factors
    all_factors, custom_degraded = _with_custom(base, custom)
    matrix, effective, degraded = compute_factor_matrix(ctx, all_factors)
    weights: dict[str, float] = {}
    if builtin:
        weights.update({n: float(w) for n, w in builtin.items()})
    weights.update({c["name"]: float(c.get("weight", 1.0)) for c in (custom or [])})
    use_weights = any(w != 1.0 for w in weights.values())
    scored = composite_score(matrix, effective, weights if use_weights else None)
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
