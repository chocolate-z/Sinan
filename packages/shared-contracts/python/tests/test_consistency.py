"""Python 绑定 ↔ canonical spec 一致性测试(防漂移)。"""

from __future__ import annotations

from sinan_contracts._spec import load_spec
from sinan_contracts.capabilities import (
    CAPABILITIES,
    CAPABILITY_BIT,
    Capability,
    caps_to_record,
    record_to_caps,
)
from sinan_contracts.endpoints import (
    API_BASE,
    API_ENDPOINTS,
    ENGINE_ENDPOINTS,
    HEADERS,
    build_path,
)
from sinan_contracts.enums import ENUM_MIRROR


def test_capabilities_match_spec():
    caps = load_spec("capabilities.json")["capabilities"]
    assert list(CAPABILITIES) == [c["name"] for c in caps]
    for c in caps:
        assert CAPABILITY_BIT[c["name"]] == c["bit"]
        assert Capability[c["name"]].value == 1 << c["bit"]


def test_caps_record_roundtrip():
    flag = record_to_caps({"NORTHBOUND": True, "DAILY_OHLCV": True})
    assert flag == (Capability.NORTHBOUND | Capability.DAILY_OHLCV)
    rec = caps_to_record(flag)
    assert rec["NORTHBOUND"] is True
    assert rec["DAILY_OHLCV"] is True
    assert rec["FUNDAMENTAL"] is False
    # 12 个能力名都给布尔值
    assert set(rec.keys()) == set(CAPABILITIES)


def test_enums_match_spec():
    enums = {k: v for k, v in load_spec("enums.json").items() if not k.startswith("$")}
    assert set(ENUM_MIRROR.keys()) == set(enums.keys())
    for key, members in ENUM_MIRROR.items():
        assert members == enums[key], f"enum {key} drift"


def test_endpoints_match_spec():
    ep = load_spec("endpoints.json")
    assert API_BASE == ep["api_base"]
    assert HEADERS["session_token"] == ep["headers"]["session_token"]
    assert HEADERS["internal"] == ep["headers"]["internal"]
    assert API_ENDPOINTS == ep["api"]
    assert ENGINE_ENDPOINTS == ep["engine"]


def test_build_path():
    assert (
        build_path(API_ENDPOINTS["credential_put"]["path"], {"id": "tushare"})
        == "/providers/tushare/credential"
    )


def test_ts_and_python_bindings_agree():
    """间接保证 TS 与 Python 双端一致:二者都以 spec 为准,各自上面的测试通过即等价。"""
    # 这里再显式断言能力数量,作为冗余哨兵。
    assert len(CAPABILITIES) == 12
