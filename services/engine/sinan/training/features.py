"""特征面板:把「单一 asof 截面」的因子矩阵堆叠成 ML 训练所需的 date×code 长表。

纯组合现有积木(FactorContext + compute_factor_matrix),不新增取数路径:
- 每个交易日 T 各自 FactorContext(asof=T) → compute_factor_matrix(已去极值/标准化/方向,且
  统计量只在当日截面内算,红线#1)→ 加 date 列 → 纵向堆叠。
- 列集固定为 factors 全集(某日某因子降级则该日该列为 null,不静默、不补 0)。

红线#1(无未来函数):特征仅经 DataLayer.asof(只见 <=T),T 日特征不依赖任何 date>T 的数据
(由 data.asof 黄金测试守护)。本模块绝不读取未来价 —— 前向收益是 labels.py 的职责,两者严禁混用。

提速(逐日全市场 asof 是大区间训练/质检主耗时):
- ① 有界回看:各因子声明 lookback,逐日 history 只取每股最近窗口(见 FactorContext.lookback),
  把逐日 O(全历史) 降为 O(窗口)。自定义 DSL 因子回看未知 → 不裁剪,保正确(红线#3)。
- ② 多核并行(默认关,显式 workers>1 才开):按日期分块进程池并行(每日独立,PIT 不变);仅因子
  全可裁剪(无自定义闭包 → 可 pickle)时启用。⚠ 每 worker 各物化一份缓存,故按 worker 数均分
  duckdb 内存预算(总占用恒定一份、不随并行度倍增致卡死);质检/训练端点默认串行 = 最省内存。
"""

from __future__ import annotations

import multiprocessing as mp
import os
from concurrent.futures import ProcessPoolExecutor, as_completed
from dataclasses import dataclass, field
from typing import Callable, Optional, Sequence

import polars as pl

from ..data import DataLayer
from ..factors import FactorContext
from ..factors.library import DEFAULT_FACTORS, Factor
from ..factors.score import compute_factor_matrix

# 历史窗口缓冲:取 max(因子回看)+缓冲行,纯安全冗余(多取旧行绝不改因子值,少取才会致静默降级)。
_LOOKBACK_BUFFER = 5
# 并行分块的目标天数/块:块数 = ceil(天数/此值),经进程池排队;块越多进度心跳越密,
# 同进程跨块复用物化(_WORKER_DL)不重复加载。
_PAR_CHUNK_DAYS = 30
# 低于此天数不并行(进程启动 + 每 worker 物化的固定开销会盖过收益)。
_PAR_MIN_DAYS = 40


@dataclass
class FeaturePanel:
    panel: pl.DataFrame  # 长表:date, stock_code, f_<name>...(降级处为 null)
    feature_cols: list[str]  # 固定特征列(factors 全集)
    degraded_days: dict[str, int] = field(default_factory=dict)  # 因子名 → 降级天数(诚实上报)
    n_dates: int = 0


def _empty_panel(feature_cols: list[str]) -> pl.DataFrame:
    return pl.DataFrame(
        schema={"date": pl.Utf8, "stock_code": pl.Utf8, **{c: pl.Float64 for c in feature_cols}}
    )


def _resolve_lookback(factors: list[Factor]) -> int | None:
    """逐日历史窗口:全部因子回看已知 → max+缓冲(裁剪提速);任一未知(自定义 DSL)→ None 不裁剪。"""
    lbs = [f.lookback for f in factors]
    if any(lb is None for lb in lbs):
        return None
    return max(lbs, default=0) + _LOOKBACK_BUFFER


def _build_panel_sequential(
    data: DataLayer,
    codes: Sequence[str],
    uniq_dates: list[str],
    factors: list[Factor],
    *,
    on_progress: Optional[Callable[[dict], None]] = None,
) -> FeaturePanel:
    """串行构造特征面板(单进程逐日)。uniq_dates 须已去重升序。"""
    feature_cols = [f"f_{f.name}" for f in factors]
    frames: list[pl.DataFrame] = []
    degraded_days: dict[str, int] = {}
    total = len(uniq_dates)
    step = max(1, total // 20)  # 约 20 次心跳,避免长跑刷屏日志
    ctx_lookback = _resolve_lookback(factors)

    for i, d in enumerate(uniq_dates):
        ctx = FactorContext(data, d, codes, lookback=ctx_lookback)
        matrix, effective, _degraded = compute_factor_matrix(ctx, factors)
        # 补齐缺失(降级)列为 null,保证各日列集一致可纵向堆叠。
        missing = [c for c in feature_cols if c not in matrix.columns]
        if missing:
            matrix = matrix.with_columns([pl.lit(None, dtype=pl.Float64).alias(c) for c in missing])
        matrix = matrix.with_columns(pl.lit(d).alias("date")).select(
            ["date", "stock_code", *feature_cols]
        )
        frames.append(matrix)
        for f in factors:
            if f.name not in effective:
                degraded_days[f.name] = degraded_days.get(f.name, 0) + 1
        if on_progress and (i % step == 0 or i == total - 1):
            try:
                on_progress({"stage": "features", "done": i + 1, "total": total, "date": d})
            except Exception:  # noqa: BLE001 — 进度上报绝不影响计算
                pass

    panel = pl.concat(frames, how="vertical") if frames else _empty_panel(feature_cols)
    return FeaturePanel(
        panel=panel, feature_cols=feature_cols, degraded_days=degraded_days, n_dates=total
    )


# 进程内 DataLayer 缓存:同一 worker 进程跨多个日期块复用物化(避免每块重物化整个数据集)。
_WORKER_DL: dict = {}

# 每 worker 内存软上限下限(MB):再均分也不低于此,保 duckdb 基本周转。
_MIN_WORKER_MB = 512
# 特征物化下界缓冲(日历日):首个特征日往前留这么多天足够覆盖内置因子回看(mom20≤20 交易日 ≪ 此),
# 与 run_eod 的 mat_since 同口径(已有黄金测试守「物化下界不改打分」)。
_FEATURE_SINCE_BUFFER_DAYS = 800


def _per_worker_mb(total_mb: int, workers: int) -> int:
    """多核时每 worker 的 duckdb 物化软上限 = 总预算 / worker 数(下限 _MIN_WORKER_MB)。
    使 N 个 worker 总占用恒定一份预算、不随并行度倍增致系统卡死。"""
    return max(_MIN_WORKER_MB, int(total_mb) // max(1, int(workers)))


def _feature_window(uniq_dates: list[str]) -> tuple[str | None, str | None]:
    """特征物化窗口 [首日-缓冲, 末日]。**只用于特征(asof,只看 <=T),不用于前向标签**:
    - 上界 = 末日:特征绝不取未来(红线#1)→ 卡在末日恒准(无悬挂股边角问题,与前向标签不同);
    - 下界 = 首日-800天:覆盖内置因子回看(并行路径仅内置因子才启用,回看已知且小),与 run_eod 同口径。
    每 worker 只物化这个窗口 → 装得进均分后的预算、不溢写,多核才真快(且逐值不变,黄金测试守)。"""
    if not uniq_dates:
        return None, None
    from datetime import datetime, timedelta

    since = (
        datetime.strptime(uniq_dates[0], "%Y-%m-%d") - timedelta(days=_FEATURE_SINCE_BUFFER_DAYS)
    ).strftime("%Y-%m-%d")
    return since, uniq_dates[-1]


def _worker_panel(
    cache_root: str,
    codes: list[str],
    dates_chunk: list[str],
    factors: list[Factor],
    mem_limit_mb: int | None = None,
    mat_since: str | None = None,
    mat_until: str | None = None,
):
    """子进程:在本进程自有的 DataLayer 上串行算一段日期的特征面板。返回可 pickle 的 (panel, degraded)。

    每日彼此独立、全经 asof(只见 <=T),PIT 不变(由黄金测试守护);并行只是把独立日子分给多核。
    mem_limit_mb:本 worker 的 duckdb 物化软上限 = 总预算 / worker 数(调用方均分)。
    mat_since/mat_until:特征物化窗口(见 _feature_window)——每 worker 只物化这一窗口,装得进预算不溢写。
    本 DataLayer 仅算特征(不碰前向标签),故上界=末日恒准(红线#1 特征绝不取未来)。"""
    key = (cache_root, mem_limit_mb, mat_since, mat_until)
    dl = _WORKER_DL.get(key)
    if dl is None:
        dl = DataLayer(
            cache_root, mat_since=mat_since, mat_until=mat_until, memory_limit_mb=mem_limit_mb
        )
        _WORKER_DL[key] = dl
    fp = _build_panel_sequential(dl, codes, dates_chunk, factors)
    return fp.panel, fp.degraded_days


def _build_panel_parallel(
    data: DataLayer,
    codes: Sequence[str],
    uniq_dates: list[str],
    factors: list[Factor],
    *,
    workers: int,
    on_progress: Optional[Callable[[dict], None]] = None,
) -> FeaturePanel:
    """多核:按日期分块进程池并行,各块在独立进程算后合并。仅供 workers>1 且因子可 pickle 时。"""
    feature_cols = [f"f_{f.name}" for f in factors]
    cache_root = str(data.cache_root)
    # 按内存预算给 worker 数封顶:保证每 worker 至少 ~1GB,否则均分后每核太少 → 物化疯狂溢写反而更慢
    # (用户手选 8 核但只有 4GB 预算时,8×512MB 全在硬盘抖 → 比 4×1GB 还慢)。低内存配置自然退到串行。
    workers = max(1, min(int(workers), int(data.memory_limit_mb) // 1024))
    # 内存安全核心:把「一份」物化预算按 worker 数均分 → 每 worker 的 duckdb 软上限 = 总/worker,
    # 总占用恒定一份预算(而非每 worker 各占满 → N 倍 → 系统在 Python 捕获 OOM 前就卡死)。
    per_worker_mb = _per_worker_mb(data.memory_limit_mb, workers)
    # 特征物化窗口 [首日-缓冲, 末日]:每 worker 只物化这点数据 → 装进均分后的预算不溢写,多核才真快。
    # 仅特征(asof <=T),上界=末日恒准;并行路径仅内置因子启用,回看已知 → 下界缓冲足够,逐值不变。
    feat_since, feat_until = _feature_window(uniq_dates)
    n = len(uniq_dates)
    chunk_size = max(1, min((n + workers - 1) // workers, _PAR_CHUNK_DAYS))
    chunks = [uniq_dates[i : i + chunk_size] for i in range(0, n, chunk_size)]
    frames: list[Optional[pl.DataFrame]] = [None] * len(chunks)
    degraded_days: dict[str, int] = {}
    codes_l = list(codes)
    days_done = 0

    # 强制 'spawn' 上下文(全平台一致):Linux 默认 'fork' 会复制已起 polars/duckdb 后台线程的进程,
    # 子进程继承不存在线程持有的锁 → 经典 fork+线程死锁(进程池永久挂起)。spawn 起全新进程重导入,
    # 无此问题,也正是 Windows 默认行为(已验证并行==串行)。
    ctx = mp.get_context("spawn")
    with ProcessPoolExecutor(max_workers=workers, mp_context=ctx) as ex:
        futs = {
            ex.submit(
                _worker_panel, cache_root, codes_l, ch, factors, per_worker_mb, feat_since, feat_until
            ): i
            for i, ch in enumerate(chunks)
        }
        for fut in as_completed(futs):
            i = futs[fut]
            panel, dd = fut.result()  # 子进程异常在此抛出 → 上层 _sse_compute 捕获为 error 事件
            frames[i] = panel
            for k, v in dd.items():
                degraded_days[k] = degraded_days.get(k, 0) + v
            days_done += len(chunks[i])
            if on_progress:
                try:
                    # 复用「features」事件形状(done/total 为天数),api 日志「X/Y 日」对串/并行一致。
                    on_progress(
                        {"stage": "features", "done": days_done, "total": n, "date": chunks[i][-1]}
                    )
                except Exception:  # noqa: BLE001
                    pass

    present = [f for f in frames if f is not None]
    panel = pl.concat(present, how="vertical") if present else _empty_panel(feature_cols)
    return FeaturePanel(
        panel=panel, feature_cols=feature_cols, degraded_days=degraded_days, n_dates=n
    )


def _resolve_workers(workers: int | str | None) -> int:
    """workers 解析:None/0/1 → 1(串行,质检/训练端点默认 = 最省内存);'auto' → min(核数-1, 4);整数 → 该值。

    注:多核已改为按 worker 数均分 duckdb 物化预算(见 _build_panel_parallel),总内存恒定一份预算,
    不再「每 worker 各占满 → N×内存致系统卡死」;用户可显式开多核提速。并行失败(如不支持 spawn)退回串行。"""
    if workers in (None, 0, 1):
        return 1
    if workers == "auto":
        return max(1, min((os.cpu_count() or 2) - 1, 4))
    try:
        return max(1, int(workers))
    except (TypeError, ValueError):
        return 1


def build_feature_panel(
    data: DataLayer,
    codes: Sequence[str],
    dates: Sequence[str],
    factors: list[Factor] = DEFAULT_FACTORS,
    *,
    on_progress: Optional[Callable[[dict], None]] = None,
    workers: int | str | None = 1,
) -> FeaturePanel:
    """构造 date×code 特征长表。dates 为升序交易日;codes 为股票池。

    返回的 panel 每行 = 某日某股的标准化因子向量;某因子当日无有效数据则该列 null。

    on_progress(可选):进度回调(SSE 流式用),既给前端可见进度、又靠持续数据流避免长连接
    空闲被重置(ECONNRESET)。回调异常被吞,绝不影响计算。
    workers:>1(或 'auto')时按日期分块进程池并行(利用多核);仅在因子全可 pickle(无自定义闭包)
    且日数足够时生效,否则自动退回串行。并行与串行结果逐值相等(每日独立、PIT 不变)。
    """
    uniq_dates = sorted(set(dates))
    # 立即发一条 0/total:让前端确定式进度条第一时间出现在 0%(尤其多核——首块完成前也不空窗,
    # 否则用户会以为"没有进度条"。后续逐日/逐块 done 递增覆盖之)。回调异常被吞,绝不影响计算。
    if on_progress and uniq_dates:
        try:
            on_progress(
                {"stage": "features", "done": 0, "total": len(uniq_dates), "date": uniq_dates[0]}
            )
        except Exception:  # noqa: BLE001
            pass
    n_workers = _resolve_workers(workers)
    # 并行条件:多 worker + 日数足够(摊掉进程启动/物化固定开销)+ 因子可 pickle(无自定义闭包,
    # 以 lookback 已知为代理 —— 自定义因子 lookback=None 且其 fn 是不可 pickle 的闭包)。
    can_parallel = (
        n_workers > 1
        and len(uniq_dates) >= _PAR_MIN_DAYS
        and all(f.lookback is not None for f in factors)
    )
    if can_parallel:
        try:
            return _build_panel_parallel(
                data, codes, uniq_dates, factors, workers=n_workers, on_progress=on_progress
            )
        except Exception:  # noqa: BLE001 — 进程池异常(如环境不支持 spawn)诚实退回串行,绝不让提速变成崩溃
            pass
    return _build_panel_sequential(data, codes, uniq_dates, factors, on_progress=on_progress)
