"""时序切分 / purge / embargo / walk-forward / 回测硬守卫 黄金测试(红线#2/#3)。"""

import pytest

from sinan.backtest.splits import (
    chronological_split,
    is_oos_clean,
    min_backtest_start,
    walk_forward,
)


def test_chronological_split_no_shuffle():
    ds = [f"d{i:02d}" for i in range(10)]
    s = chronological_split(ds, (0.6, 0.2, 0.2))
    assert s.train == ds[:6]
    assert s.valid == ds[6:8]
    assert s.test == ds[8:]
    assert s.train + s.valid + s.test == ds  # 无丢失、无打散
    assert s.test == sorted(s.test)  # 顺序保持(绝不随机)


def test_chronological_split_rejects_bad_ratios():
    with pytest.raises(ValueError):
        chronological_split(["a", "b"], (0.5, 0.5, 0.5))  # 和≠1
    with pytest.raises(ValueError):
        chronological_split(["a", "b"], (0.6, 0.4))  # type: ignore[arg-type]


def test_walk_forward_forward_only_train_before_test():
    ds = [f"d{i:02d}" for i in range(20)]
    folds = walk_forward(ds, train_span=8, test_span=4, label_horizon=1, embargo=0)
    assert len(folds) >= 2
    starts = [f.test[0] for f in folds]
    assert starts == sorted(starts)  # 只前移
    for f in folds:
        assert max(f.train) < min(f.test)  # 训练全部早于测试


def test_walk_forward_purge_embargo_gap():
    ds = [f"d{i:02d}" for i in range(30)]
    lh, emb = 3, 2
    folds = walk_forward(ds, train_span=12, test_span=5, label_horizon=lh, embargo=emb)
    assert folds
    for f in folds:
        last_train = int(f.train[-1][1:])
        first_test = int(f.test[0][1:])
        # 训练窗末与测试窗首至少隔 lh+emb 个交易日(purge+embargo 生效,防标签泄漏)
        assert first_test - last_train >= lh + emb


def test_walk_forward_rejects_bad_args():
    with pytest.raises(ValueError):
        walk_forward(["a"], train_span=0, test_span=4)
    with pytest.raises(ValueError):
        walk_forward(["a"], train_span=4, test_span=4, embargo=-1)


def test_min_backtest_start_and_oos_guard():
    trading = [f"2024-06-{d:02d}" for d in range(20, 30)]  # 20..29
    train_end = "2024-06-22"
    # train_end 之后:23,24,25,26,27,28,29;purge=2 → after[2] = 25
    assert min_backtest_start(trading, train_end, 2) == "2024-06-25"
    assert is_oos_clean("2024-06-25", train_end, trading, 2) is True  # 恰好达标
    assert is_oos_clean("2024-06-26", train_end, trading, 2) is True
    assert is_oos_clean("2024-06-24", train_end, trading, 2) is False  # 落在 purge 隔离区
    assert is_oos_clean("2024-06-22", train_end, trading, 2) is False  # 等于 train_end
    # purge 超出剩余交易日 → 无合法起点
    assert min_backtest_start(trading, "2024-06-28", 5) is None
    assert is_oos_clean("2024-06-29", "2024-06-28", trading, 5) is False
