"""股票参考元数据落盘(data.meta):round-trip / 缺列容忍 / 损坏自愈 / 不落 token。"""

import polars as pl

from sinan.data import meta


def _listing(with_industry=True, extra=None):
    cols = {
        "stock_code": ["600519.SH", "000858.SZ"],
        "name": ["贵州茅台", "五粮液"],
        "board": ["sh", "sz"],
        "list_date": ["2001-08-27", "1998-04-27"],
    }
    if with_industry:
        cols["industry"] = ["白酒", "白酒"]
    if extra:
        cols.update(extra)
    return pl.DataFrame(cols)


def test_save_load_round_trip(tmp_path):
    meta.save_stock_meta(tmp_path, _listing())
    out = meta.load_stock_meta(tmp_path)
    assert out is not None
    assert set(out.columns) == {"stock_code", "name", "board", "industry", "list_date"}
    assert out.height == 2


def test_save_only_whitelisted_columns(tmp_path):
    """红线#4:即便上游 df 混入 token 之类字段,落盘也只保留参考白名单列。"""
    meta.save_stock_meta(tmp_path, _listing(extra={"token": ["secret", "secret"]}))
    out = meta.load_stock_meta(tmp_path)
    assert "token" not in out.columns
    assert set(out.columns) == {"stock_code", "name", "board", "industry", "list_date"}


def test_save_tolerates_missing_industry(tmp_path):
    """免费源(AkShare)无 industry 列 → 只落它有的列,不报错。"""
    meta.save_stock_meta(tmp_path, _listing(with_industry=False))
    out = meta.load_stock_meta(tmp_path)
    assert out is not None and "industry" not in out.columns
    assert set(out.columns) == {"stock_code", "name", "board", "list_date"}


def test_load_missing_is_none(tmp_path):
    assert meta.load_stock_meta(tmp_path) is None


def test_save_empty_is_noop(tmp_path):
    meta.save_stock_meta(tmp_path, pl.DataFrame())
    meta.save_stock_meta(tmp_path, None)
    assert meta.load_stock_meta(tmp_path) is None


def test_load_corrupt_returns_none(tmp_path):
    """损坏(0 字节)parquet → 当作无(下次实时取重写自愈),不让整页崩。"""
    f = meta.meta_file(tmp_path)
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_bytes(b"")  # 半截/损坏
    assert meta.load_stock_meta(tmp_path) is None


def test_save_overwrites(tmp_path):
    meta.save_stock_meta(tmp_path, _listing())
    meta.save_stock_meta(
        tmp_path,
        pl.DataFrame(
            {
                "stock_code": ["600036.SH"],
                "name": ["招商银行"],
                "board": ["sh"],
                "industry": ["银行"],
                "list_date": ["2002-04-09"],
            }
        ),
    )
    out = meta.load_stock_meta(tmp_path)
    assert out.height == 1 and out["stock_code"][0] == "600036.SH"  # 整表重写
