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


# ── 历史日 K(本地 parquet,PIT 安全)───────────────────────────────────────
class PricesReq(BaseModel):
    code: str
    start: Optional[str] = None
    end: Optional[str] = None
    limit: int = 500
    adjust: str = "qfq"  # 'qfq' 前复权 | 'none' 原始


@app.post("/engine/prices", dependencies=[Depends(require_internal)])
def prices(req: PricesReq) -> dict:
    from .data import DataLayer
    from .data.kline import kline

    dl = DataLayer(config.cache_dir())
    rows, degraded = kline(
        dl,
        req.code,
        start=req.start or "",
        end=req.end or "99999999",
        limit=req.limit,
        adjust=req.adjust,
    )
    return {"code": req.code, "adjust": req.adjust, "rows": rows, "degraded": degraded}


# ── 盘后:出信号 + 模拟盘撮合记账(run_eod)────────────────────────────────
class PaperPosition(BaseModel):
    code: str
    shares: int
    avg_cost: float
    open_date: str
    last_buy_date: str


class PaperAccountIn(BaseModel):
    cash: float
    positions: list[PaperPosition] = []


class PaperRunReq(BaseModel):
    strategy_id: str
    today: str
    effective_date: str
    codes: Optional[list[str]] = None
    account: PaperAccountIn
    params: dict = {}
    prev_nav: Optional[float] = None
    peak_nav: Optional[float] = None
    benchmark: str = "000300.SH"
    fill: bool = True
    model: Optional[dict] = None  # 激活的 ML 模型系数(api 下发);在场则模型打分,否则等权
    custom: Optional[list[dict]] = None  # 启用的自定义 DSL 因子(无模型时进等权合成)


def _price_map(dl, dataset: str, asof: str, field: str, codes) -> dict[str, float]:
    df = dl.latest_asof(dataset, asof, fields=["stock_code", field], codes=codes)
    if df.is_empty():
        return {}
    return {r["stock_code"]: r[field] for r in df.iter_rows(named=True) if r[field] is not None}


@app.post("/engine/paper/run", dependencies=[Depends(require_internal)])
def paper_run(req: PaperRunReq) -> dict:
    from dataclasses import asdict

    from .data import DataLayer
    from .paper import CostModel, Position, SimAccount, run_eod

    dl = DataLayer(config.cache_dir())

    codes = req.codes
    if not codes:
        latest = dl.latest_asof("price", req.today, fields=["stock_code", "close"])
        codes = latest["stock_code"].to_list() if not latest.is_empty() else []

    prices_today = _price_map(dl, "price", req.today, "close", codes)
    open_next = _price_map(dl, "price", req.effective_date, "open", codes)
    if not open_next:  # T+1 开盘价缺失时以今收盘价兜底(诚实标注降级由上层处理)
        open_next = prices_today

    bench_df = dl.asof("index_ohlcv", req.today, fields=["trade_date", "close"], codes=[req.benchmark])
    bench_closes = bench_df.sort("trade_date")["close"].to_list() if not bench_df.is_empty() else []
    benchmark_pct = (
        bench_closes[-1] / bench_closes[-2] - 1.0 if len(bench_closes) >= 2 else None
    )

    acc = SimAccount(cash=req.account.cash, costs=CostModel.from_config())
    for p in req.account.positions:
        acc.positions[p.code] = Position(p.code, p.shares, p.avg_cost, p.open_date, p.last_buy_date)

    res = run_eod(
        data=dl, codes=codes, today=req.today, effective_date=req.effective_date, account=acc,
        bench_closes=bench_closes, prices_today=prices_today, open_prices_next=open_next,
        params=req.params, prev_nav=req.prev_nav, peak_nav=req.peak_nav, fill=req.fill,
        model=req.model, custom=req.custom,
    )

    return {
        "trade_date": res.trade_date,
        "effective_date": res.effective_date,
        "market_open": res.market_open,
        "coverage": res.coverage,
        "degraded": res.degraded,
        "benchmark_pct": benchmark_pct,
        "signals": [asdict(s) for s in res.signals],
        "trades": [asdict(t) for t in res.trades],
        "positions": [
            {"code": p.code, "shares": p.shares, "avg_cost": p.avg_cost,
             "open_date": p.open_date, "last_buy_date": p.last_buy_date}
            for p in acc.positions.values()
        ],
        "account": res.account,
    }


# ── 回测(事件驱动逐日;硬守卫 backtest_start>train_end+purge)────────────
class BacktestReq(BaseModel):
    backtest_start: str
    backtest_end: str
    train_end: str
    codes: Optional[list[str]] = None
    benchmark: str = "000300.SH"
    purge: int = 5
    params: dict = {}
    initial_cash: float = 1_000_000.0


@app.post("/engine/backtest", dependencies=[Depends(require_internal)])
def backtest(req: BacktestReq) -> dict:
    from .backtest import BacktestGuardError, run_backtest
    from .data import DataLayer

    dl = DataLayer(config.cache_dir())
    # 交易日历从 price 缓存推断(distinct trade_date);全市场代码同理。
    pdf = dl.asof("price", "99999999", fields=["stock_code", "trade_date"])
    if pdf.is_empty():
        raise HTTPException(status_code=400, detail="本地无行情缓存,先建缓存再回测")
    trading_dates = sorted(set(pdf["trade_date"].to_list()))
    codes = req.codes or sorted(set(pdf["stock_code"].to_list()))

    try:
        res = run_backtest(
            dl,
            codes=codes,
            trading_dates=trading_dates,
            backtest_start=req.backtest_start,
            backtest_end=req.backtest_end,
            train_end=req.train_end,
            params=req.params,
            benchmark=req.benchmark,
            purge=req.purge,
            initial_cash=req.initial_cash,
        )
    except BacktestGuardError as e:
        # 422:语义合法但违反诚实样本外硬守卫(红线#2)。
        raise HTTPException(status_code=422, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return res.to_dict()


# ── 训练(walk-forward + 样本内外 IC;硬守卫 purge>=label_horizon)──────────
class TrainReq(BaseModel):
    train_start: str
    train_end: str
    label_horizon: int = 5
    purge: Optional[int] = None  # 默认 = label_horizon
    embargo: int = 0
    train_span: int = 252
    test_span: int = 63
    codes: Optional[list[str]] = None
    model_type: str = "elasticnet"
    alpha: float = 0.001
    l1_ratio: float = 0.5
    top_quantile: float = 0.2
    train_threads: str = "auto"
    device: str = "auto"


@app.post("/engine/train", dependencies=[Depends(require_internal)])
def train(req: TrainReq) -> dict:
    from .training import TrainGuardError, run_train

    dl = DataLayer(config.cache_dir())
    pdf = dl.asof("price", "99999999", fields=["stock_code", "trade_date"])
    if pdf.is_empty():
        raise HTTPException(status_code=400, detail="本地无行情缓存,先建缓存再训练")
    trading_dates = sorted(set(pdf["trade_date"].to_list()))
    codes = req.codes or sorted(set(pdf["stock_code"].to_list()))

    try:
        res = run_train(
            dl,
            codes=codes,
            trading_dates=trading_dates,
            train_start=req.train_start,
            train_end=req.train_end,
            label_horizon=req.label_horizon,
            purge=req.purge,
            embargo=req.embargo,
            train_span=req.train_span,
            test_span=req.test_span,
            model_type=req.model_type,
            alpha=req.alpha,
            l1_ratio=req.l1_ratio,
            top_quantile=req.top_quantile,
            train_threads=req.train_threads,
            device=req.device,
        )
    except TrainGuardError as e:
        # 422:违反 purge>=label_horizon 硬守卫(红线#1)。
        raise HTTPException(status_code=422, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return res.to_dict()


# ── 因子质检(M4):逐因子真实 IC/ICIR/覆盖度 + IC 时序 + 十分位分层 ──────────
class FactorQualityReq(BaseModel):
    start: str
    end: str
    label_horizon: int = 5
    n_deciles: int = 10
    codes: Optional[list[str]] = None
    custom: Optional[list[dict]] = None  # 自定义 DSL 因子 [{name, expr, group?}]


@app.post("/engine/factors/quality", dependencies=[Depends(require_internal)])
def factors_quality(req: FactorQualityReq) -> dict:
    from dataclasses import asdict

    from .factors.quality import factor_quality

    dl = DataLayer(config.cache_dir())
    pdf = dl.asof("price", "99999999", fields=["stock_code", "trade_date"])
    if pdf.is_empty():
        raise HTTPException(status_code=400, detail="本地无行情缓存,先建缓存再做因子质检")
    all_dates = sorted(set(pdf["trade_date"].to_list()))
    dates = [d for d in all_dates if req.start <= d <= req.end]
    if len(dates) < req.n_deciles:
        raise HTTPException(status_code=400, detail="评估区间交易日不足(需 >= n_deciles)")
    codes = req.codes or sorted(set(pdf["stock_code"].to_list()))
    results, degraded = factor_quality(
        dl, codes, dates, custom=req.custom, label_horizon=req.label_horizon, n_deciles=req.n_deciles
    )
    return {
        "start": req.start,
        "end": req.end,
        "label_horizon": req.label_horizon,
        "n_dates": len(dates),
        "n_codes": len(codes),
        "factors": [asdict(r) for r in results],
        "degraded": degraded,
    }


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
