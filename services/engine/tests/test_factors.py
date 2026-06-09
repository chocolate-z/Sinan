"""M1 因子/打分自测:防未来函数黄金测试 + 横截面处理 + 北向缺失降级。"""

from datetime import date, timedelta

import polars as pl

from sinan.data import DataLayer, store
from sinan.factors import FactorContext, score_universe
from sinan.factors.cross_section import winsorize_mad, zscore

CODES = ["600519.SH", "000001.SZ", "600036.SH", "000333.SZ", "601318.SH", "600000.SH"]


def _dates(n: int):
    start = date(2024, 1, 1)
    return [(start + timedelta(days=i)).isoformat() for i in range(n)]


def _build_frames(dates, *, with_northbound=True, future_after=None):
    """构造合成数据帧。future_after:在该日之后再加一期「未来公告」财务行(应不可见)。"""
    price, adj, basic, north = [], [], [], []
    for ci, code in enumerate(CODES):
        for di, d in enumerate(dates):
            close = 10.0 + ci + di * 0.1 + ci * 0.01
            price.append({
                "stock_code": code, "trade_date": d,
                "open": close * 0.99, "high": close * 1.01, "low": close * 0.98,
                "close": close, "volume": 1000.0 + di, "amount": close * 1000.0,
            })
            adj.append({"stock_code": code, "trade_date": d, "adj_factor": 1.0})
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

    fundamental = []
    for ci, code in enumerate(CODES):
        # 已公告(可见)的一期
        fundamental.append({
            "stock_code": code, "end_date": "2023-12-31", "ann_date": "2024-01-05",
            "roe": 5.0 + ci * 2.0,
        })
        if future_after:
            # 未来公告:报告期更新但公告日在 future_after 之后,asof 前不可见
            fundamental.append({
                "stock_code": code, "end_date": "2024-03-31", "ann_date": "2099-01-01",
                "roe": 999.0,
            })

    frames = {
        "price": pl.DataFrame(price),
        "adj_factor": pl.DataFrame(adj),
        "daily_basic": pl.DataFrame(basic),
        "fundamental": pl.DataFrame(fundamental),
    }
    if with_northbound:
        frames["northbound"] = pl.DataFrame(north)
    return frames


def _write(cache, frames, *, max_trade_date=None):
    for ds, df in frames.items():
        if max_trade_date and ds != "fundamental":
            df = df.filter(pl.col("trade_date") <= max_trade_date)
        if max_trade_date and ds == "fundamental":
            df = df.filter(pl.col("ann_date") <= max_trade_date)
        store.write_dataset(cache, ds, df)


def test_golden_no_future_function(tmp_path):
    """对历史日 T,截断 >T 数据重算打分,结果与全量一致(走 data.asof)。"""
    dates = _dates(30)
    T = dates[24]  # 之后还有 5 天「未来」数据
    frames = _build_frames(dates, future_after=T)

    cache_full = tmp_path / "full"
    _write(cache_full, frames)  # 含 T 之后数据 + 未来公告财务
    cache_trunc = tmp_path / "trunc"
    _write(cache_trunc, frames, max_trade_date=T)  # 仅 <=T

    full = score_universe(FactorContext(DataLayer(cache_full), T, CODES))
    trunc = score_universe(FactorContext(DataLayer(cache_trunc), T, CODES))

    cols = ["stock_code", "score", "percentile"]
    a = full.scores.select(cols).sort("stock_code")
    b = trunc.scores.select(cols).sort("stock_code")
    assert a.equals(b), "asof(T) 打分受到了 >T 未来数据影响 —— 未来函数!"
    assert full.coverage == 1.0
    assert set(full.effective) == {"ep", "bp", "roe", "mom20", "north_chg5"}


def test_financial_uses_announced_not_reported(tmp_path):
    """财务按 ann_date 取:未来公告(ann>T)的报告期绝不进入打分。"""
    dates = _dates(30)
    T = dates[24]
    frames = _build_frames(dates, future_after=T)
    cache = tmp_path / "c"
    _write(cache, frames)
    # roe 因子值应来自已公告期(roe≈5+2ci),绝非 future 行的 999
    dl = DataLayer(cache)
    fin = dl.asof("fundamental", T, fields=["stock_code", "roe"], codes=CODES)
    assert fin["roe"].max() < 100, "用到了未公告的未来财务(roe=999)"


def test_degrade_when_northbound_missing(tmp_path):
    """免费源无北向:north_chg5 降级丢弃,权重重分配,coverage 标注。"""
    dates = _dates(30)
    T = dates[24]
    frames = _build_frames(dates, with_northbound=False)
    cache = tmp_path / "c"
    _write(cache, frames)

    res = score_universe(FactorContext(DataLayer(cache), T, CODES))
    assert "north_chg5" not in res.effective
    assert abs(res.coverage - 4 / 5) < 1e-9
    assert any("north_chg5" in d for d in res.degraded)
    # 仍能产出打分(基于剩余 4 因子)
    assert res.scores["score"].drop_nulls().len() == len(CODES)


def test_score_universe_with_custom_factor(tmp_path):
    """自定义 DSL 因子进等权打分:与内置因子并列贡献综合分;无效表达式如实降级不崩。"""
    dates = _dates(30)
    T = dates[24]
    cache = tmp_path / "c"
    _write(cache, _build_frames(dates))

    custom = [{"name": "mom10c", "expr": "close / delay(close, 10) - 1", "group": "custom"}]
    res = score_universe(FactorContext(DataLayer(cache), T, CODES), custom=custom)
    assert "mom10c" in res.effective  # 自定义因子进了等权合成
    assert "f_mom10c" in res.scores.columns
    assert "mom20" in res.effective  # 内置因子仍在
    assert res.scores["score"].drop_nulls().len() == len(CODES)

    # 无效表达式 → 沙箱拒 → 进 degraded,不崩、不入 effective(红线#3)。
    bad = score_universe(
        FactorContext(DataLayer(cache), T, CODES),
        custom=[{"name": "evil", "expr": "__import__('os')"}],
    )
    assert any("evil" in d for d in bad.degraded)
    assert "evil" not in bad.effective


def test_cross_section_winsor_and_zscore():
    s = pl.Series("x", [1.0, 2.0, 3.0, 4.0, 100.0])  # 100 为极端值
    w = winsorize_mad(s, n=3.0)
    assert w.max() < 100.0  # 极端值被收缩
    z = zscore(pl.Series("x", [1.0, 2.0, 3.0, 4.0, 5.0]))
    assert abs(z.mean()) < 1e-9
    assert abs(z.std() - 1.0) < 1e-6
