"""交易成本模型(回测与模拟盘一致)。印花税仅卖出(2023 后单边 0.05%);
佣金双边万 2.5、最低 5 元;过户费;冲击/滑点 bps。红线#2:成本必须计入。"""

from __future__ import annotations

from dataclasses import dataclass

from .. import config


@dataclass(frozen=True)
class CostBreakdown:
    commission: float
    stamp_tax: float
    transfer_fee: float
    impact: float

    @property
    def total(self) -> float:
        return self.commission + self.stamp_tax + self.transfer_fee + self.impact


@dataclass(frozen=True)
class CostModel:
    stamp_tax: float = 0.0005  # 仅卖出
    commission_rate: float = 0.00025  # 双边
    commission_min: float = 5.0
    transfer_fee_rate: float = 0.00001
    impact_bps: float = 5.0  # 冲击/滑点

    @classmethod
    def from_config(cls) -> "CostModel":
        c = config.defaults().get("cost_defaults", {})
        return cls(
            stamp_tax=c.get("stamp_tax", 0.0005),
            commission_rate=c.get("commission_rate", 0.00025),
            commission_min=c.get("commission_min", 5.0),
            transfer_fee_rate=c.get("transfer_fee_rate", 0.00001),
            impact_bps=c.get("impact_bps", 5.0),
        )

    def _commission(self, amount: float) -> float:
        return max(amount * self.commission_rate, self.commission_min)

    def _impact(self, amount: float) -> float:
        return amount * self.impact_bps / 10000.0

    def buy(self, amount: float) -> CostBreakdown:
        return CostBreakdown(
            commission=self._commission(amount),
            stamp_tax=0.0,  # 买入无印花税
            transfer_fee=amount * self.transfer_fee_rate,
            impact=self._impact(amount),
        )

    def sell(self, amount: float) -> CostBreakdown:
        return CostBreakdown(
            commission=self._commission(amount),
            stamp_tax=amount * self.stamp_tax,
            transfer_fee=amount * self.transfer_fee_rate,
            impact=self._impact(amount),
        )
