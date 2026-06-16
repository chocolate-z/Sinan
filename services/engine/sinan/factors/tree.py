"""LightGBM 树模型的纯 numpy 推理(M3 v2)。

训练时用 lightgbm 拟合 → dump_model() 出树结构 → flatten_trees 拍平成数组存进模型 JSON。
推理(选股打分)时用 predict_trees 纯 numpy 向量化遍历、累加叶子值 —— 不需要运行时装 lightgbm,
也不存二进制 pickle:模型仍是纯 JSON,延续 ElasticNet「系数 JSON」那套(红线#6 不破)。

打分是横截面排序选股(按预测分排名取头部),所以「各树叶子值之和」这个原始 margin 就够用 ——
lightgbm 回归默认的 init/base 常数对同一截面是同一个加数,不改排名,这里不加(加了也无害)。
因子特征都是连续值(winsor+zscore 后),不会有类别型分裂,故分裂判定恒为 x <= threshold。
"""

from __future__ import annotations

import numpy as np


def flatten_trees(dump: dict) -> list[dict]:
    """lightgbm booster.dump_model() → 每棵树拍平成 {feature,threshold,left,right,value,default_left} 数组。

    内部节点:feature>=0,left/right 指子节点下标;叶子:feature=-1、value=叶子值、left/right=-1。
    """
    trees: list[dict] = []
    for ti in dump.get("tree_info", []):
        feature: list[int] = []
        threshold: list[float] = []
        left: list[int] = []
        right: list[int] = []
        value: list[float] = []
        default_left: list[bool] = []

        def add(node: dict) -> int:
            idx = len(feature)
            # 叶子:有 leaf_value、没 split_feature
            if "split_feature" not in node:
                feature.append(-1)
                threshold.append(0.0)
                left.append(-1)
                right.append(-1)
                value.append(float(node.get("leaf_value", 0.0)))
                default_left.append(False)
                return idx
            # 内部节点:先占位(下标稳定),再递归左右,回填子下标
            feature.append(int(node["split_feature"]))
            threshold.append(float(node["threshold"]))
            value.append(0.0)
            default_left.append(bool(node.get("default_left", False)))
            left.append(-1)
            right.append(-1)
            li = add(node["left_child"])
            ri = add(node["right_child"])
            left[idx] = li
            right[idx] = ri
            return idx

        add(ti["tree_structure"])
        trees.append(
            {
                "feature": feature,
                "threshold": threshold,
                "left": left,
                "right": right,
                "value": value,
                "default_left": default_left,
            }
        )
    return trees


def predict_trees(trees: list[dict], X: np.ndarray) -> np.ndarray:
    """纯 numpy 向量化遍历:每棵树从根逐层下行到叶子,累加叶子值。X:(n_samples, n_features)。

    每棵树 O(树深) 次迭代、整批样本同时下行;连续因子无类别分裂,判定恒 x<=threshold;
    NaN(推理侧已 fillna 0,理论不出现)按 default_left 走,稳妥兜底。
    """
    n = X.shape[0]
    score = np.zeros(n, dtype=np.float64)
    if n == 0:
        return score
    for t in trees:
        feature = np.asarray(t["feature"], dtype=np.int64)
        threshold = np.asarray(t["threshold"], dtype=np.float64)
        left = np.asarray(t["left"], dtype=np.int64)
        right = np.asarray(t["right"], dtype=np.int64)
        value = np.asarray(t["value"], dtype=np.float64)
        default_left = np.asarray(t["default_left"], dtype=bool)
        node = np.zeros(n, dtype=np.int64)  # 全员从根(下标 0)出发
        # 上界 = 节点数(实际只需树深);到所有样本都落叶子即提前 break
        for _ in range(len(feature) + 1):
            internal = feature[node] >= 0
            if not internal.any():
                break
            idx = np.nonzero(internal)[0]
            cur = node[idx]
            xv = X[idx, feature[cur]]
            go_left = xv <= threshold[cur]
            nan = np.isnan(xv)
            if nan.any():
                go_left = np.where(nan, default_left[cur], go_left)
            node[idx] = np.where(go_left, left[cur], right[cur])
        score += value[node]
    return score
