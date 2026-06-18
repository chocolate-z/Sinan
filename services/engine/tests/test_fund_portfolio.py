"""基金穿透 PIT(红线#1):对每只基金取「披露日 ann_date<=T 的最近一期完整持仓」。
未来才公告的快照在 asof(T) 不可见;同报告期有修订取最新披露;按基金各自独立选最新报告期。"""

import polars as pl

from sinan.data import DataLayer, store


def _write_holdings(tmp, rows):
    """rows: (fund_code, end_date, ann_date, stock_code, stk_mkv_ratio)"""
    store.write_dataset(
        tmp,
        "fund_portfolio",
        pl.DataFrame(
            {
                "fund_code": [r[0] for r in rows],
                "end_date": [r[1] for r in rows],
                "ann_date": [r[2] for r in rows],
                "stock_code": [r[3] for r in rows],
                "mkv": [1.0] * len(rows),
                "amount": [1.0] * len(rows),
                "stk_mkv_ratio": [r[4] for r in rows],
            }
        ),
    )


# A:Q1(4/20 公告)、Q2(7/18 公告,7/25 又出修订);B:Q1(4/22)、Q3(10/20 公告)
ROWS = [
    ("A", "2024-03-31", "2024-04-20", "600519.SH", 30.0),
    ("A", "2024-03-31", "2024-04-20", "000001.SZ", 20.0),
    ("A", "2024-06-30", "2024-07-18", "600519.SH", 25.0),
    ("A", "2024-06-30", "2024-07-18", "600036.SH", 15.0),
    ("A", "2024-06-30", "2024-07-25", "600519.SH", 26.0),  # 同报告期的修订版
    ("A", "2024-06-30", "2024-07-25", "600036.SH", 16.0),
    ("B", "2024-03-31", "2024-04-22", "000333.SZ", 40.0),
    ("B", "2024-09-30", "2024-10-20", "000333.SZ", 35.0),
]


def _holdings(dl, T, funds):
    df = dl.fund_holdings_asof(T, funds)
    return {(r["fund_code"], r["stock_code"]): r["stk_mkv_ratio"] for r in df.iter_rows(named=True)}


def test_pit_latest_disclosed_per_fund(tmp_path):
    _write_holdings(tmp_path, ROWS)
    # T=5/1:A 只披露了 Q1(Q2 的 7/18 公告还没到),B 也只披露了 Q1 —— 各取各自最近一期
    h = _holdings(DataLayer(tmp_path), "2024-05-01", ["A", "B"])
    assert h == {
        ("A", "600519.SH"): 30.0,
        ("A", "000001.SZ"): 20.0,
        ("B", "000333.SZ"): 40.0,
    }


def test_pit_future_invisible_and_revision_wins(tmp_path):
    _write_holdings(tmp_path, ROWS)
    dl = DataLayer(tmp_path)
    # T=8/1:A 的 Q2 已披露 → 取最新报告期 Q2、同报告期取最新修订(7/25)→ 26/16(不是 25/15、不是 Q1);
    #        B 的 Q3(ann 10/20)还没公告 → 仍是 Q1
    h = _holdings(dl, "2024-08-01", ["A", "B"])
    assert h == {
        ("A", "600519.SH"): 26.0,
        ("A", "600036.SH"): 16.0,
        ("B", "000333.SZ"): 40.0,
    }, h
    # T=12/1:B 的 Q3 已披露 → B 切到 Q3
    assert _holdings(dl, "2024-12-01", ["B"]) == {("B", "000333.SZ"): 35.0}


def test_empty_funds_and_no_cache_are_honest(tmp_path):
    _write_holdings(tmp_path, ROWS)
    assert DataLayer(tmp_path).fund_holdings_asof("2024-12-01", []).is_empty()  # 没给基金
    assert DataLayer(tmp_path / "empty").fund_holdings_asof("2024-12-01", ["A"]).is_empty()  # 无缓存
