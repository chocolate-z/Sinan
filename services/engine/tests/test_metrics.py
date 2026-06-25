"""绩效指标口径测试(已知输入 → 已知输出)。"""

import math
from statistics import pstdev

from sinan.backtest import metrics as M


def test_cagr_one_year_double():
    nav = [1.0] * 252 + [2.0]  # 253 点 = 252 个日收益 ≈ 1 年;首 1 尾 2
    assert math.isclose(M.cagr(nav, periods=252), 1.0, rel_tol=1e-9)
    assert M.cagr([1.0], periods=252) == 0.0  # 样本不足
    assert M.cagr([0.0, 1.0], periods=252) == 0.0  # 首值非正


def test_total_return():
    assert math.isclose(M.total_return([2.0, 3.0]), 0.5)
    assert M.total_return([1.0]) == 0.0


def test_max_drawdown():
    assert math.isclose(M.max_drawdown([1.0, 1.2, 0.9, 1.5]), 0.25)  # 峰 1.2 → 谷 0.9
    assert M.max_drawdown([1.0, 2.0, 3.0]) == 0.0  # 单调升无回撤


def test_sharpe_zero_variance_and_positive():
    assert M.sharpe([0.01, 0.01, 0.01]) == 0.0  # 零波动 → 0(不返回 inf)
    assert M.sharpe([0.01, -0.01]) == 0.0  # 均值 0
    assert M.sharpe([0.01, 0.02, 0.03]) > 0  # 正向收益 → 正夏普
    assert M.sharpe([0.01]) == 0.0  # 样本不足


def test_tracking_error():
    assert math.isclose(M.tracking_error([0.01, -0.01]), 0.01 * math.sqrt(252))
    assert M.tracking_error([0.0]) == 0.0


def test_information_ratio():
    # 超额恒定(零波动)→ te=0 → ir=0,不返回 inf
    assert M.information_ratio([0.02, 0.02, 0.02], [0.01, 0.01, 0.01]) == 0.0
    # 有波动的正超额 → 正 IR
    assert M.information_ratio([0.03, 0.01, 0.03, 0.01], [0.0, 0.0, 0.0, 0.0]) > 0


def test_turnover():
    assert math.isclose(M.turnover({"A": 0.5, "B": 0.5}, {"A": 0.3, "C": 0.7}), 0.7)
    assert M.turnover({}, {}) == 0.0


def test_win_rate_and_profit_factor():
    assert math.isclose(M.win_rate([1, -1, 2, -3, 0]), 0.4)  # 2 盈 / 5 总
    assert M.win_rate([]) == 0.0
    assert math.isclose(M.profit_factor([1, -1, 2, -3]), 0.75)  # (1+2)/(1+3)
    assert M.profit_factor([1, 2]) == math.inf  # 无亏损
    assert M.profit_factor([-1, -2]) == 0.0  # 无盈利


def test_calmar():
    assert math.isclose(M.calmar(0.2, 0.1), 2.0)
    assert M.calmar(0.2, 0.0) == 0.0


def test_rank_ic():
    assert math.isclose(M.rank_ic([1, 2, 3, 4], [1, 2, 3, 4]), 1.0)  # 完全同序
    assert math.isclose(M.rank_ic([1, 2, 3, 4], [4, 3, 2, 1]), -1.0)  # 完全反序
    ic = M.rank_ic([1, 2, 3, 4], [1, 3, 2, 4])
    assert -1.0 <= ic <= 1.0


def test_icir():
    s = [0.1, 0.2, 0.3]
    assert math.isclose(M.icir(s), 0.2 / pstdev(s))
    assert M.icir([0.1, 0.1]) == 0.0  # 零标准差 → 0


def test_performance_aggregate():
    nav = [1.0] * 100 + [1.1]
    bench = [1.0] * 100 + [1.05]
    rep = M.performance(nav, bench, trade_pnls=[1, -1, 2])
    assert rep["days"] == 101
    assert math.isclose(rep["total_return"], 0.1)
    assert rep["annual_return"] > 0
    assert math.isclose(rep["excess_return"], rep["annual_return"] - rep["benchmark_return"])
    assert "information_ratio" in rep and "tracking_error" in rep
    assert rep["trades"] == 3
    assert math.isclose(rep["win_rate"], 2 / 3)
    # 不传新参数 → 不附 deflated_sharpe / style_attribution(向后兼容)
    assert "deflated_sharpe" not in rep and "style_attribution" not in rep
    # 有基准 → 必附白话判词(此例超额为正、IR 区间不定,只断言存在且为字符串)
    assert isinstance(rep.get("verdict"), str) and rep["verdict"]


def test_honest_verdict():
    assert "跑输" in M.honest_verdict(-0.0245, -0.08)      # 截图口径:超额负/IR负
    assert "跑输" in M.honest_verdict(0.03, 0.0)           # IR=0 也算无超额
    assert "未达目标" in M.honest_verdict(0.02, 0.3)        # 正超额但 IR<0.5
    assert "风格 beta" in M.honest_verdict(0.03, 0.7)       # 达标区间:警示是 beta
    assert "异常偏高" in M.honest_verdict(0.05, 1.5)        # IR>1 警惕


def test_deflated_sharpe_multiple_testing():
    # 每期夏普 ~0.1 的边(单看不错),N 次试验后应被折低
    rets = [0.001 + 0.01 * (1 if i % 2 == 0 else -1) for i in range(60)]
    p1 = M.deflated_sharpe(rets, n_trials=1, var_trials_sr=0.01)     # 单次=PSR(对0检验)
    p50 = M.deflated_sharpe(rets, n_trials=50, var_trials_sr=0.01)   # 50次试验=挑最好
    assert p1 > 0.7                      # 单看显著
    assert p50 < 0.5                     # 扣多重检验后被打回(<0.95 不算稳健)
    assert p50 < p1                      # 试验越多门槛越高
    # 守卫:样本不足 / 无离散度 → 0
    assert M.deflated_sharpe([0.01, 0.01], 5, 0.01) == 0.0
    assert M.deflated_sharpe(rets, 5, 0.0) == 0.0


def test_style_attribution_recovers_exposures():
    A = [0.01 if i % 2 == 0 else -0.01 for i in range(40)]
    B = [0.01 if (i // 2) % 2 == 0 else -0.01 for i in range(40)]   # 与 A 非共线
    # 纯线性组合(无独有 alpha):超额 = 1.5A − 0.5B + 截距 0.0005
    ex = [0.0005 + 1.5 * A[i] - 0.5 * B[i] for i in range(40)]
    rep = M.style_attribution(ex, {"价值": A, "规模": B})
    assert math.isclose(rep["exposures"]["价值"], 1.5, rel_tol=1e-6)
    assert math.isclose(rep["exposures"]["规模"], -0.5, rel_tol=1e-6)
    assert math.isclose(rep["alpha_annual"], 0.0005 * 252, rel_tol=1e-6)
    assert rep["r2"] > 0.99


def test_style_attribution_pure_beta_verdict():
    A = [0.01 if i % 2 == 0 else -0.01 for i in range(30)]
    ex = [2.0 * a for a in A]                       # 超额完全由风格解释,无 alpha
    rep = M.style_attribution(ex, {"价值": A})
    assert math.isclose(rep["exposures"]["价值"], 2.0, rel_tol=1e-6)
    assert abs(rep["alpha_annual"]) < 1e-6
    assert "无独有 alpha" in rep["verdict"]
    # 守卫
    assert M.style_attribution(ex, {})["verdict"] == "无风格序列"
