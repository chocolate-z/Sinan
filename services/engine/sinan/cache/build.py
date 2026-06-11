"""零数据冷启动建缓存作业:限速 / 断点续传 / 增量 / SSE 进度 / 优雅降级。

红线落地:
- 断点续传:每完成 N 只 flush cursor;中途停止后从 cursor 恢复,不重拉已完成部分。
- 去重:store.write_dataset 按主键去重 → 续传/重跑绝不产生重复行。
- 增量:以 data_coverage.last_date 为锚,只拉缺口。
- 降级永不静默:某能力全链不可用 → 记入 result.degraded,coverage 不含该 dataset。
- 限速:由 ProviderRegistry 的令牌桶承担(每 provider 一桶)。
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Callable, Iterable, Sequence

from ..data import store
from ..providers.base import Capability
from ..providers.registry import DegradedResult, ProviderRegistry

# dataset → (所需能力, 取数方法名)
_DATASET_FETCH: dict[str, tuple[Capability, str]] = {
    "price": (Capability.DAILY_OHLCV, "daily_bars"),
    "adj_factor": (Capability.ADJ_FACTOR, "adj_factor"),
    "daily_basic": (Capability.DAILY_BASIC, "daily_basic"),
    "northbound": (Capability.NORTHBOUND, "northbound"),
}

ProgressCb = Callable[[dict], None]
ContinueCb = Callable[[], bool]


@dataclass
class CoverageEntry:
    stock_code: str
    dataset: str
    provider: str
    first_date: str | None
    last_date: str | None
    rows: int


@dataclass
class CacheBuildResult:
    job_id: str
    status: str  # done / paused / canceled / failed
    total: int
    done_count: int
    failed_count: int
    cursor: dict
    coverage: list[CoverageEntry] = field(default_factory=list)
    degraded: list[str] = field(default_factory=list)
    events: list[dict] = field(default_factory=list)


def _next_day(d: str) -> str:
    return (datetime.strptime(d, "%Y-%m-%d").date() + timedelta(days=1)).isoformat()


class CacheBuilder:
    def __init__(self, cache_root: Path | str, registry: ProviderRegistry) -> None:
        self.cache_root = Path(cache_root)
        self.registry = registry

    # ── 解析 universe ─────────────────────────────────────────────────────
    def resolve_universe(self, params: dict) -> list[str]:
        uni = params.get("universe", {})
        codes = uni.get("codes")
        if codes:
            return list(codes)
        boards = set(uni.get("boards", ["sh", "sz"]))
        res = self.registry.fetch(Capability.DAILY_OHLCV, lambda p: p.stock_list())
        if isinstance(res, DegradedResult):
            return []
        df = res.filter(__import__("polars").col("board").is_in(list(boards)))
        return df["stock_code"].to_list()

    # ── 主流程 ────────────────────────────────────────────────────────────
    def run(
        self,
        params: dict,
        *,
        job_id: str,
        on_progress: ProgressCb | None = None,
        should_continue: ContinueCb | None = None,
        cursor: dict | None = None,
        codes: Sequence[str] | None = None,
        end_date: str | None = None,
        flush_every: int = 20,
    ) -> CacheBuildResult:
        on_progress = on_progress or (lambda e: None)
        should_continue = should_continue or (lambda: True)
        end_date = end_date or date.today().isoformat()
        start_year = params.get("start_year")
        if start_year is None and params.get("years"):
            start_year = date.today().year - int(params["years"])
        start_date = f"{start_year or 2018}-01-01"

        datasets = [d for d in params.get("datasets", []) if d in _DATASET_FETCH]
        universe = list(codes) if codes is not None else self.resolve_universe(params)
        total = len(universe)

        result = CacheBuildResult(
            job_id=job_id, status="running", total=total, done_count=0, failed_count=0,
            cursor=dict(cursor or {}),
        )
        start_index = int((cursor or {}).get("next_index", 0))
        degraded_caps: set[str] = set()
        provider_of: dict[tuple[str, str], str] = {}  # (code,dataset)→provider,终态汇报用

        def emit(
            stage: str, idx: int, message: str = "", coverage: list[CoverageEntry] | None = None
        ) -> None:
            progress = (idx / total) if total else 1.0
            ev: dict = {
                "job_id": job_id,
                "status": "done" if stage == "done" else "running",
                "progress": round(progress, 4),
                "total": total,
                "done_count": idx,
                "failed_count": result.failed_count,
                "stage": stage,
                "message": message,
                "ts": datetime.now().isoformat(timespec="seconds"),
            }
            if coverage:
                ev["coverage"] = [asdict(c) for c in coverage]
            if stage in ("done", "paused"):
                ev["degraded"] = result.degraded
            result.events.append(ev)
            on_progress(ev)

        for idx in range(start_index, total):
            if not should_continue():
                result.status = "paused"
                result.cursor = {"next_index": idx}
                result.done_count = idx
                emit("paused", idx, "已暂停,保留游标")
                return result

            code = universe[idx]
            for dataset in datasets:
                cap, method = _DATASET_FETCH[dataset]
                # 增量锚:已覆盖到 last_date 则只拉缺口。
                _, cov_last, _ = store.coverage_for(self.cache_root, dataset, code)
                fetch_start = _next_day(cov_last) if cov_last else start_date
                if cov_last and cov_last >= end_date:
                    continue  # 已是最新,跳过

                res, provider_id = self.registry.fetch_traced(
                    cap,
                    lambda p, m=method, c=code, s=fetch_start, e=end_date: getattr(p, m)(c, s, e),
                    reason=f"{dataset} 无可用源",
                )
                if isinstance(res, DegradedResult):
                    if dataset not in degraded_caps:
                        degraded_caps.add(dataset)
                        result.degraded.append(f"{dataset}: {res.reason}")
                    continue
                if res is None or res.is_empty():
                    # 该 code 此 dataset 无新数据,不算失败。
                    continue
                store.write_dataset(self.cache_root, dataset, res)
                provider_of[(code, dataset)] = provider_id or "unknown"

            # 本股当前全量覆盖(读 store,含本轮跳过的已缓存项)→ 逐股增量回传,api 即时落库。
            # 修复:此前 coverage 只进返回值、从不进 SSE 事件 → api data_coverage 永空 → 设置页
            # 误判「未建缓存」。逐股回传(非单个巨型 done 事件):① 部分/中断构建也记录已完成股票;
            # ② all-stocks(数千只)不产生多 MB 事件;③ 重建(全跳过)也把磁盘已有缓存如实回填。
            stock_cov: list[CoverageEntry] = []
            for ds in datasets:
                first, last, rows = store.coverage_for(self.cache_root, ds, code)
                if rows:
                    stock_cov.append(
                        CoverageEntry(
                            code, ds, provider_of.get((code, ds), "cache"), first, last, rows
                        )
                    )
            result.coverage.extend(stock_cov)

            done = idx + 1
            result.done_count = done
            if done % flush_every == 0 or done == total:
                result.cursor = {"next_index": done}
            emit("fetching", done, f"{code} 完成", coverage=stock_cov)

        result.status = "done"
        result.cursor = {"next_index": total}
        emit("done", total, "建缓存完成")
        return result
