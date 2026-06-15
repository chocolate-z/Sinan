import httpx

from sinan.providers.akshare_provider import AkShareProvider
from sinan.providers.base import Capability, ProviderStatus


def make_provider(handler):
    client = httpx.Client(transport=httpx.MockTransport(handler))
    return AkShareProvider(client=client)


def test_daily_bars_parses_eastmoney_klines():
    def handler(request):
        assert "push2his" in str(request.url)
        # f51..f57: date,open,close,high,low,volume,amount
        return httpx.Response(
            200,
            json={
                "data": {
                    "code": "600519",
                    "klines": [
                        "2024-01-02,1.0,1.1,1.2,0.9,1000,1100.0",
                        "2024-01-03,1.1,1.15,1.2,1.05,900,990.0",
                    ],
                }
            },
        )

    p = make_provider(handler)
    df = p.daily_bars("600519.SH", "2024-01-01", "2024-01-31")
    assert df.columns == ["stock_code", "trade_date", "open", "high", "low", "close", "volume", "amount"]
    r = df.row(0, named=True)
    assert r["stock_code"] == "600519.SH"
    assert r["open"] == 1.0 and r["close"] == 1.1 and r["high"] == 1.2 and r["low"] == 0.9
    assert df.height == 2


def test_index_bars_uses_eastmoney_kline_with_secid():
    """指数日线(回测基准):secid 区分市场(沪 1./深 0.),复用 kline 解析。"""

    def handler(request):
        assert "push2his" in str(request.url)
        assert "secid=1.000300" in str(request.url)  # 沪深300 在上交所 → market 1
        return httpx.Response(
            200,
            json={"data": {"klines": ["2024-01-02,3900,3950,3960,3880,1e6,2e9"]}},
        )

    p = make_provider(handler)
    df = p.index_bars("000300.SH", "2024-01-01", "2024-01-31")
    r = df.row(0, named=True)
    assert r["stock_code"] == "000300.SH" and r["close"] == 3950.0


def test_capabilities_exclude_northbound():
    p = AkShareProvider()
    caps = p.capabilities()
    assert caps & Capability.DAILY_OHLCV
    assert not (caps & Capability.NORTHBOUND)
    assert not (caps & Capability.FUNDAMENTAL)


def test_test_connection_marks_degraded():
    def handler(request):
        return httpx.Response(200, json={"data": {"diff": [{"f12": "600519"}]}})

    p = make_provider(handler)
    h = p.test_connection()
    assert h.status is ProviderStatus.OK
    assert h.caps["DAILY_OHLCV"] is True
    assert h.caps["NORTHBOUND"] is False
    assert any("免费源" in d for d in h.degraded)


def test_stock_list_parses_market_suffix():
    def handler(request):
        return httpx.Response(
            200,
            json={
                "data": {
                    "diff": [
                        {"f12": "600519", "f13": 1, "f14": "贵州茅台", "f26": 20010827},
                        {"f12": "000001", "f13": 0, "f14": "平安银行", "f26": 19910403},
                    ]
                }
            },
        )

    p = make_provider(handler)
    df = p.stock_list()
    codes = set(df["stock_code"].to_list())
    assert "600519.SH" in codes and "000001.SZ" in codes
