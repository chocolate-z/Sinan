"""AkShareProvider —— 免费兜底源,直连东方财富公开 HTTP(无 token)。

不依赖 akshare SDK,直接请求 push2/push2his 公开接口,便于 MockTransport 单测。
能力受限:仅日线/指数行情;无北向、无财务 —— 由注册表降级并诚实告知用户。
注:真实接口字段需以 BYO 实测为准(test_connection 对真实环境手测一次);
本实现按公开文档的响应形态解析,单测以 MockTransport 固定响应验证。
"""

from __future__ import annotations

import time
from typing import Any

import httpx
import polars as pl

from .base import (
    Capability,
    IDataProvider,
    ProviderError,
    ProviderHealth,
    ProviderRateLimited,
    ProviderStatus,
    Provider,
    split_code,
)

_CLIST_URL = "http://push2.eastmoney.com/api/qt/clist/get"
_KLINE_URL = "http://push2his.eastmoney.com/api/qt/stock/kline/get"

_DECLARED = Capability.DAILY_OHLCV | Capability.INDEX_OHLCV


def _secid(code: str) -> str:
    num, suffix = split_code(code)
    market = "1" if suffix == "SH" else "0"
    return f"{market}.{num}"


class AkShareProvider(IDataProvider):
    id = Provider.AKSHARE
    display_name = "AkShare(免费)"
    needs_token = False
    priority = 20

    def __init__(self, *, client: httpx.Client | None = None, timeout: float = 30.0) -> None:
        self._client = client or httpx.Client(timeout=timeout)

    def capabilities(self) -> Capability:
        return _DECLARED

    def _get(self, url: str, params: dict[str, Any]) -> dict:
        try:
            resp = self._client.get(url, params=params)
            resp.raise_for_status()
        except httpx.HTTPStatusError as e:
            status = e.response.status_code
            if status in (429, 503):
                raise ProviderRateLimited(f"HTTP {status}") from e
            raise ProviderError("http_error", f"HTTP {status}", retryable=status >= 500) from e
        except httpx.HTTPError as e:
            raise ProviderError("network_error", str(e), retryable=True) from e
        return resp.json()

    def stock_list(self) -> pl.DataFrame:
        body = self._get(
            _CLIST_URL,
            {
                "pn": 1, "pz": 10000, "po": 1, "np": 1, "fltt": 2, "invt": 2, "fid": "f12",
                "fs": "m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048",
                "fields": "f12,f13,f14,f26",
            },
        )
        diff = ((body.get("data") or {}).get("diff")) or []
        if isinstance(diff, dict):
            diff = list(diff.values())
        rows = []
        for d in diff:
            num = str(d.get("f12"))
            market = d.get("f13")
            suffix = "SH" if market == 1 else "BJ" if market == 0 and num.startswith(("8", "4")) else "SZ"
            list_date = d.get("f26")
            ld = str(list_date)
            ld_fmt = f"{ld[0:4]}-{ld[4:6]}-{ld[6:8]}" if ld.isdigit() and len(ld) == 8 else None
            rows.append(
                {"stock_code": f"{num}.{suffix}", "name": d.get("f14"), "board": suffix.lower(), "list_date": ld_fmt}
            )
        if not rows:
            return pl.DataFrame(schema={"stock_code": pl.Utf8, "name": pl.Utf8, "board": pl.Utf8, "list_date": pl.Utf8})
        return pl.DataFrame(rows)

    def daily_bars(self, code: str, start: str, end: str) -> pl.DataFrame:
        body = self._get(
            _KLINE_URL,
            {
                "secid": _secid(code),
                "klt": 101,  # 日线
                "fqt": 0,  # 不复权(复权因子另存,计算时动态施加)
                "beg": start.replace("-", ""),
                "end": end.replace("-", ""),
                "fields1": "f1,f2,f3,f4,f5,f6",
                "fields2": "f51,f52,f53,f54,f55,f56,f57",
            },
        )
        klines = ((body.get("data") or {}).get("klines")) or []
        empty = pl.DataFrame(
            schema={c: pl.Utf8 for c in ("stock_code", "trade_date")}
            | {c: pl.Float64 for c in ("open", "high", "low", "close", "volume", "amount")}
        )
        if not klines:
            return empty
        num, suffix = split_code(code)
        scode = f"{num}.{suffix}"
        rows = []
        for line in klines:
            # 东方财富 f51..f57:date,open,close,high,low,volume,amount
            parts = line.split(",")
            if len(parts) < 7:
                continue
            rows.append(
                {
                    "stock_code": scode,
                    "trade_date": parts[0],
                    "open": float(parts[1]),
                    "close": float(parts[2]),
                    "high": float(parts[3]),
                    "low": float(parts[4]),
                    "volume": float(parts[5]),
                    "amount": float(parts[6]),
                }
            )
        if not rows:
            return empty
        return pl.DataFrame(rows).select(
            "stock_code", "trade_date", "open", "high", "low", "close", "volume", "amount"
        )

    def test_connection(self) -> ProviderHealth:
        caps = {c.name: False for c in Capability}
        t0 = time.monotonic()
        try:
            self._get(_CLIST_URL, {"pn": 1, "pz": 1, "fields": "f12", "fs": "m:1+t:2"})
            for c in Capability:
                caps[c.name] = bool(_DECLARED & c)
            status = ProviderStatus.OK
            message = None
        except ProviderError as e:
            status = ProviderStatus.ERROR
            message = e.message
        latency_ms = (time.monotonic() - t0) * 1000.0
        degraded = ["免费源:无北向/财务,因子覆盖受限,样本外预期更低"]
        return ProviderHealth(
            status=status, caps=caps, latency_ms=latency_ms, degraded=degraded, message=message
        )
