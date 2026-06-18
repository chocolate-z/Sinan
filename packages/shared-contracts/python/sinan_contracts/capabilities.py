"""能力位(Capability)Python 绑定 —— 镜像自 spec/capabilities.json。"""

from __future__ import annotations

from enum import IntFlag
from typing import Mapping

# 与 spec/capabilities.json 一致(consistency 测试守护)。
CAPABILITIES: tuple[str, ...] = (
    "DAILY_OHLCV",
    "ADJ_FACTOR",
    "REALTIME_QUOTE",
    "FUNDAMENTAL",
    "FINA_INDICATOR",
    "DAILY_BASIC",
    "NORTHBOUND",
    "INDEX_OHLCV",
    "INDEX_WEIGHT",
    "SW_INDUSTRY",
    "EARNINGS_FORECAST",
    "TRADE_CAL",
    "FUND_PORTFOLIO",
)

CAPABILITY_BIT: dict[str, int] = {name: i for i, name in enumerate(CAPABILITIES)}


class Capability(IntFlag):
    """位掩码能力枚举,用于引擎按能力路由 / 降级判断。"""

    DAILY_OHLCV = 1 << 0
    ADJ_FACTOR = 1 << 1
    REALTIME_QUOTE = 1 << 2
    FUNDAMENTAL = 1 << 3
    FINA_INDICATOR = 1 << 4
    DAILY_BASIC = 1 << 5
    NORTHBOUND = 1 << 6
    INDEX_OHLCV = 1 << 7
    INDEX_WEIGHT = 1 << 8
    SW_INDUSTRY = 1 << 9
    EARNINGS_FORECAST = 1 << 10
    TRADE_CAL = 1 << 11
    FUND_PORTFOLIO = 1 << 12


def caps_to_record(caps: Capability) -> dict[str, bool]:
    """位掩码 → caps_json(12 个能力名全给布尔值)。"""
    return {name: bool(caps & Capability[name]) for name in CAPABILITIES}


def record_to_caps(record: Mapping[str, bool]) -> Capability:
    """caps_json → 位掩码(仅 True 的能力置位)。"""
    flag = Capability(0)
    for name, present in record.items():
        if present and name in CAPABILITY_BIT:
            flag |= Capability[name]
    return flag
