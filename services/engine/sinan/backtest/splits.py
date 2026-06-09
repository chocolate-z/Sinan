"""时序切分 + purge/embargo + walk-forward + 回测硬守卫(诚实评估地基,红线#2/#3)。

绝不随机打散:一切按日期顺序。purge 剔除「标签窗口跨越切分边界」的样本——标签看未来
label_horizon 个交易日,边界前 label_horizon 日的样本会用到边界之后的信息(泄漏);embargo
再额外隔离若干日。walk-forward 滚动且只前移,覆盖多周期(跨牛熊)。

回测硬守卫:backtest_start 必须晚于 train_end + purge 个交易日,否则拒跑(由 is_oos_clean 判定)。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Sequence


@dataclass(frozen=True)
class Split:
    train: list[str]
    valid: list[str]
    test: list[str]


@dataclass(frozen=True)
class Fold:
    index: int
    train: list[str]
    test: list[str]


def chronological_split(
    dates: Sequence[str], ratios: tuple[float, float, float] = (0.6, 0.2, 0.2)
) -> Split:
    """按日期顺序切 train/valid/test(绝不打散)。dates 须已排序去重。"""
    if len(ratios) != 3:
        raise ValueError("ratios 须为 (train, valid, test) 三元组")
    if any(r < 0 for r in ratios):
        raise ValueError("ratios 不可为负")
    if abs(sum(ratios) - 1.0) > 1e-9:
        raise ValueError("ratios 之和须为 1")
    ds = list(dates)
    n = len(ds)
    n_tr = int(n * ratios[0])
    n_va = int(n * ratios[1])
    return Split(ds[:n_tr], ds[n_tr : n_tr + n_va], ds[n_tr + n_va :])


def walk_forward(
    dates: Sequence[str],
    *,
    train_span: int,
    test_span: int,
    label_horizon: int = 1,
    embargo: int = 0,
    step: int | None = None,
    max_folds: int | None = None,
) -> list[Fold]:
    """滚动窗口生成 folds(只前移)。每折训练窗末尾按 purge+embargo 净化,杜绝标签泄漏。

    test 紧接 train 之后;purge 在 train 一侧剔除最后 label_horizon+embargo 个样本(它们的
    未来 label_horizon 日标签会落入 test 区)。step 默认 = test_span(不重叠前移)。
    """
    if train_span <= 0 or test_span <= 0:
        raise ValueError("train_span/test_span 须为正整数")
    if label_horizon < 0 or embargo < 0:
        raise ValueError("label_horizon/embargo 不可为负")
    ds = list(dates)
    n = len(ds)
    step = step if step is not None else test_span
    if step <= 0:
        raise ValueError("step 须为正整数")

    folds: list[Fold] = []
    train_start = 0
    fi = 0
    while True:
        test_start = train_start + train_span
        if test_start >= n:
            break
        test_end = min(test_start + test_span, n)
        purged_train_end = test_start - label_horizon - embargo
        train = ds[train_start:purged_train_end] if purged_train_end > train_start else []
        test = ds[test_start:test_end]
        if train and test:
            folds.append(Fold(fi, train, test))
            fi += 1
            if max_folds is not None and fi >= max_folds:
                break
        if test_end >= n:
            break
        train_start += step
    return folds


def min_backtest_start(trading_dates: Sequence[str], train_end: str, purge: int) -> str | None:
    """回测必须晚于 train_end + purge 个交易日。返回最早合法的 backtest_start(含),无则 None。

    train_end 之后第 purge 个交易日(after[purge-1])是被 purge 隔离的最后一天;backtest_start
    须 > 它,即 >= after[purge]。
    """
    if purge < 0:
        raise ValueError("purge 不可为负")
    after = [d for d in trading_dates if d > train_end]
    if len(after) <= purge:
        return None
    return after[purge]


def is_oos_clean(
    backtest_start: str, train_end: str, trading_dates: Sequence[str], purge: int
) -> bool:
    """回测区间是否「诚实样本外」:backtest_start > train_end + purge 个交易日。"""
    floor = min_backtest_start(trading_dates, train_end, purge)
    return floor is not None and backtest_start >= floor
