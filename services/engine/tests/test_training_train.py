"""M3 切片3 自测:walk-forward 训练器 + /engine/train 路由 + 红线守卫。

- 红线#1 硬守卫:purge < label_horizon 必拒(TrainGuardError / 路由 422)。
- 可学习性:构造「动量信号」合成盘(每股固定漂移 g_i),mom20 与前向收益同序 → OOS IC 高、
  特征重要度以 f_mom20 为首。
- 红线#3 诚实:样本内外 IC 并列返回;其余因子无信息时权重≈0(不夸大)。
"""

import json

import polars as pl
import pytest
from fastapi.testclient import TestClient

from sinan import app as appmod
from sinan.backtest.splits import walk_forward
from sinan.data import DataLayer, store
from sinan.training import TrainGuardError, build_feature_panel, run_train

CODES = ["600519.SH", "000001.SZ", "600036.SH", "000333.SZ", "601318.SH", "600000.SH"]


def sse_events(resp) -> list[dict]:
    """解析 SSE 响应为事件列表(TestClient 把流式响应整体缓冲进 .text)。训练/质检共用。"""
    return [json.loads(line[6:]) for line in resp.text.splitlines() if line.startswith("data: ")]


def _dates(n: int):
    # 用纯数字交易日串(便于排序),避免月份进位。
    return [f"2024{1 + i // 28:02d}{1 + i % 28:02d}" for i in range(n)]


def _signal_frames(dates):
    """动量信号盘:股 i 日漂移 g_i(单调),mom20 与前向收益同序;其余因子常量(无信息)。"""
    price, adj, basic = [], [], []
    for ci, code in enumerate(CODES):
        g = -0.002 + ci * 0.001
        for di, d in enumerate(dates):
            close = 10.0 * ((1.0 + g) ** di)
            price.append({
                "stock_code": code, "trade_date": d,
                "open": close, "high": close, "low": close, "close": close,
                "volume": 1000.0, "amount": close * 1000.0,
            })
            adj.append({"stock_code": code, "trade_date": d, "adj_factor": 1.0})
            basic.append({  # pe/pb 常量 → ep/bp 截面无方差(无信息)
                "stock_code": code, "trade_date": d,
                "pe_ttm": 15.0, "pb": 1.5, "ps_ttm": 5.0,
                "total_mv": 1e6, "circ_mv": 8e5, "turnover_rate": 1.5, "dv_ttm": 2.0,
            })
    fundamental = [
        {"stock_code": code, "end_date": "2023-12-31", "ann_date": "20240105", "roe": 8.0}
        for code in CODES
    ]
    return {
        "price": pl.DataFrame(price),
        "adj_factor": pl.DataFrame(adj),
        "daily_basic": pl.DataFrame(basic),
        "fundamental": pl.DataFrame(fundamental),
        # 故意无 northbound → north_chg5 全降级(测试诚实降级路径)。
    }


def _write(cache, frames):
    for ds, df in frames.items():
        store.write_dataset(cache, ds, df)


def test_train_guard_purge_lt_horizon(tmp_path):
    dates = _dates(60)
    _write(tmp_path / "c", _signal_frames(dates))
    with pytest.raises(TrainGuardError):
        run_train(
            DataLayer(tmp_path / "c"),
            codes=CODES,
            trading_dates=dates,
            train_start=dates[0],
            train_end=dates[-1],
            label_horizon=5,
            purge=2,  # < label_horizon → 拒
            train_span=20,
            test_span=10,
        )


def test_train_recovers_momentum_signal(tmp_path):
    dates = _dates(100)
    _write(tmp_path / "c", _signal_frames(dates))
    res = run_train(
        DataLayer(tmp_path / "c"),
        codes=CODES,
        trading_dates=dates,
        train_start=dates[0],
        train_end=dates[-1],
        label_horizon=5,
        purge=5,
        train_span=30,
        test_span=15,
    )
    assert res.n_folds > 0
    assert res.oos_clean is True
    # 动量信号 → 样本外 RankIC 应显著为正。
    assert res.ic_oos > 0.5, f"OOS IC 未恢复动量信号: {res.ic_oos}"
    # 特征重要度以 f_mom20 为首(其余因子常量无信息 → 权重≈0)。
    assert res.feature_importance[0]["feature"] == "f_mom20"
    # north 因无数据被全局降级,不入可用特征。
    assert "f_north_chg5" not in res.feature_cols
    assert any("north_chg5" in d for d in res.degraded)


def test_train_paired_is_oos_and_model(tmp_path):
    dates = _dates(100)
    _write(tmp_path / "c", _signal_frames(dates))
    res = run_train(
        DataLayer(tmp_path / "c"),
        codes=CODES,
        trading_dates=dates,
        train_start=dates[0],
        train_end=dates[-1],
        label_horizon=5,
        purge=5,
        train_span=30,
        test_span=15,
    )
    # 样本内外并列(红线#3)。
    assert isinstance(res.ic_is, float) and isinstance(res.ic_oos, float)
    assert len(res.fold_metrics) == res.n_folds
    # 特征重要度归一(|coef| 占比和≈1,允许全零兜底)。
    total = sum(f["weight"] for f in res.feature_importance)
    assert abs(total - 1.0) < 1e-6 or total == 0.0
    # 模型 = 线性系数 JSON(无二进制),可直接序列化。
    assert res.model["type"] == "elasticnet"
    assert len(res.model["coef"]) == len(res.feature_cols)
    assert "intercept" in res.model
    import json

    json.dumps(res.to_dict())  # 全字段可 JSON 序列化(经 api 落库)


def test_feature_cols_never_contain_label(tmp_path):
    """结构性守卫:特征列永不含 'label' —— 标签当特征是最直接的泄漏路径,从源头封死。"""
    dates = _dates(40)
    _write(tmp_path / "c", _signal_frames(dates))
    fp = build_feature_panel(DataLayer(tmp_path / "c"), CODES, dates)
    assert "label" not in fp.feature_cols
    assert all(c.startswith("f_") for c in fp.feature_cols)


def test_purge_widens_isolation_and_disjoint():
    """purge 真隔离:effective_embargo=max(embargo,purge-horizon) 使每折 train/test 间隔 >= purge 且不相交。"""
    dates = [f"d{i:03d}" for i in range(120)]
    horizon, embargo, purge = 5, 0, 12
    eff = max(embargo, purge - horizon)
    folds = walk_forward(dates, train_span=40, test_span=20, label_horizon=horizon, embargo=eff)
    assert folds
    idx = {d: i for i, d in enumerate(dates)}
    for f in folds:
        gap = idx[f.test[0]] - idx[f.train[-1]]
        assert gap >= purge, f"折 {f.index} 隔离 {gap} < purge {purge}"
        assert set(f.train).isdisjoint(set(f.test))


def test_layered_metrics_carry_honest_note(tmp_path):
    """红线#3 硬化:分层口径夏普/年化以 layered_ 前缀 + metrics_note 随 JSON 下发,诚实标注不依赖注释。"""
    dates = _dates(100)
    _write(tmp_path / "c", _signal_frames(dates))
    res = run_train(
        DataLayer(tmp_path / "c"), codes=CODES, trading_dates=dates,
        train_start=dates[0], train_end=dates[-1], label_horizon=5, purge=5,
        train_span=30, test_span=15,
    )
    d = res.to_dict()
    assert "layered_sharpe_oos" in d and "layered_annual_return_oos" in d
    assert "sharpe_oos" not in d and "annual_return_oos" not in d
    assert "分层" in d["metrics_note"] and "非完整" in d["metrics_note"]


def test_train_route_guard_and_success(tmp_path, monkeypatch):
    monkeypatch.setenv("SINAN_DATA_DIR", str(tmp_path))
    dates = _dates(100)
    _write(tmp_path / "cache", _signal_frames(dates))  # config.cache_dir() == SINAN_DATA_DIR/cache
    client = TestClient(appmod.app)

    # 守卫:purge < label_horizon → SSE 流内 error 事件携带 status 422(api 据此转发 422)。
    bad = client.post(
        "/engine/train",
        json={"train_start": dates[0], "train_end": dates[-1], "label_horizon": 5, "purge": 1,
              "train_span": 30, "test_span": 15},
    )
    assert bad.status_code == 200, bad.text  # SSE 始终 200,错误走事件
    err = sse_events(bad)[-1]
    assert err["stage"] == "error" and err["status"] == 422

    # 200:正常训练 → 流式进度(特征面板 + 逐折 IC)+ 末尾 done 事件携带结果。
    # feature_workers=1:测试串行(并行等价性另由 test_training_data 直测,避免 pytest 里起进程池)。
    ok = client.post(
        "/engine/train",
        json={"train_start": dates[0], "train_end": dates[-1], "label_horizon": 5, "purge": 5,
              "train_span": 30, "test_span": 15, "feature_workers": 1},
    )
    assert ok.status_code == 200, ok.text
    events = sse_events(ok)
    stages = {e["stage"] for e in events}
    assert "features" in stages and "fold" in stages  # 可见进度(用户要的「提升/下降」)
    fold_evs = [e for e in events if e["stage"] == "fold"]
    assert all("ic_is" in e and "ic_oos" in e for e in fold_evs)  # 逐折样本内/外 IC
    done = events[-1]
    assert done["stage"] == "done"
    body = done["result"]
    assert body["ic_oos"] > 0.5
    assert body["model"]["type"] == "elasticnet"
    assert body["oos_clean"] is True
