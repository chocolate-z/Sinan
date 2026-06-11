"""engine FastAPI 自测:健康、内部 token 守卫、连通探测、建缓存 SSE。"""

import json

from fastapi.testclient import TestClient

from sinan import app as appmod
from sinan.providers.registry import ProviderRegistry
from tests.helpers import FakeClock, FakePriceProvider

client = TestClient(appmod.app)


def test_healthz():
    r = client.get("/healthz")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_indicators_validate_endpoint():
    ok = client.post("/engine/indicators/validate", json={"expr": "zscore(-pe_ttm) + rank(roe)"})
    assert ok.status_code == 200 and ok.json()["ok"] is True
    bad = client.post("/engine/indicators/validate", json={"expr": "__import__('os')"})
    assert bad.status_code == 200 and bad.json()["ok"] is False
    assert "fields" in ok.json() and "functions" in ok.json()


def test_device_endpoint():
    r = client.get("/engine/device", params={"threads": "2", "device": "cpu"})
    assert r.status_code == 200
    body = r.json()
    assert body["device"] == "cpu"
    assert 1 <= body["num_threads"] <= body["cpu_count"]
    assert "note" in body


def test_paper_run_endpoint(tmp_path, monkeypatch):
    monkeypatch.setenv("SINAN_DATA_DIR", str(tmp_path))
    from tests.test_factors import CODES, _build_frames, _dates, _write

    dates = _dates(30)
    _write(tmp_path / "cache", _build_frames(dates))  # config.cache_dir() == SINAN_DATA_DIR/cache
    body = {
        "strategy_id": "s1",
        "today": dates[24],
        "effective_date": dates[25],
        "codes": CODES,
        "account": {"cash": 1_000_000, "positions": []},
        "params": {"buy_threshold": 0.0, "max_holdings": 5},
        "prev_nav": 1_000_000,
        "fill": True,
    }
    r = client.post("/engine/paper/run", json=body)
    assert r.status_code == 200
    res = r.json()
    assert res["market_open"] is True
    assert any(s["action"] == "buy" and not s["blocked"] for s in res["signals"])
    assert len(res["trades"]) >= 1
    assert res["account"]["nav"] > 0


def test_prices_endpoint(tmp_path, monkeypatch):
    monkeypatch.setenv("SINAN_DATA_DIR", str(tmp_path))
    import polars as pl

    from sinan.data import store

    code = "600519.SH"
    dates = [f"2024-01-{i:02d}" for i in range(2, 7)]  # 5 个交易日
    df = pl.DataFrame(
        {
            "stock_code": [code] * 5,
            "trade_date": dates,
            "open": [10.0, 11, 12, 13, 14],
            "high": [10.0, 11, 12, 13, 14],
            "low": [10.0, 11, 12, 13, 14],
            "close": [10.0, 11, 12, 13, 14],
            "volume": [1.0, 2, 3, 4, 5],
            "amount": [1.0, 2, 3, 4, 5],
        }
    )
    store.write_dataset(tmp_path / "cache", "price", df)  # config.cache_dir() == SINAN_DATA_DIR/cache
    r = client.post("/engine/prices", json={"code": code, "adjust": "none", "limit": 3})
    assert r.status_code == 200
    body = r.json()
    assert body["code"] == code and body["adjust"] == "none"
    assert [row["trade_date"] for row in body["rows"]] == dates[-3:]  # 末 3 根


def test_backtest_endpoint(tmp_path, monkeypatch):
    monkeypatch.setenv("SINAN_DATA_DIR", str(tmp_path))
    import polars as pl

    from sinan.data import store
    from tests.test_backtest import _index_frames
    from tests.test_factors import _build_frames, _dates, _write

    dates = _dates(40)
    cache = tmp_path / "cache"
    _write(cache, _build_frames(dates))
    store.write_dataset(cache, "index_ohlcv", _index_frames(dates))

    # 守卫:backtest_start 落在 purge 区 → 422
    bad = client.post(
        "/engine/backtest",
        json={
            "backtest_start": dates[20],
            "backtest_end": dates[38],
            "train_end": dates[19],
            "purge": 5,
        },
    )
    assert bad.status_code == 422

    # 正常回测
    ok = client.post(
        "/engine/backtest",
        json={
            "backtest_start": dates[26],
            "backtest_end": dates[38],
            "train_end": dates[19],
            "purge": 5,
            "params": {"buy_threshold": 0.0},
        },
    )
    assert ok.status_code == 200
    body = ok.json()
    assert body["cost_included"] is True
    assert body["n_days"] >= 2
    assert "metrics" in body and "nav_curve" in body
    assert isinstance(pl.DataFrame(body["nav_curve"]), pl.DataFrame)


def test_internal_guard(monkeypatch):
    monkeypatch.setenv("SINAN_IPC_TOKEN", "secret-session")
    # 无头 → 403
    r = client.post("/engine/provider/test", json={"provider": "tushare"})
    assert r.status_code == 403
    # 正确头 → 放行(tushare 无 token → status error,但请求被接受)
    r = client.post(
        "/engine/provider/test",
        json={"provider": "tushare"},
        headers={"X-Sinan-Internal": "secret-session"},
    )
    assert r.status_code == 200
    assert r.json()["status"] == "error"


def test_provider_test_tushare_no_token_is_error():
    r = client.post("/engine/provider/test", json={"provider": "tushare"})
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "error"
    assert all(v is False for v in body["caps"].values())


def test_provider_test_unknown_provider_400():
    r = client.post("/engine/provider/test", json={"provider": "bogus"})
    assert r.status_code == 400


def test_cache_build_sse_stream(tmp_path, monkeypatch):
    monkeypatch.setenv("SINAN_DATA_DIR", str(tmp_path))

    def fake_factory(creds):
        clk = FakeClock()
        return ProviderRegistry([FakePriceProvider()], clock=clk, sleep=clk.sleep)

    monkeypatch.setattr(appmod, "build_registry", fake_factory)

    body = {
        "job_id": "jx",
        "params": {"universe": {"codes": ["600519.SH", "000001.SZ"]}, "start_year": 2024, "datasets": ["price", "northbound"]},
        "tokens": {},
        "end_date": "2024-01-05",
    }
    r = client.post("/engine/cache/build", json=body)
    assert r.status_code == 200
    events = [json.loads(line[6:]) for line in r.text.splitlines() if line.startswith("data: ")]
    assert events, "should stream at least one event"
    assert events[-1]["status"] == "done"
    assert events[-1]["done_count"] == 2
    # coverage 逐股增量回传(否则 api data_coverage 永空 → 设置页误判未建缓存)。
    all_cov = [c for ev in events for c in ev.get("coverage", [])]
    assert all_cov, "应至少回传一条覆盖度"
    assert all(
        {"stock_code", "dataset", "rows", "first_date", "last_date"} <= set(c) for c in all_cov
    )
    assert {c["stock_code"] for c in all_cov} == {"600519.SH", "000001.SZ"}


def _fake_stock_list():
    import polars as pl

    return pl.DataFrame(
        {
            "stock_code": ["600519.SH", "000858.SZ", "600036.SH"],
            "name": ["贵州茅台", "五粮液", "招商银行"],
            "board": ["主板", "主板", "主板"],
            "list_date": ["20010827", "19980427", "20020409"],
        }
    )


def test_stocks_search_by_code_and_name(monkeypatch):
    appmod._STOCK_LIST_CACHE.clear()

    class Fake:
        def stock_list(self):
            return _fake_stock_list()

    monkeypatch.setattr(appmod, "_make_provider", lambda provider, token: Fake())
    r = client.post("/engine/stocks/search", json={"provider": "tushare", "q": "600519"})
    assert r.status_code == 200
    assert [s["code"] for s in r.json()["stocks"]] == ["600519.SH"]
    r = client.post("/engine/stocks/search", json={"provider": "tushare", "q": "茅台"})
    assert [s["code"] for s in r.json()["stocks"]] == ["600519.SH"]
    r = client.post("/engine/stocks/search", json={"provider": "tushare", "q": "", "limit": 2})
    assert len(r.json()["stocks"]) == 2
    appmod._STOCK_LIST_CACHE.clear()


def test_stocks_search_honest_empty_when_provider_fails(monkeypatch):
    appmod._STOCK_LIST_CACHE.clear()

    def boom(provider, token):
        raise RuntimeError("no token / network")

    monkeypatch.setattr(appmod, "_make_provider", boom)
    r = client.post("/engine/stocks/search", json={"provider": "tushare", "q": "x"})
    assert r.status_code == 200 and r.json()["stocks"] == []
    appmod._STOCK_LIST_CACHE.clear()
