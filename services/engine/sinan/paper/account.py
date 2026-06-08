"""模拟盘虚拟账户:现金 / 持仓 / 流水。T+1(当日买不可卖)、移动加权成本、按市值估净值。

记账权威表在 engine 内(sim_account/sim_position/sim_trade);跑完经 api 回传落库展示视图。
本类是内存账本,纯函数化便于单测,不触 SQLite(红线#6)。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Mapping

from .costs import CostModel, CostBreakdown


class T1Violation(Exception):
    """违反 T+1:试图卖出当日买入的持仓。"""


class InsufficientCash(Exception):
    pass


@dataclass
class Position:
    code: str
    shares: int
    avg_cost: float  # 含买入费用的移动加权成本
    open_date: str
    last_buy_date: str


@dataclass
class Trade:
    trade_date: str
    code: str
    side: str  # buy / sell
    shares: int
    price: float
    amount: float
    commission: float
    stamp_tax: float
    transfer_fee: float
    impact: float
    fee_total: float
    reason: str


@dataclass
class SimAccount:
    cash: float
    costs: CostModel = field(default_factory=CostModel)
    positions: dict[str, Position] = field(default_factory=dict)
    trades: list[Trade] = field(default_factory=list)

    def _record(self, date, code, side, shares, price, cb: CostBreakdown, reason):
        self.trades.append(
            Trade(
                trade_date=date, code=code, side=side, shares=shares, price=price,
                amount=shares * price, commission=cb.commission, stamp_tax=cb.stamp_tax,
                transfer_fee=cb.transfer_fee, impact=cb.impact, fee_total=cb.total, reason=reason,
            )
        )

    def buy(self, date: str, code: str, shares: int, price: float, reason: str = "signal") -> None:
        if shares <= 0:
            return
        amount = shares * price
        cb = self.costs.buy(amount)
        outflow = amount + cb.total
        if outflow > self.cash + 1e-6:
            raise InsufficientCash(f"现金不足:需 {outflow:.2f},有 {self.cash:.2f}")
        self.cash -= outflow
        pos = self.positions.get(code)
        if pos:
            basis = pos.shares * pos.avg_cost + amount + cb.total
            pos.shares += shares
            pos.avg_cost = basis / pos.shares
            pos.last_buy_date = date
        else:
            self.positions[code] = Position(
                code=code, shares=shares, avg_cost=(amount + cb.total) / shares,
                open_date=date, last_buy_date=date,
            )
        self._record(date, code, "buy", shares, price, cb, reason)

    def can_sell(self, date: str, code: str) -> bool:
        pos = self.positions.get(code)
        return bool(pos) and date > pos.last_buy_date  # T+1:严格晚于最近买入日

    def sell(self, date: str, code: str, price: float, reason: str = "signal", shares: int | None = None) -> None:
        pos = self.positions.get(code)
        if not pos:
            return
        if date <= pos.last_buy_date:
            raise T1Violation(f"{code} 于 {pos.last_buy_date} 买入,{date} 不可卖(T+1)")
        qty = pos.shares if shares is None else min(shares, pos.shares)
        if qty <= 0:
            return
        amount = qty * price
        cb = self.costs.sell(amount)
        self.cash += amount - cb.total
        pos.shares -= qty
        if pos.shares == 0:
            del self.positions[code]
        self._record(date, code, "sell", qty, price, cb, reason)

    def holdings_value(self, prices: Mapping[str, float]) -> float:
        return sum(p.shares * prices.get(c, p.avg_cost) for c, p in self.positions.items())

    def nav(self, prices: Mapping[str, float]) -> float:
        return self.cash + self.holdings_value(prices)
