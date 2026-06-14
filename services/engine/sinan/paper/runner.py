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
from ..factors import FactorContext, model_score_universe, run_eod_lookback, score_universe
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
    fill: bool = True,
    model: dict | None = None,
    custom: list[dict] | None = None,
) -> EodResult:
    p = {**DEFAULTS, **(params or {})}
    # 有界取数:逐日只取每股最近窗口而非重扫全历史(回测 O(N²)→O(N),PIT 安全、逐值不变)。
    ctx = FactorContext(data, today, codes, lookback=run_eod_lookback(model, custom))
    # 激活的 ML 模型在场 → 用模型线性打分(同一 asof 特征,红线#1);否则等权因子合成(含启用的自定义因子)。
    sr = model_score_universe(ctx, model) if model else score_universe(ctx, custom=custom)
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

    # 红线#1:T 日估值只用 T 收盘价(prices_today),绝不混入 T+1 开盘价。
    # 先按撮合前(T 日实际持有)的组合在 T 收盘估值,得到诚实的当日收益。
    nav = account.nav(prices_today)
    daily_return = (nav / prev_nav - 1.0) if prev_nav else None
    peak = max(peak_nav or nav, nav)
    drawdown = (nav - peak) / peak if peak else 0.0

    # T+1 开盘价仅用于成交撮合,不参与任何 T 日估值(fill=False 则仅出信号、不撮合)。
    if fill:
        apply_fills(account, plan, open_prices_next)

    account_state = {
        # cash / market_value 为撮合后的结转书(供下一日快照),按 T 收盘单一价集估值,仍不含未来。
        "cash": account.cash,
        "market_value": account.holdings_value(prices_today),
        # nav 为当日诚实净值口径(撮合前 @T 收盘),供 daily_pnl 与收益链连续性。
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
