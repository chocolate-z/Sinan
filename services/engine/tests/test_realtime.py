import httpx

from sinan.providers.realtime_provider import RealtimeProvider


def make_provider(handler):
    client = httpx.Client(transport=httpx.MockTransport(handler))
    return RealtimeProvider(client=client)


def test_sina_quotes_parsed():
    def handler(request):
        host = request.url.host
        assert host == "hq.sinajs.cn"
        # 0名称,1今开,2昨收,3现价,4最高,5最低
        text = 'var hq_str_sh600519="贵州茅台,1680.0,1675.0,1700.0,1710.0,1660.0";\n'
        return httpx.Response(200, content=text.encode("gbk"))

    p = make_provider(handler)
    q = p.realtime_quotes(["600519.SH"])
    assert q["600519.SH"]["price"] == 1700.0
    assert q["600519.SH"]["prev_close"] == 1675.0
    assert q["600519.SH"]["source"] == "sina"


def test_falls_back_to_tencent_when_sina_fails():
    def handler(request):
        host = request.url.host
        if host == "hq.sinajs.cn":
            return httpx.Response(500)
        assert host == "qt.gtimg.cn"
        # 1名称,2代码,3现价,4昨收,5今开
        text = 'v_sz000001="51~平安银行~000001~12.50~12.30~12.35~...";\n'
        return httpx.Response(200, content=text.encode("gbk"))

    p = make_provider(handler)
    q = p.realtime_quotes(["000001.SZ"])
    assert q["000001.SZ"]["price"] == 12.50
    assert q["000001.SZ"]["prev_close"] == 12.30
    assert q["000001.SZ"]["source"] == "tencent"


def test_test_connection_ok():
    def handler(request):
        text = 'var hq_str_sz000001="平安银行,12.0,12.3,12.5,12.6,11.9";\n'
        return httpx.Response(200, content=text.encode("gbk"))

    p = make_provider(handler)
    h = p.test_connection()
    assert h.caps["REALTIME_QUOTE"] is True
