"""模拟盘自测:成本(印花税/佣金/冲击)、T+1/移动加权成本/净值、风控决策链。"""

import polars as pl
import pytest

from sinan.paper import (
    CostModel,
    Order,
    OrderPlan,
    Position,
    SimAccount,
    T1Violation,
    apply_fills,
    decide,
    market_open_allowed,
)


# ── 成本 ────────────────────────────────────────────────────────────────
def test_costs_stamp_only_on_sell():
    cm = CostModel()
    buy = cm.buy(100_000)
    sell = cm.sell(100_000)
    assert buy.stamp_tax == 0.0  # 买入无印花税
    assert sell.stamp_tax == pytest.approx(100_000 * 0.0005)  # 卖出 0.05%
    assert buy.impact == pytest.approx(100_000 * 5 / 10_000)  # 冲击 5bps


def test_costs_min_commission():
    cm = CostModel()
    assert cm.buy(1_000).commission == 5.0  # max(1000*0.00025, 5) = 5


# ── 账户 ────────────────────────────────────────────────────────────────
def test_buy_moving_avg_cost_includes_fees():
    acc = SimAccount(cash=1_000_000)
    acc.buy("2024-01-10", "A", 100, 10.0)
    pos = acc.positions["A"]
    # 费用:佣金5 + 过户0.01 + 冲击0.5 = 5.51;avg=(1000+5.51)/100
    assert pos.avg_cost == pytest.approx(10.0551)
    assert acc.cash == pytest.approx(1_000_000 - 1005.51)


def test_t_plus_1_cannot_sell_same_day():
    acc = SimAccount(cash=1_000_000)
    acc.buy("2024-01-10", "A", 100, 10.0)
    assert acc.can_sell("2024-01-10", "A") is False
    with pytest.raises(T1Violation):
        acc.sell("2024-01-10", "A", 11.0)
    # 次日可卖
    assert acc.can_sell("2024-01-11", "A") is True
    acc.sell("2024-01-11", "A", 11.0)
    assert "A" not in acc.positions


def test_nav_marks_to_market():
    acc = SimAccount(cash=1000.0)
    acc.positions["A"] = Position("A", 100, 10.0, "d", "d")
    assert acc.nav({"A": 12.0}) == pytest.approx(1000.0 + 1200.0)


# ── 风控决策链 ──────────────────────────────────────────────────────────
def _rising(n=25):
    return [100.0 + i for i in range(n)]  # 升序,末位最高 → 站上 MA


def _falling(n=25):
    return [124.0 - i for i in range(n)]  # 降序,末位最低 → 跌破 MA


def _scores(codes_pcts):
    return pl.DataFrame(
        {
            "stock_code": [c for c, _ in codes_pcts],
            "score": [p * 3 for _, p in codes_pcts],
            "percentile": [p for _, p in codes_pcts],
        }
    )


def test_market_timing_gate():
    assert market_open_allowed(_rising(), 20) is True
    assert market_open_allowed(_falling(), 20) is False


def test_market_filter_clears_and_blocks_new(tmp_path):
    """沪深300<MA20 → 清仓 + 不开新仓。"""
    acc = SimAccount(cash=100_000)
    acc.positions["H1"] = Position("H1", 100, 10.0, "2024-01-01", "2024-01-01")
    scores = _scores([("A", 0.95), ("B", 0.9)])
    plan = decide(
        scores, acc,
        prices_today={"H1": 10.0}, bench_closes=_falling(),
        today="2024-01-10", effective_date="2024-01-11",
    )
    assert plan.market_open is False
    assert {o.code for o in plan.sells} == {"H1"}
    assert all(o.reason == "market_filter" for o in plan.sells)
    assert plan.buys == []


def test_position_cap_blocks_new_opens():
    """持仓=5(上限5)→ 不再开新仓。"""
    acc = SimAccount(cash=100_000)
    for i in range(5):
        c = f"P{i}"
        acc.positions[c] = Position(c, 100, 10.0, "2024-01-01", "2024-01-01")
    scores = _scores([("A", 0.99), ("B", 0.98)])
    plan = decide(
        scores, acc,
        prices_today={f"P{i}": 10.0 for i in range(5)},  # 无止损止盈
        bench_closes=_rising(),
        today="2024-01-10", effective_date="2024-01-11",
        params={"max_holdings": 5},
    )
    assert plan.market_open is True
    assert plan.sells == []
    assert plan.buys == []  # 仓位已满


def test_stop_loss_triggers_sell():
    acc = SimAccount(cash=100_000)
    acc.positions["X"] = Position("X", 100, 10.0, "2024-01-01", "2024-01-01")
    plan = decide(
        _scores([]), acc,
        prices_today={"X": 8.5},  # -15% <= -12% 止损
        bench_closes=_rising(),
        today="2024-01-10", effective_date="2024-01-11",
    )
    assert any(o.code == "X" and o.reason == "stop_loss" for o in plan.sells)


def test_take_profit_triggers_sell():
    acc = SimAccount(cash=100_000)
    acc.positions["Y"] = Position("Y", 100, 10.0, "2024-01-01", "2024-01-01")
    plan = decide(
        _scores([]), acc,
        prices_today={"Y": 13.5},  # +35% >= +30% 止盈
        bench_closes=_rising(),
        today="2024-01-10", effective_date="2024-01-11",
    )
    assert any(o.code == "Y" and o.reason == "take_profit" for o in plan.sells)


def test_decide_opens_topn_under_cap():
    acc = SimAccount(cash=100_000)
    scores = _scores([("A", 0.99), ("B", 0.95), ("C", 0.5)])  # C 低于阈值 0.65
    plan = decide(
        scores, acc,
        prices_today={}, bench_closes=_rising(),
        today="2024-01-10", effective_date="2024-01-11",
        params={"max_holdings": 5, "buy_threshold": 0.65},
        liquid={"A", "B", "C"},
    )
    assert [o.code for o in plan.buys] == ["A", "B"]  # 按分数序,C 被阈值挡掉


# ── T+1 撮合 ────────────────────────────────────────────────────────────
def test_apply_fills_buys_at_open_with_costs():
    acc = SimAccount(cash=100_000)
    plan = OrderPlan(effective_date="2024-01-11", market_open=True,
                     buys=[Order("A", "buy", "signal"), Order("B", "buy", "signal")])
    apply_fills(acc, plan, open_prices={"A": 10.0, "B": 20.0})
    assert set(acc.positions) == {"A", "B"}
    assert acc.cash < 100_000  # 现金减少(含成本)
    assert all(t.fee_total > 0 for t in acc.trades)  # 每笔含成本明细


def test_apply_fills_respects_t_plus_1_skip():
    acc = SimAccount(cash=100_000)
    acc.buy("2024-01-11", "A", 100, 10.0)  # 当日买入
    # 同日的卖出计划 → T+1 未满足,跳过(不抛错)
    plan = OrderPlan(effective_date="2024-01-11", market_open=True,
                     sells=[Order("A", "sell", "stop_loss")])
    skipped = apply_fills(acc, plan, open_prices={"A": 9.0})
    assert "A" in acc.positions  # 未被卖出
    assert any("T+1" in s for s in skipped)
