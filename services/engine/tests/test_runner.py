"""盘后编排 run_eod 自测:信号产出 + 被拦截组 + T+1 撮合记账 + 当日收益。"""

from sinan.data import DataLayer
from sinan.paper import Position, SimAccount, run_eod
from tests.test_factors import CODES, _build_frames, _dates, _write


def _setup(tmp_path):
    dates = _dates(30)
    T = dates[24]
    eff = dates[25]
    frames = _build_frames(dates)
    cache = tmp_path / "cache"
    _write(cache, frames)
    return DataLayer(cache), T, eff


def _rising(n=25):
    return [100.0 + i for i in range(n)]


def _falling(n=25):
    return [124.0 - i for i in range(n)]


def test_eod_opens_topn_and_blocks_overflow(tmp_path):
    data, T, eff = _setup(tmp_path)
    acc = SimAccount(cash=1_000_000)
    res = run_eod(
        data=data, codes=CODES, today=T, effective_date=eff, account=acc,
        bench_closes=_rising(),
        prices_today={c: 20.0 for c in CODES},
        open_prices_next={c: 20.0 for c in CODES},
        params={"buy_threshold": 0.0, "max_holdings": 5},
        prev_nav=1_000_000,
    )
    assert res.market_open is True
    assert res.coverage == 1.0
    buys = [s for s in res.signals if s.action == "buy" and not s.blocked]
    blocked = [s for s in res.signals if s.blocked]
    assert len(buys) == 5  # 持仓上限
    assert len(blocked) == 1  # 第 6 只被 rank_out 拦截
    assert all(b.reason == "rank_out" for b in blocked)
    # 撮合后建仓 5 只,流水含成本
    assert len(acc.positions) == 5
    assert len(acc.trades) == 5 and all(t.fee_total > 0 for t in acc.trades)
    # 因子分解随买入信号附带
    assert buys[0].factor_breakdown  # 非空
    assert res.account["daily_return"] is not None


def test_eod_builtin_restricts_factors(tmp_path):
    """v2 因子库:run_eod 透传 builtin → 只启用的内置因子进打分,信号因子分解里不出现禁用的因子。"""
    data, T, eff = _setup(tmp_path)
    acc = SimAccount(cash=1_000_000)
    res = run_eod(
        data=data, codes=CODES, today=T, effective_date=eff, account=acc,
        bench_closes=_rising(),
        prices_today={c: 20.0 for c in CODES},
        open_prices_next={c: 20.0 for c in CODES},
        params={"buy_threshold": 0.0, "max_holdings": 5},
        prev_nav=1_000_000,
        builtin={"ep": 1.0, "bp": 1.0},  # 只启用 ep/bp
    )
    buys = [s for s in res.signals if s.action == "buy" and not s.blocked]
    assert buys, "应有买入信号"
    for s in buys:
        assert set(s.factor_breakdown) <= {"ep", "bp"}, "禁用的内置因子不应进入打分"
    assert any(s.factor_breakdown for s in buys)  # 启用的因子确有贡献


def test_eod_market_filter_clears_and_blocks(tmp_path):
    data, T, eff = _setup(tmp_path)
    acc = SimAccount(cash=1_000_000)
    acc.positions["600519.SH"] = Position("600519.SH", 100, 20.0, "2024-01-01", "2024-01-01")
    res = run_eod(
        data=data, codes=CODES, today=T, effective_date=eff, account=acc,
        bench_closes=_falling(),  # 跌破 MA20 → 空仓
        prices_today={c: 20.0 for c in CODES},
        open_prices_next={c: 20.0 for c in CODES},
        params={"buy_threshold": 0.0, "max_holdings": 5},
        prev_nav=1_000_000,
    )
    assert res.market_open is False
    sells = [s for s in res.signals if s.action == "sell"]
    assert any(s.stock_code == "600519.SH" and s.reason == "market_filter" for s in sells)
    # 无新开仓买入信号(全部被拦截 market_filter)
    assert all(s.blocked for s in res.signals if s.action == "buy")
    assert any(s.reason == "market_filter" for s in res.signals if s.action == "buy")
    # 持仓被清
    assert "600519.SH" not in acc.positions


def test_eod_valuation_independent_of_future_open(tmp_path):
    """防未来函数回归:T 日 nav/当日收益只依赖 T 收盘价,与 T+1 开盘价无关。"""
    data, T, eff = _setup(tmp_path)

    def run(open_px):
        acc = SimAccount(cash=1_000_000)
        acc.positions["600519.SH"] = Position("600519.SH", 100, 20.0, "2024-01-01", "2024-01-01")
        return run_eod(
            data=data, codes=CODES, today=T, effective_date=eff, account=acc,
            bench_closes=_rising(),
            prices_today={c: 20.0 for c in CODES},
            open_prices_next=open_px,
            params={"buy_threshold": 0.0, "max_holdings": 5},
            prev_nav=1_000_000,
        )

    a = run({c: 20.0 for c in CODES})
    b = run({c: 999.0 for c in CODES})  # 截然不同的 T+1 开盘价
    assert a.account["nav"] == b.account["nav"], "T 日净值被 T+1 价格影响 → 未来函数"
    assert a.account["daily_return"] == b.account["daily_return"]


def test_eod_degraded_when_no_northbound(tmp_path):
    dates = _dates(30)
    T, eff = dates[24], dates[25]
    frames = _build_frames(dates, with_northbound=False)
    cache = tmp_path / "cache"
    _write(cache, frames)
    acc = SimAccount(cash=1_000_000)
    res = run_eod(
        data=DataLayer(cache), codes=CODES, today=T, effective_date=eff, account=acc,
        bench_closes=_rising(),
        prices_today={c: 20.0 for c in CODES},
        open_prices_next={c: 20.0 for c in CODES},
        params={"buy_threshold": 0.0},
    )
    assert res.coverage < 1.0
    assert any("north" in d for d in res.degraded)
