"""TushareProvider —— 首选源,直连 Tushare Pro HTTP API(http://api.tushare.pro)。

不依赖 tushare SDK,便于注入 MockTransport 单测。token 由 api 下发(BYO,红线#4)。
每个能力方法把「无权限/积分不足」翻译为 CapabilityNotSupported,使注册表无惩罚地降级。
"""

from __future__ import annotations

import time
from typing import Any, Sequence

import httpx
import polars as pl

from .base import (
    Capability,
    CapabilityNotSupported,
    IDataProvider,
    ProviderAuthError,
    ProviderError,
    ProviderHealth,
    ProviderRateLimited,
    ProviderStatus,
    Provider,
    board_of,
    normalize_code,
)

TUSHARE_URL = "http://api.tushare.pro"

# Tushare 能力 → (探测 api 名, 探测参数)。test_connection 据此构建 caps 矩阵。
# ⚠️ 参数必须满足该接口的「必填参数」:income/fina_indicator/index_daily 等必填 ts_code,
# 否则 tushare 返回「必填参数, ts_code」(非积分/权限错)→ 会把「有权限但缺参数」误判为无权限。
# 给足必填参数后,tushare 才会真正执行积分/权限校验,探测结果才准确(限 limit=1 拉最小数据)。
_PROBE = [
    (Capability.DAILY_OHLCV, "daily", {"ts_code": "000001.SZ"}),
    (Capability.ADJ_FACTOR, "adj_factor", {"ts_code": "000001.SZ"}),
    (Capability.DAILY_BASIC, "daily_basic", {"ts_code": "000001.SZ"}),
    (Capability.FUNDAMENTAL, "income", {"ts_code": "000001.SZ"}),
    (Capability.FINA_INDICATOR, "fina_indicator", {"ts_code": "000001.SZ"}),
    (Capability.NORTHBOUND, "hk_hold", {"ts_code": "000001.SZ"}),
    (Capability.INDEX_OHLCV, "index_daily", {"ts_code": "000300.SH"}),
    (Capability.INDEX_WEIGHT, "index_weight", {"index_code": "000300.SH"}),
    (Capability.SW_INDUSTRY, "index_classify", {}),
    (Capability.EARNINGS_FORECAST, "forecast", {"ts_code": "000001.SZ"}),
    (Capability.TRADE_CAL, "trade_cal", {}),
]

_DECLARED = (
    Capability.DAILY_OHLCV
    | Capability.ADJ_FACTOR
    | Capability.DAILY_BASIC
    | Capability.FUNDAMENTAL
    | Capability.FINA_INDICATOR
    | Capability.NORTHBOUND
    | Capability.INDEX_OHLCV
    | Capability.INDEX_WEIGHT
    | Capability.SW_INDUSTRY
    | Capability.EARNINGS_FORECAST
    | Capability.TRADE_CAL
)


class _PermissionDenied(ProviderError):
    def __init__(self, message: str) -> None:
        super().__init__("permission_denied", message, retryable=False)


def _fmt_in(d: str) -> str:
    return d.replace("-", "")


def _fmt_out(d: str) -> str:
    s = str(d)
    return f"{s[0:4]}-{s[4:6]}-{s[6:8]}" if len(s) == 8 and "-" not in s else s


class TushareProvider(IDataProvider):
    id = Provider.TUSHARE
    display_name = "Tushare Pro"
    needs_token = True
    priority = 10

    def __init__(
        self,
        token: str | None,
        *,
        client: httpx.Client | None = None,
        timeout: float = 30.0,
    ) -> None:
        self.token = token
        self._client = client or httpx.Client(base_url=TUSHARE_URL, timeout=timeout)

    def capabilities(self) -> Capability:
        return _DECLARED

    # ── 底层调用 ──────────────────────────────────────────────────────────
    def _call(self, api_name: str, params: dict[str, Any], fields: str) -> pl.DataFrame:
        if not self.token:
            raise ProviderAuthError("未配置 Tushare token")
        payload = {
            "api_name": api_name,
            "token": self.token,
            "params": params,
            "fields": fields,
        }
        try:
            resp = self._client.post("/", json=payload)
            resp.raise_for_status()
        except httpx.HTTPStatusError as e:
            status = e.response.status_code
            if status in (429, 503):
                raise ProviderRateLimited(f"HTTP {status}") from e
            raise ProviderError("http_error", f"HTTP {status}", retryable=status >= 500) from e
        except httpx.HTTPError as e:
            raise ProviderError("network_error", str(e), retryable=True) from e

        body = resp.json()
        code = body.get("code", 0)
        if code != 0:
            msg = str(body.get("msg", ""))
            # 顺序要紧:token 失效(fatal) > 积分/权限缺失(降级) > 限频(可重试) > 其它。
            # 「积分不足」是权限类(该接口不可用),区别于「每分钟次数」(限频)。
            if "token" in msg.lower() and ("无效" in msg or "不对" in msg or "错误" in msg):
                raise ProviderAuthError(msg)
            if "积分" in msg or "权限" in msg:
                raise _PermissionDenied(msg)
            if "每分钟" in msg or "访问该接口的次数" in msg or "最多访问" in msg or code == 40203:
                raise ProviderRateLimited(msg)
            raise ProviderError("tushare_error", msg or f"code={code}", retryable=False)

        data = body.get("data") or {}
        cols = data.get("fields") or []
        items = data.get("items") or []
        if not cols:
            return pl.DataFrame()
        return pl.DataFrame(items, schema=cols, orient="row")

    # ── 能力方法 ──────────────────────────────────────────────────────────
    def stock_list(self) -> pl.DataFrame:
        df = self._call("stock_basic", {"list_status": "L"}, "ts_code,name,list_date")
        if df.is_empty():
            return pl.DataFrame(schema={"stock_code": pl.Utf8, "name": pl.Utf8, "board": pl.Utf8, "list_date": pl.Utf8})
        return df.with_columns(
            pl.col("ts_code").map_elements(normalize_code, return_dtype=pl.Utf8).alias("stock_code"),
            pl.col("ts_code").map_elements(board_of, return_dtype=pl.Utf8).alias("board"),
            pl.col("list_date").map_elements(_fmt_out, return_dtype=pl.Utf8).alias("list_date"),
        ).select("stock_code", "name", "board", "list_date")

    def daily_bars(self, code: str, start: str, end: str) -> pl.DataFrame:
        df = self._call(
            "daily",
            {"ts_code": normalize_code(code), "start_date": _fmt_in(start), "end_date": _fmt_in(end)},
            "ts_code,trade_date,open,high,low,close,vol,amount",
        )
        if df.is_empty():
            return pl.DataFrame(schema={c: pl.Utf8 for c in ("stock_code", "trade_date")})
        return df.with_columns(
            pl.lit(normalize_code(code)).alias("stock_code"),
            pl.col("trade_date").map_elements(_fmt_out, return_dtype=pl.Utf8),
            pl.col("vol").alias("volume"),
        ).select("stock_code", "trade_date", "open", "high", "low", "close", "volume", "amount")

    def adj_factor(self, code: str, start: str, end: str) -> pl.DataFrame:
        df = self._call(
            "adj_factor",
            {"ts_code": normalize_code(code), "start_date": _fmt_in(start), "end_date": _fmt_in(end)},
            "ts_code,trade_date,adj_factor",
        )
        if df.is_empty():
            return pl.DataFrame(schema={"stock_code": pl.Utf8, "trade_date": pl.Utf8, "adj_factor": pl.Float64})
        return df.with_columns(
            pl.lit(normalize_code(code)).alias("stock_code"),
            pl.col("trade_date").map_elements(_fmt_out, return_dtype=pl.Utf8),
        ).select("stock_code", "trade_date", "adj_factor")

    def daily_basic(self, code: str, start: str, end: str) -> pl.DataFrame:
        try:
            df = self._call(
                "daily_basic",
                {"ts_code": normalize_code(code), "start_date": _fmt_in(start), "end_date": _fmt_in(end)},
                "ts_code,trade_date,pe_ttm,pb,ps_ttm,total_mv,circ_mv,turnover_rate,dv_ttm",
            )
        except _PermissionDenied:
            raise CapabilityNotSupported(str(self.id), Capability.DAILY_BASIC)
        if df.is_empty():
            return pl.DataFrame(schema={"stock_code": pl.Utf8, "trade_date": pl.Utf8})
        return df.with_columns(
            pl.lit(normalize_code(code)).alias("stock_code"),
            pl.col("trade_date").map_elements(_fmt_out, return_dtype=pl.Utf8),
        ).select(
            "stock_code", "trade_date", "pe_ttm", "pb", "ps_ttm",
            "total_mv", "circ_mv", "turnover_rate", "dv_ttm",
        )

    def northbound(self, code: str, start: str, end: str) -> pl.DataFrame:
        try:
            df = self._call(
                "hk_hold",
                {"ts_code": normalize_code(code), "start_date": _fmt_in(start), "end_date": _fmt_in(end)},
                "ts_code,trade_date,ratio",
            )
        except _PermissionDenied:
            # 积分不足以访问北向 —— 翻译为能力缺失,注册表无惩罚降级。
            raise CapabilityNotSupported(str(self.id), Capability.NORTHBOUND)
        if df.is_empty():
            return pl.DataFrame(schema={"stock_code": pl.Utf8, "trade_date": pl.Utf8, "north_hold_ratio": pl.Float64})
        return df.with_columns(
            pl.lit(normalize_code(code)).alias("stock_code"),
            pl.col("trade_date").map_elements(_fmt_out, return_dtype=pl.Utf8),
            pl.col("ratio").alias("north_hold_ratio"),
        ).select("stock_code", "trade_date", "north_hold_ratio")

    # ── 连通 + 能力探测 ───────────────────────────────────────────────────
    def test_connection(self) -> ProviderHealth:
        if not self.token:
            return ProviderHealth(
                status=ProviderStatus.ERROR,
                caps={c.name: False for c in Capability},
                message="未配置 Tushare token",
            )
        caps: dict[str, bool] = {c.name: False for c in Capability}
        degraded: list[str] = []
        latency_ms: float | None = None
        auth_ok = False
        for cap, api_name, probe_params in _PROBE:
            t0 = time.monotonic()
            try:
                # 极小探测:带该接口必填参数 + limit=1 拉最小数据;有权限→成功,无权限→积分错(下方捕获)。
                self._call(api_name, {**probe_params, "limit": "1"}, "")
                caps[cap.name] = True
                auth_ok = True
            except ProviderAuthError as e:
                return ProviderHealth(
                    status=ProviderStatus.ERROR,
                    caps=caps,
                    message=e.message,
                )
            except _PermissionDenied:
                caps[cap.name] = False
                degraded.append(f"{cap.name} 积分不足/无权限")
                auth_ok = True
            except ProviderRateLimited:
                caps[cap.name] = True  # 限频说明接口存在且 token 有效
                auth_ok = True
            except ProviderError:
                caps[cap.name] = False
            finally:
                if latency_ms is None:
                    latency_ms = (time.monotonic() - t0) * 1000.0
        status = ProviderStatus.OK if auth_ok else ProviderStatus.ERROR
        if not caps.get(Capability.NORTHBOUND.name):
            degraded.append("北向不可用,因子将退回价量+基本面,样本外预期更低")
        return ProviderHealth(
            status=status,
            caps=caps,
            latency_ms=latency_ms,
            degraded=degraded,
        )
