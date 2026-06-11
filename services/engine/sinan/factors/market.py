"""行情页全市场快照(板块视角):最新交易日 → 个股当日涨跌 → 按行业聚合。

真实板块视角(非 mock):
- 全 A 涨跌广度(替代大盘指数条):涨/跌/平家数 + 平均涨跌幅。
- 板块卡:板块涨跌(成分等权均值)/涨跌家数/领涨股/近 N 日板块走势(Sparkline)。
- 下钻:板块成分股列表(现价/涨跌/换手)。

红线:#1 取数全走 DataLayer(PIT,只见<=asof);#3 缺数据诚实空(不造数);#6 engine 不写库。
个股「行业」来自 stock_basic.industry(tushare 自有分类,一次调用覆盖全市场);申万一级(更干净
的 28 类)留作后续(需申万成分 API + 积分确认)。北向「主力净流入」需 moneyflow(无),留作后续。
"""

from __future__ import annotations

from typing import Mapping

import polars as pl

from ..data import DataLayer


def _chg_table(dl: DataLayer, latest: str, prev: str) -> pl.DataFrame:
    """每只(缓存有数据的)股票:最新收盘 / 昨收 → 当日涨跌幅(%)。"""
    a = dl.latest_asof("price", latest, fields=["stock_code", "close"])
    b = dl.latest_asof("price", prev, fields=["stock_code", "close"]).rename({"close": "prev"})
    if a.is_empty() or b.is_empty():
        return pl.DataFrame()
    df = a.join(b, on="stock_code", how="inner").filter(
        pl.col("close").is_not_null() & pl.col("prev").is_not_null() & (pl.col("prev") != 0)
    )
    return df.with_columns(((pl.col("close") / pl.col("prev") - 1.0) * 100.0).alias("chg"))


def _meta_frame(meta: Mapping[str, dict]) -> pl.DataFrame:
    return pl.DataFrame(
        {
            "stock_code": list(meta.keys()),
            "industry": [(meta[c].get("industry") or None) for c in meta],
            "sname": [(meta[c].get("name") or None) for c in meta],
        }
    )


def market_snapshot(dl: DataLayer, meta: Mapping[str, dict], *, spark_days: int = 20) -> dict:
    """全市场快照:全A广度 + 按行业聚合的板块卡(降序按板块涨跌)。"""
    dates = dl.latest_dates("price", n=spark_days + 1)  # 降序
    if len(dates) < 2:
        return {"asof": dates[0] if dates else None, "breadth": None, "sectors": [], "spark_days": spark_days}
    latest, prev, earliest = dates[0], dates[1], dates[-1]
    chg = _chg_table(dl, latest, prev)
    if chg.is_empty():
        return {"asof": latest, "breadth": None, "sectors": [], "spark_days": spark_days}

    chg = chg.join(_meta_frame(meta), on="stock_code", how="left")
    # 全 A 广度(用全部有涨跌的票,无论是否有行业)。
    up = int((chg["chg"] > 0).sum())
    down = int((chg["chg"] < 0).sum())
    total = chg.height
    breadth = {
        "total": total,
        "up": up,
        "down": down,
        "flat": total - up - down,
        "avg_chg": round(float(chg["chg"].mean()), 4),
    }

    sec = chg.filter(pl.col("industry").is_not_null() & (pl.col("industry") != ""))
    if sec.is_empty():
        return {"asof": latest, "breadth": breadth, "sectors": [], "spark_days": spark_days}

    # 近 N 日板块走势:窗口内每股收盘 → 按行业逐日等权均值 → 归一化到首日。
    win = dl.window("price", earliest, latest, fields=["stock_code", "trade_date", "close"])
    win = win.join(_meta_frame(meta).select("stock_code", "industry"), on="stock_code", how="inner")
    win = win.filter(pl.col("industry").is_not_null() & (pl.col("industry") != ""))
    sector_spark: dict[str, list[float]] = {}
    if not win.is_empty():
        daily = (
            win.group_by(["industry", "trade_date"])
            .agg(pl.col("close").mean().alias("c"))
            .sort(["industry", "trade_date"])
        )
        for (ind,), g in daily.group_by(["industry"], maintain_order=True):
            vals = g["c"].to_list()
            base = vals[0] if vals and vals[0] else 0.0
            sector_spark[ind] = [round(v / base, 4) for v in vals] if base else []

    sectors = []
    for (ind,), grp in sec.group_by(["industry"]):
        s_up = int((grp["chg"] > 0).sum())
        s_down = int((grp["chg"] < 0).sum())
        lead = grp.sort("chg", descending=True, nulls_last=True).row(0, named=True)
        sectors.append(
            {
                "name": ind,
                "chg": round(float(grp["chg"].mean()), 4),
                "count": grp.height,
                "up": s_up,
                "down": s_down,
                "lead": lead.get("sname") or lead["stock_code"],
                "lead_chg": round(float(lead["chg"]), 4),
                "spark": sector_spark.get(ind, []),
            }
        )
    sectors.sort(key=lambda s: s["chg"], reverse=True)
    return {"asof": latest, "breadth": breadth, "sectors": sectors, "spark_days": spark_days}


def sector_constituents(dl: DataLayer, meta: Mapping[str, dict], industry: str) -> dict:
    """板块成分股:现价 / 当日涨跌 / 换手(降序按涨跌)。无数据诚实空。"""
    dates = dl.latest_dates("price", n=2)
    if len(dates) < 2:
        return {"industry": industry, "asof": None, "constituents": []}
    latest, prev = dates[0], dates[1]
    codes = [c for c, m in meta.items() if (m.get("industry") or "") == industry]
    if not codes:
        return {"industry": industry, "asof": latest, "constituents": []}
    chg = _chg_table(dl, latest, prev)
    if chg.is_empty():
        return {"industry": industry, "asof": latest, "constituents": []}
    chg = chg.filter(pl.col("stock_code").is_in(codes))
    db = dl.latest_asof("daily_basic", latest, fields=["stock_code", "turnover_rate"])
    if not db.is_empty():
        chg = chg.join(db, on="stock_code", how="left")
    out = []
    for r in chg.sort("chg", descending=True, nulls_last=True).iter_rows(named=True):
        out.append(
            {
                "stock_code": r["stock_code"],
                "name": (meta.get(r["stock_code"], {}) or {}).get("name"),
                "price": r["close"],
                "chg": round(float(r["chg"]), 4),
                "turnover": r.get("turnover_rate"),
            }
        )
    return {"industry": industry, "asof": latest, "constituents": out}
