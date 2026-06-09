"""因子质量报告(M4):对因子库逐因子算真实 IC 均值 / ICIR / 覆盖度 + IC 时序 + 十分位分层收益。

复用 M3 积木(asof PIT 全程):build_feature_panel(标准化因子面板,已 ×direction)+
build_forward_return_labels(前向收益)+ metrics.rank_ic/icir。
红线#1:特征 asof、标签前向,IC = 当日截面因子值 vs 前向收益(不跨日泄漏)。
红线#3:低 IC / 缺数据如实(coverage=0 表示该因子无数据,不补强不造假)。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Sequence

import polars as pl

from ..backtest import metrics
from ..data import DataLayer
from ..training.features import build_feature_panel
from ..training.labels import build_forward_return_labels
from .custom import custom_factor
from .library import DEFAULT_FACTORS, Factor


@dataclass
class FactorQuality:
    name: str
    group: str
    ic_mean: float
    icir: float
    coverage: float  # 有效计算 IC 的天数 / 总交易日(0 = 该因子无数据)
    ic_series: list[float] = field(default_factory=list)  # 逐日 RankIC
    deciles: list[float] = field(default_factory=list)  # D1..D10 平均前向收益(按因子值升序分桶)


def factor_quality(
    data: DataLayer,
    codes: Sequence[str],
    dates: Sequence[str],
    *,
    factors: list[Factor] = DEFAULT_FACTORS,
    custom: Sequence[dict] | None = None,
    label_horizon: int = 5,
    n_deciles: int = 10,
) -> tuple[list[FactorQuality], list[str]]:
    """逐因子质量报告。dates 为评估区间交易日(升序)。custom = 自定义 DSL 因子 [{name,expr,group?}]。"""
    all_factors = list(factors)
    custom_degraded: list[str] = []
    for c in custom or []:
        try:
            all_factors.append(custom_factor(c["name"], c["expr"], c.get("group", "custom")))
        except Exception as e:  # noqa: BLE001 表达式无效 → 跳过并如实记录(不静默)
            custom_degraded.append(f"{c.get('name', '?')}:表达式无效({e})")

    fp = build_feature_panel(data, codes, dates, all_factors)
    labels = build_forward_return_labels(data, codes, label_horizon)
    samples = fp.panel.join(labels, on=["date", "stock_code"], how="left")
    uniq = sorted(set(dates))

    results: list[FactorQuality] = []
    for f, col in zip(all_factors, fp.feature_cols):
        ic_series: list[float] = []
        decile_acc: list[list[float]] = [[] for _ in range(n_deciles)]
        for d in uniq:
            sub = samples.filter(pl.col("date") == d).drop_nulls(subset=[col, "label"])
            if sub.height < n_deciles:
                continue
            ic_series.append(metrics.rank_ic(sub[col].to_list(), sub["label"].to_list()))
            # 按因子值升序分十分位,逐桶平均前向收益。
            sub = sub.sort(col).with_row_index("_r")
            h = sub.height
            sub = sub.with_columns(
                ((pl.col("_r") * n_deciles) // h).clip(0, n_deciles - 1).alias("_dec")
            )
            grp = sub.group_by("_dec").agg(pl.col("label").mean().alias("_m"))
            mp = {r["_dec"]: r["_m"] for r in grp.iter_rows(named=True)}
            for i in range(n_deciles):
                if mp.get(i) is not None:
                    decile_acc[i].append(mp[i])

        ic_mean = round(sum(ic_series) / len(ic_series), 4) if ic_series else 0.0
        icir = round(metrics.icir(ic_series), 4)
        coverage = round(len(ic_series) / len(uniq), 4) if uniq else 0.0
        deciles = [round(sum(x) / len(x), 4) if x else 0.0 for x in decile_acc]
        results.append(
            FactorQuality(
                name=f.name,
                group=f.group,
                ic_mean=ic_mean,
                icir=icir,
                coverage=coverage,
                ic_series=[round(v, 4) for v in ic_series],
                deciles=deciles,
            )
        )

    degraded = [
        f"{name}:{n}/{fp.n_dates} 天降级(数据缺失)" for name, n in sorted(fp.degraded_days.items())
    ]
    degraded.extend(custom_degraded)
    return results, degraded
