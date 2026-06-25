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


# ---------- 多重检验:deflated Sharpe(Bailey & López de Prado 2014)----------
# 移植自 alpha-lab(notebook 09)。动机/教训:司南支持自动挖因子/搜参,在 N 个候选里挑出
# "看着最好"的那个,其夏普天然偏高;alpha-lab 实测中一个剔风格后样本外 t=3.1 的因子,
# 正是被 deflated Sharpe(扣 N 次试验)判为不显著而归档。这是红线#3 的统计后盾。


def _norm_cdf(x: float) -> float:
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def _norm_ppf(p: float) -> float:
    """标准正态逆 CDF(Acklam 近似),纯 stdlib。"""
    if p <= 0.0:
        return -math.inf
    if p >= 1.0:
        return math.inf
    a = (-3.969683028665376e01, 2.209460984245205e02, -2.759285104469687e02,
         1.383577518672690e02, -3.066479806614716e01, 2.506628277459239e00)
    b = (-5.447609879822406e01, 1.615858368580409e02, -1.556989798598866e02,
         6.680131188771972e01, -1.328068155288572e01)
    c = (-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e00,
         -2.549732539343734e00, 4.374664141464968e00, 2.938163982698783e00)
    d = (7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e00,
         3.754408661907416e00)
    plow, phigh = 0.02425, 1 - 0.02425
    if p < plow:
        q = math.sqrt(-2 * math.log(p))
        return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1)
    if p > phigh:
        q = math.sqrt(-2 * math.log(1 - p))
        return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1)
    q = p - 0.5
    r = q * q
    return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q / (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1)


def deflated_sharpe(returns: Sequence[float], n_trials: int, var_trials_sr: float) -> float:
    """多重检验打折夏普:返回「真夏普 > 挑最好该有的门槛」的概率(0–1),**>0.95 才算稳健**。

    n_trials = 搜参/挖因子的试验总数;var_trials_sr = 各试验「每期夏普」的方差(挖因子时由各
    候选的每期夏普求方差得到)。试验越多、收益越左偏/肥尾,门槛越高。对象应是「主动收益」
    (有基准时用超额收益序列),因为多重检验罚的是你挑出来的那点 alpha,不是 beta。
    """
    r = list(returns)
    n = len(r)
    if n < 3 or n_trials < 1 or var_trials_sr <= 0:
        return 0.0
    m = mean(r)
    sd = pstdev(r)
    if sd == 0:
        return 0.0
    sr = m / sd  # 每期夏普
    sk = sum((x - m) ** 3 for x in r) / n / sd ** 3
    ku = sum((x - m) ** 4 for x in r) / n / sd ** 4
    g = 0.5772156649015329  # Euler–Mascheroni
    if n_trials >= 2:
        sr0 = math.sqrt(var_trials_sr) * (
            (1 - g) * _norm_ppf(1 - 1.0 / n_trials) + g * _norm_ppf(1 - 1.0 / (n_trials * math.e))
        )
    else:
        sr0 = 0.0  # 单次试验:退化为 Probabilistic Sharpe(对 0 检验)
    denom = math.sqrt(max(1 - sk * sr + (ku - 1) / 4.0 * sr * sr, 1e-9))
    return _norm_cdf((sr - sr0) * math.sqrt(n - 1) / denom)


# ---------- 风格归因(alpha-lab §三③ 口径)----------


def _inv(a: list[list[float]]) -> list[list[float]] | None:
    """方阵求逆(高斯-约当,选主元)。奇异 → None。纯 stdlib。"""
    n = len(a)
    m = [[a[i][j] for j in range(n)] + [1.0 if i == j else 0.0 for j in range(n)] for i in range(n)]
    for col in range(n):
        piv = max(range(col, n), key=lambda r: abs(m[r][col]))
        if abs(m[piv][col]) < 1e-12:
            return None
        m[col], m[piv] = m[piv], m[col]
        pv = m[col][col]
        m[col] = [x / pv for x in m[col]]
        for r in range(n):
            if r != col and m[r][col] != 0.0:
                f = m[r][col]
                m[r] = [m[r][j] - f * m[col][j] for j in range(2 * n)]
    return [row[n:] for row in m]


def _ols(x: list[list[float]], y: list[float]):
    """OLS:x=[n][k](含截距列),y=[n] → (beta[k], tvalues[k], r2)。纯 stdlib 正规方程。"""
    n, k = len(y), len(x[0])
    if n <= k:
        return None
    xtx = [[sum(x[r][i] * x[r][j] for r in range(n)) for j in range(k)] for i in range(k)]
    xty = [sum(x[r][i] * y[r] for r in range(n)) for i in range(k)]
    inv = _inv(xtx)
    if inv is None:
        return None
    beta = [sum(inv[i][j] * xty[j] for j in range(k)) for i in range(k)]
    resid = [y[r] - sum(x[r][j] * beta[j] for j in range(k)) for r in range(n)]
    sse = sum(e * e for e in resid)
    s2 = sse / (n - k)
    se = [math.sqrt(s2 * inv[i][i]) if inv[i][i] > 0 else 0.0 for i in range(k)]
    tvals = [beta[i] / se[i] if se[i] > 0 else 0.0 for i in range(k)]
    ybar = mean(y)
    sst = sum((v - ybar) ** 2 for v in y)
    r2 = 1.0 - sse / sst if sst > 0 else 0.0
    return beta, tvals, r2


def style_attribution(
    excess_returns: Sequence[float],
    style_returns: Mapping[str, Sequence[float]],
    periods: int = 252,
) -> dict:
    """风格归因:策略(每期)超额收益 ~ α + Σ风格因子多空收益。

    剔掉【市场/规模/价值/质量/反转/低波…】后,残余 α(截距)显著为正才算「独有 alpha」;
    α 不显著或为负 = 超额 ≈ 已知风格 beta 的暴露,**没有独有 alpha**(诚实告知「你在赌什么」)。
    style_returns: {风格名: 每期多空收益},与 excess_returns 等长。
    """
    names = list(style_returns)
    if not names:
        return {"alpha_annual": 0.0, "t": 0.0, "r2": 0.0, "exposures": {}, "verdict": "无风格序列"}
    n = min([len(excess_returns)] + [len(style_returns[s]) for s in names])
    if n < len(names) + 3:
        return {"alpha_annual": 0.0, "t": 0.0, "r2": 0.0, "exposures": {}, "verdict": "样本不足"}
    y = [excess_returns[i] for i in range(n)]
    x = [[1.0] + [style_returns[s][i] for s in names] for i in range(n)]
    res = _ols(x, y)
    if res is None:
        return {"alpha_annual": 0.0, "t": 0.0, "r2": 0.0, "exposures": {}, "verdict": "不可估(共线)"}
    beta, tvals, r2 = res
    alpha_ann, t_alpha = beta[0] * periods, tvals[0]
    if t_alpha > 2.0 and beta[0] > 0:
        verdict = "剔风格后仍有显著正 α(疑似独有 alpha,须再过 deflated Sharpe)"
    elif t_alpha < -2.0:
        verdict = "剔风格后 α 显著为负 = 纯风格 beta 暴露"
    else:
        verdict = "剔风格后 α 不显著 = 超额≈已知风格 beta,无独有 alpha"
    return {
        "alpha_annual": alpha_ann,
        "t": t_alpha,
        "r2": r2,
        "exposures": {names[i]: beta[i + 1] for i in range(len(names))},
        "verdict": verdict,
    }


def honest_verdict(excess_return: float, information_ratio: float) -> str:
    """从「超额 + IR」自动给一句白话判词,根治"被绝对收益误导"(红线#3)。

    动机:绝对年化是绿的(含 beta),不代表跑赢了基准;真正该看的是超额与 IR。
    例:超额 −2.45%、IR −0.08 → "跑输基准",而非看着 +13.68% 以为不错。
    """
    if excess_return <= 0 or information_ratio <= 0:
        return "跑输/打平基准:无超额——绝对收益是 beta,别被它误导(看超额与 IR)"
    if information_ratio < 0.5:
        return "微弱超额但 IR<0.5(未达目标):大概率是噪声/风格暴露,不稳健"
    if information_ratio <= 1.0:
        return "达目标区间 IR 0.5–1.0:略跑赢基准——多半是风格 beta 而非独有 alpha,做风格归因确认"
    return "IR>1 异常偏高:警惕未来函数/过拟合/样本过短,先自查诚实口径"


def performance(
    nav: Sequence[float],
    bench_nav: Sequence[float] | None = None,
    trade_pnls: Sequence[float] | None = None,
    periods: int = 252,
    n_trials: int | None = None,
    var_trials_sr: float | None = None,
    style_returns: Mapping[str, Sequence[float]] | None = None,
) -> dict:
    """聚合一份回测/walk-forward 绩效报告。bench_nav 须与 nav 等长。

    诚实增强(alpha-lab 蓝本,对应红线#3):
    - 给 n_trials + var_trials_sr → 附 `deflated_sharpe`(搜参/挖因子后「这点超额是真的吗」);
    - 给 style_returns → 附 `style_attribution`(剔已知风格后残余 α,答「你在赌什么」)。
    二者皆向后兼容(不传则报告维持原状)。
    """
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
    edge = rets  # deflated Sharpe 的对象:有基准时用超额(主动收益),否则用原始收益
    if bench_nav is not None and len(bench_nav) == len(nav) and len(nav) >= 2:
        bench_ann = cagr(bench_nav, periods)
        bench_rets = daily_returns(bench_nav)
        ex = [rets[i] - bench_rets[i] for i in range(min(len(rets), len(bench_rets)))]
        edge = ex
        out["benchmark_return"] = bench_ann
        out["excess_return"] = ann - bench_ann
        out["tracking_error"] = tracking_error(ex, periods)
        out["information_ratio"] = information_ratio(rets, bench_rets, periods)
        out["verdict"] = honest_verdict(out["excess_return"], out["information_ratio"])
        if style_returns:
            out["style_attribution"] = style_attribution(ex, style_returns, periods)
    if n_trials is not None and var_trials_sr is not None and len(edge) >= 3:
        out["deflated_sharpe"] = deflated_sharpe(edge, n_trials, var_trials_sr)
    if trade_pnls is not None:
        out["trades"] = len(trade_pnls)
        out["win_rate"] = win_rate(trade_pnls)
        out["profit_factor"] = profit_factor(trade_pnls)
    return out
