"""Provider 统一接口、能力枚举、异常、代码工具与归一化 schema。

设计要点:
- 调用方只表达需求(需要某 Capability),不关心来源;注册表按能力路由+降级。
- Provider 只实现自己声明的能力;未声明的方法默认抛 CapabilityNotSupported,由注册表降级。
- 不支持的能力抛 CapabilityNotSupported;限频抛 ProviderRateLimited(retryable);
  token 失效抛 ProviderAuthError(fatal)。
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Sequence

import polars as pl

# 能力枚举来自契约单一真相源。
from sinan_contracts import Capability, Provider, ProviderStatus

__all__ = [
    "Capability",
    "Provider",
    "ProviderStatus",
    "ProviderError",
    "CapabilityNotSupported",
    "ProviderRateLimited",
    "ProviderAuthError",
    "ProviderHealth",
    "IDataProvider",
    "normalize_code",
    "board_of",
    "split_code",
    "COLS_PRICE",
    "COLS_ADJ",
    "COLS_DAILY_BASIC",
    "COLS_NORTHBOUND",
    "COLS_STOCK_LIST",
]

# ── 归一化列 schema(所有 provider 必须映射到这些内部列名)────────────────
COLS_STOCK_LIST = ("stock_code", "name", "board", "list_date")
COLS_PRICE = ("stock_code", "trade_date", "open", "high", "low", "close", "volume", "amount")
COLS_ADJ = ("stock_code", "trade_date", "adj_factor")
COLS_DAILY_BASIC = (
    "stock_code",
    "trade_date",
    "pe_ttm",
    "pb",
    "ps_ttm",
    "total_mv",
    "circ_mv",
    "turnover_rate",
    "dv_ttm",
)
COLS_NORTHBOUND = ("stock_code", "trade_date", "north_hold_ratio")


# ── 异常分级 ────────────────────────────────────────────────────────────
class ProviderError(Exception):
    """统一 provider 错误。retryable 决定是否指数退避重试。"""

    def __init__(self, code: str, message: str, *, retryable: bool = False) -> None:
        super().__init__(f"[{code}] {message}")
        self.code = code
        self.message = message
        self.retryable = retryable


class CapabilityNotSupported(ProviderError):
    def __init__(self, provider_id: str, capability: Capability) -> None:
        super().__init__(
            "capability_not_supported",
            f"provider {provider_id} 不支持能力 {capability.name}",
            retryable=False,
        )
        self.capability = capability


class ProviderRateLimited(ProviderError):
    def __init__(self, message: str = "限频", *, retry_after_s: float | None = None) -> None:
        super().__init__("rate_limited", message, retryable=True)
        self.retry_after_s = retry_after_s


class ProviderAuthError(ProviderError):
    """token 无效/积分不足等不可重试的鉴权错误(fatal)。"""

    def __init__(self, message: str = "token 无效或积分不足") -> None:
        super().__init__("auth_error", message, retryable=False)


# ── 连通/健康探测结果 ───────────────────────────────────────────────────
@dataclass
class ProviderHealth:
    status: ProviderStatus
    caps: dict[str, bool]
    latency_ms: float | None = None
    rate_limit: dict[str, int] | None = None
    points_hint: int | None = None
    degraded: list[str] = field(default_factory=list)
    message: str | None = None


# ── 代码工具(内部 canonical 形态:600519.SH / 000001.SZ / 430047.BJ)──────
def split_code(code: str) -> tuple[str, str]:
    """返回 (6位数字, 交易所后缀 SH/SZ/BJ)。接受 600519.SH / sh600519 / 600519。"""
    c = code.strip().upper()
    if "." in c:
        num, suffix = c.split(".", 1)
        return num, suffix
    if c[:2] in ("SH", "SZ", "BJ"):
        return c[2:], c[:2]
    num = c
    suffix = _infer_suffix(num)
    return num, suffix


def _infer_suffix(num: str) -> str:
    if num.startswith(("60", "68", "5", "11", "51", "58")):
        return "SH"
    if num.startswith(("8", "4", "92")):
        return "BJ"
    return "SZ"


def normalize_code(code: str) -> str:
    num, suffix = split_code(code)
    return f"{num}.{suffix}"


def board_of(code: str) -> str:
    """板块 sh/sz/bj(用于 parquet 分区)。"""
    _, suffix = split_code(code)
    return suffix.lower()


# ── 统一接口 ────────────────────────────────────────────────────────────
class IDataProvider(ABC):
    """所有数据源实现此接口。声明能力,实现对应方法;未声明能力默认抛异常。"""

    id: Provider
    display_name: str
    needs_token: bool = False
    priority: int = 100

    @abstractmethod
    def capabilities(self) -> Capability:
        """声明本 provider 具备哪些能力位。"""

    @abstractmethod
    def test_connection(self) -> ProviderHealth:
        """连通性 + 能力/积分/限频探测(onboarding 用)。"""

    def supports(self, cap: Capability) -> bool:
        return bool(self.capabilities() & cap)

    # ── 历史数据(默认抛 CapabilityNotSupported,由注册表降级)──────────────
    def stock_list(self) -> pl.DataFrame:
        raise CapabilityNotSupported(str(self.id), Capability.DAILY_OHLCV)

    def daily_bars(self, code: str, start: str, end: str) -> pl.DataFrame:
        raise CapabilityNotSupported(str(self.id), Capability.DAILY_OHLCV)

    def adj_factor(self, code: str, start: str, end: str) -> pl.DataFrame:
        raise CapabilityNotSupported(str(self.id), Capability.ADJ_FACTOR)

    def daily_basic(self, code: str, start: str, end: str) -> pl.DataFrame:
        raise CapabilityNotSupported(str(self.id), Capability.DAILY_BASIC)

    def northbound(self, code: str, start: str, end: str) -> pl.DataFrame:
        raise CapabilityNotSupported(str(self.id), Capability.NORTHBOUND)

    # ── 实时 ──────────────────────────────────────────────────────────────
    def realtime_quotes(self, codes: Sequence[str]) -> dict[str, dict]:
        raise CapabilityNotSupported(str(self.id), Capability.REALTIME_QUOTE)
