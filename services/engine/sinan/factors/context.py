"""FactorContext:因子层唯一取数入口,全部经 DataLayer.asof(PIT)。

因子层不感知数据来自 Tushare 还是 AkShare(provider 解耦);任一时刻只能看见
asof_date 当日及之前可获得的数据(财务按 ann_date)。结果按 (dataset, fields) 缓存,
同一 asof 下多因子复用,避免重复扫描。
"""

from __future__ import annotations

from typing import Sequence

import polars as pl

from ..data import DataLayer


class FactorContext:
    def __init__(self, data: DataLayer, asof_date: str, codes: Sequence[str]) -> None:
        self.data = data
        self.asof = asof_date
        self.codes = list(codes)
        self._cache: dict[tuple, pl.DataFrame] = {}

    def _key(self, kind: str, dataset: str, fields: Sequence[str] | None) -> tuple:
        return (kind, dataset, tuple(fields) if fields else None)

    def history(self, dataset: str, fields: Sequence[str] | None = None) -> pl.DataFrame:
        """asof 可见的全部历史行(trade_date<=asof),供时序因子(动量/北向变动)。"""
        key = self._key("history", dataset, fields)
        if key not in self._cache:
            self._cache[key] = self.data.asof(dataset, self.asof, fields=fields, codes=self.codes)
        return self._cache[key]

    def latest(self, dataset: str, fields: Sequence[str] | None = None) -> pl.DataFrame:
        """每只股票 asof 可见的最新一行(估值/价量截面)。"""
        key = self._key("latest", dataset, fields)
        if key not in self._cache:
            self._cache[key] = self.data.latest_asof(
                dataset, self.asof, fields=fields, codes=self.codes
            )
        return self._cache[key]

    def latest_financial(self, dataset: str, fields: Sequence[str] | None = None) -> pl.DataFrame:
        """财务类:asof 已按 ann_date 取每只股票最新一期(根除报告期泄漏)。"""
        key = self._key("fin", dataset, fields)
        if key not in self._cache:
            self._cache[key] = self.data.asof(dataset, self.asof, fields=fields, codes=self.codes)
        return self._cache[key]
