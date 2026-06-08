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
