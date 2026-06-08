"""测试公共工具:可控时钟 + 离线假 provider。"""

from __future__ import annotations

import polars as pl

from sinan.providers.base import (
    Capability,
    IDataProvider,
    ProviderHealth,
    ProviderStatus,
    Provider,
)


class FakePriceProvider(IDataProvider):
    """离线 provider:返回固定日期窗口的价量/复权/估值,不含北向(用于降级测试)。"""

    id = Provider.TUSHARE
    display_name = "fake"
    needs_token = False
    priority = 10

    def __init__(self, dates=("2024-01-02", "2024-01-03", "2024-01-04", "2024-01-05")) -> None:
        self.dates = list(dates)
        self.calls = 0

    def capabilities(self) -> Capability:
        return Capability.DAILY_OHLCV | Capability.ADJ_FACTOR | Capability.DAILY_BASIC

    def test_connection(self) -> ProviderHealth:
        return ProviderHealth(status=ProviderStatus.OK, caps={c.name: self.supports(c) for c in Capability})

    def _window(self, start: str, end: str) -> list[str]:
        return [d for d in self.dates if start <= d <= end]

    def daily_bars(self, code, start, end) -> pl.DataFrame:
        self.calls += 1
        ds = self._window(start, end)
        n = len(ds)
        return pl.DataFrame(
            {
                "stock_code": [code] * n,
                "trade_date": ds,
                "open": [1.0] * n,
                "high": [1.2] * n,
                "low": [0.9] * n,
                "close": [1.1] * n,
                "volume": [1000.0] * n,
                "amount": [1100.0] * n,
            }
        )

    def adj_factor(self, code, start, end) -> pl.DataFrame:
        ds = self._window(start, end)
        return pl.DataFrame(
            {"stock_code": [code] * len(ds), "trade_date": ds, "adj_factor": [1.0] * len(ds)}
        )

    def daily_basic(self, code, start, end) -> pl.DataFrame:
        ds = self._window(start, end)
        n = len(ds)
        return pl.DataFrame(
            {
                "stock_code": [code] * n,
                "trade_date": ds,
                "pe_ttm": [20.0] * n,
                "pb": [3.0] * n,
                "ps_ttm": [5.0] * n,
                "total_mv": [1e6] * n,
                "circ_mv": [8e5] * n,
                "turnover_rate": [1.5] * n,
                "dv_ttm": [2.0] * n,
            }
        )


class FakeClock:
    def __init__(self, start: float = 0.0) -> None:
        self.t = start

    def __call__(self) -> float:
        return self.t

    def advance(self, dt: float) -> None:
        self.t += dt

    def sleep(self, dt: float) -> None:
        """作为注入的 sleep:推进时钟而非真正阻塞。"""
        self.t += dt
