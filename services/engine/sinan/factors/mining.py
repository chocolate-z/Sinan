"""自动挖因子(公式搜索):在候选公式里按【训练集】IC 选,再在【没碰过的样本外窗】如实报业绩。

🔴 红线#3(数据窥探):搜一堆公式挑最高 IC,纯噪声也能挑出高 IC。所以这里把流程钉死成
「训练集选 → 样本外报」:① 候选只在 train 窗算 ICIR 选 top-K;② top-K 只在 oos 窗(与 train
不相交、且隔开 purge 防标签前瞻泄漏)重算 IC 如实下发。报告必带「测了多少个候选 + 只信 OOS 列」
的警示。选出来的就是 DSL 表达式,用户可一键存成自定义因子(复用现成机制)。

红线#1:候选全是仅回看的 DSL(operators 没有前视算子),IC 经 factor_quality(asof PIT)算,
结构上写不出未来函数;穿越由 factor_quality / 自定义因子的既有黄金测试覆盖。
"""

from __future__ import annotations

from typing import Callable, Optional, Sequence

from ..data import DataLayer
from .quality import factor_quality


class MiningGuardError(ValueError):
    """挖因子的窗口违反诚实样本外(train/oos 重叠或隔离不足)。"""


def generate_candidates() -> list[dict]:
    """生成一批可解释的候选公式(name/expr/group),全用 DSL 白名单字段与仅回看算子。

    刻意做成【有界、可解释】的模板网格(估值/规模/动量/反转/波动/流动性/资金流/技术),
    不做无界随机搜索 —— 候选越多,多重检验越容易挖出噪声。当前约几十个。
    """
    c: list[dict] = []

    def add(name: str, expr: str, group: str) -> None:
        c.append({"name": name, "expr": expr, "group": group})

    # 估值(倒数,越高越便宜)
    for f, nm in (("pe_ttm", "ep"), ("pb", "bp"), ("ps_ttm", "sp")):
        add(f"cand_{nm}", f"where({f} > 0, 1 / {f}, 0)", "value")
    add("cand_dy", "dv_ttm", "value")
    # 规模(小盘,取负)
    add("cand_size_circ", "0 - where(circ_mv > 0, log(circ_mv), 0)", "size")
    add("cand_size_total", "0 - where(total_mv > 0, log(total_mv), 0)", "size")
    # 质量
    add("cand_roe", "roe", "quality")
    # 动量(多周期)
    for n in (5, 10, 20, 60):
        add(f"cand_mom{n}", f"close / delay(close, {n}) - 1", "momentum")
    # 反转(短周期,取负)
    for n in (3, 5):
        add(f"cand_rev{n}", f"0 - (close / delay(close, {n}) - 1)", "reversal")
    # 波动(日收益标准差,取负 → 低波动占优)
    for n in (20, 60):
        add(f"cand_vol{n}", f"0 - ts_std(close / delay(close, 1) - 1, {n})", "volatility")
    # 流动性(换手,取负 → 低换手占优)+ 换手变化
    for n in (20, 60):
        add(f"cand_turn{n}", f"0 - ts_mean(turnover_rate, {n})", "liquidity")
    add("cand_turn_chg20", "ts_delta(turnover_rate, 20)", "liquidity")
    # 技术(乖离两向 + RSI)
    add("cand_bias20", "close / ma(close, 20) - 1", "technical")
    add("cand_bias20_rev", "0 - (close / ma(close, 20) - 1)", "technical")
    add("cand_rsi14", "rsi(close, 14)", "technical")
    # 量能(成交额趋势)
    add("cand_amt_mom20", "amount / delay(amount, 20) - 1", "technical")
    # 日内振幅(取负)
    add("cand_range20", "0 - ts_mean((high - low) / close, 20)", "volatility")
    # 资金流(北向变动,多周期)
    for n in (5, 20):
        add(f"cand_north_chg{n}", f"ts_delta(north_hold_ratio, {n})", "northbound")
    return c


def _date_index(trading_dates: Sequence[str], d: str) -> int:
    """d 在交易日历里的位置(用 bisect 找最近不晚于 d 的那天的下标)。"""
    import bisect

    i = bisect.bisect_right(sorted(set(trading_dates)), d) - 1
    return i


def mine_factors(
    data: DataLayer,
    *,
    codes: Sequence[str],
    trading_dates: Sequence[str],
    train_start: str,
    train_end: str,
    oos_start: str,
    oos_end: str,
    label_horizon: int = 5,
    purge: int | None = None,
    top_k: int = 10,
    candidates: list[dict] | None = None,
    on_progress: Optional[Callable[[dict], None]] = None,
    feature_workers: int | str | None = 1,
) -> dict:
    """候选公式 → 训练集选 top-K → 样本外如实报 IC。train/oos 必须不相交且隔开 purge(红线#3/#1)。"""
    purge = purge if purge is not None else label_horizon
    if label_horizon < 1:
        raise ValueError("label_horizon 必须 >= 1")
    if not (train_start <= train_end) or not (oos_start <= oos_end):
        raise MiningGuardError("窗口起止颠倒")

    tds = sorted(set(trading_dates))
    # 硬守卫:oos 起点必须在 train 截止之后、且隔开至少 purge 个交易日 —— 否则训练标签的前瞻窗
    # 会够到 oos 特征期,等于「选的时候偷看了样本外」(数据窥探 + 标签泄漏)。
    ti = _date_index(tds, train_end)
    oi = _date_index(tds, oos_start)
    if ti < 0 or oi < 0:
        raise MiningGuardError("train_end / oos_start 不在交易日历内(先建缓存)")
    if oi - ti < purge:
        raise MiningGuardError(
            f"oos_start 距 train_end 仅 {oi - ti} 个交易日,需 >= purge({purge}),"
            f"否则训练标签前瞻窗泄漏进样本外。请把样本外窗往后推。"
        )

    cands = candidates if candidates is not None else generate_candidates()
    train_dates = [d for d in tds if train_start <= d <= train_end]
    oos_dates = [d for d in tds if oos_start <= d <= oos_end]
    if len(train_dates) < 2 or len(oos_dates) < 2:
        raise MiningGuardError("训练窗或样本外窗交易日不足(各至少 2 日)")

    def _emit(ev: dict) -> None:
        if on_progress:
            try:
                on_progress(ev)
            except Exception:  # noqa: BLE001 — 进度上报绝不影响计算
                pass

    # ① 训练集上逐候选算 IC/ICIR(只用 train 窗,factors=[] → 只评候选,不带内置)。
    _emit({"stage": "select", "n_candidates": len(cands), "message": f"训练集评 {len(cands)} 个候选"})
    train_q, _td = factor_quality(
        data, codes, train_dates, factors=[], custom=cands,
        label_horizon=label_horizon, on_progress=on_progress, feature_workers=feature_workers,
    )
    # 按训练 ICIR 降序选 top-K(NaN 当 -inf 沉底;诚实:训练 IC 高不代表真有效,下一步样本外检验)。
    def _key(r) -> float:
        v = r.icir
        return v if v == v else float("-inf")  # NaN != NaN

    ranked = sorted(train_q, key=_key, reverse=True)[: max(1, top_k)]
    top_names = {r.name for r in ranked}
    top_cands = [c for c in cands if c["name"] in top_names]

    # ② 样本外窗(没参与选择)上重算 top-K 的 IC —— 这才是诚实业绩。
    _emit({"stage": "oos", "n_top": len(top_cands), "message": f"样本外检验 top-{len(top_cands)}"})
    oos_q, _od = factor_quality(
        data, codes, oos_dates, factors=[], custom=top_cands,
        label_horizon=label_horizon, on_progress=on_progress, feature_workers=feature_workers,
    )
    oos_by = {r.name: r for r in oos_q}
    expr_by = {c["name"]: c["expr"] for c in cands}
    group_by = {c["name"]: c.get("group", "custom") for c in cands}

    results = []
    for r in ranked:
        o = oos_by.get(r.name)
        results.append(
            {
                "name": r.name,
                "expr": expr_by.get(r.name, ""),
                "group": group_by.get(r.name, "custom"),
                "train_ic": r.ic_mean,
                "train_icir": r.icir,
                "train_coverage": r.coverage,
                "oos_ic": o.ic_mean if o else None,
                "oos_icir": o.icir if o else None,
                "oos_coverage": o.coverage if o else None,
            }
        )

    return {
        "candidates_tested": len(cands),
        "top_k": len(results),
        "train_window": [train_start, train_end],
        "oos_window": [oos_start, oos_end],
        "label_horizon": label_horizon,
        "purge": purge,
        "results": results,
        "warning": (
            f"在 {len(cands)} 个候选里按【训练集】ICIR 选 top-{len(results)};测的候选越多,训练 IC "
            f"越容易被运气抬高(数据窥探)。只信【样本外】列:OOS IC/ICIR 仍显著才有意义,"
            f"训练高、样本外塌 = 过拟合噪声。样本外窗与训练窗不相交且隔开 {purge} 个交易日(防标签泄漏)。"
        ),
    }
