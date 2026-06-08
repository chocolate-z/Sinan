"""engine FastAPI 应用。仅 api 可达(校验 X-Sinan-Internal),绑定 127.0.0.1,零外联。

红线:engine 不写 SQLite(只读);token 只在内存、用完即弃,绝不落盘/日志/SSE。
"""

from __future__ import annotations

import json
import queue
import threading
from typing import Optional

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from . import __version__, config
from .cache.build import CacheBuilder
from .data import DataLayer
from .providers.akshare_provider import AkShareProvider
from .providers.base import ProviderStatus
from .providers.credentials import RequestCredentialSource
from .providers.factory import build_registry
from .providers.realtime_provider import RealtimeProvider
from .providers.tushare_provider import TushareProvider

app = FastAPI(title="Sinan engine", version=__version__)


def require_internal(x_sinan_internal: Optional[str] = Header(default=None)) -> None:
    """校验来自 api 的内部调用 token。未配置 token 时(开发/测试)放行。"""
    expected = config.internal_token()
    if expected and x_sinan_internal != expected:
        raise HTTPException(status_code=403, detail="forbidden: bad internal token")


@app.get("/healthz")
def healthz() -> dict:
    return {"status": "ok", "version": __version__, "db_ok": True, "gpu": False}


# ── 自定义指标校验(白名单 AST 安全沙箱)──────────────────────────────────
class IndicatorValidateReq(BaseModel):
    expr: str


@app.post("/engine/indicators/validate", dependencies=[Depends(require_internal)])
def indicators_validate(req: IndicatorValidateReq) -> dict:
    from .indicators import validate

    res = validate(req.expr)
    return {
        "ok": res.ok,
        "errors": res.errors,
        "lookahead_ok": res.lookahead_ok,
        "fields": res.fields,
        "functions": res.functions,
    }


# ── 训练设备 / CPU 核心探测(动态)────────────────────────────────────────
@app.get("/engine/device", dependencies=[Depends(require_internal)])
def device(threads: str = "auto", device: str = "auto") -> dict:
    from .training import resolve_device

    cfg = resolve_device(threads, device)
    return {
        "device": cfg.device,
        "num_threads": cfg.num_threads,
        "gpu_available": cfg.gpu_available,
        "cpu_count": cfg.cpu_count,
        "note": cfg.note,
    }


# ── 连通 + 能力探测 ─────────────────────────────────────────────────────
class ProviderTestReq(BaseModel):
    provider: str
    token: Optional[str] = None


def _make_provider(provider: str, token: Optional[str]):
    if provider == "tushare":
        return TushareProvider(token)
    if provider == "akshare":
        return AkShareProvider()
    if provider in ("realtime_sina", "realtime_tencent"):
        return RealtimeProvider()
    raise HTTPException(status_code=400, detail=f"unknown provider {provider}")


@app.post("/engine/provider/test", dependencies=[Depends(require_internal)])
def provider_test(req: ProviderTestReq) -> dict:
    provider = _make_provider(req.provider, req.token)
    health = provider.test_connection()
    rl = config.rate_limit_for(req.provider)
    return {
        "status": health.status.value if isinstance(health.status, ProviderStatus) else str(health.status),
        "latency_ms": health.latency_ms,
        "caps": health.caps,
        "rate_limit": health.rate_limit or rl,
        "points_hint": health.points_hint,
        "degraded": health.degraded,
        "message": health.message,
    }


# ── 实时报价 ────────────────────────────────────────────────────────────
class QuotesReq(BaseModel):
    codes: list[str]


@app.post("/engine/quotes", dependencies=[Depends(require_internal)])
def quotes(req: QuotesReq) -> dict:
    rt = RealtimeProvider()
    return rt.realtime_quotes(req.codes)


# ── 缓存覆盖 ────────────────────────────────────────────────────────────
@app.get("/engine/cache/coverage", dependencies=[Depends(require_internal)])
def coverage() -> dict:
    from .data import layout
    from .providers.base import COLS_PRICE  # noqa: F401

    dl_root = config.cache_dir()
    datasets = ["price", "adj_factor", "daily_basic", "northbound"]
    present = {d: layout.has_any(dl_root, d) for d in datasets}
    return {"cache_root": str(dl_root), "datasets": present}


# ── 建缓存(SSE 流式进度)──────────────────────────────────────────────
class CacheBuildReq(BaseModel):
    job_id: str
    params: dict
    tokens: dict[str, str] = {}
    cursor: Optional[dict] = None
    end_date: Optional[str] = None


@app.post("/engine/cache/build", dependencies=[Depends(require_internal)])
def cache_build(req: CacheBuildReq) -> StreamingResponse:
    creds = RequestCredentialSource(req.tokens)
    registry = build_registry(creds)
    builder = CacheBuilder(config.cache_dir(), registry)

    q: "queue.Queue[Optional[dict]]" = queue.Queue()

    def worker() -> None:
        try:
            builder.run(
                req.params,
                job_id=req.job_id,
                on_progress=q.put,
                cursor=req.cursor,
                end_date=req.end_date,
            )
        except Exception as e:  # noqa: BLE001 — 失败也要推给前端
            q.put({"job_id": req.job_id, "status": "failed", "message": str(e)})
        finally:
            q.put(None)

    threading.Thread(target=worker, daemon=True).start()

    def stream():
        while True:
            ev = q.get()
            if ev is None:
                break
            yield f"data: {json.dumps(ev, ensure_ascii=False)}\n\n"

    return StreamingResponse(stream(), media_type="text/event-stream")
