"""回测引擎:诚实评估地基(时序切分 / purge / embargo / walk-forward)+ 绩效指标。

红线#2 无虚假回测:只测 train_end+purge 之后;必含成本;禁随机切分。
红线#3 不夸大收益:指标一律样本外口径(由调用层保证);walk-forward 跨牛熊。
"""

from . import metrics, splits

__all__ = ["metrics", "splits"]
