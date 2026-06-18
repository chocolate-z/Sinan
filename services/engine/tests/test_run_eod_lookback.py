"""回测/实盘逐日有界取数 run_eod_lookback 的回归:窗口口径正确 + 自定义因子不裁剪(红线#1)。

把回测逐日「重扫 ≤asof 全历史」降为「只取每股最近窗口」(O(N²)→O(N))。逐值不变性由
test_training_data 黄金测试(有界窗口 == 无界 lookback=None 逐值相等)传递性覆盖;本文件只钉口径。
"""

from sinan.factors import run_eod_lookback
from sinan.factors.library import DEFAULT_FACTORS

# 内置因子里最大回看 + 5 缓冲(run_eod_lookback 口径);随因子库扩充自动跟着变(当前 mom60=60 → 65)。
_EXPECTED = max(f.lookback for f in DEFAULT_FACTORS) + 5


def test_builtin_and_model_paths_bound_to_max_lookback_plus_buffer():
    # 内置因子 max 回看 + 5 缓冲;模型路径用同一批内置因子,同界。
    assert run_eod_lookback(None, None) == _EXPECTED
    assert run_eod_lookback({"coef": {"f_bp": 1.0}}, None) == _EXPECTED


def test_custom_factor_present_disables_truncation():
    # 自定义 DSL 因子(回看窗口未知,lookback=None)在场 → None 不裁剪,避免截断 60 日均线之类
    # 需更长历史的因子而算错值(红线#1:不截断未知回看)。
    custom = [{"name": "cf_mom5", "expr": "close / delay(close, 5) - 1", "group": "custom"}]
    assert run_eod_lookback(None, custom) is None


def test_invalid_custom_expr_falls_back_to_builtin_bound():
    # 无效 DSL 被沙箱拒、不计入因子集 → 退回内置因子界(诚实降级,不静默改窗口)。
    assert run_eod_lookback(None, [{"name": "evil", "expr": "__import__('os')"}]) == _EXPECTED
