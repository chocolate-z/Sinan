"""风控闸(纪律 > 模型)。大盘择时是回撤控制最强单一开关。"""

from __future__ import annotations

from typing import Sequence


def market_open_allowed(bench_closes: Sequence[float], ma_days: int = 20) -> bool:
    """沪深300 收盘 >= MA(ma_days) → 允许开新仓;跌破 → 空仓/只减不增。

    历史不足 ma_days 时保守放行(无足够择时信息)。bench_closes 按时间升序,末位为最新。
    """
    closes = [c for c in bench_closes if c is not None]
    if len(closes) < ma_days:
        return True
    ma = sum(closes[-ma_days:]) / ma_days
    return closes[-1] >= ma
