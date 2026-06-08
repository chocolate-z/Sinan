"""RealtimeProvider —— 实时现价/昨收,新浪→腾讯三级降级(继承原型 realtime.py 逻辑)。

仅声明 REALTIME_QUOTE;与历史源解耦(历史可 Tushare,实时仍用新浪,互不影响)。
供当日收益与盘中刷新。注入 httpx.Client 便于 MockTransport 单测。
"""

from __future__ import annotations

import time
from typing import Sequence

import httpx

from .base import (
    Capability,
    IDataProvider,
    ProviderError,
    ProviderHealth,
    ProviderStatus,
    Provider,
    split_code,
)

_SINA_URL = "http://hq.sinajs.cn/list="
_TENCENT_URL = "http://qt.gtimg.cn/q="


def _sina_code(code: str) -> str:
    num, suffix = split_code(code)
    return f"{suffix.lower()}{num}"


class RealtimeProvider(IDataProvider):
    id = Provider.REALTIME_SINA
    display_name = "实时(新浪→腾讯)"
    needs_token = False
    priority = 30

    def __init__(self, *, client: httpx.Client | None = None, timeout: float = 10.0) -> None:
        self._client = client or httpx.Client(timeout=timeout)

    def capabilities(self) -> Capability:
        return Capability.REALTIME_QUOTE

    def realtime_quotes(self, codes: Sequence[str]) -> dict[str, dict]:
        if not codes:
            return {}
        try:
            return self._sina(codes)
        except ProviderError:
            return self._tencent(codes)

    def _sina(self, codes: Sequence[str]) -> dict[str, dict]:
        sina_codes = [_sina_code(c) for c in codes]
        try:
            resp = self._client.get(
                _SINA_URL + ",".join(sina_codes),
                headers={"Referer": "https://finance.sina.com.cn"},
            )
            resp.raise_for_status()
        except httpx.HTTPError as e:
            raise ProviderError("sina_error", str(e), retryable=True) from e
        text = resp.content.decode("gbk", errors="ignore")
        out: dict[str, dict] = {}
        for code, line in zip(codes, text.strip().splitlines()):
            try:
                payload = line.split('"', 2)[1]
            except IndexError:
                continue
            fields = payload.split(",")
            if len(fields) < 4 or not fields[0]:
                continue
            # 新浪:0 名称,1 今开,2 昨收,3 现价,4 最高,5 最低
            out[code] = {
                "name": fields[0],
                "open": _f(fields[1]),
                "prev_close": _f(fields[2]),
                "price": _f(fields[3]),
                "source": "sina",
            }
        if not out:
            raise ProviderError("sina_empty", "新浪无数据", retryable=True)
        return out

    def _tencent(self, codes: Sequence[str]) -> dict[str, dict]:
        t_codes = [_sina_code(c) for c in codes]
        try:
            resp = self._client.get(_TENCENT_URL + ",".join(t_codes))
            resp.raise_for_status()
        except httpx.HTTPError as e:
            raise ProviderError("tencent_error", str(e), retryable=True) from e
        text = resp.content.decode("gbk", errors="ignore")
        out: dict[str, dict] = {}
        for code, line in zip(codes, text.strip().splitlines()):
            try:
                payload = line.split('"', 2)[1]
            except IndexError:
                continue
            fields = payload.split("~")
            if len(fields) < 6:
                continue
            # 腾讯:1 名称,2 代码,3 现价,4 昨收,5 今开
            out[code] = {
                "name": fields[1],
                "price": _f(fields[3]),
                "prev_close": _f(fields[4]),
                "open": _f(fields[5]),
                "source": "tencent",
            }
        if not out:
            raise ProviderError("tencent_empty", "腾讯无数据", retryable=True)
        return out

    def test_connection(self) -> ProviderHealth:
        caps = {c.name: False for c in Capability}
        t0 = time.monotonic()
        try:
            self.realtime_quotes(["000001.SZ"])
            caps[Capability.REALTIME_QUOTE.name] = True
            status = ProviderStatus.OK
            message = None
        except ProviderError as e:
            status = ProviderStatus.ERROR
            message = e.message
        return ProviderHealth(
            status=status, caps=caps, latency_ms=(time.monotonic() - t0) * 1000.0, message=message
        )


def _f(s: str) -> float | None:
    try:
        return float(s)
    except (TypeError, ValueError):
        return None
