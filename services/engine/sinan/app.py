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


# ── 股票搜索(代码/名称补全;BYO provider.stock_list,进程内 memo)───────────
class StockSearchReq(BaseModel):
    provider: str
    token: Optional[str] = None
    q: str = ""
    limit: int = 20


# provider 名 → 完整股票清单(进程内缓存;只缓存成功非空结果,失败/空不缓存以便重试)。
# 仅内存,随进程消亡;token 绝不入此缓存键(red line #4)。
_STOCK_LIST_CACHE: dict = {}


def _load_stock_list(provider: str, token: Optional[str]):
    """完整股票清单(stock_code/name/board/industry)。进程 memo → 实时取(成功落盘)→ 盘缓存兜底。

    搜索 / 名称映射 / 行情页行业聚合共用。修「行情页板块视角离线/重启/无 token 即空」:行业分类
    与名称是近静态参考数据,曾用 token 取过一次即落 cache/_meta(见 data.meta),之后离线亦可复用。
    红线#4:落盘只含 code/name/board/industry,绝无 token;红线#1:仅展示用,不入因子/信号/回测。
    """
    from .data import meta as _meta

    df = _STOCK_LIST_CACHE.get(provider)
    if df is not None:
        return df
    # 1) 实时取(有 token/网络时):成功 → 落盘(供日后离线)+ memo。
    live = None
    try:
        live = _make_provider(provider, token).stock_list()
    except Exception:  # noqa: BLE001 — 无 token/网络/权限 → 落盘兜底
        live = None
    if live is not None and not live.is_empty():
        _STOCK_LIST_CACHE[provider] = live
        try:
            _meta.save_stock_meta(config.cache_dir(), live)
        except Exception:  # noqa: BLE001 — 落盘失败不影响本次返回
            pass
        return live
    # 2) 盘缓存兜底(此前曾取过一次):无 token / 离线 / 网络抖动仍可用。
    disk = _meta.load_stock_meta(config.cache_dir())
    if disk is not None and not disk.is_empty():
        _STOCK_LIST_CACHE[provider] = disk
        return disk
    return None


@app.post("/engine/stocks/search", dependencies=[Depends(require_internal)])
def stocks_search(req: StockSearchReq) -> dict:
    """按代码或名称模糊搜索股票。无 token/网络不可达 → 诚实空(不报错)。"""
    import polars as pl

    df = _load_stock_list(req.provider, req.token)
    if df is None or df.is_empty():
        return {"stocks": []}

    q = req.q.strip()
    out = df
    if q:
        out = df.filter(
            pl.col("stock_code").str.to_lowercase().str.contains(q.lower(), literal=True)
            | pl.col("name").str.contains(q, literal=True)
        )
    out = out.head(max(1, min(req.limit, 50)))
    return {
        "stocks": [
            {"code": r["stock_code"], "name": r["name"]} for r in out.iter_rows(named=True)
        ]
    }


# ── 股票名称映射(code→name;信号/持仓等展示用,进程内 memo 同搜索)───────────
class StockNamesReq(BaseModel):
    provider: str
    token: Optional[str] = None
    codes: Optional[list[str]] = None  # 给定则只返这些;否则返全表


@app.post("/engine/stocks/names", dependencies=[Depends(require_internal)])
def stocks_names(req: StockNamesReq) -> dict:
    """code→name 映射(用激活源 stock_list,进程内 memo + 盘缓存兜底)。无源 → 诚实空 {}。"""
    import polars as pl

    df = _load_stock_list(req.provider, req.token)
    if df is None or df.is_empty():
        return {"names": {}}
    out = df.filter(pl.col("stock_code").is_in(req.codes)) if req.codes else df
    return {"names": {r["stock_code"]: r["name"] for r in out.iter_rows(named=True)}}


# ── 行情页全市场快照(板块视角)────────────────────────────────────────────
def _industry_meta(provider: str, token: Optional[str]) -> dict:
    """code → {name, industry}(行情页板块聚合用;memo → 实时取落盘 → 盘缓存兜底)。"""
    df = _load_stock_list(provider, token)
    if df is None or df.is_empty():
        return {}
    has_industry = "industry" in df.columns
    return {
        r["stock_code"]: {
            "name": r.get("name"),
            "industry": r.get("industry") if has_industry else None,
        }
        for r in df.iter_rows(named=True)
    }


class MarketSnapshotReq(BaseModel):
    provider: str
    token: Optional[str] = None
    spark_days: int = 20


@app.post("/engine/market/snapshot", dependencies=[Depends(require_internal)])
def market_snapshot_ep(req: MarketSnapshotReq) -> dict:
    """全 A 广度 + 板块卡(真实板块视角)。无缓存/无行业 → 诚实空。"""
    from .data import DataLayer
    from .factors.market import market_snapshot

    meta = _industry_meta(req.provider, req.token)
    return market_snapshot(DataLayer(config.cache_dir()), meta, spark_days=req.spark_days)


class MarketSectorReq(BaseModel):
    provider: str
    token: Optional[str] = None
    industry: str


@app.post("/engine/market/sector", dependencies=[Depends(require_internal)])
def market_sector_ep(req: MarketSectorReq) -> dict:
    """板块成分股(现价/当日涨跌/换手)。无数据 → 诚实空。"""
    from .data import DataLayer
    from .factors.market import sector_constituents

    meta = _industry_meta(req.provider, req.token)
    return sector_constituents(DataLayer(config.cache_dir()), meta, req.industry)


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

    from datetime import datetime, timedelta

    from .data import DataLayer
    from .paper import CostModel, Position, SimAccount, run_eod

    # 单日实盘只看最近数据:把日频物化压到最近窗口防 OOM(全 A 大缓存)。内置因子回看≤20、模型同;
    # 自定义因子(req.custom)回看未知 → 不设下界(载全历史,靠 duckdb 溢写兜底,绝不少取致降级,红线#3)。
    mat_since = None
    if not req.custom:
        try:
            anchor = datetime.strptime(req.today, "%Y-%m-%d") - timedelta(days=800)
            mat_since = anchor.strftime("%Y-%m-%d")
        except (TypeError, ValueError):
            mat_since = None
    dl = DataLayer(config.cache_dir(), mat_since=mat_since)

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
    model: Optional[dict] = None  # 激活/指定模型系数(api 下发);在场则模型线性打分,口径与实盘一致
    custom: Optional[list[dict]] = None  # 启用的自定义 DSL 因子(无模型时进等权合成)


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
            model=req.model,
            custom=req.custom,
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
    # 特征面板多核:None→'auto'(min(核-1,4))利用多核;1=串行。每 worker 复制一份缓存到内存。
    feature_workers: Optional[int] = None


def _sse_compute(compute) -> StreamingResponse:
    """把同步长计算(训练/质检)包装成 SSE 流式:worker 线程跑 compute(emit),逐进度事件推前端,
    末尾推 {stage:'done', result:...} 或 {stage:'error', status, detail}。

    动机:大区间训练/质检逐日特征面板可达数分钟乃至更久;原本一次性返回 JSON 的长连接 4 小时零字节
    流动,被对端/系统空闲重置(ECONNRESET)且全程无进度。流式持续吐进度既给可见反馈、又保活连接。
    域错误(HTTPException)如实带 status 走 error 事件(api 据此转发 422/400);其余 → 500。"""
    q: "queue.Queue[Optional[dict]]" = queue.Queue()

    def worker() -> None:
        try:
            result = compute(q.put)
            q.put({"stage": "done", "result": result})
        except HTTPException as e:
            q.put({"stage": "error", "status": e.status_code, "detail": e.detail})
        except Exception as e:  # noqa: BLE001 — 失败也要诚实推给前端,不静默
            q.put({"stage": "error", "status": 500, "detail": str(e)})
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


@app.post("/engine/train", dependencies=[Depends(require_internal)])
def train(req: TrainReq) -> StreamingResponse:
    """walk-forward 训练(SSE 流式:特征面板进度 + 逐折 IS/OOS IC + done/error)。"""
    from .training import TrainGuardError, run_train

    dl = DataLayer(config.cache_dir())
    pdf = dl.asof("price", "99999999", fields=["stock_code", "trade_date"])
    if pdf.is_empty():
        # 预检失败:在开流前抛,返回非 2xx(api 按普通错误处理)。
        raise HTTPException(status_code=400, detail="本地无行情缓存,先建缓存再训练")
    trading_dates = sorted(set(pdf["trade_date"].to_list()))
    codes = req.codes or sorted(set(pdf["stock_code"].to_list()))

    def compute(emit):
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
                on_progress=emit,
                feature_workers="auto" if req.feature_workers is None else req.feature_workers,
            )
        except TrainGuardError as e:
            # 422:违反 purge>=label_horizon 硬守卫(红线#1)。
            raise HTTPException(status_code=422, detail=str(e))
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        return res.to_dict()

    return _sse_compute(compute)


# ── 因子质检(M4):逐因子真实 IC/ICIR/覆盖度 + IC 时序 + 十分位分层 ──────────
class FactorQualityReq(BaseModel):
    start: str
    end: str
    label_horizon: int = 5
    n_deciles: int = 10
    codes: Optional[list[str]] = None
    custom: Optional[list[dict]] = None  # 自定义 DSL 因子 [{name, expr, group?}]
    feature_workers: Optional[int] = None  # None→'auto' 多核;1=串行(自定义因子在场自动退串行)


@app.post("/engine/factors/quality", dependencies=[Depends(require_internal)])
def factors_quality(req: FactorQualityReq) -> StreamingResponse:
    """因子质检(SSE 流式:特征面板进度 + 逐因子 IC/ICIR/覆盖 + done/error)。"""
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

    def compute(emit):
        results, degraded = factor_quality(
            dl,
            codes,
            dates,
            custom=req.custom,
            label_horizon=req.label_horizon,
            n_deciles=req.n_deciles,
            on_progress=emit,
            feature_workers="auto" if req.feature_workers is None else req.feature_workers,
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

    return _sse_compute(compute)


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
