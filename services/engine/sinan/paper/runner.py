"""盘后编排 run_eod:打分 → 风控决策 → 信号(含被拦截组)→ T+1 开盘价撮合 → 记账/当日收益。

信号 T 日盘后生成(effective_date=T+1);撮合用 T+1 开盘价。被风控拦截的候选单独成组
(blocked=1 + reason),供信号页「已生成但被拦截」教育用户纪律高于模型。
所有取数经 DataLayer(PIT);engine 不写 SQLite,结果由 api 回传落库。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Mapping, Sequence

import polars as pl

from ..data import DataLayer
from ..factors import FactorContext, score_universe
from .account import SimAccount, Trade
from .eod import DEFAULTS, apply_fills, decide


@dataclass
class GeneratedSignal:
    stock_code: str
    action: str  # buy / sell / hold
    score: float | None
    reason: str
    blocked: bool
    factor_breakdown: dict[str, float]


@dataclass
class EodResult:
    trade_date: str
    effective_date: str
    market_open: bool
    signals: list[GeneratedSignal]
    trades: list[Trade]
    account: dict
    coverage: float
    degraded: list[str]


def _breakdown(row: dict) -> dict[str, float]:
    return {k[2:]: v for k, v in row.items() if k.startswith("f_") and v is not None}


def run_eod(
    *,
    data: DataLayer,
    codes: Sequence[str],
    today: str,
    effective_date: str,
    account: SimAccount,
    bench_closes: Sequence[float],
    prices_today: Mapping[str, float],
    open_prices_next: Mapping[str, float],
    params: dict | None = None,
    liquid: set[str] | None = None,
    prev_nav: float | None = None,
    peak_nav: float | None = None,
) -> EodResult:
    p = {**DEFAULTS, **(params or {})}
    ctx = FactorContext(data, today, codes)
    sr = score_universe(ctx)
    scores = sr.scores
    score_rows = {r["stock_code"]: r for r in scores.iter_rows(named=True)}

    plan = decide(
        scores, account,
        prices_today=prices_today, bench_closes=bench_closes,
        today=today, effective_date=effective_date,
        params=p, liquid=liquid if liquid is not None else set(codes),
    )

    signals: list[GeneratedSignal] = []
    chosen = {o.code for o in plan.buys}
    held = set(account.positions)

    for o in plan.buys:
        row = score_rows.get(o.code, {})
        signals.append(GeneratedSignal(o.code, "buy", row.get("score"), o.reason, False, _breakdown(row)))
    for o in plan.sells:
        row = score_rows.get(o.code, {})
        signals.append(GeneratedSignal(o.code, "sell", row.get("score"), o.reason, False, {}))

    # 被拦截组:过阈值且流动性合格、未持有、未入选 → 因择时/持仓上限被拦。
    if "percentile" in scores.columns:
        ranked = scores.filter(pl.col("percentile") >= p["buy_threshold"]).sort(
            "score", descending=True, nulls_last=True
        )
        for r in ranked.iter_rows(named=True):
            code = r["stock_code"]
            if code in chosen or code in held:
                continue
            if liquid is not None and code not in liquid:
                continue
            reason = "market_filter" if not plan.market_open else "rank_out"
            signals.append(GeneratedSignal(code, "buy", r["score"], reason, True, _breakdown(r)))

    # T+1 开盘价撮合。
    apply_fills(account, plan, open_prices_next)

    mark = {**prices_today, **open_prices_next}
    nav = account.nav(mark)
    daily_return = (nav / prev_nav - 1.0) if prev_nav else None
    peak = max(peak_nav or nav, nav)
    drawdown = (nav - peak) / peak if peak else 0.0

    account_state = {
        "cash": account.cash,
        "market_value": account.holdings_value(mark),
        "nav": nav,
        "daily_return": daily_return,
        "drawdown": drawdown,
        "peak": peak,
    }
    return EodResult(
        trade_date=today, effective_date=effective_date, market_open=plan.market_open,
        signals=signals, trades=list(account.trades), account=account_state,
        coverage=sr.coverage, degraded=sr.degraded,
    )
