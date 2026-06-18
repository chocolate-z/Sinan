"""行情页全市场快照:全A广度 + 板块聚合 + 成分股(真实板块视角,诚实空)。"""

import polars as pl

from sinan.data import DataLayer, store
from sinan.factors.market import market_snapshot, sector_constituents


def _write(tmp, code, rows):
    """rows: [(trade_date, close), ...]"""
    n = len(rows)
    store.write_dataset(
        tmp,
        "price",
        pl.DataFrame(
            {
                "stock_code": [code] * n,
                "trade_date": [r[0] for r in rows],
                "open": [r[1] for r in rows],
                "high": [r[1] for r in rows],
                "low": [r[1] for r in rows],
                "close": [r[1] for r in rows],
                "volume": [1.0] * n,
                "amount": [1.0] * n,
            }
        ),
    )


META = {
    "600000.SH": {"name": "浦发银行", "industry": "银行"},
    "601398.SH": {"name": "工商银行", "industry": "银行"},
    "600519.SH": {"name": "贵州茅台", "industry": "白酒"},
}


def test_market_snapshot_breadth_and_sectors(tmp_path):
    _write(tmp_path, "600000.SH", [("2024-01-02", 10.0), ("2024-01-03", 11.0)])  # +10%
    _write(tmp_path, "601398.SH", [("2024-01-02", 5.0), ("2024-01-03", 5.1)])  # +2%
    _write(tmp_path, "600519.SH", [("2024-01-02", 100.0), ("2024-01-03", 90.0)])  # -10%

    snap = market_snapshot(DataLayer(tmp_path), META, spark_days=5)
    assert snap["asof"] == "2024-01-03"
    assert (snap["breadth"]["total"], snap["breadth"]["up"], snap["breadth"]["down"]) == (3, 2, 1)
    # 银行(+6% 均值)> 白酒(-10%):降序排列
    assert [s["name"] for s in snap["sectors"]] == ["银行", "白酒"]
    bank = snap["sectors"][0]
    assert bank["count"] == 2 and bank["up"] == 2 and bank["down"] == 0
    assert bank["lead"] == "浦发银行"  # 涨幅最大的成分
    assert abs(bank["chg"] - 6.0) < 1e-6
    assert len(bank["spark"]) >= 1  # 有板块走势序列


def test_sector_constituents_sorted(tmp_path):
    _write(tmp_path, "600000.SH", [("2024-01-02", 10.0), ("2024-01-03", 11.0)])
    _write(tmp_path, "601398.SH", [("2024-01-02", 5.0), ("2024-01-03", 5.1)])

    res = sector_constituents(DataLayer(tmp_path), META, "银行")
    assert res["industry"] == "银行" and len(res["constituents"]) == 2
    assert res["constituents"][0]["name"] == "浦发银行"  # 涨幅最大在前
    assert res["constituents"][0]["chg"] > res["constituents"][1]["chg"]


def test_market_snapshot_empty_cache_is_honest(tmp_path):
    snap = market_snapshot(DataLayer(tmp_path), META)
    assert snap["breadth"] is None and snap["sectors"] == []


def test_market_snapshot_no_meta_degrades_to_breadth_only(tmp_path):
    """有行情但缺行业元数据(本会话无 token → meta={}):出全A广度、板块诚实空,绝不崩。"""
    _write(tmp_path, "600000.SH", [("2024-01-02", 10.0), ("2024-01-03", 11.0)])  # +10%
    _write(tmp_path, "600519.SH", [("2024-01-02", 100.0), ("2024-01-03", 90.0)])  # -10%

    snap = market_snapshot(DataLayer(tmp_path), {}, spark_days=5)  # meta 空 → 曾触发 SchemaError
    assert snap["asof"] == "2024-01-03"
    assert (snap["breadth"]["total"], snap["breadth"]["up"], snap["breadth"]["down"]) == (2, 1, 1)
    assert snap["sectors"] == []  # 无行业 → 诚实空


def test_sector_constituents_no_meta_is_honest(tmp_path):
    """成分股:meta 空时该板块无成分 → 诚实空,不崩。"""
    _write(tmp_path, "600000.SH", [("2024-01-02", 10.0), ("2024-01-03", 11.0)])
    res = sector_constituents(DataLayer(tmp_path), {}, "银行")
    assert res["industry"] == "银行" and res["constituents"] == []


def test_market_live_uses_realtime_quotes(tmp_path):
    """实时快照:当日涨跌取自实时报价(现价 vs 昨收),板块走势仍取缓存日线。"""
    from sinan.factors.market import market_live

    # 缓存日线(供板块走势 Sparkline)
    _write(tmp_path, "600000.SH", [("2024-01-02", 10.0), ("2024-01-03", 10.5)])
    _write(tmp_path, "601398.SH", [("2024-01-02", 5.0), ("2024-01-03", 5.1)])
    _write(tmp_path, "600519.SH", [("2024-01-02", 100.0), ("2024-01-03", 99.0)])
    # 实时报价:现价 vs 昨收 → 今日涨跌(与缓存收盘无关)
    quotes = {
        "600000.SH": {"price": 11.0, "prev_close": 10.0},  # +10%
        "601398.SH": {"price": 5.2, "prev_close": 5.0},  # +4%
        "600519.SH": {"price": 90.0, "prev_close": 100.0},  # -10%
    }
    res = market_live(DataLayer(tmp_path), META, quotes, spark_days=5, asof="LIVE")
    assert res["live"] is True and res["asof"] == "LIVE"
    assert (res["breadth"]["total"], res["breadth"]["up"], res["breadth"]["down"]) == (3, 2, 1)
    # 银行(+10%/+4% 均 +7%)> 白酒(-10%):用实时涨跌排序
    assert [s["name"] for s in res["sectors"]] == ["银行", "白酒"]
    assert abs(res["sectors"][0]["chg"] - 7.0) < 1e-6


def test_market_live_no_quotes_is_honest(tmp_path):
    """无有效实时报价(盘后/源不可达)→ breadth=None,调用方据此回落收盘快照。"""
    from sinan.factors.market import market_live

    _write(tmp_path, "600000.SH", [("2024-01-02", 10.0), ("2024-01-03", 10.5)])
    res = market_live(DataLayer(tmp_path), META, {}, spark_days=5, asof="LIVE")
    assert res["breadth"] is None and res["sectors"] == [] and res["live"] is True


def _write_index(tmp, code, rows):
    """index_ohlcv: [(trade_date, close), ...]"""
    n = len(rows)
    store.write_dataset(
        tmp,
        "index_ohlcv",
        pl.DataFrame(
            {
                "stock_code": [code] * n,
                "trade_date": [r[0] for r in rows],
                "open": [r[1] for r in rows],
                "high": [r[1] for r in rows],
                "low": [r[1] for r in rows],
                "close": [r[1] for r in rows],
                "volume": [1.0] * n,
                "amount": [1.0] * n,
            }
        ),
    )


def test_market_indices_chg_from_cache(tmp_path):
    """大盘指数条:每只指数取缓存最近 2 行算涨跌(最新 vs 昨收);只 1 行 → chg=None(诚实)。"""
    from sinan.factors.market import market_indices

    _write_index(tmp_path, "000300.SH", [("2024-01-02", 4000.0), ("2024-01-03", 4040.0)])  # +1%
    _write_index(tmp_path, "000905.SH", [("2024-01-02", 6000.0), ("2024-01-03", 5940.0)])  # -1%
    _write_index(tmp_path, "000001.SH", [("2024-01-03", 3000.0)])  # 只 1 行 → 无昨收

    res = market_indices(DataLayer(tmp_path))
    by = {x["code"]: x for x in res["indices"]}
    assert res["asof"] == "2024-01-03"
    assert by["000300.SH"]["name"] == "沪深300"
    assert by["000300.SH"]["close"] == 4040.0 and abs(by["000300.SH"]["chg"] - 1.0) < 1e-6
    assert abs(by["000905.SH"]["chg"] + 1.0) < 1e-6  # -1%
    assert by["000001.SH"]["close"] == 3000.0 and by["000001.SH"]["chg"] is None  # 无昨收 → 诚实 None
    # 缓存里没有的默认指数(深证/创业板)不硬塞,诚实不出现
    assert "399001.SZ" not in by and "399006.SZ" not in by


def test_market_indices_empty_cache_is_honest(tmp_path):
    """无 index_ohlcv 缓存(免费源没拉指数)→ indices 空、asof=None,绝不造数(红线#3)。"""
    from sinan.factors.market import market_indices

    res = market_indices(DataLayer(tmp_path))
    assert res["indices"] == [] and res["asof"] is None


def test_datalayer_year_pruning(tmp_path):
    """行情快照提速地基:DataLayer(years=) 只物化指定 year 分区,跨年只看裁剪内的年份。
    全市场多年缓存里只读最近两年可成倍提速(避免 glob 上万分股文件),asof 在裁剪内仍正确。"""
    from sinan.data.layout import available_years

    _write(tmp_path, "600000.SH", [("2024-12-30", 10.0), ("2025-06-02", 11.0), ("2025-06-03", 12.0)])
    assert available_years(tmp_path, "price") == ["2024", "2025"]  # 廉价目录列举

    full = DataLayer(tmp_path).latest_dates("price", n=5)
    assert "2024-12-30" in full and "2025-06-03" in full

    pruned = DataLayer(tmp_path, years=["2025"]).latest_dates("price", n=5)
    assert "2024-12-30" not in pruned and set(pruned) == {"2025-06-02", "2025-06-03"}

    # asof 在裁剪分区内仍取最新一行(PIT 上界不受影响)
    a = DataLayer(tmp_path, years=["2025"]).latest_asof(
        "price", "2025-06-03", fields=["stock_code", "close"]
    )
    assert a.row(0, named=True)["close"] == 12.0
