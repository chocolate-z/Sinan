"""ProviderRegistry:能力索引 + 优先级路由 + 令牌桶限流 + 断路器 + 优雅降级。

调用方只表达「我要某 Capability 的数据」,不关心来源。注册表:
1. 路由:取声明该能力且 enabled 的 provider,按 priority 升序。
2. 限流:每 provider 一个令牌桶,超额排队。
3. 断路器:连续失败熔断,自动切下一优先级,恢复后半开探测。
4. 优雅降级:全链不可用时返回 DegradedResult(不静默,写入 coverage/日志/UI)。
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Callable, Sequence, TypeVar

from .base import (
    Capability,
    CapabilityNotSupported,
    IDataProvider,
    ProviderAuthError,
    ProviderError,
    ProviderRateLimited,
)
from .circuit import CircuitBreaker
from .ratelimit import TokenBucket

T = TypeVar("T")


@dataclass
class DegradedResult:
    """某能力全链不可用时的降级标记(永不静默)。"""

    capability: Capability
    reason: str
    tried: list[str]


class ProviderRegistry:
    def __init__(
        self,
        providers: Sequence[IDataProvider],
        *,
        rate_limits: dict[str, dict] | None = None,
        fail_threshold: int = 5,
        cooldown_s: float = 30.0,
        max_retries: int = 3,
        backoff_base_s: float = 1.0,
        clock: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self.providers: list[IDataProvider] = sorted(providers, key=lambda p: p.priority)
        self._clock = clock
        self._sleep = sleep
        self.max_retries = max_retries
        self.backoff_base_s = backoff_base_s
        rate_limits = rate_limits or {}
        self._buckets: dict[str, TokenBucket] = {}
        self._breakers: dict[str, CircuitBreaker] = {}
        for p in self.providers:
            rl = rate_limits.get(str(p.id), {})
            per_min = int(rl.get("per_min", 120))
            self._buckets[str(p.id)] = TokenBucket(per_min, clock=clock, sleep=sleep)
            self._breakers[str(p.id)] = CircuitBreaker(
                fail_threshold, cooldown_s, clock=clock
            )

    # ── 能力视图 ──────────────────────────────────────────────────────────
    def caps_union(self) -> dict[str, bool]:
        """所有 provider 能力并集(对前端/coverage 的 caps_json)。"""
        union = Capability(0)
        for p in self.providers:
            union |= p.capabilities()
        return {c.name: bool(union & c) for c in Capability}

    def providers_for(self, cap: Capability) -> list[IDataProvider]:
        """声明该能力、断路器放行的 provider,按 priority 升序。"""
        return [
            p
            for p in self.providers
            if p.supports(cap) and self._breakers[str(p.id)].allow()
        ]

    def bucket(self, provider_id: str) -> TokenBucket:
        return self._buckets[provider_id]

    def breaker(self, provider_id: str) -> CircuitBreaker:
        return self._breakers[provider_id]

    # ── 路由执行 ──────────────────────────────────────────────────────────
    def fetch(
        self,
        cap: Capability,
        call: Callable[[IDataProvider], T],
        *,
        reason: str = "",
    ) -> T | DegradedResult:
        """按能力路由执行 call(provider)。失败按策略降级,最终返回结果或 DegradedResult。"""
        value, _ = self.fetch_traced(cap, call, reason=reason)
        return value

    def fetch_traced(
        self,
        cap: Capability,
        call: Callable[[IDataProvider], T],
        *,
        reason: str = "",
    ) -> tuple[T | DegradedResult, str | None]:
        """同 fetch,但额外返回实际服务的 provider id(血缘用);降级时返回 None。"""
        tried: list[str] = []
        last_err: str | None = None
        for p in self.providers_for(cap):
            pid = str(p.id)
            tried.append(pid)
            breaker = self._breakers[pid]
            bucket = self._buckets[pid]
            try:
                result = self._call_with_retries(p, bucket, call)
                breaker.record_success()
                return result, pid
            except CapabilityNotSupported:
                # 不惩罚断路器,直接试下一优先级。
                continue
            except ProviderAuthError as e:
                breaker.record_failure()
                last_err = e.message
                continue
            except ProviderRateLimited as e:
                bucket.cooldown(e.retry_after_s or 30.0)
                breaker.record_failure()
                last_err = e.message
                continue
            except ProviderError as e:
                breaker.record_failure()
                last_err = e.message
                continue
        return (
            DegradedResult(
                capability=cap,
                reason=reason or (last_err or f"无可用 provider 提供能力 {cap.name}"),
                tried=tried,
            ),
            None,
        )

    def _call_with_retries(
        self, p: IDataProvider, bucket: TokenBucket, call: Callable[[IDataProvider], T]
    ) -> T:
        attempt = 0
        while True:
            bucket.acquire(1)
            try:
                return call(p)
            except ProviderRateLimited as e:
                # 限频:冷却令牌桶并按退避重试,超出重试次数则上抛。
                bucket.cooldown(e.retry_after_s or (self.backoff_base_s * (2**attempt)))
                if attempt >= self.max_retries:
                    raise
                self._sleep(self.backoff_base_s * (2**attempt))
                attempt += 1
            except ProviderError as e:
                if not e.retryable or attempt >= self.max_retries:
                    raise
                self._sleep(self.backoff_base_s * (2**attempt))
                attempt += 1
