"""K 线取数黄金测试:PIT 截断不变式(防未来函数)+ 前复权基线 + 区间/limit + 诚实降级。"""

import polars as pl

from sinan.data import DataLayer, store
from sinan.data.kline import forward_adjust, kline

DATES = [f"2024-01-{i:02d}" for i in range(2, 10)]  # 8 个交易日 02..09
CLOSES = [10.0, 11.0, 12.0, 13.0, 14.0, 15.0, 16.0, 17.0]


def _price(code, dates, closes):
    n = len(dates)
    return pl.DataFrame(
        {
            "stock_code": [code] * n,
            "trade_date": list(dates),
            "open": [round(c - 0.1, 4) for c in closes],
            "high": [round(c + 0.2, 4) for c in closes],
            "low": [round(c - 0.2, 4) for c in closes],
            "close": list(closes),
            "volume": [1000.0 + i for i in range(n)],
            "amount": [10000.0 + i for i in range(n)],
        }
    )


def _adj(code, dates, factors):
    return pl.DataFrame(
        {"stock_code": [code] * len(dates), "trade_date": list(dates), "adj_factor": list(factors)}
    )


def test_kline_only_sees_past_and_truncation_invariant(tmp_path):
    """黄金不变式:kline(end=T) 只见 <=T;在全量与截断到 <=T 的缓存上结果一致。"""
    code = "600519.SH"
    cache = tmp_path / "cache"
    store.write_dataset(cache, "price", _price(code, DATES, CLOSES))
    rows_full, _ = kline(DataLayer(cache), code, end="2024-01-05", adjust="none")
    assert [r["trade_date"] for r in rows_full] == DATES[:4]  # 02..05
    assert max(r["trade_date"] for r in rows_full) == "2024-01-05"  # 绝不泄漏 >T

    cache2 = tmp_path / "trunc"
    trunc = _price(code, DATES, CLOSES).filter(pl.col("trade_date") <= "2024-01-05")
    store.write_dataset(cache2, "price", trunc)
    rows_trunc, _ = kline(DataLayer(cache2), code, end="2024-01-05", adjust="none")
    assert rows_full == rows_trunc  # 追加 >T 的未来行不改变 kline(T) 的输出


def test_forward_adjust_baseline_is_latest_in_window(tmp_path):
    """前复权基线 = 窗口内最新一日的复权因子;基线日前复权价 == 原始价。"""
    code = "600000.SH"
    cache = tmp_path / "cache"
    dates, closes, factors = DATES[:4], [10.0, 10.0, 10.0, 10.0], [1.0, 1.0, 2.0, 2.0]
    store.write_dataset(cache, "price", _price(code, dates, closes))
    store.write_dataset(cache, "adj_factor", _adj(code, dates, factors))
    rows, degraded = kline(DataLayer(cache), code, end="2024-01-05", adjust="qfq")
    assert degraded is False
    # 基线=2.0,ratio=factor/2 → [0.5,0.5,1,1];close 10 → [5,5,10,10]
    assert [r["close"] for r in rows] == [5.0, 5.0, 10.0, 10.0]
    assert rows[-1]["close"] == closes[-1]  # 最新一日 ratio=1,前复权价==原始价

    raw, _ = kline(DataLayer(cache), code, end="2024-01-05", adjust="none")
    assert [r["close"] for r in raw] == closes  # 不复权返回原始价


def test_kline_degraded_without_adj_factor(tmp_path):
    """无复权因子缓存 → 诚实降级到原始价并标 degraded。"""
    code = "000001.SZ"
    cache = tmp_path / "cache"
    store.write_dataset(cache, "price", _price(code, DATES[:3], CLOSES[:3]))
    rows, degraded = kline(DataLayer(cache), code, end="2024-12-31", adjust="qfq")
    assert degraded is True
    assert [r["close"] for r in rows] == CLOSES[:3]


def test_forward_adjust_partial_missing_is_degraded():
    """部分日缺复权因子也算降级(诚实告知覆盖不全)。"""
    prices = _price("600519.SH", DATES[:3], CLOSES[:3])
    adj = _adj("600519.SH", DATES[:2], [1.0, 1.0])  # 缺第 3 日
    out, degraded = forward_adjust(prices, adj)
    assert degraded is True
    assert out.height == 3


def test_kline_limit_and_range(tmp_path):
    code = "600519.SH"
    cache = tmp_path / "cache"
    store.write_dataset(cache, "price", _price(code, DATES, CLOSES))
    rows, _ = kline(DataLayer(cache), code, end="99999999", limit=3, adjust="none")
    assert [r["trade_date"] for r in rows] == DATES[-3:]  # 末 3 根
    rows2, _ = kline(DataLayer(cache), code, start="2024-01-06", end="99999999", adjust="none")
    assert [r["trade_date"] for r in rows2] == DATES[4:]  # >= 06(含端点)


def test_kline_empty_cache_no_error(tmp_path):
    rows, degraded = kline(DataLayer(tmp_path / "cache"), "600519.SH", adjust="qfq")
    assert rows == [] and degraded is False
