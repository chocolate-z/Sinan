"""事件驱动逐日回测:复用 paper/ 成本·账户·风控,PIT 取数,硬守卫 backtest_start>train_end+purge。

红线#1 无未来函数:每日 data.asof(只见 <=T);复用 run_eod —— T 收盘估值 nav、T+1 开盘价撮合。
红线#2 无虚假回测:守卫拒跑重叠区间;成交一律经 CostModel(印花税0.05%+佣金+冲击),cost_included=True。
红线#3 不夸大:绩效经 metrics.performance(样本外口径),并列基准超额/IR/跟踪误差。
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Sequence

from ..data import DataLayer
from . import metrics
from .splits import is_oos_clean, min_backtest_start


class BacktestGuardError(ValueError):
    """回测区间未通过诚实样本外硬守卫(backtest_start ≤ train_end + purge 个交易日)。"""


@dataclass
class BacktestResult:
    backtest_start: str
    backtest_end: str
    train_end: str
    purge: int
    benchmark: str
    initial_cash: float
    n_days: int
    n_trades: int
    total_cost: float
    cost_included: bool
    # 逐日明细(可回溯):[{date, nav, cash, holding_value, benchmark, day_return, drawdown, positions}]
    # positions = [{code, shares, avg_cost, value}](撮合前 @ T 收盘,与 nav 同口径:cash+holding=nav)
    nav_curve: list[dict]
    # 逐笔成交(买卖点):account.trades 全量(trade_date=撮合日, side, shares, price, fee_total, reason, ...)
    trades: list[dict]
    metrics: dict
    degraded: list[str]

    def to_dict(self) -> dict:
        return asdict(self)


def _price_map(data: DataLayer, dataset: str, asof: str, field: str, codes) -> dict[str, float]:
    df = data.latest_asof(dataset, asof, fields=["stock_code", field], codes=codes)
    if df.is_empty():
        return {}
    return {r["stock_code"]: r[field] for r in df.iter_rows(named=True) if r[field] is not None}


def _next_day(trading_dates: Sequence[str], t: str) -> str | None:
    for d in trading_dates:
        if d > t:
            return d
    return None


def _realized_trade_pnls(trades) -> list[float]:
    """按移动加权成本重放流水,每笔卖出 = 一次已实现盈亏(含买入费摊入成本、卖出费扣减)。

    与 SimAccount 的 avg_cost 记账口径一致(account.py:75-83/99-105);期末未平仓不计入(未实现)。
    供 win_rate / profit_factor 统计(红线#3:如实,亏损也计)。
    """
    pnls: list[float] = []
    cost: dict[str, tuple[int, float]] = {}  # code -> (shares, avg_cost 含买入费)
    for t in trades:
        sh, ac = cost.get(t.code, (0, 0.0))
        if t.side == "buy":
            nsh = sh + t.shares
            basis = sh * ac + t.amount + t.fee_total
            cost[t.code] = (nsh, basis / nsh if nsh else 0.0)
        else:
            pnls.append((t.price - ac) * t.shares - t.fee_total)
            rem = sh - t.shares
            cost[t.code] = (rem, ac) if rem > 0 else (0, 0.0)
    return pnls


def _bench_nav(bench_raw: Sequence[float | None], base_nav: float) -> list[float] | None:
    """把基准收盘序列归一化为与组合同起点的净值;None 前向填充。整段无效 → None。"""
    filled: list[float | None] = []
    last: float | None = None
    for v in bench_raw:
        if v is not None and v > 0:
            last = v
        filled.append(last)
    if not filled or filled[0] is None or filled[0] <= 0:
        return None
    b0 = filled[0]
    return [base_nav * (v if v is not None else b0) / b0 for v in filled]


def run_backtest(
    data: DataLayer,
    *,
    codes: Sequence[str],
    trading_dates: Sequence[str],
    backtest_start: str,
    backtest_end: str,
    train_end: str,
    params: dict | None = None,
    benchmark: str = "000300.SH",
    purge: int = 5,
    initial_cash: float = 1_000_000.0,
    periods: int = 252,
) -> BacktestResult:
    tds = sorted(set(trading_dates))

    # ① 硬守卫(红线#2):回测必须晚于 train_end + purge 个交易日,否则拒跑。
    if not is_oos_clean(backtest_start, train_end, tds, purge):
        floor = min_backtest_start(tds, train_end, purge)
        raise BacktestGuardError(
            f"backtest_start={backtest_start} 必须晚于 train_end={train_end} + purge={purge} "
            f"个交易日(最早合法起点 {floor or '无(交易日不足)'});拒绝非诚实样本外回测。"
        )

    days = [d for d in tds if backtest_start <= d <= backtest_end]
    if len(days) < 2:
        raise ValueError("回测区间交易日不足(至少 2 日)")

    # paper 在函数内延迟 import(避免与 data 的潜在循环;paper 依赖 factors/data)。
    from ..paper import CostModel, SimAccount, run_eod

    account = SimAccount(cash=initial_cash, costs=CostModel.from_config())
    nav_curve: list[dict] = []
    prev_nav = initial_cash
    peak_nav = initial_cash
    degraded_all: set[str] = set()

    # ② 逐日撮合:每日 run_eod(T 收盘估值 → T+1 开盘成交),account 持久滚动。
    for t in days:
        effective = _next_day(tds, t)
        if effective is None:
            break  # 无 T+1,无法 T+1 撮合,结束
        prices_today = _price_map(data, "price", t, "close", codes)
        open_next = _price_map(data, "price", effective, "open", codes) or prices_today
        bench_df = data.asof(
            "index_ohlcv", t, fields=["trade_date", "close"], codes=[benchmark]
        )
        bcloses = bench_df.sort("trade_date")["close"].to_list() if not bench_df.is_empty() else []

        # 撮合前持仓快照 + 现金(与 T 收盘估值同口径:cash + Σ value == nav,无未来函数)。
        cash_before = account.cash
        snapshot = [
            {
                "code": p.code,
                "shares": p.shares,
                "avg_cost": round(p.avg_cost, 4),
                "value": round(p.shares * prices_today.get(p.code, p.avg_cost), 2),
            }
            for p in account.positions.values()
        ]
        holding_value = round(sum(s["value"] for s in snapshot), 2)

        res = run_eod(
            data=data,
            codes=codes,
            today=t,
            effective_date=effective,
            account=account,
            bench_closes=bcloses,
            prices_today=prices_today,
            open_prices_next=open_next,
            params=params or {},
            prev_nav=prev_nav,
            peak_nav=peak_nav,
            fill=True,
        )
        nav_curve.append(
            {
                "date": t,
                "nav": round(res.account["nav"], 2),
                "cash": round(cash_before, 2),
                "holding_value": holding_value,
                "benchmark": bcloses[-1] if bcloses else None,
                "day_return": res.account["daily_return"],
                "drawdown": res.account["drawdown"],
                "positions": snapshot,
            }
        )
        prev_nav = res.account["nav"]
        peak_nav = res.account["peak"]
        degraded_all.update(res.degraded)

    # ③ 绩效(样本外口径)+ 基准归一化净值并写回曲线供前端对比。
    navs = [r["nav"] for r in nav_curve]
    base = navs[0] if navs else initial_cash
    bench_nav = _bench_nav([r["benchmark"] for r in nav_curve], base)
    # 胜率/盈亏比(已平仓)+ 区间单边换手率(Σ成交额 / 2 / 平均净值)。
    trade_pnls = _realized_trade_pnls(account.trades)
    avg_nav = (sum(navs) / len(navs)) if navs else initial_cash
    turnover = sum(tr.amount for tr in account.trades) / (2 * avg_nav) if avg_nav else 0.0
    perf = metrics.performance(navs, bench_nav, trade_pnls=trade_pnls or None, periods=periods)
    perf["turnover"] = round(turnover, 4)
    # 全胜无亏损 → profit_factor=inf,JSON 不安全(api JSON.parse 会崩)→ 置 None(前端显示「全胜」)。
    if perf.get("profit_factor") == float("inf"):
        perf["profit_factor"] = None
    for i, r in enumerate(nav_curve):
        r["benchmark"] = bench_nav[i] if bench_nav else None

    total_cost = sum(t.fee_total for t in account.trades)
    trades = [asdict(tr) for tr in account.trades]  # 逐笔成交(买卖点)
    return BacktestResult(
        backtest_start=backtest_start,
        backtest_end=backtest_end,
        train_end=train_end,
        purge=purge,
        benchmark=benchmark,
        initial_cash=initial_cash,
        n_days=len(nav_curve),
        n_trades=len(account.trades),
        total_cost=total_cost,
        cost_included=True,
        nav_curve=nav_curve,
        trades=trades,
        metrics=perf,
        degraded=sorted(degraded_all),
    )
