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
