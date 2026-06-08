import polars as pl

from sinan.providers.base import (
    Capability,
    CapabilityNotSupported,
    IDataProvider,
    ProviderError,
    ProviderHealth,
    ProviderRateLimited,
    ProviderStatus,
)
from sinan.providers.registry import DegradedResult, ProviderRegistry
from tests.helpers import FakeClock


class FakeProvider(IDataProvider):
    def __init__(self, pid, caps, *, priority=100, behavior=None):
        self.id = pid
        self.display_name = pid
        self.priority = priority
        self._caps = caps
        self._behavior = behavior or {}
        self.calls = 0

    def capabilities(self):
        return self._caps

    def test_connection(self):
        return ProviderHealth(status=ProviderStatus.OK, caps={})

    def daily_bars(self, code, start, end):
        self.calls += 1
        b = self._behavior.get("daily_bars")
        if b == "rate_limited":
            raise ProviderRateLimited("limit")
        if b == "error":
            raise ProviderError("boom", "fail", retryable=False)
        return pl.DataFrame({"stock_code": [code], "src": [self.id]})

    def northbound(self, code, start, end):
        self.calls += 1
        if not (self._caps & Capability.NORTHBOUND):
            raise CapabilityNotSupported(self.id, Capability.NORTHBOUND)
        return pl.DataFrame({"stock_code": [code], "src": [self.id]})


def _reg(providers):
    clk = FakeClock()
    return ProviderRegistry(
        providers,
        rate_limits={p.id: {"per_min": 600} for p in providers},
        clock=clk,
        sleep=clk.sleep,
        max_retries=2,
        backoff_base_s=0.01,
    )


def test_routes_by_priority():
    hi = FakeProvider("hi", Capability.DAILY_OHLCV, priority=10)
    lo = FakeProvider("lo", Capability.DAILY_OHLCV, priority=20)
    reg = _reg([lo, hi])  # 乱序传入,内部按 priority 升序
    out = reg.fetch(Capability.DAILY_OHLCV, lambda p: p.daily_bars("600519.SH", "a", "b"))
    assert out["src"][0] == "hi"
    assert hi.calls == 1 and lo.calls == 0


def test_degrades_when_capability_missing():
    p = FakeProvider("p", Capability.DAILY_OHLCV)  # 不含 NORTHBOUND
    reg = _reg([p])
    out = reg.fetch(
        Capability.NORTHBOUND,
        lambda pr: pr.northbound("600519.SH", "a", "b"),
        reason="北向不可用",
    )
    assert isinstance(out, DegradedResult)
    assert out.capability is Capability.NORTHBOUND


def test_capability_not_supported_falls_through_without_breaker_penalty():
    # 高优先源声明 NORTHBOUND 但运行时抛 CapabilityNotSupported(模拟积分不足),
    # 低优先源具备 → 应回退到低优先源,且高优先源断路器不被惩罚。
    class Flaky(FakeProvider):
        def northbound(self, code, start, end):
            self.calls += 1
            raise CapabilityNotSupported(self.id, Capability.NORTHBOUND)

    hi = Flaky("hi", Capability.NORTHBOUND, priority=10)
    lo = FakeProvider("lo", Capability.NORTHBOUND, priority=20)
    reg = _reg([hi, lo])
    out = reg.fetch(Capability.NORTHBOUND, lambda p: p.northbound("x", "a", "b"))
    assert out["src"][0] == "lo"
    assert reg.breaker("hi").allow() is True  # 未被惩罚


def test_circuit_breaker_opens_and_skips():
    bad = FakeProvider("bad", Capability.DAILY_OHLCV, priority=10, behavior={"daily_bars": "error"})
    good = FakeProvider("good", Capability.DAILY_OHLCV, priority=20)
    reg = _reg([bad, good])
    # 反复请求让 bad 断路器累计失败到阈值(默认 5)。
    for _ in range(6):
        reg.fetch(Capability.DAILY_OHLCV, lambda p: p.daily_bars("x", "a", "b"))
    from sinan.providers.circuit import CircuitState

    assert reg.breaker("bad").state is CircuitState.OPEN
    # 之后请求直接跳过 bad,走 good。
    out = reg.fetch(Capability.DAILY_OHLCV, lambda p: p.daily_bars("x", "a", "b"))
    assert out["src"][0] == "good"


def test_rate_limited_falls_to_next_provider():
    limited = FakeProvider(
        "limited", Capability.DAILY_OHLCV, priority=10, behavior={"daily_bars": "rate_limited"}
    )
    good = FakeProvider("good", Capability.DAILY_OHLCV, priority=20)
    reg = _reg([limited, good])
    out = reg.fetch(Capability.DAILY_OHLCV, lambda p: p.daily_bars("x", "a", "b"))
    assert out["src"][0] == "good"


def test_caps_union():
    a = FakeProvider("a", Capability.DAILY_OHLCV | Capability.ADJ_FACTOR)
    b = FakeProvider("b", Capability.NORTHBOUND)
    reg = _reg([a, b])
    union = reg.caps_union()
    assert union["DAILY_OHLCV"] and union["ADJ_FACTOR"] and union["NORTHBOUND"]
    assert union["FUNDAMENTAL"] is False
