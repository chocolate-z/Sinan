"""断路器:连续失败 N 次熔断 cooldown 秒,自动切下一优先级 provider,恢复后半开探测。

把原型里分散在每个 _fetch_* 的重试退避收敛为统一策略。时钟可注入便于单测。
"""

from __future__ import annotations

import time
from enum import Enum
from typing import Callable


class CircuitState(str, Enum):
    CLOSED = "closed"  # 正常放行
    OPEN = "open"  # 熔断,拒绝放行直到冷却结束
    HALF_OPEN = "half_open"  # 冷却后放行一次探测


class CircuitBreaker:
    def __init__(
        self,
        fail_threshold: int = 5,
        cooldown_s: float = 30.0,
        *,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.fail_threshold = fail_threshold
        self.cooldown_s = cooldown_s
        self._clock = clock
        self._state = CircuitState.CLOSED
        self._failures = 0
        self._opened_at = 0.0

    @property
    def state(self) -> CircuitState:
        # 惰性状态转移:OPEN 冷却到期 → HALF_OPEN
        if self._state is CircuitState.OPEN and self._clock() - self._opened_at >= self.cooldown_s:
            self._state = CircuitState.HALF_OPEN
        return self._state

    def allow(self) -> bool:
        """是否放行一次请求。"""
        return self.state in (CircuitState.CLOSED, CircuitState.HALF_OPEN)

    def record_success(self) -> None:
        self._failures = 0
        self._state = CircuitState.CLOSED

    def record_failure(self) -> None:
        # 半开态再次失败 → 立即重新熔断
        if self.state is CircuitState.HALF_OPEN:
            self._open()
            return
        self._failures += 1
        if self._failures >= self.fail_threshold:
            self._open()

    def _open(self) -> None:
        self._state = CircuitState.OPEN
        self._opened_at = self._clock()
        self._failures = self.fail_threshold

    def seconds_until_retry(self) -> float:
        if self._state is not CircuitState.OPEN:
            return 0.0
        remaining = self.cooldown_s - (self._clock() - self._opened_at)
        return max(0.0, remaining)
