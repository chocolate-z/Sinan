"""股票参考元数据(code→name/board/industry)落盘缓存。

`stock_list()` 取来的清单(行业分类 / 名称)是近静态参考数据。原本只活在进程内存
(`_STOCK_LIST_CACHE`)里,随进程重启或无 token 即消失 → 行情页板块视角离线 / 重启后
诚实空(用户反馈「建了全市场缓存,行情页仍无板块」的根因:行业映射从不落盘)。

落盘一份(单文件,~数千行)→ 让 `_industry_meta` / 搜索 / 名称映射在「曾用 token 取过
一次」之后,离线 / 重启 / 无 token 仍可用。单文件而非按股分区:体量小、整表读、永远整体重写。

红线#4(token 永不落盘):只存 stock_code/name/board/industry/list_date,**绝无 token**。
红线#1(无未来函数):此元数据仅供行情页展示与股票搜索,**从不进因子/信号/回测取数**
  (那些一律走 DataLayer.asof 的 PIT 通道);行业分类是「当下」参考,非时序回测输入。
"""

from __future__ import annotations

import os
from pathlib import Path

import polars as pl

# 落盘保留的参考列(白名单:杜绝任何额外字段意外落盘)。
_META_COLS = ("stock_code", "name", "board", "industry", "list_date")


def meta_file(cache_root: Path | str) -> Path:
    return Path(cache_root) / "_meta" / "stock_basic.parquet"


def save_stock_meta(cache_root: Path | str, df: pl.DataFrame | None) -> None:
    """原子写股票清单到 cache/_meta/stock_basic.parquet。只保留参考列(白名单,绝不含 token)。

    缺列容忍:免费源(AkShare)无 industry 列 → 只落它有的列(行业仍空,诚实)。
    """
    if df is None or df.is_empty() or "stock_code" not in df.columns:
        return
    cols = [c for c in _META_COLS if c in df.columns]
    out = df.select(cols)
    target = meta_file(cache_root)
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.parent / (target.name + ".tmp")
    out.write_parquet(tmp)
    os.replace(tmp, target)  # 同盘原子替换,杜绝写入中断留半截文件


def load_stock_meta(cache_root: Path | str) -> pl.DataFrame | None:
    """读盘缓存的股票清单;缺失 / 损坏(0 字节或半截)→ None(下次实时取重写)。"""
    p = meta_file(cache_root)
    if not p.exists():
        return None
    try:
        df = pl.read_parquet(p)
    except Exception:  # noqa: BLE001 — 损坏文件当作无,实时取一次即自愈重写
        return None
    return df if not df.is_empty() else None
