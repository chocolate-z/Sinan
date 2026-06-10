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


def test_backtest_detail_trades_positions_assets(tmp_path):
    """可回溯明细:逐笔成交(买卖点,含成本)+ 逐日持仓快照 + 资产拆解(现金+持仓=净值)。"""
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

    # 逐笔成交(买卖点):每笔含日期/代码/方向/股数/价/成本明细。
    assert len(res.trades) == res.n_trades >= 1
    t0 = res.trades[0]
    assert t0["side"] in ("buy", "sell")
    assert {"trade_date", "code", "shares", "price", "fee_total", "reason"} <= set(t0)
    assert t0["fee_total"] > 0  # 含成本

    # 逐日明细:资产拆解一致(现金 + 持仓市值 == 净值),且含当日盈亏/回撤/持仓快照。
    for r in res.nav_curve:
        assert abs(r["cash"] + r["holding_value"] - r["nav"]) < 1.0  # round 误差容忍
        assert "day_return" in r and "drawdown" in r and "positions" in r
    # 首日撮合前空仓,净值=初始资金。
    assert res.nav_curve[0]["positions"] == []
    assert abs(res.nav_curve[0]["nav"] - 1_000_000) < 1e-6
    # 持仓变化:后续确有持仓,且快照字段完整。
    held = [r for r in res.nav_curve if r["positions"]]
    assert held
    p0 = held[0]["positions"][0]
    assert {"code", "shares", "avg_cost", "value"} <= set(p0)
    # 持仓快照估值与净值估值同源(prices_today),已由 test_backtest_valuation_asof_* 守护无未来函数。


def test_backtest_trade_stats_and_json_safe(tmp_path):
    """成交统计:区间单边换手率 + 已平仓胜率/盈亏比;且结果 JSON 安全(无 inf/NaN,api 可 parse)。"""
    import json

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
        params={"buy_threshold": 0.0, "max_holdings": 5, "take_profit": 0.0},  # 强制平仓制造已平仓交易
    )
    assert res.metrics["turnover"] > 0  # 有买入 → 单边换手 > 0
    pf = res.metrics.get("profit_factor")
    assert pf is None or pf != float("inf")  # 全胜无亏损时 inf 已被置 None(JSON 安全)
    if "win_rate" in res.metrics:  # 有已平仓交易时
        assert 0.0 <= res.metrics["win_rate"] <= 1.0
    # 红线#6 落库前提:整份结果严格 JSON 安全(allow_nan=False 捕获任何 inf/NaN)。
    json.dumps(res.to_dict(), allow_nan=False)


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


# ── 口径与实盘一致:回测用激活模型 / 自定义因子(M4 v3 扩展;红线#1 双保险)──────────────
_MODEL_MOM = {"feature_cols": ["f_mom20"], "coef": [1.0], "intercept": 0.0}
_CUSTOM_MOM = [{"name": "cf_mom5", "expr": "close / delay(close, 5) - 1", "group": "custom"}]


def test_backtest_scoring_field_reports_actual_caliber(tmp_path):
    """scoring 字段如实回传本次实际口径(红线#3:前端据此标注出处,不混淆模型/等权)。"""
    cache = tmp_path / "cache"
    dates = _dates(40)
    _setup(cache, dates)
    kw = dict(
        codes=CODES, trading_dates=dates, backtest_start=dates[26], backtest_end=dates[38],
        train_end=dates[19], purge=5, params={"buy_threshold": 0.0, "max_holdings": 3},
    )
    assert run_backtest(DataLayer(cache), **kw).scoring == "equal_weight"  # 默认纯内置因子等权
    assert run_backtest(DataLayer(cache), model=_MODEL_MOM, **kw).scoring == "model"
    assert run_backtest(DataLayer(cache), custom=_CUSTOM_MOM, **kw).scoring == "custom"
    # 模型优先于自定义(与 run_eod 一致):同时给则口径为 model。
    assert run_backtest(DataLayer(cache), model=_MODEL_MOM, custom=_CUSTOM_MOM, **kw).scoring == "model"
    # 空自定义列表退化为等权(不虚标 custom)。
    assert run_backtest(DataLayer(cache), custom=[], **kw).scoring == "equal_weight"


def test_backtest_model_coef_drives_selection(tmp_path):
    """模型系数真正驱动选股(而非等权):正负系数选出不同股票,证明是模型而非内置等权在打分。"""
    cache = tmp_path / "cache"
    dates = _dates(40)
    _setup(cache, dates)
    kw = dict(
        codes=CODES, trading_dates=dates, backtest_start=dates[26], backtest_end=dates[38],
        train_end=dates[19], purge=5, params={"buy_threshold": 0.0, "max_holdings": 2},
    )
    pos = run_backtest(DataLayer(cache), model={**_MODEL_MOM, "coef": [1.0]}, **kw)
    neg = run_backtest(DataLayer(cache), model={**_MODEL_MOM, "coef": [-1.0]}, **kw)
    buys_pos = {t["code"] for t in pos.trades if t["side"] == "buy"}
    buys_neg = {t["code"] for t in neg.trades if t["side"] == "buy"}
    assert buys_pos and buys_neg
    assert buys_pos != buys_neg  # 系数反号 → 选股不同 → 确是模型系数在驱动,而非等权


def test_backtest_model_truncation_invariance(tmp_path):
    """黄金测试(红线#1):以模型打分回测,只依赖 <=(回测末日 T+1)的数据;追加更远未来数据
    不改变 nav/成交数/成本。模型系数为训练期固定 JSON,逐日特征经 asof PIT,绝不引入未来。
    (与 test_backtest_truncation_invariance 同构,但走 model= 打分路径以覆盖模型场景。)"""
    dates = _dates(50)
    full = tmp_path / "full"
    _setup(full, dates)
    cutoff = dates[39]
    trunc = tmp_path / "trunc"
    _setup(trunc, dates, max_trade_date=cutoff)

    kw = dict(
        codes=CODES, backtest_start=dates[26], backtest_end=dates[38],
        train_end=dates[19], purge=5, params={"buy_threshold": 0.0, "max_holdings": 3},
        model=_MODEL_MOM,
    )
    r_full = run_backtest(DataLayer(full), trading_dates=dates, **kw)
    r_trunc = run_backtest(DataLayer(trunc), trading_dates=dates[:40], **kw)

    assert r_full.scoring == r_trunc.scoring == "model"
    assert [round(r["nav"], 4) for r in r_full.nav_curve] == [
        round(r["nav"], 4) for r in r_trunc.nav_curve
    ]
    assert r_full.n_trades == r_trunc.n_trades
    assert round(r_full.total_cost, 4) == round(r_trunc.total_cost, 4)


def test_backtest_model_train_window_no_overlap(tmp_path):
    """红线#2:以模型回测时,硬守卫 is_oos_clean 照样拒跑重叠区间 —— 模型在场绝不绕过守卫。
    (补「模型 + 非法样本外区间」跨层组合的测试盲点:证明模型路径的样本外纪律不弱于纯因子路径。)"""
    cache = tmp_path / "cache"
    dates = _dates(40)
    _setup(cache, dates)
    # backtest_start 落在 purge=5 隔离区内 → 即便给了模型也必须拒跑(否则=拿训练窗口样本回测)。
    with pytest.raises(BacktestGuardError):
        run_backtest(
            DataLayer(cache),
            codes=CODES,
            trading_dates=dates,
            backtest_start=dates[20],
            backtest_end=dates[38],
            train_end=dates[19],
            purge=5,
            model=_MODEL_MOM,
        )


def test_backtest_custom_factor_truncation_invariance(tmp_path):
    """黄金测试(红线#1):以自定义 DSL 因子回测同样 PIT —— 仅回看算子(delay)+ asof 面板,
    结构上写不出前视;追加远未来数据不改变 nav/成交。自定义因子接入回测口径的穿越护栏。"""
    dates = _dates(50)
    full = tmp_path / "full"
    _setup(full, dates)
    cutoff = dates[39]
    trunc = tmp_path / "trunc"
    _setup(trunc, dates, max_trade_date=cutoff)

    kw = dict(
        codes=CODES, backtest_start=dates[26], backtest_end=dates[38],
        train_end=dates[19], purge=5, params={"buy_threshold": 0.0, "max_holdings": 3},
        custom=_CUSTOM_MOM,
    )
    r_full = run_backtest(DataLayer(full), trading_dates=dates, **kw)
    r_trunc = run_backtest(DataLayer(trunc), trading_dates=dates[:40], **kw)

    assert r_full.scoring == r_trunc.scoring == "custom"
    # 自定义因子确有效驱动(非全降级空跑):区间内确有成交。
    assert r_full.n_trades >= 1
    assert [round(r["nav"], 4) for r in r_full.nav_curve] == [
        round(r["nav"], 4) for r in r_trunc.nav_curve
    ]
    assert r_full.n_trades == r_trunc.n_trades
    assert round(r_full.total_cost, 4) == round(r_trunc.total_cost, 4)
