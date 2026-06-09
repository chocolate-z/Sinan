"""M3 切片2 自测:特征面板 + 前向标签的红线#1(无未来函数)守护。

- 特征面板:T 日特征只依赖 <=T 数据(截断 >T 重算,T 及之前各日特征逐行一致)。
- 前向标签:label[T] 恰为 hfq[T+horizon]/hfq[T]-1;最后 horizon 日无未来 → null(不编造)。
- 两者严禁混用:标签用未来价,特征绝不含未来价(由 features 走 asof + 本测试共同守护)。
"""

from datetime import date, timedelta

import polars as pl

from sinan.data import DataLayer, store
from sinan.training import build_feature_panel, build_forward_return_labels

CODES = ["600519.SH", "000001.SZ", "600036.SH", "000333.SZ", "601318.SH", "600000.SH"]


def _dates(n: int):
    start = date(2024, 1, 1)
    return [(start + timedelta(days=i)).isoformat() for i in range(n)]


def _frames(dates, *, with_northbound=True, adj=1.0):
    price, adjf, basic, north = [], [], [], []
    for ci, code in enumerate(CODES):
        for di, d in enumerate(dates):
            close = 10.0 + ci + di * 0.1
            price.append({
                "stock_code": code, "trade_date": d,
                "open": close * 0.99, "high": close * 1.01, "low": close * 0.98,
                "close": close, "volume": 1000.0 + di, "amount": close * 1000.0,
            })
            adjf.append({"stock_code": code, "trade_date": d, "adj_factor": adj})
            basic.append({
                "stock_code": code, "trade_date": d,
                "pe_ttm": 10.0 + ci * 3 + di * 0.01, "pb": 1.0 + ci * 0.5,
                "ps_ttm": 5.0, "total_mv": 1e6, "circ_mv": 8e5,
                "turnover_rate": 1.5, "dv_ttm": 2.0,
            })
            if with_northbound:
                north.append({
                    "stock_code": code, "trade_date": d,
                    "north_hold_ratio": 1.0 + ci * 0.3 + di * (0.01 + ci * 0.005),
                })
    fundamental = [
        {"stock_code": code, "end_date": "2023-12-31", "ann_date": "2024-01-05", "roe": 5.0 + ci * 2.0}
        for ci, code in enumerate(CODES)
    ]
    frames = {
        "price": pl.DataFrame(price),
        "adj_factor": pl.DataFrame(adjf),
        "daily_basic": pl.DataFrame(basic),
        "fundamental": pl.DataFrame(fundamental),
    }
    if with_northbound:
        frames["northbound"] = pl.DataFrame(north)
    return frames


def _write(cache, frames, *, max_trade_date=None):
    for ds, df in frames.items():
        if max_trade_date and ds == "fundamental":
            df = df.filter(pl.col("ann_date") <= max_trade_date)
        elif max_trade_date:
            df = df.filter(pl.col("trade_date") <= max_trade_date)
        store.write_dataset(cache, ds, df)


def test_feature_panel_no_future_function(tmp_path):
    """截断 >T 数据后,T 及之前各日的特征面板逐行不变 —— 防未来函数。"""
    dates = _dates(30)
    T = dates[24]
    train_dates = dates[:25]  # <= T
    frames = _frames(dates)

    full = tmp_path / "full"
    _write(full, frames)
    trunc = tmp_path / "trunc"
    _write(trunc, frames, max_trade_date=T)

    p_full = build_feature_panel(DataLayer(full), CODES, train_dates).panel.sort(
        ["date", "stock_code"]
    )
    p_trunc = build_feature_panel(DataLayer(trunc), CODES, train_dates).panel.sort(
        ["date", "stock_code"]
    )
    assert p_full.equals(p_trunc), "特征面板受到了 >T 未来数据影响 —— 未来函数!"


def test_feature_panel_shape_and_degrade(tmp_path):
    dates = _dates(30)
    cache = tmp_path / "c"
    _write(cache, _frames(dates, with_northbound=False))

    fp = build_feature_panel(DataLayer(cache), CODES, dates)
    # 列集固定为 factors 全集(含降级的 north_chg5,值为 null)。
    assert fp.feature_cols == ["f_ep", "f_bp", "f_roe", "f_mom20", "f_north_chg5"]
    assert fp.panel.height == len(dates) * len(CODES)
    assert set(fp.panel.columns) == {"date", "stock_code", *fp.feature_cols}
    # 北向缺失 → 每日降级,且该列全 null(诚实,不补 0)。
    assert fp.degraded_days.get("north_chg5") == len(dates)
    assert fp.panel["f_north_chg5"].drop_nulls().len() == 0


def test_forward_return_label_correct(tmp_path):
    dates = _dates(30)
    cache = tmp_path / "c"
    _write(cache, _frames(dates))
    horizon = 5

    lab = build_forward_return_labels(DataLayer(cache), CODES, horizon)
    # 取某股某日核对:close=10+ci+di*0.1,adj=1 → hfq=close。
    code = CODES[2]  # ci=2
    di = 10
    close_t = 10.0 + 2 + di * 0.1
    close_fwd = 10.0 + 2 + (di + horizon) * 0.1
    expect = close_fwd / close_t - 1.0
    row = lab.filter((pl.col("stock_code") == code) & (pl.col("date") == dates[di]))
    assert abs(row["label"][0] - expect) < 1e-9

    # 最后 horizon 个交易日无未来 → label 必为 null(不编造)。
    tail = lab.filter(pl.col("date").is_in(dates[-horizon:]))
    assert tail["label"].drop_nulls().len() == 0
    # 倒数第 horizon+1 日仍有标签。
    has = lab.filter(pl.col("date") == dates[-horizon - 1])
    assert has["label"].drop_nulls().len() == len(CODES)


def test_label_horizon_changes_label_not_leak(tmp_path):
    """标签确为前向:删掉 >T+h 的数据不改变 label[T](label[T] 只用到 T..T+h)。"""
    dates = _dates(30)
    horizon = 5
    T_idx = 10
    full = tmp_path / "full"
    _write(full, _frames(dates))
    trunc = tmp_path / "trunc"
    _write(trunc, _frames(dates), max_trade_date=dates[T_idx + horizon])  # 仅保留到 T+h

    a = build_forward_return_labels(DataLayer(full), CODES, horizon).filter(
        pl.col("date") == dates[T_idx]
    ).sort("stock_code")
    b = build_forward_return_labels(DataLayer(trunc), CODES, horizon).filter(
        pl.col("date") == dates[T_idx]
    ).sort("stock_code")
    assert a.select("stock_code", "label").equals(b.select("stock_code", "label"))
    assert a["label"].drop_nulls().len() == len(CODES)
