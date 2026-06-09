"""walk-forward 训练 + 样本内外评估(M3 v1:ElasticNet 线性模型)。

红线落点:
- #1 无未来函数:特征经 features.py(asof,只见 <=T);标签 labels.py 前向收益;**purge 必须 >=
  label_horizon**(否则训练样本的标签前瞻窗会落进测试集特征 → 泄漏)。本模块入口显式硬守卫。
- #2/#3 不虚假/不夸大:训练只在 Fold.train,评估只在 Fold.test(OOS);IC/ICIR 样本内外**并列**返回;
  低 IC 如实返回原值不裁剪。OOS「夏普/年化」用顶分位分层口径(非完整事件驱动回测,诚实标注)。
- #6:engine 只算不落库。模型产物 = 线性系数 JSON(无二进制 pickle、无文件、无外联),由 api 落库。

ElasticNet 在已标准化(per-截面 winsor+zscore)的因子上拟合;模型 = {feature_cols, coef, intercept}。
推理时在某 asof 截面 compute_factor_matrix → f_* → pred = intercept + Σ coef·f。
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Sequence

import numpy as np
import polars as pl
from sklearn.linear_model import ElasticNet

from ..backtest import metrics
from ..backtest.splits import walk_forward
from ..data import DataLayer
from .device import resolve_device
from .features import build_feature_panel
from .labels import build_forward_return_labels


class TrainGuardError(ValueError):
    """训练参数违反红线硬守卫(如 purge < label_horizon)。"""


@dataclass
class TrainResult:
    model_type: str
    train_start: str
    train_end: str
    label_horizon: int
    purge: int
    embargo: int
    train_span: int
    test_span: int
    n_folds: int
    n_samples: int
    feature_cols: list[str]
    # 样本内外并列(红线#3):RankIC 均值 + ICIR
    ic_is: float
    ic_oos: float
    icir_is: float
    icir_oos: float
    # OOS 顶分位分层口径(非完整回测,诚实标注随字段名 + metrics_note 一并下发)
    layered_sharpe_oos: float
    layered_annual_return_oos: float
    top_quantile: float
    metrics_note: str
    feature_importance: list[dict]  # [{feature, weight}](|coef| 归一)
    fold_metrics: list[dict]  # [{index, n_train, n_test, ic_oos}]
    model: dict  # {type, feature_cols, coef, intercept, alpha, l1_ratio, label_horizon}
    degraded: list[str]
    oos_clean: bool
    device: str = "cpu"
    num_threads: int = 1

    def to_dict(self) -> dict:
        return asdict(self)


def _per_date_ic(df: pl.DataFrame, model: ElasticNet, usable: list[str]) -> list[float]:
    """逐日 RankIC(预测分 vs 实际前向收益),只在传入截面内算。"""
    ics: list[float] = []
    for d in sorted(set(df["date"].to_list())):
        sub = df.filter(pl.col("date") == d)
        if sub.height < 2:
            continue
        pred = model.predict(sub.select(usable).to_numpy())
        ics.append(metrics.rank_ic(pred.tolist(), sub["label"].to_list()))
    return ics


def _top_quantile_returns(
    df: pl.DataFrame, model: ElasticNet, usable: list[str], q: float
) -> list[tuple[str, float]]:
    """每个测试日:按预测分取前 q 分位等权,组合的未来 horizon 收益 = 选中股 label 均值。"""
    out: list[tuple[str, float]] = []
    for d in sorted(set(df["date"].to_list())):
        sub = df.filter(pl.col("date") == d)
        if sub.height < 2:
            continue
        pred = model.predict(sub.select(usable).to_numpy())
        labels = np.asarray(sub["label"].to_list(), dtype=float)
        k = max(1, int(round(sub.height * q)))
        top = np.argsort(pred)[::-1][:k]
        out.append((d, float(labels[top].mean())))
    return out


def _fit(X: np.ndarray, y: np.ndarray, alpha: float, l1_ratio: float) -> ElasticNet:
    return ElasticNet(alpha=alpha, l1_ratio=l1_ratio, max_iter=5000, tol=1e-4).fit(X, y)


def run_train(
    data: DataLayer,
    *,
    codes: Sequence[str],
    trading_dates: Sequence[str],
    train_start: str,
    train_end: str,
    label_horizon: int = 5,
    purge: int | None = None,
    embargo: int = 0,
    train_span: int = 252,
    test_span: int = 63,
    model_type: str = "elasticnet",
    alpha: float = 0.001,
    l1_ratio: float = 0.5,
    top_quantile: float = 0.2,
    train_threads: str | int = "auto",
    device: str = "auto",
) -> TrainResult:
    if model_type != "elasticnet":
        raise ValueError(f"M3 v1 仅支持 model_type=elasticnet,收到 {model_type}")
    if label_horizon < 1:
        raise ValueError("label_horizon 必须 >= 1")
    if purge is None:
        purge = label_horizon
    # ── 红线#1 硬守卫:purge 必须 >= label_horizon(M2 遗留要求)──────────────
    if purge < label_horizon:
        raise TrainGuardError(
            f"purge={purge} 必须 >= label_horizon={label_horizon};"
            f"否则训练样本的前瞻标签窗会泄漏进测试集特征(未来函数)。"
        )

    cfg = resolve_device(train_threads, device)
    tds = sorted(set(trading_dates))
    train_dates = [d for d in tds if train_start <= d <= train_end]
    if len(train_dates) < 2:
        raise ValueError("训练区间交易日不足(至少 2 日)")

    # 特征面板(仅训练日,asof PIT)+ 前向标签(全历史,内部用未来价但严不混入特征)。
    fp = build_feature_panel(data, codes, train_dates)
    labels = build_forward_return_labels(data, codes, label_horizon)
    samples = fp.panel.join(labels, on=["date", "stock_code"], how="left")

    # 全局丢弃「整列无有效值」的特征(如免费源缺北向),诚实记录降级。
    usable = [c for c in fp.feature_cols if samples[c].drop_nulls().len() > 0]
    if not usable:
        raise ValueError("无可用特征列(因子全部降级);请检查数据缓存覆盖。")

    # purge 须真正参与切分:walk_forward 在 train 尾剔 label_horizon+embargo;若用户为求保守传了
    # 更大的 purge,放大 embargo 使实际隔离 = max(label_horizon+embargo, purge),令回显 purge 名副其实。
    effective_embargo = max(embargo, purge - label_horizon)
    folds = walk_forward(
        train_dates,
        train_span=train_span,
        test_span=test_span,
        label_horizon=label_horizon,
        embargo=effective_embargo,
    )
    if not folds:
        raise ValueError(
            f"训练区间({len(train_dates)} 交易日)不足以构造 walk-forward 折"
            f"(train_span={train_span}/test_span={test_span});请扩大区间或缩小 span。"
        )

    ic_is_series: list[float] = []
    ic_oos_series: list[float] = []
    oos_layered: list[tuple[str, float]] = []
    fold_metrics: list[dict] = []

    for fold in folds:
        tr = samples.filter(pl.col("date").is_in(set(fold.train))).drop_nulls(
            subset=[*usable, "label"]
        )
        te = samples.filter(pl.col("date").is_in(set(fold.test))).drop_nulls(
            subset=[*usable, "label"]
        )
        if tr.height < 10 or te.height < 2:
            continue
        model = _fit(tr.select(usable).to_numpy(), tr["label"].to_numpy(), alpha, l1_ratio)
        is_ics = _per_date_ic(tr, model, usable)
        oos_ics = _per_date_ic(te, model, usable)
        ic_is_series.extend(is_ics)
        ic_oos_series.extend(oos_ics)
        oos_layered.extend(_top_quantile_returns(te, model, usable, top_quantile))
        fold_metrics.append(
            {
                "index": fold.index,
                "n_train": tr.height,
                "n_test": te.height,
                "ic_oos": round(sum(oos_ics) / len(oos_ics), 4) if oos_ics else 0.0,
            }
        )

    # OOS 分层收益 → 非重叠抽样(每 horizon 个测试日取一)→ 夏普 / 年化(诚实口径标注)。
    oos_layered.sort(key=lambda x: x[0])
    sampled = [r for i, (_, r) in enumerate(oos_layered) if i % label_horizon == 0]
    if len(sampled) >= 2:
        nav = [1.0]
        for r in sampled:
            nav.append(nav[-1] * (1.0 + r))
        periods = max(1, round(252 / label_horizon))
        sharpe_oos = metrics.sharpe(metrics.daily_returns(nav), periods=periods)
        annual_oos = metrics.cagr(nav, periods=periods)
    else:
        sharpe_oos = 0.0
        annual_oos = 0.0

    # 最终模型:全训练段重训(去掉无标签的尾部),系数 = 特征重要度 + 推理参数。
    allsamp = samples.filter(pl.col("date").is_in(set(train_dates))).drop_nulls(
        subset=[*usable, "label"]
    )
    final = _fit(allsamp.select(usable).to_numpy(), allsamp["label"].to_numpy(), alpha, l1_ratio)
    coef = [float(c) for c in final.coef_]
    intercept = float(final.intercept_)
    denom = sum(abs(c) for c in coef) or 1.0
    feature_importance = sorted(
        [{"feature": usable[i], "weight": round(abs(coef[i]) / denom, 4)} for i in range(len(usable))],
        key=lambda x: x["weight"],
        reverse=True,
    )

    degraded = [
        f"{name}:{n}/{fp.n_dates} 天降级(数据缺失)" for name, n in sorted(fp.degraded_days.items())
    ]

    return TrainResult(
        model_type=model_type,
        train_start=train_start,
        train_end=train_end,
        label_horizon=label_horizon,
        purge=purge,
        embargo=embargo,
        train_span=train_span,
        test_span=test_span,
        n_folds=len(fold_metrics),
        n_samples=allsamp.height,
        feature_cols=usable,
        ic_is=round(sum(ic_is_series) / len(ic_is_series), 4) if ic_is_series else 0.0,
        ic_oos=round(sum(ic_oos_series) / len(ic_oos_series), 4) if ic_oos_series else 0.0,
        icir_is=round(metrics.icir(ic_is_series), 4),
        icir_oos=round(metrics.icir(ic_oos_series), 4),
        layered_sharpe_oos=round(sharpe_oos, 4),
        layered_annual_return_oos=round(annual_oos, 4),
        top_quantile=top_quantile,
        metrics_note=(
            "样本外 IC/ICIR 为逐日 RankIC 口径;夏普/年化为顶分位等权分层口径"
            "(按 horizon 非重叠抽样,无交易成本/换手/T+1 撮合),非完整事件驱动回测,勿读作策略真实收益。"
        ),
        feature_importance=feature_importance,
        fold_metrics=fold_metrics,
        model={
            "type": model_type,
            "feature_cols": usable,
            "coef": coef,
            "intercept": intercept,
            "alpha": alpha,
            "l1_ratio": l1_ratio,
            "label_horizon": label_horizon,
        },
        degraded=degraded,
        oos_clean=len(fold_metrics) > 0,
        device=cfg.device,
        num_threads=cfg.num_threads,
    )
