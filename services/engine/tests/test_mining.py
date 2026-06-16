"""自动挖因子:候选都是合法 DSL;train/oos 必须不相交且隔开 purge(数据窥探/标签泄漏守卫);
端到端在样本外窗如实报 IC(选 top-K 用训练窗,报业绩用没碰过的样本外窗)。"""

import pytest

from sinan.data import DataLayer
from sinan.factors.custom import custom_factor
from sinan.factors.mining import MiningGuardError, generate_candidates, mine_factors
from tests.test_factors import CODES, _build_frames, _dates, _write


def test_candidates_are_all_valid_lookback_only_dsl():
    """每个候选公式都能过沙箱编译(白名单字段 + 仅回看算子);结构上写不出未来函数。"""
    cands = generate_candidates()
    assert len(cands) >= 20
    names = [c["name"] for c in cands]
    assert len(names) == len(set(names)), "候选名有重复"
    for c in cands:
        custom_factor(c["name"], c["expr"], c["group"])  # 不抛 = 合法且仅回看


def test_mine_guard_rejects_oos_too_close_to_train(tmp_path):
    """样本外窗距训练截止不足 purge → 拒跑(否则训练标签前瞻窗泄漏进样本外)。"""
    dates = _dates(60)
    cache = tmp_path / "c"
    _write(cache, _build_frames(dates))
    with pytest.raises(MiningGuardError):
        mine_factors(
            DataLayer(cache), codes=CODES, trading_dates=dates,
            train_start=dates[0], train_end=dates[40],
            oos_start=dates[42], oos_end=dates[59],  # 仅隔 2 个交易日 < purge(5)
            label_horizon=5, feature_workers=1,
        )


def test_mine_end_to_end_reports_train_and_oos(tmp_path):
    """端到端:候选→训练集选 top-K→样本外重算;每条结果训练/样本外指标都在,带候选数与警示。"""
    dates = _dates(90)
    cache = tmp_path / "c"
    _write(cache, _build_frames(dates))
    res = mine_factors(
        DataLayer(cache), codes=CODES, trading_dates=dates,
        train_start=dates[0], train_end=dates[50],
        oos_start=dates[60], oos_end=dates[89],  # 隔 ~9 个交易日 >= purge(5)
        label_horizon=5, top_k=5, feature_workers=1,
    )
    assert res["candidates_tested"] == len(generate_candidates())
    assert res["top_k"] == 5 and len(res["results"]) == 5
    assert res["train_window"] == [dates[0], dates[50]]
    assert res["oos_window"] == [dates[60], dates[89]]
    assert "样本外" in res["warning"] and str(res["candidates_tested"]) in res["warning"]
    for r in res["results"]:
        assert r["expr"] and r["name"]
        # 训练指标必有;样本外指标也都算了(单独在 oos 窗重算,可能为 None 仅当该候选 oos 全降级)
        assert r["train_icir"] is not None
        assert "oos_icir" in r and "oos_ic" in r
    # top-K 按训练 ICIR 降序
    ticirs = [r["train_icir"] for r in res["results"]]
    assert ticirs == sorted(ticirs, reverse=True)
