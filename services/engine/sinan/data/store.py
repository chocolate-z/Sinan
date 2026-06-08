"""列式缓存写入(仅 engine 写)。按 board+year 分区 upsert,按主键去重。

去重是「断点续传不产生重复行」红线的存储层保障:重复写入同一 (key) 取最后一条。
"""

from __future__ import annotations

from pathlib import Path

import polars as pl

from ..providers.base import board_of
from . import layout


def _year_of(date_str: str) -> str:
    s = str(date_str)
    return s[:4]


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
    for (board, year), part in df.group_by(["_board", "_year"]):
        part = part.drop(["_board", "_year"])
        target = layout.partition_file(cache_root, dataset, str(board), str(year))
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists():
            existing = pl.read_parquet(target)
            combined = pl.concat([existing, part], how="diagonal_relaxed")
        else:
            combined = part
        # 按主键去重,保留最后一条(同键以新数据覆盖)。
        combined = combined.unique(subset=key_cols, keep="last").sort(key_cols)
        combined.write_parquet(target)
        written += part.height
    return written


def coverage_for(cache_root: Path, dataset: str, stock_code: str) -> tuple[str | None, str | None, int]:
    """返回某股某 dataset 的 (first_date, last_date, rows),供 data_coverage 台账与增量锚点。"""
    if not layout.has_any(cache_root, dataset):
        return None, None, 0
    date_col = layout.ASOF_DATE_COL[dataset]
    board = board_of(stock_code)
    d = layout.dataset_dir(Path(cache_root), dataset) / f"board={board}"
    if not d.exists():
        return None, None, 0
    frames = [pl.read_parquet(p) for p in d.rglob("*.parquet")]
    if not frames:
        return None, None, 0
    df = pl.concat(frames, how="diagonal_relaxed").filter(pl.col("stock_code") == stock_code)
    if df.is_empty():
        return None, None, 0
    dates = df[date_col].cast(pl.Utf8)
    return dates.min(), dates.max(), df.height
