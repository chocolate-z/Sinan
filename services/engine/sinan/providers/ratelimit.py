"""令牌桶限速器(每 provider 一个)。

按积分填 capacity(如 Tushare 500/min);超额排队而非打挂。
时钟可注入,便于确定性单测;实际运行用 time.monotonic + sleep。
"""

from __future__ import annotations

import threading
import time
from typing import Callable


class TokenBucket:
    def __init__(
        self,
        capacity: int,
        refill_per_sec: float | None = None,
        *,
        clock: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        if capacity <= 0:
            raise ValueError("capacity must be > 0")
        self.capacity = float(capacity)
        # 默认按「每分钟 capacity 个」匀速回填。
        self.refill_per_sec = float(refill_per_sec) if refill_per_sec else capacity / 60.0
        self._clock = clock
        self._sleep = sleep
        self._tokens = float(capacity)
        self._last = clock()
        self._lock = threading.Lock()

    def _refill_locked(self) -> None:
        now = self._clock()
        elapsed = now - self._last
        # 仅在时间真正前进时回填并推进基准。冷却期 _last 设在未来,
        # 此时 elapsed<=0,保留 _last 不变,直到 now 越过冷却终点才开始回填。
        if elapsed <= 0:
            return
        self._tokens = min(self.capacity, self._tokens + elapsed * self.refill_per_sec)
        self._last = now

    def tokens(self) -> float:
        with self._lock:
            self._refill_locked()
            return self._tokens

    def try_acquire(self, n: float = 1.0) -> bool:
        """非阻塞:有足够令牌则扣减返回 True,否则返回 False。"""
        with self._lock:
            self._refill_locked()
            if self._tokens >= n:
                self._tokens -= n
                return True
            return False

    def time_until_available(self, n: float = 1.0) -> float:
        """还需等待多少秒才能取到 n 个令牌(0 表示现在就能取)。"""
        with self._lock:
            self._refill_locked()
            if self._tokens >= n:
                return 0.0
            deficit = n - self._tokens
            return deficit / self.refill_per_sec

    def acquire(self, n: float = 1.0) -> float:
        """阻塞直到拿到 n 个令牌,返回实际等待秒数。"""
        waited = 0.0
        while True:
            with self._lock:
                self._refill_locked()
                if self._tokens >= n:
                    self._tokens -= n
                    return waited
                deficit = n - self._tokens
                wait = deficit / self.refill_per_sec
            self._sleep(wait)
            waited += wait

    def cooldown(self, seconds: float) -> None:
        """收到 429/限频时主动冷却:清空令牌并把回填基准推后 seconds。"""
        with self._lock:
            self._tokens = 0.0
            self._last = self._clock() + seconds
