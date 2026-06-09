"""回测引擎黄金测试:硬守卫拒跑(红线#2)+ 成交含成本 + 基准对比 + 无未来函数截断不变式。"""

import polars as pl
import pytest

from sinan.backtest import BacktestGuardError, run_backtest
from sinan.data import DataLayer, store
from tests.test_factors import CODES, _build_frames, _dates, _write

BENCH = "000300.SH"


def _index_frames(dates, *, start=4000.0, step=6.0):
    # 单调上升的沪深300 → 始终 > MA20 → 大盘择时闸放行(正常开仓)。
    return pl.DataFrame(
        [
            {
                "stock_code": BENCH,
                "trade_date": d,
                "open": start + i * step,
                "high": start + i * step,
                "low": start + i * step,
                "close": start + i * step,
                "volume": 1.0,
                "amount": 1.0,
            }
            for i, d in enumerate(dates)
        ]
    )


def _setup(cache, dates, *, max_trade_date=None):
    _write(cache, _build_frames(dates), max_trade_date=max_trade_date)
    idx = _index_frames(dates)
    if max_trade_date:
        idx = idx.filter(pl.col("trade_date") <= max_trade_date)
    store.write_dataset(cache, "index_ohlcv", idx)


def test_backtest_guard_rejects_overlap(tmp_path):
    cache = tmp_path / "cache"
    dates = _dates(40)
    _setup(cache, dates)
    # backtest_start = train_end+1,落在 purge=5 隔离区内 → 拒跑。
    with pytest.raises(BacktestGuardError):
        run_backtest(
            DataLayer(cache),
            codes=CODES,
            trading_dates=dates,
            backtest_start=dates[20],
            backtest_end=dates[38],
            train_end=dates[19],
            purge=5,
        )


def test_backtest_runs_with_costs_and_benchmark(tmp_path):
    cache = tmp_path / "cache"
    dates = _dates(40)
    _setup(cache, dates)
    res = run_backtest(
        DataLayer(cache),
        codes=CODES,
        trading_dates=dates,
        backtest_start=dates[26],
        backtest_end=dates[38],
        train_end=dates[19],
        purge=5,
        params={"buy_threshold": 0.0, "max_holdings": 5},
    )
    assert res.cost_included is True
    assert res.n_days >= 2
    assert res.n_trades >= 1  # 单调上升数据 → 触发买入
    assert res.total_cost > 0  # 成交一律含成本(印花税+佣金+冲击)
    assert len(res.nav_curve) == res.n_days
    assert all("nav" in r and "benchmark" in r for r in res.nav_curve)
    # 有基准 → 超额 / IR / 跟踪误差齐备
    for k in ("annual_return", "max_drawdown", "sharpe", "excess_return", "information_ratio"):
        assert k in res.metrics


def test_backtest_valuation_asof_never_leads_decision_day(tmp_path, monkeypatch):
    """白盒护栏(红线#1 真正的执行机制):逐日「收盘估值」取数的 asof 必须恰为决策日 T,
    绝不超前到 T+1/未来。

    这是能真正证伪「T 日估值误用 T+1 价」的护栏:把估值取数日前移一天(经典未来函数 bug),
    close 取数序列就会与决策日序列不符且 max 超出回测区间末日,本测试即变红。
    (纯截断不变式无法抓到「回测可见区内」的此类泄漏,故另立此白盒断言。)"""
    from sinan.backtest import engine as eng

    cache = tmp_path / "cache"
    dates = _dates(40)
    _setup(cache, dates)

    close_asofs: list[str] = []
    orig = eng._price_map

    def spy(data, dataset, asof, field, codes):
        if dataset == "price" and field == "close":
            close_asofs.append(asof)  # 估值取数(T 收盘)
        return orig(data, dataset, asof, field, codes)

    monkeypatch.setattr(eng, "_price_map", spy)
    run_backtest(
        DataLayer(cache),
        codes=CODES,
        trading_dates=dates,
        backtest_start=dates[26],
        backtest_end=dates[38],
        train_end=dates[19],
        purge=5,
        params={"buy_threshold": 0.0},
    )
    days = [d for d in dates if dates[26] <= d <= dates[38]]
    assert close_asofs == days  # 收盘估值逐日 T,无任何超前
    assert max(close_asofs) <= dates[38]  # 估值绝不触碰回测区间末日之后


def test_backtest_truncation_invariance(tmp_path):
    """截断不变式(补充护栏):回测只依赖 <=(回测末日的 T+1) 的数据;追加更远未来数据
    不改变 nav/成交数/成本。注:此测只覆盖『> 回测可见区』的泄漏;『回测可见区内』的未来
    函数由上面的白盒 asof 护栏把守。"""
    dates = _dates(50)
    full = tmp_path / "full"
    _setup(full, dates)
    cutoff = dates[39]  # 回测 [26,38] 最远用到 dates[39] 的开盘价
    trunc = tmp_path / "trunc"
    _setup(trunc, dates, max_trade_date=cutoff)

    kw = dict(
        codes=CODES,
        backtest_start=dates[26],
        backtest_end=dates[38],
        train_end=dates[19],
        purge=5,
        params={"buy_threshold": 0.0},
    )
    r_full = run_backtest(DataLayer(full), trading_dates=dates, **kw)
    r_trunc = run_backtest(DataLayer(trunc), trading_dates=dates[:40], **kw)

    assert [round(r["nav"], 4) for r in r_full.nav_curve] == [
        round(r["nav"], 4) for r in r_trunc.nav_curve
    ]
    assert r_full.n_trades == r_trunc.n_trades  # 收窄盲区:成交数/成本也不受远未来影响
    assert round(r_full.total_cost, 4) == round(r_trunc.total_cost, 4)


def test_backtest_rejects_short_window(tmp_path):
    cache = tmp_path / "cache"
    dates = _dates(40)
    _setup(cache, dates)
    with pytest.raises(ValueError):
        run_backtest(
            DataLayer(cache),
            codes=CODES,
            trading_dates=dates,
            backtest_start=dates[38],
            backtest_end=dates[38],  # 单日区间 → 不足
            train_end=dates[19],
            purge=5,
        )
