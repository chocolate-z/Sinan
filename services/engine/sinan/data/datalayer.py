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
    def __init__(
        self,
        cache_root: Path | str,
        con: "duckdb.DuckDBPyConnection | None" = None,
        *,
        mat_since: str | None = None,
        years: "Sequence[str] | None" = None,
    ) -> None:
        self.cache_root = Path(cache_root)
        owns_con = con is None
        self._con = con or duckdb.connect(":memory:")
        # 年分区裁剪(可选):只 glob 这些 year 分区的 parquet,而非全库 **。全市场多年缓存里
        # 打开上万个分股文件是主耗时;只需最近窗口的查询(行情快照)按年裁剪可成倍提速。
        # ⚠ 设了它,本实例对任意 asof 只看得见这些年的数据 —— 仅供「当下视角/近窗口」查询
        # (行情快照、近端因子),绝不可用于跨更早年份的回测/训练(会少取致错)。
        self.years = list(years) if years else None
        # 物化下界(YYYY-MM-DD):非财务(日频)数据集只物化 trade_date>=mat_since 的行。单日实盘
        # (run_eod)只需最近窗口,却原本把全 A×多年(数千万行)整段灌进内存 → OOM(Allocation
        # failure)。设下界把日频物化压到「最近窗口」防爆;财务类(fundamental)不裁剪——其 PIT 取
        # 「ann_date<=T 的最新一期」需保留全历史,且体量小不致 OOM。仅内置/模型路径(因子回看已知
        # 且≤窗口)由调用方设此界;自定义因子(回看未知)不设,靠下方磁盘溢写兜底,绝不少取致降级(红线#3)。
        self.mat_since = mat_since
        if owns_con:
            # 开 duckdb 磁盘溢写:大缓存物化超内存预算时落盘而非 OOM。纯安全网,零正确性影响。
            # memory_limit 设较保守值,使「可用内存紧张(开发服+本应用+子进程并发)」时提前溢写,
            # 不依赖总内存的 80% 默认(会在低空闲内存下仍 OOM)。配置失败不致命(退回默认)。
            try:
                spill = self.cache_root / "_duckdb_spill"
                spill.mkdir(parents=True, exist_ok=True)
                p = str(spill).replace("\\", "/").replace("'", "''")
                self._con.execute(f"SET temp_directory='{p}'")
                self._con.execute("SET memory_limit='4GB'")
            except Exception:  # noqa: BLE001 — 配置失败退回默认,不引入新错误
                pass
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
        # 年分区裁剪:只读最近窗口需要的 year 分区(read_parquet 接受 glob 列表),避免
        # glob 全库上万个分股文件。未设 years 时退回全 glob(行为不变)。
        if self.years:
            globs = [
                g.replace("\\", "/").replace("'", "''")
                for g in layout.globs_for_years(self.cache_root, dataset, self.years)
            ]
            src_expr = "[" + ", ".join(f"'{g}'" for g in globs) + "]"
        else:
            glob = layout.glob_for(self.cache_root, dataset).replace("\\", "/").replace("'", "''")
            src_expr = f"'{glob}'"
        name = f"_ds_{next(_TBL_SEQ)}"
        params: list[object] = []
        conds: list[str] = []
        if codes:
            conds.append(f"stock_code IN ({', '.join(['?'] * len(codes))})")
            params.extend(codes)
        # 物化下界:仅非财务(日频)且设了 mat_since 时,只载最近窗口(防单日实盘把全历史灌爆内存)。
        # asof 查询仍在物化表上加 <=asof 上界,PIT 不变;下界只是「不载更早的、当前用不到的日频历史」。
        if self.mat_since and dataset not in layout.FINANCIAL_PIT:
            conds.append(f"{layout.ASOF_DATE_COL[dataset]} >= ?")
            params.append(self.mat_since)
        where = (" WHERE " + " AND ".join(conds)) if conds else ""
        # 分股文件与旧共享 part.parquet 共存可能让同一主键出现重复行 → 物化时按主键去重(留一条),
        # 杜绝同 (stock_code, 日期) 重复进入横截面/asof。财务类不在此去重:其 PIT 需保留同 end_date
        # 的多条 ann_date 供 asof 取「<=T 的最新一期」(去重会破坏 ann_date 逻辑)。
        dedup = ""
        if dataset not in layout.FINANCIAL_PIT:
            keys = ", ".join(layout.DATASET_KEYS[dataset])
            dedup = f" QUALIFY row_number() OVER (PARTITION BY {keys} ORDER BY {keys}) = 1"
        # 物化时按 codes 过滤(分区裁剪,只读该股票池的分区),后续 asof 不再带 code 过滤。
        self._con.execute(
            f"CREATE TEMP TABLE {name} AS "
            f"SELECT * FROM read_parquet({src_expr}, hive_partitioning=1, union_by_name=1)"
            f"{where}{dedup}",
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

    def window(
        self,
        dataset: str,
        start: str,
        end: str,
        *,
        fields: Sequence[str] | None = None,
        codes: Sequence[str] | None = None,
    ) -> pl.DataFrame:
        """区间 [start, end] 的行(行情快照的板块 Sparkline 用,只取最近 N 日,避免拉全历史)。"""
        src = self._source(dataset, codes)
        if src is None:
            return pl.DataFrame()
        date_col = layout.ASOF_DATE_COL[dataset]
        cols = "*" if not fields else ", ".join(fields)
        return self._con.execute(
            f"SELECT {cols} FROM {src} WHERE {date_col} BETWEEN ? AND ? "
            f"ORDER BY stock_code, {date_col}",
            [start, end],
        ).pl()

    def latest_dates(self, dataset: str, n: int = 2, codes: Sequence[str] | None = None) -> list[str]:
        """该数据集最近 n 个不同交易日(降序)。行情快照用(取最新日+昨日算当日涨跌)。"""
        src = self._source(dataset, codes)
        if src is None:
            return []
        date_col = layout.ASOF_DATE_COL[dataset]
        rows = self._con.execute(
            f"SELECT DISTINCT {date_col} FROM {src} ORDER BY {date_col} DESC LIMIT ?", [int(n)]
        ).fetchall()
        return [r[0] for r in rows]

    def latest_asof(
        self,
        dataset: str,
        asof_date: str,
        *,
        fields: Sequence[str] | None = None,
        codes: Sequence[str] | None = None,
    ) -> pl.DataFrame:
        """每只股票取 asof 可见的最新一行(因子取数常用)。

        非财务类直接在 SQL 里用 QUALIFY 每股取 ≤asof 的最新一行(只返 ~股票数 行),
        替代旧的「取全历史(O(天数×股票))再 polars group_by.last」——逐日特征面板里这一步
        随区间长度 O(N²) 累积,是训练/质检的主耗时之一。结果与旧实现逐值相等(主键去重无并列日)。
        财务类:asof 已按 ann_date 取每股最新一期,直接复用。"""
        if dataset in layout.FINANCIAL_PIT:
            return self.asof(dataset, asof_date, fields=fields, codes=codes)
        src = self._source(dataset, codes)
        if src is None:
            return pl.DataFrame()
        date_col = layout.ASOF_DATE_COL[dataset]
        cols = "*" if not fields else ", ".join(fields)
        # QUALIFY 的窗口 ORDER BY 可引用表中列(date_col),无需把它选进结果。
        sql = (
            f"SELECT {cols} FROM {src} "
            f"WHERE {date_col} <= ? "
            f"QUALIFY row_number() OVER (PARTITION BY stock_code ORDER BY {date_col} DESC) = 1"
        )
        return self._con.execute(sql, [asof_date]).pl()

    def recent_asof(
        self,
        dataset: str,
        asof_date: str,
        n: int,
        *,
        fields: Sequence[str] | None = None,
        codes: Sequence[str] | None = None,
    ) -> pl.DataFrame:
        """每只股票取 ≤asof 的最近 n 行(升序返回),供时序因子(动量/北向变动)。

        关键提速:时序因子只需最近窗口(mom20 需 21 行、north 需 6 行),却原走 history() 重扫
        「≤asof 全历史再排序」→ 逐日 O(全历史)。改为每股只取最近 n 行(QUALIFY row_number≤n,
        在物化表上高效),把逐日 O(N) 降为 O(n)。PIT 不变:仍只见 ≤asof;n 须 ≥ 因子最大回看+1,
        否则会少取行致 shift 出 null —— 由 build_feature_panel 按因子声明的 lookback 保证(自定义
        回看未知则不裁剪)。财务类 PIT 语义特殊(取最新一期),不做窗口裁剪。"""
        if dataset in layout.FINANCIAL_PIT:
            return self.asof(dataset, asof_date, fields=fields, codes=codes)
        src = self._source(dataset, codes)
        if src is None:
            return pl.DataFrame()
        date_col = layout.ASOF_DATE_COL[dataset]
        cols = "*" if not fields else ", ".join(fields)
        sql = (
            f"SELECT {cols} FROM {src} "
            f"WHERE {date_col} <= ? "
            f"QUALIFY row_number() OVER (PARTITION BY stock_code ORDER BY {date_col} DESC) <= ? "
            f"ORDER BY stock_code, {date_col}"
        )
        return self._con.execute(sql, [asof_date, int(n)]).pl()
