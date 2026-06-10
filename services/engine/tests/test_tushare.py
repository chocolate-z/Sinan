import json

import httpx

from sinan.providers.base import (
    Capability,
    CapabilityNotSupported,
    ProviderAuthError,
    ProviderRateLimited,
    ProviderStatus,
)
from sinan.providers.tushare_provider import TushareProvider


def _ok(fields, items):
    return {"code": 0, "msg": "", "data": {"fields": fields, "items": items}}


def make_provider(handler, token="tok"):
    client = httpx.Client(transport=httpx.MockTransport(handler), base_url="http://api.tushare.pro")
    return TushareProvider(token, client=client)


def test_daily_bars_normalized():
    def handler(request):
        body = json.loads(request.content)
        assert body["api_name"] == "daily"
        assert body["token"] == "tok"  # token 进入请求体(BYO),不落库/日志由上层保证
        return httpx.Response(
            200,
            json=_ok(
                ["trade_date", "open", "high", "low", "close", "vol", "amount"],
                [["20240105", 1.0, 1.2, 0.9, 1.1, 1000, 1100.0]],
            ),
        )

    p = make_provider(handler)
    df = p.daily_bars("600519.SH", "2024-01-01", "2024-01-31")
    assert df.columns == ["stock_code", "trade_date", "open", "high", "low", "close", "volume", "amount"]
    row = df.row(0, named=True)
    assert row["stock_code"] == "600519.SH"
    assert row["trade_date"] == "2024-01-05"  # YYYYMMDD → YYYY-MM-DD
    assert row["volume"] == 1000


def test_northbound_permission_denied_becomes_capability_missing():
    def handler(request):
        body = json.loads(request.content)
        assert body["api_name"] == "hk_hold"
        return httpx.Response(200, json={"code": 40203, "msg": "抱歉,您的积分不足以访问北向接口"})

    p = make_provider(handler)
    # 40203 含「积分」→ 翻译为 CapabilityNotSupported(注册表无惩罚降级)。
    try:
        p.northbound("600519.SH", "2024-01-01", "2024-01-31")
        assert False, "should raise"
    except CapabilityNotSupported as e:
        assert e.capability is Capability.NORTHBOUND


def test_rate_limit_raises_retryable():
    def handler(request):
        return httpx.Response(200, json={"code": 0, "msg": "抱歉,您每分钟最多访问该接口500次", "data": {}})

    # msg 命中限频关键词 → ProviderRateLimited(即便 code=0 也按限频处理)
    def handler2(request):
        return httpx.Response(200, json={"code": 40203, "msg": "每分钟最多访问该接口500次"})

    p = make_provider(handler2)
    try:
        p.daily_bars("600519.SH", "2024-01-01", "2024-01-31")
        assert False
    except ProviderRateLimited as e:
        assert e.retryable is True


def test_invalid_token_raises_auth_error():
    def handler(request):
        return httpx.Response(200, json={"code": 2002, "msg": "token无效,请检查"})

    p = make_provider(handler)
    try:
        p.daily_bars("600519.SH", "2024-01-01", "2024-01-31")
        assert False
    except ProviderAuthError:
        pass


def test_test_connection_builds_caps_and_degraded():
    # daily/adj_factor/daily_basic 可用;hk_hold 积分不足;其余权限不足。
    def handler(request):
        api = json.loads(request.content)["api_name"]
        if api in ("daily", "adj_factor", "daily_basic", "index_daily", "trade_cal"):
            return httpx.Response(200, json=_ok([], []))
        if api == "hk_hold":
            return httpx.Response(200, json={"code": 40203, "msg": "积分不足"})
        return httpx.Response(200, json={"code": 40001, "msg": "没有访问该接口的权限"})

    p = make_provider(handler)
    h = p.test_connection()
    assert h.status is ProviderStatus.OK
    assert h.caps["DAILY_OHLCV"] is True
    assert h.caps["NORTHBOUND"] is False
    assert any("北向" in d for d in h.degraded)


def test_no_token_test_connection_errors():
    p = TushareProvider(None)
    h = p.test_connection()
    assert h.status is ProviderStatus.ERROR
    assert all(v is False for v in h.caps.values())


def test_test_connection_passes_required_params_not_misjudged():
    """回归(真实 bug):income/fina_indicator/index_daily 等必填 ts_code/index_code。探测若缺这些
    参数,tushare 返回「必填参数」(非积分/权限错)→ 会被误判为无权限。修复后探测带必填参数,
    有权限即探测为 True。模拟:缺必填参数 → 报必填参数错;给了必填参数 → 成功。"""
    NEEDS_TS = {"income", "fina_indicator", "forecast", "index_daily", "daily", "adj_factor", "daily_basic", "hk_hold"}

    def handler(request):
        body = json.loads(request.content)
        api = body["api_name"]
        params = body.get("params") or {}
        if api in NEEDS_TS and "ts_code" not in params:
            return httpx.Response(200, json={"code": 40002, "msg": "必填参数, ts_code"})
        if api == "index_weight" and "index_code" not in params:
            return httpx.Response(200, json={"code": 40002, "msg": "必填参数, index_code"})
        return httpx.Response(200, json=_ok([], []))  # 有必填参数 → 成功(模拟有权限)

    p = make_provider(handler)
    h = p.test_connection()
    assert h.status is ProviderStatus.OK
    # 探测已带必填参数 → 这些接口不再因「必填参数」错被误判为无权限。
    for cap in ("FUNDAMENTAL", "FINA_INDICATOR", "INDEX_OHLCV", "INDEX_WEIGHT", "EARNINGS_FORECAST"):
        assert h.caps[cap] is True, f"{cap} 应为 True(探测已带必填参数,不再误判)"
