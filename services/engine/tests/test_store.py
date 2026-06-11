"""缓存存储健壮性:损坏/0 字节 parquet(写入中断残留)不让建缓存崩,且自愈。"""

import polars as pl

from sinan.data import layout, store
from sinan.providers.base import board_of


def _price_df(code, dates):
    n = len(dates)
    return pl.DataFrame(
        {
            "stock_code": [code] * n,
            "trade_date": list(dates),
            "open": [1.0] * n,
            "high": [1.0] * n,
            "low": [1.0] * n,
            "close": [1.0] * n,
            "volume": [1.0] * n,
            "amount": [1.0] * n,
        }
    )


def test_write_dataset_recovers_from_corrupt_existing_partition(tmp_path):
    code = "600519.SH"
    store.write_dataset(tmp_path, "price", _price_df(code, ["2024-01-02"]))
    target = layout.partition_file(tmp_path, "price", board_of(code), "2024")
    target.write_bytes(b"")  # 模拟写入中断:0 字节损坏分区

    # 读到损坏 existing 不崩,重写为合法文件
    n = store.write_dataset(tmp_path, "price", _price_df(code, ["2024-01-03"]))
    assert n == 1
    assert "2024-01-03" in pl.read_parquet(target)["trade_date"].to_list()


def test_coverage_for_skips_and_deletes_corrupt(tmp_path):
    code = "600519.SH"
    target = layout.partition_file(tmp_path, "price", board_of(code), "2024")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(b"\x00\x00")  # 损坏(无其他有效分区)

    assert store.coverage_for(tmp_path, "price", code) == (None, None, 0)
    assert not target.exists()  # 损坏文件已删除自愈


def test_coverage_for_uses_good_partitions_alongside_corrupt(tmp_path):
    code = "600519.SH"
    store.write_dataset(tmp_path, "price", _price_df(code, ["2023-12-29"]))  # 2023 分区
    store.write_dataset(tmp_path, "price", _price_df(code, ["2024-01-02"]))  # 2024 分区
    bad = layout.partition_file(tmp_path, "price", board_of(code), "2024")
    bad.write_bytes(b"")  # 损坏 2024,2023 完好

    first, last, rows = store.coverage_for(tmp_path, "price", code)
    assert (first, last, rows) == ("2023-12-29", "2023-12-29", 1)  # 用完好分区,跳过损坏
    assert not bad.exists()
