"""Provider 抽象层 —— BYO 地基的承重墙,所有出网数据访问的唯一入口。"""

from .base import (
    Capability,
    CapabilityNotSupported,
    IDataProvider,
    ProviderAuthError,
    ProviderError,
    ProviderHealth,
    ProviderRateLimited,
    board_of,
    normalize_code,
)
from .circuit import CircuitBreaker
from .ratelimit import TokenBucket
from .registry import DegradedResult, ProviderRegistry

__all__ = [
    "Capability",
    "CapabilityNotSupported",
    "IDataProvider",
    "ProviderAuthError",
    "ProviderError",
    "ProviderHealth",
    "ProviderRateLimited",
    "board_of",
    "normalize_code",
    "CircuitBreaker",
    "TokenBucket",
    "DegradedResult",
    "ProviderRegistry",
]
