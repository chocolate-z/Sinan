from sinan.providers.ratelimit import TokenBucket
from tests.helpers import FakeClock


def test_drains_capacity_then_blocks_nonblocking():
    clk = FakeClock()
    b = TokenBucket(10, refill_per_sec=10, clock=clk, sleep=clk.sleep)
    for _ in range(10):
        assert b.try_acquire() is True
    assert b.try_acquire() is False  # 桶空


def test_refill_over_time():
    clk = FakeClock()
    b = TokenBucket(10, refill_per_sec=10, clock=clk, sleep=clk.sleep)
    for _ in range(10):
        b.try_acquire()
    assert b.try_acquire() is False
    clk.advance(0.5)  # 0.5s * 10/s = 5 个
    assert round(b.tokens(), 3) == 5.0
    assert b.try_acquire(5) is True
    assert b.try_acquire() is False


def test_blocking_acquire_waits_and_advances_clock():
    clk = FakeClock()
    b = TokenBucket(10, refill_per_sec=10, clock=clk, sleep=clk.sleep)
    for _ in range(10):
        b.try_acquire()
    waited = b.acquire(5)  # 需要 5 个,10/s → 0.5s
    assert abs(waited - 0.5) < 1e-6
    assert clk.t >= 0.5


def test_time_until_available():
    clk = FakeClock()
    b = TokenBucket(10, refill_per_sec=10, clock=clk, sleep=clk.sleep)
    for _ in range(10):
        b.try_acquire()
    assert abs(b.time_until_available(3) - 0.3) < 1e-6


def test_cooldown_blocks_then_recovers():
    clk = FakeClock()
    b = TokenBucket(60, refill_per_sec=1, clock=clk, sleep=clk.sleep)
    b.cooldown(30)  # 限频:清空 + 回填基准推后 30s
    assert b.try_acquire() is False
    clk.advance(10)
    assert b.try_acquire() is False  # 仍在冷却窗内
    clk.advance(25)  # 累计 35s,超过冷却,开始回填
    assert b.tokens() > 0
