"""data.asof —— 统一 PIT 取数入口。所有上层取数走它,杜绝裸读 parquet(红线#1)。

语义:asof(dataset, fields, asof_date) 只返回在 asof_date「可见」的数据:
- 行情/估值/北向类:trade_date <= asof_date 的全部历史行(调用方可取末行)。
- 财务类(fundamental/fina_indicator):按 ann_date<=asof 取每只股票的最新一期
  (order by end_date desc, ann_date desc),根除「报告期已到但尚未公告」的泄漏。

不变式(黄金测试守护):asof(T) 的结果只依赖 date<=T 的数据 —— 追加任何 date>T 的
未来数据都不改变 asof(T) 的输出。
"""

from __future__ import annotations

import itertools
from pathlib import Path
from typing import Sequence

import duckdb
import polars as pl

from . import layout

# 全局唯一临时表名计数(避免共享 con 时表名撞车)。
_TBL_SEQ = itertools.count()


class DataLayer:
    def __init__(self, cache_root: Path | str, con: "duckdb.DuckDBPyConnection | None" = None) -> None:
        self.cache_root = Path(cache_root)
        self._con = con or duckdb.connect(":memory:")
        # 每实例物化缓存:(dataset, codes) → duckdb 临时表名。首次 asof 把该数据集(可选按 codes
        # 过滤,利用分区裁剪)整段读入临时表,后续逐日 asof 只在内存表上过滤 —— 质检/训练在大缓存
        # 上从「逐日重扫 parquet」降为「一次读入 + N 次内存查询」。WHERE/QUALIFY/ORDER 逻辑不变,
        # PIT 不变式(asof(T) 只依赖 <=T)完全不受影响(黄金测试守护)。每请求新建 DataLayer →
        # 自带 :memory: con,随实例 GC 释放,不跨请求泄漏。
        self._materialized: dict[tuple, str] = {}

    def _source(self, dataset: str, codes: Sequence[str] | None) -> str | None:
        """物化数据集到临时表(每实例每 (dataset,codes) 一次),返回表名;无数据→None。"""
        key = (dataset, tuple(codes) if codes else None)
        name = self._materialized.get(key)
        if name is not None:
            return name
        if not layout.has_any(self.cache_root, dataset):
            return None
        glob = layout.glob_for(self.cache_root, dataset).replace("\\", "/").replace("'", "''")
        name = f"_ds_{next(_TBL_SEQ)}"
        params: list[object] = []
        code_filter = ""
        if codes:
            placeholders = ", ".join(["?"] * len(codes))
            code_filter = f" WHERE stock_code IN ({placeholders})"
            params = list(codes)
        # 物化时按 codes 过滤(分区裁剪,只读该股票池的分区),后续 asof 不再带 code 过滤。
        self._con.execute(
            f"CREATE TEMP TABLE {name} AS "
            f"SELECT * FROM read_parquet('{glob}', hive_partitioning=1, union_by_name=1){code_filter}",
            params,
        )
        self._materialized[key] = name
        return name

    def asof(
        self,
        dataset: str,
        asof_date: str,
        *,
        fields: Sequence[str] | None = None,
        codes: Sequence[str] | None = None,
    ) -> pl.DataFrame:
        if dataset not in layout.ASOF_DATE_COL:
            raise ValueError(f"未知 dataset: {dataset}")
        src = self._source(dataset, codes)
        if src is None:
            return pl.DataFrame()

        date_col = layout.ASOF_DATE_COL[dataset]
        cols = "*" if not fields else ", ".join(fields)
        # codes 过滤已在物化时完成(临时表只含该股票池),此处只按 asof 日期切片。
        params: list[object] = [asof_date]
        if dataset in layout.FINANCIAL_PIT:
            sql = (
                f"SELECT {cols} FROM {src} "
                f"WHERE {date_col} <= ? "
                f"QUALIFY row_number() OVER "
                f"(PARTITION BY stock_code ORDER BY end_date DESC, ann_date DESC) = 1"
            )
        else:
            sql = (
                f"SELECT {cols} FROM {src} "
                f"WHERE {date_col} <= ? "
                f"ORDER BY stock_code, {date_col}"
            )
        return self._con.execute(sql, params).pl()

    def latest_asof(
        self,
        dataset: str,
        asof_date: str,
        *,
        fields: Sequence[str] | None = None,
        codes: Sequence[str] | None = None,
    ) -> pl.DataFrame:
        """每只股票取 asof 可见的最新一行(因子取数常用)。"""
        date_col = layout.ASOF_DATE_COL[dataset]
        # 排序需要日期列;若调用方未请求,临时补取,返回前去掉。
        req = fields
        drop_date = False
        if fields is not None and date_col not in fields:
            req = [*fields, date_col]
            drop_date = True
        df = self.asof(dataset, asof_date, fields=req, codes=codes)
        if df.is_empty() or dataset in layout.FINANCIAL_PIT:
            return df.drop(date_col) if drop_date and date_col in df.columns else df
        out = df.sort(date_col).group_by("stock_code", maintain_order=True).last()
        return out.drop(date_col) if drop_date else out
