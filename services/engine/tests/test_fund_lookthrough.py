"""基金穿透聚合:基金×权重 → 股票级暴露 + 行业分布;诚实显已披露覆盖率(不补满未披露部分)。"""

import polars as pl
import pytest

from sinan.data import DataLayer, store
from sinan.factors.fund import look_through


def _write(tmp, rows):
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


ROWS = [
    ("A", "2024-03-31", "2024-04-20", "600519.SH", 30.0),
    ("A", "2024-03-31", "2024-04-20", "000001.SZ", 20.0),  # A 已披露 50% 净值
    ("B", "2024-03-31", "2024-04-22", "000333.SZ", 40.0),  # B 已披露 40%
]
META = {
    "600519.SH": {"name": "贵州茅台", "industry": "白酒"},
    "000001.SZ": {"name": "平安银行", "industry": "银行"},
    "000333.SZ": {"name": "美的集团", "industry": "家电"},
}


def test_aggregates_exposure_and_honest_coverage(tmp_path):
    _write(tmp_path, ROWS)
    res = look_through(
        DataLayer(tmp_path), "2024-05-01",
        [{"fund_code": "A", "weight": 0.6}, {"fund_code": "B", "weight": 0.4}], META,
    )
    # 股票暴露 = Σ 基金权重 × 该基金里这只股的净值占比
    by = {s["stock_code"]: s for s in res["stocks"]}
    assert by["600519.SH"]["weight"] == pytest.approx(0.6 * 0.30)  # 0.18
    assert by["000001.SZ"]["weight"] == pytest.approx(0.6 * 0.20)  # 0.12
    assert by["000333.SZ"]["weight"] == pytest.approx(0.4 * 0.40)  # 0.16
    # 整体已披露覆盖 = Σ 权重×基金覆盖 = .6*.5 + .4*.4 = .46(诚实 < 1,不补满)
    assert res["total_coverage"] == pytest.approx(0.46)
    # 按暴露降序
    assert [s["stock_code"] for s in res["stocks"]] == ["600519.SH", "000333.SZ", "000001.SZ"]
    # 行业 rollup + 名字带上
    sect = {s["industry"]: s["weight"] for s in res["sectors"]}
    assert sect["白酒"] == pytest.approx(0.18) and sect["家电"] == pytest.approx(0.16)
    assert by["600519.SH"]["name"] == "贵州茅台"
    # 逐基金:覆盖率 + 持仓数 + 披露的报告期
    fr = {f["fund_code"]: f for f in res["funds"]}
    assert fr["A"]["disclosed_coverage"] == pytest.approx(0.5) and fr["A"]["n_holdings"] == 2
    assert fr["B"]["disclosed_coverage"] == pytest.approx(0.4)
    assert "覆盖" in res["note"]


def test_missing_industry_is_honest(tmp_path):
    _write(tmp_path, ROWS)
    res = look_through(DataLayer(tmp_path), "2024-05-01", [{"fund_code": "A", "weight": 1.0}], meta=None)
    assert res["stocks"] and res["sectors"] == []  # 有股票暴露,但缺行业 → 行业分布诚实空
    assert any("行业" in d for d in res["degraded"])


def test_fund_without_disclosure_and_empty(tmp_path):
    _write(tmp_path, ROWS)
    dl = DataLayer(tmp_path)
    # 给一个没披露持仓的基金 → 覆盖 0、进 degraded,不崩
    res = look_through(dl, "2024-05-01", [{"fund_code": "ZZZ", "weight": 1.0}], META)
    assert res["total_coverage"] == 0.0 and any("ZZZ" in d for d in res["degraded"])
    # 空持仓 → 诚实空
    assert look_through(dl, "2024-05-01", [], META)["stocks"] == []
