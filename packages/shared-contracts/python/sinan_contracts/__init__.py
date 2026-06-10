"""sinan_contracts — 司南跨服务契约 Python 绑定。

单一真相源为 packages/shared-contracts/spec/*.json;本包与 TS 绑定均为其镜像,
由各自 consistency 测试守护,杜绝前后端漂移(总纲⑦:契约先行)。
"""

from __future__ import annotations

from .capabilities import (
    CAPABILITIES,
    CAPABILITY_BIT,
    Capability,
    caps_to_record,
    record_to_caps,
)
from .endpoints import (
    API_BASE,
    API_ENDPOINTS,
    ENGINE_ENDPOINTS,
    HEADERS,
    build_path,
)
from .enums import (
    BacktestScoring,
    Board,
    Dataset,
    JobStatus,
    JobTrigger,
    JobType,
    LogLevel,
    ModelStatus,
    ModelType,
    OnboardingStep,
    Portfolio,
    Provider,
    ProviderStatus,
    SignalAction,
    TradeReason,
    TradeSide,
)

__all__ = [
    "CAPABILITIES",
    "CAPABILITY_BIT",
    "Capability",
    "caps_to_record",
    "record_to_caps",
    "API_BASE",
    "API_ENDPOINTS",
    "ENGINE_ENDPOINTS",
    "HEADERS",
    "build_path",
    "BacktestScoring",
    "Board",
    "Dataset",
    "JobStatus",
    "JobTrigger",
    "JobType",
    "LogLevel",
    "ModelStatus",
    "ModelType",
    "OnboardingStep",
    "Portfolio",
    "Provider",
    "ProviderStatus",
    "SignalAction",
    "TradeReason",
    "TradeSide",
]
