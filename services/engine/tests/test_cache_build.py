"""cache_build 自测:断点续传无重复、增量跳过、北向降级、基准指数。"""

import polars as pl

from sinan.cache.build import DEFAULT_INDICES, CacheBuilder
from sinan.data import DataLayer
from sinan.providers.base import Capability, IDataProvider, Provider, ProviderHealth, ProviderStatus
from sinan.providers.registry import ProviderRegistry
from tests.helpers import FakeClock, FakePriceProvider

CODES = ["600519.SH", "000001.SZ", "600000.SH"]


def _registry(provider):
    clk = FakeClock()
    return ProviderRegistry([provider], clock=clk, sleep=clk.sleep)


class _IndexProvider(IDataProvider):
    """只支持指数日线的 fake(模拟 akshare 免费源拉指数,绕开 token 门槛)。"""

    id = Provider.AKSHARE
    display_name = "idx"
    needs_token = False
    priority = 10

    def capabilities(self) -> Capability:
        return Capability.INDEX_OHLCV

    def test_connection(self) -> ProviderHealth:
        return ProviderHealth(status=ProviderStatus.OK, caps={})

    def index_bars(self, code, start, end) -> pl.DataFrame:
        return pl.DataFrame(
            {
                "stock_code": [code, code],
                "trade_date": ["2024-01-02", "2024-01-03"],
                "open": [1.0, 1.0],
                "high": [1.0, 1.0],
                "low": [1.0, 1.0],
                "close": [10.0, 11.0],
                "volume": [1.0, 1.0],
                "amount": [1.0, 1.0],
            }
        )


def test_build_indices_writes_index_ohlcv(tmp_path):
    """基准指数:_build_indices 经注册表(免费源)拉默认指数 → 落 index_ohlcv,回测基准可读。"""
    builder = CacheBuilder(tmp_path / "cache", _registry(_IndexProvider()))
    built = builder._build_indices("2018-01-01", "2024-12-31")
    assert set(built) == set(DEFAULT_INDICES)
    df = DataLayer(tmp_path / "cache").latest_asof(
        "index_ohlcv", "2024-12-31", fields=["stock_code", "close"]
    )
    assert df.height == len(DEFAULT_INDICES)
    assert "000905.SH" in df["stock_code"].to_list()  # 中证500


def test_build_indices_degrades_when_unsupported(tmp_path):
    """无源支持指数(如只有受限 token)→ 诚实空,不崩,不影响主建缓存。"""
    builder = CacheBuilder(tmp_path / "cache", _registry(FakePriceProvider()))
    assert builder._build_indices("2018-01-01", "2024-12-31") == []


def _params():
    return {"universe": {"boards": ["sh", "sz"]}, "start_year": 2024, "datasets": ["price", "northbound"]}


def test_build_writes_and_degrades_northbound(tmp_path):
    builder = CacheBuilder(tmp_path / "cache", _registry(FakePriceProvider()))
    res = builder.run(_params(), job_id="j1", codes=CODES, end_date="2024-01-05")
    assert res.status == "done"
    assert res.done_count == 3
    # 价量写入,北向降级(无 provider 支持)。
    price_cov = [c for c in res.coverage if c.dataset == "price"]
    assert len(price_cov) == 3
    assert any("northbound" in d for d in res.degraded)
    assert all(c.dataset != "northbound" for c in res.coverage)
    # parquet 可查
    out = DataLayer(tmp_path / "cache").asof("price", "2024-01-05", fields=["stock_code", "trade_date"])
    assert out.height == 12  # 3 codes × 4 dates


def test_interrupt_then_resume_no_duplicates(tmp_path):
    cache = tmp_path / "cache"
    provider = FakePriceProvider()
    builder = CacheBuilder(cache, _registry(provider))

    # 第一次:处理 1 只后暂停。
    calls = {"n": 0}

    def should_continue():
        calls["n"] += 1
        return calls["n"] <= 1  # 第一次检查放行,之后暂停

    res1 = builder.run(_params(), job_id="j2", codes=CODES, end_date="2024-01-05", should_continue=should_continue, flush_every=1)
    assert res1.status == "paused"
    assert res1.cursor == {"next_index": 1}

    # 续传:从游标恢复(用新 builder/registry 模拟重启)。
    builder2 = CacheBuilder(cache, _registry(FakePriceProvider()))
    res2 = builder2.run(_params(), job_id="j2", codes=CODES, end_date="2024-01-05", cursor=res1.cursor)
    assert res2.status == "done"

    # 全部覆盖,且无重复行。
    out = DataLayer(cache).asof("price", "2024-01-05", fields=["stock_code", "trade_date"])
    assert out.height == 12
    # 与「一口气跑完」的结果一致。
    cache_full = tmp_path / "cache_full"
    CacheBuilder(cache_full, _registry(FakePriceProvider())).run(
        _params(), job_id="jf", codes=CODES, end_date="2024-01-05"
    )
    a = out.sort(["stock_code", "trade_date"])
    b = DataLayer(cache_full).asof("price", "2024-01-05", fields=["stock_code", "trade_date"]).sort(["stock_code", "trade_date"])
    assert a.equals(b)


def test_incremental_skips_already_covered(tmp_path):
    cache = tmp_path / "cache"
    provider = FakePriceProvider()
    builder = CacheBuilder(cache, _registry(provider))
    builder.run(_params(), job_id="j3", codes=CODES, end_date="2024-01-05")
    calls_after_first = provider.calls
    # 第二次:cov_last(2024-01-05) >= end(2024-01-05) → 全部跳过,不再调用 provider。
    builder.run(_params(), job_id="j3b", codes=CODES, end_date="2024-01-05")
    assert provider.calls == calls_after_first  # 无新增拉取
    out = DataLayer(cache).asof("price", "2024-01-05", fields=["stock_code", "trade_date"])
    assert out.height == 12  # 行数不变,无重复


def test_progress_events_emitted(tmp_path):
    events = []
    builder = CacheBuilder(tmp_path / "cache", _registry(FakePriceProvider()))
    builder.run(_params(), job_id="j4", codes=CODES, end_date="2024-01-05", on_progress=events.append)
    assert events[-1]["status"] == "done"
    assert events[-1]["progress"] == 1.0
    assert events[-1]["done_count"] == 3
    # 进度单调不减
    progs = [e["progress"] for e in events]
    assert progs == sorted(progs)
