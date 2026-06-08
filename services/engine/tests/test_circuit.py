from sinan.providers.circuit import CircuitBreaker, CircuitState
from tests.helpers import FakeClock


def test_opens_after_threshold():
    clk = FakeClock()
    cb = CircuitBreaker(fail_threshold=3, cooldown_s=30, clock=clk)
    assert cb.allow()
    cb.record_failure()
    cb.record_failure()
    assert cb.allow()  # 还没到阈值
    cb.record_failure()
    assert cb.state is CircuitState.OPEN
    assert cb.allow() is False


def test_half_open_after_cooldown_then_close_on_success():
    clk = FakeClock()
    cb = CircuitBreaker(fail_threshold=2, cooldown_s=30, clock=clk)
    cb.record_failure()
    cb.record_failure()
    assert cb.state is CircuitState.OPEN
    assert abs(cb.seconds_until_retry() - 30) < 1e-6
    clk.advance(30)
    assert cb.state is CircuitState.HALF_OPEN
    assert cb.allow()
    cb.record_success()
    assert cb.state is CircuitState.CLOSED


def test_half_open_failure_reopens():
    clk = FakeClock()
    cb = CircuitBreaker(fail_threshold=2, cooldown_s=30, clock=clk)
    cb.record_failure()
    cb.record_failure()
    clk.advance(30)
    assert cb.state is CircuitState.HALF_OPEN
    cb.record_failure()  # 半开探测再失败 → 立即重新熔断
    assert cb.state is CircuitState.OPEN
    assert cb.allow() is False


def test_success_resets_failure_count():
    clk = FakeClock()
    cb = CircuitBreaker(fail_threshold=3, cooldown_s=30, clock=clk)
    cb.record_failure()
    cb.record_failure()
    cb.record_success()
    cb.record_failure()
    cb.record_failure()
    assert cb.allow()  # 计数被重置,未到阈值
