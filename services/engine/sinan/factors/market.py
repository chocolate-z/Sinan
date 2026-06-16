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

from typing import Mapping, Sequence

import polars as pl

from ..data import DataLayer

# 大盘指数条用的默认基准指数(与 cache.build.DEFAULT_INDICES 同一批,回测基准同源)。
INDEX_NAMES: dict[str, str] = {
    "000300.SH": "沪深300",
    "000905.SH": "中证500",
    "000001.SH": "上证指数",
    "399001.SZ": "深证成指",
    "399006.SZ": "创业板指",
}


def market_indices(dl: DataLayer, codes: Sequence[str] | None = None) -> dict:
    """大盘指数条:每只基准指数最新收盘 + 涨跌幅(最新 vs 昨收)。

    读缓存里已有的 index_ohlcv(回测基准同源),每只指数 PIT 取最近 2 行算涨跌(只见 ≤asof,
    无未来函数)。免费源没拉指数 → index_ohlcv 为空 → indices 空,前端诚实显「—」/隐藏(红线#3)。
    指数是日频 EOD 收盘价、非实时报价,每项带 trade_date,展示侧自明白是收盘口径。
    """
    order = list(codes) if codes else list(INDEX_NAMES.keys())
    # 不按 codes 过滤物化:index_ohlcv 本就只有几只指数(全集很小),整读再挑要展示的,
    # 省得给不存在分区的指数代码 glob 报「无文件匹配」。
    df = dl.recent_asof(
        "index_ohlcv", "9999-12-31", 2, fields=["stock_code", "trade_date", "close"]
    )
    indices: list[dict] = []
    asof: str | None = None
    if not df.is_empty():
        for code in order:
            g = df.filter(pl.col("stock_code") == code).sort("trade_date")
            if g.is_empty():
                continue
            rows = g.to_dicts()
            close = rows[-1]["close"]
            prev = rows[-2]["close"] if len(rows) >= 2 else None
            chg = (
                (close / prev - 1.0) * 100.0
                if (close is not None and prev not in (None, 0))
                else None
            )
            td = rows[-1]["trade_date"]
            asof = max(asof, td) if asof else td
            indices.append(
                {
                    "code": code,
                    "name": INDEX_NAMES.get(code, code),
                    "close": round(float(close), 2) if close is not None else None,
                    "chg": round(float(chg), 4) if chg is not None else None,
                    "trade_date": td,
                }
            )
    return {"asof": asof, "indices": indices}


def _chg_table(dl: DataLayer, latest: str, prev: str, codes=None) -> pl.DataFrame:
    """每只(缓存有数据的)股票:最新收盘 / 昨收 → 当日涨跌幅(%)。

    codes 给定时只物化这些股票的分区(板块下钻只需 ~十几只 → 不再整库物化,成倍提速)。
    """
    a = dl.latest_asof("price", latest, fields=["stock_code", "close"], codes=codes)
    b = dl.latest_asof("price", prev, fields=["stock_code", "close"], codes=codes).rename(
        {"close": "prev"}
    )
    if a.is_empty() or b.is_empty():
        return pl.DataFrame()
    df = a.join(b, on="stock_code", how="inner").filter(
        pl.col("close").is_not_null() & pl.col("prev").is_not_null() & (pl.col("prev") != 0)
    )
    return df.with_columns(((pl.col("close") / pl.col("prev") - 1.0) * 100.0).alias("chg"))


def _meta_frame(meta: Mapping[str, dict]) -> pl.DataFrame:
    # 显式 schema:meta 为空时(本会话无 token / 缺 stock_list 权限)列也保持 str,
    # 否则空列表会被推断成 Null 类型,与左侧 str 的 stock_code join 报 SchemaError。
    # 缺行业元数据应诚实降级为「只出全A广度、板块为空」,而非 500。
    return pl.DataFrame(
        {
            "stock_code": list(meta.keys()),
            "industry": [(meta[c].get("industry") or None) for c in meta],
            "sname": [(meta[c].get("name") or None) for c in meta],
        },
        schema={"stock_code": pl.Utf8, "industry": pl.Utf8, "sname": pl.Utf8},
    )


def _aggregate(
    dl: DataLayer,
    chg: pl.DataFrame,
    meta: Mapping[str, dict],
    *,
    asof,
    spark_range: tuple[str, str] | None,
    spark_days: int,
) -> dict:
    """共享聚合:chg(stock_code/close/chg)→ 全A广度 + 按行业板块卡(收盘快照与实时共用)。

    板块走势 Sparkline 仍取自缓存日线(spark_range);实时模式只换「当日涨跌」来源,走势保持日频。
    """
    chg = chg.join(_meta_frame(meta), on="stock_code", how="left")
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
        return {"asof": asof, "breadth": breadth, "sectors": [], "spark_days": spark_days}

    # 近 N 日板块走势:缓存日线窗口内每股收盘 → 按行业逐日等权均值 → 归一化到首日。
    sector_spark: dict[str, list[float]] = {}
    if spark_range is not None:
        win = dl.window(
            "price", spark_range[0], spark_range[1], fields=["stock_code", "trade_date", "close"]
        )
        win = win.join(
            _meta_frame(meta).select("stock_code", "industry"), on="stock_code", how="inner"
        )
        win = win.filter(pl.col("industry").is_not_null() & (pl.col("industry") != ""))
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
    return {"asof": asof, "breadth": breadth, "sectors": sectors, "spark_days": spark_days}


def market_snapshot(dl: DataLayer, meta: Mapping[str, dict], *, spark_days: int = 20) -> dict:
    """收盘快照:全A广度 + 按行业聚合的板块卡(用缓存最新交易日 vs 昨日)。"""
    dates = dl.latest_dates("price", n=spark_days + 1)  # 降序
    if len(dates) < 2:
        return {"asof": dates[0] if dates else None, "breadth": None, "sectors": [], "spark_days": spark_days}
    latest, prev, earliest = dates[0], dates[1], dates[-1]
    chg = _chg_table(dl, latest, prev)
    if chg.is_empty():
        return {"asof": latest, "breadth": None, "sectors": [], "spark_days": spark_days}
    return _aggregate(dl, chg, meta, asof=latest, spark_range=(earliest, latest), spark_days=spark_days)


def market_live(
    dl: DataLayer,
    meta: Mapping[str, dict],
    quotes: Mapping[str, dict],
    *,
    spark_days: int = 20,
    asof: str | None = None,
) -> dict:
    """实时快照:当日涨跌取自实时报价(现价 vs 昨收),板块走势仍取缓存日线。

    quotes:{code: {price 现价, prev_close 昨收, ...}}(RealtimeProvider)。无有效报价 → 诚实空,
    调用方据此回落收盘快照(market_snapshot)。仅当日展示用,不入因子/信号/回测(红线:日频不分时)。
    """
    rows = [
        {"stock_code": c, "close": float(q["price"]), "chg": (float(q["price"]) / float(q["prev_close"]) - 1.0) * 100.0}
        for c, q in quotes.items()
        if q.get("price") and q.get("prev_close")
    ]
    if not rows:
        return {"asof": asof, "breadth": None, "sectors": [], "spark_days": spark_days, "live": True}
    chg = pl.DataFrame(rows)
    dates = dl.latest_dates("price", n=spark_days + 1)
    spark_range = (dates[-1], dates[0]) if len(dates) >= 2 else None
    res = _aggregate(dl, chg, meta, asof=asof, spark_range=spark_range, spark_days=spark_days)
    res["live"] = True
    return res


def sector_constituents(
    dl: DataLayer, meta: Mapping[str, dict], industry: str, quotes: Mapping[str, dict] | None = None
) -> dict:
    """板块成分股:现价 / 当日涨跌 / 换手(降序按涨跌)。无数据诚实空。

    quotes 给定(实时报价)→ 用现价/昨收算当日涨跌(与实时行情主页同口径,~十几只瞬时);
    否则回落缓存收盘价(只物化本板块成分,不再整库物化 → 提速)。
    """
    codes = [c for c, m in meta.items() if (m.get("industry") or "") == industry]
    if not codes:
        return {"industry": industry, "asof": None, "constituents": [], "live": bool(quotes)}

    rows: list[dict] = []
    asof = None
    if quotes:  # 实时:只算本板块成分(快、与主页一致)
        for c in codes:
            q = quotes.get(c)
            if q and q.get("price") and q.get("prev_close"):
                px, pc = float(q["price"]), float(q["prev_close"])
                rows.append({"stock_code": c, "close": px, "chg": (px / pc - 1.0) * 100.0})
    if rows:
        # 实时路径只用现价/涨跌(瞬时);换手需 daily_basic(开万级文件,慢)→ 实时下不查,诚实留空。
        chg = pl.DataFrame(rows)
    else:  # 回落缓存收盘(按 codes 裁剪物化,不整库)
        dates = dl.latest_dates("price", n=2, codes=codes)
        if len(dates) < 2:
            return {"industry": industry, "asof": None, "constituents": [], "live": False}
        asof = dates[0]
        chg = _chg_table(dl, dates[0], dates[1], codes=codes)
        if chg.is_empty():
            return {"industry": industry, "asof": asof, "constituents": [], "live": False}
        db = dl.latest_asof(
            "daily_basic", asof, fields=["stock_code", "turnover_rate"], codes=codes
        )
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
    return {"industry": industry, "asof": asof, "constituents": out, "live": bool(rows)}
