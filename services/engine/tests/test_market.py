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
