"""列式缓存写入(仅 engine 写)。按 board+year 分区 upsert,按主键去重。

去重是「断点续传不产生重复行」红线的存储层保障:重复写入同一 (key) 取最后一条。
健壮性:① 原子写(临时文件 + rename)—— 写入中断不会留下损坏的半截 parquet;
        ② 安全读 —— 已存在的损坏/0 字节 parquet(历史中断残留)不再让整个建缓存崩。
"""

from __future__ import annotations

import os
from pathlib import Path

import polars as pl

from ..providers.base import board_of
from . import layout


def _year_of(date_str: str) -> str:
    s = str(date_str)
    return s[:4]


def _safe_read_parquet(p: Path) -> pl.DataFrame | None:
    """读 parquet;损坏 / 0 字节(写入中断残留)→ 删除该文件并返回 None。

    删除是自愈关键:损坏文件无法恢复,删掉后 ① 建缓存重抓该缺口重写;② DuckDB 数据层
    的 glob(训练/质检/回测读取)不再命中它而崩。不删则它会反复让整个流程报错。
    """
    try:
        return pl.read_parquet(p)
    except Exception:  # noqa: BLE001 — 损坏文件:删除自愈
        try:
            p.unlink()
        except OSError:
            pass
        return None


def _atomic_write_parquet(df: pl.DataFrame, target: Path) -> None:
    """原子写:先写 .tmp 再 os.replace,避免中断留下损坏分区(本次报错根因)。"""
    tmp = target.parent / (target.name + ".tmp")
    df.write_parquet(tmp)
    os.replace(tmp, target)  # 同盘原子替换(Windows/Posix 均可)


def write_dataset(cache_root: Path, dataset: str, df: pl.DataFrame) -> int:
    """把 df upsert 进 cache/<dataset> 的对应 board+year 分区。返回写入(去重后)行数。

    df 必须含 stock_code 与该 dataset 的日期列。已存在分区与新数据合并后按主键去重。
    """
    if df.is_empty():
        return 0
    cache_root = Path(cache_root)
    key_cols = list(layout.DATASET_KEYS[dataset])
    date_col = layout.ASOF_DATE_COL[dataset]

    df = df.with_columns(
        pl.col("stock_code").map_elements(board_of, return_dtype=pl.Utf8).alias("_board"),
        pl.col(date_col).cast(pl.Utf8).str.slice(0, 4).alias("_year"),
    )
    written = 0
    # 按 (board, year, stock_code) 分组 → 每股各占一文件,写入只读/重写自身小文件(O(stock)),
    # 根除「共享 part.parquet 越写越大」的 O(N²)。
    for (board, year, code), part in df.group_by(["_board", "_year", "stock_code"]):
        part = part.drop(["_board", "_year"])
        target = layout.stock_file(cache_root, dataset, str(board), str(year), str(code))
        target.parent.mkdir(parents=True, exist_ok=True)
        existing = _safe_read_parquet(target) if target.exists() else None
        # existing 为 None:不存在,或损坏 → 直接以新数据重写(自愈损坏文件)。
        combined = (
            pl.concat([existing, part], how="diagonal_relaxed") if existing is not None else part
        )
        # 按主键去重,保留最后一条(同键以新数据覆盖)。
        combined = combined.unique(subset=key_cols, keep="last").sort(key_cols)
        _atomic_write_parquet(combined, target)
        written += part.height
    return written


def coverage_for(
    cache_root: Path, dataset: str, stock_code: str
) -> tuple[str | None, str | None, int]:
    """返回某股某 dataset 的 (first_date, last_date, rows),供 data_coverage 台账与增量锚点。"""
    date_col = layout.ASOF_DATE_COL[dataset]
    board = board_of(stock_code)
    d = layout.dataset_dir(Path(cache_root), dataset) / f"board={board}"
    if not d.exists():
        return None, None, 0
    # 只读该股自己的分股文件 <code>.parquet(O(stock));旧共享 part.parquet 不计入此台账,
    # 其数据仍由 DataLayer 读端去重消费,但重建时该股按分股文件重抓 → 迁移到干净布局。
    frames = [
        f for p in d.rglob(f"{stock_code}.parquet") if (f := _safe_read_parquet(p)) is not None
    ]  # 跳过损坏分区
    if not frames:
        return None, None, 0
    df = pl.concat(frames, how="diagonal_relaxed").filter(pl.col("stock_code") == stock_code)
    if df.is_empty():
        return None, None, 0
    dates = df[date_col].cast(pl.Utf8)
    return dates.min(), dates.max(), df.height
