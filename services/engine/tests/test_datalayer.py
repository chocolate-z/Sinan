"""data.asof 黄金测试:防未来函数(ann_date PIT)+ 截断不变式 + 断点续传去重。"""

import polars as pl

from sinan.data import DataLayer, store


def _price(codes_dates_close):
    return pl.DataFrame(
        {
            "stock_code": [c for c, _, _ in codes_dates_close],
            "trade_date": [d for _, d, _ in codes_dates_close],
            "close": [v for _, _, v in codes_dates_close],
        }
    )


def test_asof_only_sees_past(tmp_path):
    cache = tmp_path / "cache"
    df = _price(
        [("600519.SH", f"2024-01-0{i}", float(i)) for i in range(2, 10)]
    )
    store.write_dataset(cache, "price", df)
    out = DataLayer(cache).asof("price", "2024-01-05", fields=["stock_code", "trade_date", "close"])
    assert out["trade_date"].to_list() == ["2024-01-02", "2024-01-03", "2024-01-04", "2024-01-05"]
    assert max(out["trade_date"].to_list()) == "2024-01-05"  # 绝不泄漏 >T


def test_truncation_invariance_golden(tmp_path):
    """黄金不变式:asof(T) 在「全量数据」与「截断到 <=T 的数据」上结果一致。"""
    full = _price([("600519.SH", f"2024-01-0{i}", float(i)) for i in range(2, 9)])
    cache_full = tmp_path / "full"
    store.write_dataset(cache_full, "price", full)

    trunc = full.filter(pl.col("trade_date") <= "2024-01-05")
    cache_trunc = tmp_path / "trunc"
    store.write_dataset(cache_trunc, "price", trunc)

    f = ["stock_code", "trade_date", "close"]
    a = DataLayer(cache_full).asof("price", "2024-01-05", fields=f).sort("trade_date")
    b = DataLayer(cache_trunc).asof("price", "2024-01-05", fields=f).sort("trade_date")
    assert a.equals(b)


def test_financial_ann_date_pit_no_leak(tmp_path):
    """财务按 ann_date 取数:报告期已到但尚未公告的一期绝不可见(根除一季报泄漏)。"""
    cache = tmp_path / "cache"
    fin = pl.DataFrame(
        {
            "stock_code": ["600519.SH", "600519.SH"],
            "end_date": ["2023-12-31", "2024-03-31"],  # 报告期
            "ann_date": ["2024-04-20", "2024-04-25"],  # 公告日
            "roe": [20.0, 5.0],
        }
    )
    store.write_dataset(cache, "fundamental", fin)
    out = DataLayer(cache).asof(
        "fundamental", "2024-04-22", fields=["stock_code", "end_date", "ann_date", "roe"]
    )
    # T=04-22:一季报(end 03-31)虽已是过去报告期,但公告日 04-25 > T,不可见。
    # 只能看到年报(ann 04-20<=T)。若错用 end_date 会误取 roe=5.0(未来函数)。
    assert out.height == 1
    assert out["end_date"].to_list() == ["2023-12-31"]
    assert out["roe"].to_list() == [20.0]

    # 公告后 T=04-25:应切到最新一期(end 03-31, roe 5.0)。
    out2 = DataLayer(cache).asof("fundamental", "2024-04-25", fields=["end_date", "roe"])
    assert out2["end_date"].to_list() == ["2024-03-31"]
    assert out2["roe"].to_list() == [5.0]


def test_write_dataset_dedup_on_repeat(tmp_path):
    """断点续传去重:重复写入同一批数据不产生重复行。"""
    cache = tmp_path / "cache"
    df = _price([("600519.SH", f"2024-01-0{i}", float(i)) for i in range(2, 6)])
    store.write_dataset(cache, "price", df)
    store.write_dataset(cache, "price", df)  # 模拟重复/续传重写
    out = DataLayer(cache).asof("price", "2024-12-31", fields=["stock_code", "trade_date"])
    assert out.height == 4  # 4 行,无重复


def test_latest_asof_one_row_per_code(tmp_path):
    cache = tmp_path / "cache"
    df = _price(
        [("600519.SH", "2024-01-02", 1.0), ("600519.SH", "2024-01-04", 3.0),
         ("000001.SZ", "2024-01-03", 2.0)]
    )
    store.write_dataset(cache, "price", df)
    out = DataLayer(cache).latest_asof("price", "2024-01-04", fields=["stock_code", "trade_date", "close"])
    rows = {r["stock_code"]: r["trade_date"] for r in out.to_dicts()}
    assert rows["600519.SH"] == "2024-01-04"
    assert rows["000001.SZ"] == "2024-01-03"


def test_coverage_for(tmp_path):
    cache = tmp_path / "cache"
    df = _price([("600519.SH", f"2024-01-0{i}", float(i)) for i in range(2, 6)])
    store.write_dataset(cache, "price", df)
    first, last, rows = store.coverage_for(cache, "price", "600519.SH")
    assert first == "2024-01-02" and last == "2024-01-05" and rows == 4


def test_resolve_mem_mb_precedence(monkeypatch):
    """物化内存预算解析:显式 > 环境 SINAN_DUCKDB_MEMORY_MB > 默认;下限 512;非法值退默认。"""
    from sinan.data.datalayer import _DEFAULT_MEMORY_MB, _resolve_mem_mb

    monkeypatch.delenv("SINAN_DUCKDB_MEMORY_MB", raising=False)
    assert _resolve_mem_mb(2048) == 2048  # 显式
    assert _resolve_mem_mb(None) == _DEFAULT_MEMORY_MB  # 默认
    assert _resolve_mem_mb(10) == 512  # 下限钳制(防 duckdb 无法周转)

    monkeypatch.setenv("SINAN_DUCKDB_MEMORY_MB", "1536")
    assert _resolve_mem_mb(None) == 1536  # 环境覆盖默认
    assert _resolve_mem_mb(3072) == 3072  # 显式仍优先于环境

    monkeypatch.setenv("SINAN_DUCKDB_MEMORY_MB", "garbage")
    assert _resolve_mem_mb(None) == _DEFAULT_MEMORY_MB  # 非法环境值退默认


def test_datalayer_memory_limit_applies(tmp_path):
    """内存预算真的写进各自 con(SET 生效、非被 try/except 吞掉):不同预算 → 不同 current_setting。"""
    cache = tmp_path / "cache"
    store.write_dataset(cache, "price", _price([("600519.SH", "2024-01-02", 1.0)]))

    small = DataLayer(cache, memory_limit_mb=512)
    big = DataLayer(cache, memory_limit_mb=4096)
    assert small.memory_limit_mb == 512 and big.memory_limit_mb == 4096
    s = small._con.execute("SELECT current_setting('memory_limit')").fetchone()[0]
    b = big._con.execute("SELECT current_setting('memory_limit')").fetchone()[0]
    assert s != b, "memory_limit 未按预算生效(SET 被吞或格式错 → 防卡死失效)"
    # 低预算不改变取数正确性(只是更早溢写,慢但不丢值)。
    out = small.asof("price", "2024-12-31", fields=["stock_code", "close"])
    assert out.height == 1 and out["close"].to_list() == [1.0]
