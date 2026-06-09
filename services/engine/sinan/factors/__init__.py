"""因子库 + 横截面处理 + 多因子合成打分。全程 PIT(data.asof),防未来函数。"""

from .context import FactorContext
from .library import DEFAULT_FACTORS, Factor
from .score import (
    ScoreResult,
    compute_factor_matrix,
    composite_score,
    model_score_universe,
    score_universe,
)

__all__ = [
    "FactorContext",
    "Factor",
    "DEFAULT_FACTORS",
    "ScoreResult",
    "compute_factor_matrix",
    "composite_score",
    "model_score_universe",
    "score_universe",
]
