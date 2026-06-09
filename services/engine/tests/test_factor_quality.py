"""M4 切片A 自测:因子质量报告(真实 IC/ICIR/覆盖度 + 十分位分层)+ /engine/factors/quality 路由。

动量信号盘:mom20 预测前向收益 → 正 IC + 十分位单调;常量因子 IC≈0;无数据因子 coverage=0(诚实)。
"""

from fastapi.testclient import TestClient

from sinan import app as appmod
from sinan.data import DataLayer
from sinan.factors import FactorContext
from sinan.factors.custom import custom_factor
from sinan.factors.quality import factor_quality

# 复用 M3 训练测试的动量信号合成盘(每股固定漂移 → mom20 与前向收益同序)。
from tests.test_training_train import CODES, _dates, _signal_frames, _write


def test_factor_quality_momentum_and_degrade(tmp_path):
    dates = _dates(60)
    _write(tmp_path / "c", _signal_frames(dates))
    # 仅 6 只股 → n_deciles=3(每桶 2 只)。
    results, degraded = factor_quality(
        DataLayer(tmp_path / "c"), CODES, dates, label_horizon=5, n_deciles=3
    )
    by = {r.name: r for r in results}

    mom = by["mom20"]
    assert mom.coverage > 0.5
    assert mom.ic_mean > 0.3, f"动量因子 IC 未恢复: {mom.ic_mean}"
    assert len(mom.ic_series) > 0
    # 十分位(此处 3 桶)单调:高因子值组前向收益 > 低组。
    assert mom.deciles[-1] > mom.deciles[0]

    # 常量因子(pe/pb 截面无方差)IC≈0,不无中生有。
    assert abs(by["ep"].ic_mean) < 0.2

    # 无北向数据 → coverage 0(诚实,不补强),且计入 degraded。
    assert by["north_chg5"].coverage == 0.0
    assert any("north_chg5" in d for d in degraded)


def test_custom_dsl_factor_quality(tmp_path):
    """自定义 DSL 因子接入质检:动量表达式 → 真实正 IC,且与内置因子并列出现。"""
    dates = _dates(60)
    _write(tmp_path / "c", _signal_frames(dates))
    custom = [{"name": "mom10_custom", "expr": "close / delay(close, 10) - 1", "group": "custom"}]
    results, _deg = factor_quality(
        DataLayer(tmp_path / "c"), CODES, dates, custom=custom, label_horizon=5, n_deciles=3
    )
    by = {r.name: r for r in results}
    assert "mom10_custom" in by and "mom20" in by  # 自定义 + 内置并列
    mc = by["mom10_custom"]
    assert mc.coverage > 0.5
    assert mc.ic_mean > 0.3, f"自定义动量因子 IC 未恢复: {mc.ic_mean}"
    assert mc.group == "custom"


def test_custom_factor_no_future_function(tmp_path):
    """自定义因子 asof(T) 只依赖 <=T:截断 >T 数据,因子值逐股不变(红线#1)。"""
    dates = _dates(50)
    T = dates[40]
    full = tmp_path / "full"
    _write(full, _signal_frames(dates))
    trunc = tmp_path / "trunc"
    _write(trunc, _signal_frames(dates[:42]))  # 仅保留 <= T+1 的数据

    f = custom_factor("c", "close / delay(close, 10) - 1")
    a = f.compute(FactorContext(DataLayer(full), T, CODES)).sort("stock_code")
    b = f.compute(FactorContext(DataLayer(trunc), T, CODES)).sort("stock_code")
    assert a.equals(b), "自定义因子 asof(T) 受到 >T 未来数据影响 —— 未来函数!"


def test_factors_quality_route(tmp_path, monkeypatch):
    monkeypatch.setenv("SINAN_DATA_DIR", str(tmp_path))
    dates = _dates(60)
    _write(tmp_path / "cache", _signal_frames(dates))  # config.cache_dir() == SINAN_DATA_DIR/cache
    client = TestClient(appmod.app)

    r = client.post(
        "/engine/factors/quality",
        json={"start": dates[0], "end": dates[-1], "label_horizon": 5, "n_deciles": 3},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["n_dates"] > 0
    mom = next(f for f in body["factors"] if f["name"] == "mom20")
    assert mom["ic_mean"] > 0.3
    assert "deciles" in mom and len(mom["deciles"]) == 3

    # 区间过短(交易日 < n_deciles)→ 400。
    bad = client.post(
        "/engine/factors/quality",
        json={"start": dates[0], "end": dates[1], "n_deciles": 10},
    )
    assert bad.status_code == 400
