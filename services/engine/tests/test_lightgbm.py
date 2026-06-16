"""LightGBM(M3 v2)树模型:纯 numpy 遍历推理 == lightgbm 预测;端到端训练出纯 JSON 树模型;
无未来函数(树模型走同一 asof 特征面板,asof(T) 不受 >T 数据影响)。

lightgbm 仅训练 + 本测试需要(可选 extra);推理(factors/tree.predict_trees)纯 numpy,不依赖它。
"""

import numpy as np

from sinan.data import DataLayer
from sinan.factors import FactorContext, model_score_universe
from sinan.factors.tree import flatten_trees, predict_trees
from sinan.training.train import run_train
from tests.test_factors import CODES, _build_frames, _dates, _write

LGBM_KW = dict(
    model_type="lightgbm",
    n_estimators=20,
    num_leaves=7,
    learning_rate=0.1,
    min_child_samples=3,
    train_span=40,
    test_span=20,
    label_horizon=5,
    purge=5,
    feature_workers=1,
)


def test_tree_traversal_matches_lightgbm_up_to_constant():
    """金标准:拍平树 + 纯 numpy 遍历累加叶子值 == lightgbm 原始预测(只差一个 init 常数)。

    我们不加 init/base 常数(横截面排序选股不需要,加了也只是同一个加数);故两者应:
    ① 全样本差值是同一个常数(std≈0)② 排名完全一致(argsort 相等)。这证明序列化→推理逐叶精确。
    """
    from lightgbm import LGBMRegressor

    rng = np.random.default_rng(0)
    X = rng.standard_normal((400, 5))
    y = X[:, 0] * 0.6 - X[:, 1] * 0.3 + rng.standard_normal(400) * 0.1
    m = LGBMRegressor(
        n_estimators=40, num_leaves=9, learning_rate=0.1, min_child_samples=5,
        random_state=42, deterministic=True, force_col_wise=True, n_jobs=1, verbose=-1,
    ).fit(X, y)
    trees = flatten_trees(m.booster_.dump_model())

    Xt = rng.standard_normal((150, 5))
    ours = predict_trees(trees, Xt)
    raw = np.asarray(m.predict(Xt, raw_score=True), dtype=float)
    diff = raw - ours
    assert float(np.std(diff)) < 1e-6, "遍历结果与 lightgbm 原始预测差值非常数 → 遍历不精确"
    assert np.array_equal(np.argsort(ours), np.argsort(raw)), "排名与 lightgbm 不一致"

    # trees 必须可 JSON 序列化(模型存库:纯 JSON、无二进制 pickle,红线#6)
    import json

    json.dumps(trees)


def test_run_train_lightgbm_tree_model_and_inference(tmp_path):
    """端到端:run_train(model_type=lightgbm) 产出纯 JSON 树模型(无 coef);能给截面打分出排名。"""
    dates = _dates(120)
    cache = tmp_path / "c"
    _write(cache, _build_frames(dates))
    res = run_train(
        DataLayer(cache), codes=CODES, trading_dates=dates,
        train_start=dates[0], train_end=dates[-1], **LGBM_KW,
    )
    assert res.model_type == "lightgbm"
    assert res.model["type"] == "lightgbm"
    assert res.model["trees"] and "coef" not in res.model  # 树结构,非线性系数
    assert res.n_folds >= 1
    assert res.feature_importance and abs(sum(f["weight"] for f in res.feature_importance) - 1.0) < 1e-3

    # 推理:用训出的树模型给某 asof 截面打分(纯 numpy,无 lightgbm)
    sr = model_score_universe(FactorContext(DataLayer(cache), dates[100], CODES), res.model)
    assert sr.scores["score"].drop_nulls().len() == len(CODES)
    assert "percentile" in sr.scores.columns


def test_lightgbm_inference_no_future_function(tmp_path):
    """红线#1:固定一个树模型,asof(T) 打分只依赖 <=T 数据 —— 追加 >T 未来数据不改变结果。"""
    dates = _dates(120)
    T = dates[100]
    frames = _build_frames(dates, future_after=T)
    full = tmp_path / "full"
    _write(full, frames)  # 含 >T 未来行 + 未来公告财务
    trunc = tmp_path / "trunc"
    _write(trunc, frames, max_trade_date=T)  # 仅 <=T

    # 在 trunc(只 <=T)上训出模型并固定
    res = run_train(
        DataLayer(trunc), codes=CODES, trading_dates=[d for d in dates if d <= T],
        train_start=dates[0], train_end=T, **LGBM_KW,
    )
    a = (
        model_score_universe(FactorContext(DataLayer(full), T, CODES), res.model)
        .scores.select(["stock_code", "score"]).sort("stock_code")
    )
    b = (
        model_score_universe(FactorContext(DataLayer(trunc), T, CODES), res.model)
        .scores.select(["stock_code", "score"]).sort("stock_code")
    )
    assert a.equals(b), "asof(T) 树模型打分受到 >T 未来数据影响 —— 未来函数!"
