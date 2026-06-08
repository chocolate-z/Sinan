"""盘后决策链 + T+1 撮合。

decide():T 日盘后,按「择时 → 止损止盈 → 候选(流动性+阈值+持仓上限+冷却)」产出 T+1 订单。
apply_fills():T+1 开盘价撮合(含成本),受 T+1 约束。两步分离 = 信号滞后1日 + 防未来函数。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from math import floor
from typing import Mapping, Sequence

import polars as pl

from .account import SimAccount
from .risk import market_open_allowed


@dataclass
class Order:
    code: str
    side: str  # buy / sell
    reason: str  # signal / stop_loss / take_profit / market_filter / rank_out


@dataclass
class OrderPlan:
    effective_date: str
    market_open: bool
    sells: list[Order] = field(default_factory=list)
    buys: list[Order] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)


DEFAULTS = {
    "max_holdings": 5,
    "buy_threshold": 0.65,  # percentile 阈值
    "stop_loss": -0.12,
    "take_profit": 0.30,
    "market_ma_days": 20,
}


def decide(
    scores: pl.DataFrame,
    account: SimAccount,
    *,
    prices_today: Mapping[str, float],
    bench_closes: Sequence[float],
    today: str,
    effective_date: str,
    params: dict | None = None,
    liquid: set[str] | None = None,
    cooldown: Mapping[str, str] | None = None,
) -> OrderPlan:
    p = {**DEFAULTS, **(params or {})}
    cooldown = cooldown or {}
    market_open = market_open_allowed(bench_closes, p["market_ma_days"])
    plan = OrderPlan(effective_date=effective_date, market_open=market_open)

    # ① 大盘择时闸:跌破 MA → 全清、不开新仓。
    if not market_open:
        for code in list(account.positions):
            plan.sells.append(Order(code, "sell", "market_filter"))
        plan.notes.append(f"大盘择时:沪深300 跌破 MA{p['market_ma_days']},清仓/不开新仓")
        return plan

    # ② 止损/止盈(对现有持仓)。
    sold_codes: set[str] = set()
    for code, pos in account.positions.items():
        px = prices_today.get(code)
        if px is None:
            continue
        ret = px / pos.avg_cost - 1.0
        if ret <= p["stop_loss"]:
            plan.sells.append(Order(code, "sell", "stop_loss"))
            sold_codes.add(code)
        elif ret >= p["take_profit"]:
            plan.sells.append(Order(code, "sell", "take_profit"))
            sold_codes.add(code)

    # ③ 候选池:持仓上限内,按打分排序补仓。
    remaining_held = len(account.positions) - len(sold_codes)
    slots = max(0, p["max_holdings"] - remaining_held)
    if slots > 0 and "percentile" in scores.columns:
        held = set(account.positions)
        ranked = scores.filter(pl.col("percentile") >= p["buy_threshold"]).sort(
            "score", descending=True, nulls_last=True
        )
        for row in ranked.iter_rows(named=True):
            code = row["stock_code"]
            if code in held or code in sold_codes:
                continue
            if liquid is not None and code not in liquid:
                continue
            if code in cooldown and cooldown[code] >= effective_date:
                continue
            plan.buys.append(Order(code, "buy", "signal"))
            if len(plan.buys) >= slots:
                break
    return plan


def apply_fills(
    account: SimAccount,
    plan: OrderPlan,
    open_prices: Mapping[str, float],
) -> list[str]:
    """T+1 开盘价撮合。先卖后买,买入等权分配可用现金(100 股整手)。返回跳过说明。"""
    skipped: list[str] = []
    date = plan.effective_date

    for o in plan.sells:
        px = open_prices.get(o.code)
        if px is None:
            skipped.append(f"{o.code} 无开盘价,跳过卖出")
            continue
        if not account.can_sell(date, o.code):
            skipped.append(f"{o.code} T+1 未满足,跳过卖出")
            continue
        account.sell(date, o.code, px, o.reason)

    buys = [o for o in plan.buys if open_prices.get(o.code)]
    for i, o in enumerate(buys):
        px = open_prices[o.code]
        # 按剩余现金 / 剩余笔数分配,预留 0.2% 成本头寸,100 股整手。
        budget = account.cash / (len(buys) - i)
        shares = int(floor((budget * 0.998) / px / 100.0) * 100)
        if shares <= 0:
            skipped.append(f"{o.code} 现金不足一手,跳过买入")
            continue
        account.buy(date, o.code, shares, px, o.reason)
    return skipped
