"""基金穿透聚合(Phase 2):给定一组基金(+权重)→ 拆到底层股票暴露 + 行业分布。

红线#3 诚实:公募季报只披露前十大重仓(占净值约 30-70%),所以穿透天然是【部分】的 ——
每只基金、整体组合都如实给出「已披露覆盖率」,绝不把没披露的部分脑补/放大补满。
红线#1:持仓走 DataLayer.fund_holdings_asof(ann_date<=asof 的最近一期),不偷看未来披露。

口径:某股票在组合里的暴露 = Σ_基金( 该基金权重 × 该基金里这只股票的净值占比 )。
所有股票暴露之和 = 整体已披露覆盖率(< 1),剩下的是没披露、没穿透的部分。
"""

from __future__ import annotations

from typing import Mapping, Sequence

from ..data import DataLayer


def look_through(
    dl: DataLayer,
    asof: str,
    holdings: Sequence[dict],
    meta: Mapping[str, dict] | None = None,
) -> dict:
    """holdings: [{fund_code, weight}]。weight=对该基金的相对配置(金额或权重,内部归一)。

    返回 {asof, funds[], stocks[], sectors[], total_coverage, note, degraded}。
    暴露/覆盖率都是 0~1 的小数(展示侧 ×100);股票暴露之和 = total_coverage(诚实,不补满)。
    """
    meta = meta or {}
    funds = [h for h in holdings if h.get("fund_code")]
    if not funds:
        return {
            "asof": asof, "funds": [], "stocks": [], "sectors": [],
            "total_coverage": 0.0, "note": "未提供基金", "degraded": [],
        }

    wsum = sum(max(0.0, float(h.get("weight", 0.0))) for h in funds) or 1.0
    fund_codes = [h["fund_code"] for h in funds]
    raw = dl.fund_holdings_asof(asof, fund_codes)
    by_fund: dict[str, list[dict]] = {}
    if not raw.is_empty():
        for r in raw.iter_rows(named=True):
            by_fund.setdefault(r["fund_code"], []).append(r)

    stock_acc: dict[str, float] = {}
    fund_reports: list[dict] = []
    degraded: list[str] = []
    for h in funds:
        fc = h["fund_code"]
        fw = max(0.0, float(h.get("weight", 0.0))) / wsum  # 归一后的组合权重
        rows = by_fund.get(fc, [])
        if not rows:
            fund_reports.append(
                {"fund_code": fc, "weight": round(fw, 4), "end_date": None, "ann_date": None,
                 "disclosed_coverage": 0.0, "n_holdings": 0}
            )
            degraded.append(f"{fc}:无 ≤{asof} 的已披露持仓(穿透为 0)")
            continue
        cov = sum(float(r["stk_mkv_ratio"] or 0.0) for r in rows) / 100.0  # 该基金已披露占净值比
        for r in rows:
            contrib = fw * (float(r["stk_mkv_ratio"] or 0.0) / 100.0)
            stock_acc[r["stock_code"]] = stock_acc.get(r["stock_code"], 0.0) + contrib
        fund_reports.append(
            {"fund_code": fc, "weight": round(fw, 4), "end_date": rows[0]["end_date"],
             "ann_date": rows[0]["ann_date"], "disclosed_coverage": round(cov, 4),
             "n_holdings": len(rows)}
        )

    total_coverage = sum(stock_acc.values())
    stocks = sorted(
        (
            {
                "stock_code": code,
                "name": (meta.get(code, {}) or {}).get("name"),
                "industry": (meta.get(code, {}) or {}).get("industry"),
                "weight": round(w, 6),
            }
            for code, w in stock_acc.items()
        ),
        key=lambda s: s["weight"],
        reverse=True,
    )

    sector_acc: dict[str, float] = {}
    for s in stocks:
        ind = s["industry"]
        if ind:
            sector_acc[ind] = sector_acc.get(ind, 0.0) + s["weight"]
    sectors = sorted(
        ({"industry": k, "weight": round(v, 6)} for k, v in sector_acc.items()),
        key=lambda x: x["weight"],
        reverse=True,
    )
    if not sectors and stocks:
        degraded.append("缺个股行业分类(确认数据源为 Tushare 且已拉行业元数据),行业分布暂空")

    note = (
        f"穿透基于季报披露的前十大重仓,整体已披露覆盖约 {total_coverage * 100:.0f}% 净值,"
        f"其余为未披露部分、未穿透(不补满)。持仓按披露日 PIT,非未来函数。"
    )
    return {
        "asof": asof,
        "funds": fund_reports,
        "stocks": stocks,
        "sectors": sectors,
        "total_coverage": round(total_coverage, 4),
        "note": note,
        "degraded": degraded,
    }
