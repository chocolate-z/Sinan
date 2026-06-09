"""绩效指标全集(日频口径)。纯函数,无第三方依赖(stdlib statistics/math)。

红线#3:报告指标一律样本外口径(由调用层用 splits 保证);此处只做数值口径定义。
口径对齐设计蓝图「绩效指标」表:年化/超额/MaxDD/Sharpe/IR/跟踪误差/换手/胜率/盈亏比/Calmar/RankIC/ICIR。
"""

from __future__ import annotations

import math
from statistics import mean, pstdev
from typing import Mapping, Sequence


def daily_returns(nav: Sequence[float]) -> list[float]:
    """净值序列 → 日收益率(长度 = len(nav)-1)。"""
    return [nav[i] / nav[i - 1] - 1.0 for i in range(1, len(nav)) if nav[i - 1] != 0]


def cagr(nav: Sequence[float], periods: int = 252) -> float:
    """年化收益(几何)。需 nav 首尾为正、长度≥2,否则 0。"""
    if len(nav) < 2 or nav[0] <= 0 or nav[-1] <= 0:
        return 0.0
    years = (len(nav) - 1) / periods
    if years <= 0:
        return 0.0
    return (nav[-1] / nav[0]) ** (1.0 / years) - 1.0


def total_return(nav: Sequence[float]) -> float:
    if len(nav) < 2 or nav[0] <= 0:
        return 0.0
    return nav[-1] / nav[0] - 1.0


def max_drawdown(nav: Sequence[float]) -> float:
    """最大回撤(正数):max_t (峰值−净值_t)/峰值。"""
    peak = float("-inf")
    mdd = 0.0
    for v in nav:
        if v > peak:
            peak = v
        if peak > 0:
            dd = (peak - v) / peak
            if dd > mdd:
                mdd = dd
    return mdd


def sharpe(returns: Sequence[float], rf: float = 0.0, periods: int = 252) -> float:
    """夏普:(年化收益−rf)/年化波动,rf 默认 0。波动为 0 或样本不足 → 0。"""
    if len(returns) < 2:
        return 0.0
    daily_rf = rf / periods
    excess = [r - daily_rf for r in returns]
    sd = pstdev(excess)
    if sd == 0:
        return 0.0
    return mean(excess) / sd * math.sqrt(periods)


def tracking_error(excess_returns: Sequence[float], periods: int = 252) -> float:
    """跟踪误差:超额日收益标准差 × √periods。"""
    if len(excess_returns) < 2:
        return 0.0
    return pstdev(excess_returns) * math.sqrt(periods)


def information_ratio(
    port_returns: Sequence[float], bench_returns: Sequence[float], periods: int = 252
) -> float:
    """信息比率:年化超额 / 跟踪误差。目标 0.5–1.0。"""
    n = min(len(port_returns), len(bench_returns))
    if n < 2:
        return 0.0
    ex = [port_returns[i] - bench_returns[i] for i in range(n)]
    te = tracking_error(ex, periods)
    if te == 0:
        return 0.0
    return (mean(ex) * periods) / te


def turnover(prev_w: Mapping[str, float], new_w: Mapping[str, float]) -> float:
    """单次调仓换手:Σ|权重变动| / 2(双边)。"""
    codes = set(prev_w) | set(new_w)
    return 0.5 * sum(abs(new_w.get(c, 0.0) - prev_w.get(c, 0.0)) for c in codes)


def win_rate(pnls: Sequence[float]) -> float:
    """胜率:盈利交易数 / 总交易数。"""
    if not pnls:
        return 0.0
    return sum(1 for p in pnls if p > 0) / len(pnls)


def profit_factor(pnls: Sequence[float]) -> float:
    """盈亏比:Σ盈利 / |Σ亏损|。无亏损且有盈利 → inf;无盈利 → 0。"""
    gains = sum(p for p in pnls if p > 0)
    losses = -sum(p for p in pnls if p < 0)
    if losses == 0:
        return math.inf if gains > 0 else 0.0
    return gains / losses


def calmar(annual_return: float, mdd: float) -> float:
    """Calmar:年化收益 / 最大回撤。mdd≤0 → 0。"""
    if mdd <= 0:
        return 0.0
    return annual_return / mdd


def _average_rank(xs: Sequence[float]) -> list[float]:
    """平均秩(并列取平均,1-based)。"""
    order = sorted(range(len(xs)), key=lambda i: xs[i])
    ranks = [0.0] * len(xs)
    i = 0
    while i < len(xs):
        j = i
        while j + 1 < len(xs) and xs[order[j + 1]] == xs[order[i]]:
            j += 1
        avg = (i + j) / 2.0 + 1.0
        for k in range(i, j + 1):
            ranks[order[k]] = avg
        i = j + 1
    return ranks


def _pearson(a: Sequence[float], b: Sequence[float]) -> float:
    n = len(a)
    if n < 2:
        return 0.0
    ma, mb = mean(a), mean(b)
    cov = sum((a[i] - ma) * (b[i] - mb) for i in range(n))
    va = sum((a[i] - ma) ** 2 for i in range(n))
    vb = sum((b[i] - mb) ** 2 for i in range(n))
    if va == 0 or vb == 0:
        return 0.0
    return cov / math.sqrt(va * vb)


def rank_ic(scores: Sequence[float], forward_returns: Sequence[float]) -> float:
    """RankIC:因子分与未来收益的 Spearman(秩相关)。"""
    n = min(len(scores), len(forward_returns))
    if n < 2:
        return 0.0
    return _pearson(_average_rank(list(scores[:n])), _average_rank(list(forward_returns[:n])))


def icir(ic_series: Sequence[float]) -> float:
    """ICIR:IC 均值 / IC 标准差。"""
    if len(ic_series) < 2:
        return 0.0
    sd = pstdev(ic_series)
    if sd == 0:
        return 0.0
    return mean(ic_series) / sd


def performance(
    nav: Sequence[float],
    bench_nav: Sequence[float] | None = None,
    trade_pnls: Sequence[float] | None = None,
    periods: int = 252,
) -> dict:
    """聚合一份回测/walk-forward 绩效报告。bench_nav 须与 nav 等长。"""
    rets = daily_returns(nav)
    ann = cagr(nav, periods)
    mdd = max_drawdown(nav)
    out: dict = {
        "days": len(nav),
        "total_return": total_return(nav),
        "annual_return": ann,
        "max_drawdown": mdd,
        "sharpe": sharpe(rets, periods=periods),
        "calmar": calmar(ann, mdd),
    }
    if bench_nav is not None and len(bench_nav) == len(nav) and len(nav) >= 2:
        bench_ann = cagr(bench_nav, periods)
        bench_rets = daily_returns(bench_nav)
        ex = [rets[i] - bench_rets[i] for i in range(min(len(rets), len(bench_rets)))]
        out["benchmark_return"] = bench_ann
        out["excess_return"] = ann - bench_ann
        out["tracking_error"] = tracking_error(ex, periods)
        out["information_ratio"] = information_ratio(rets, bench_rets, periods)
    if trade_pnls is not None:
        out["trades"] = len(trade_pnls)
        out["win_rate"] = win_rate(trade_pnls)
        out["profit_factor"] = profit_factor(trade_pnls)
    return out
