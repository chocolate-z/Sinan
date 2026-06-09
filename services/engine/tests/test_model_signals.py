"""M3 切片6 自测:激活模型驱动选股(模型出信号)。

- model_score_universe:score = intercept + Σ coef·f(同一 asof 特征,红线#1);按模型分横截面排名。
- run_eod(model=...):用模型打分替换等权合成。负系数反转动量 → 选「低动量」组,证明是模型系数在驱动,
  而非等权(等权只有 mom20 时会选高动量),清晰区分。
"""

from sinan.data import DataLayer, store
from sinan.factors import FactorContext, model_score_universe
from sinan.paper import CostModel, SimAccount, run_eod

import polars as pl

CODES = ["A.SH", "B.SH", "C.SH", "D.SH", "E.SH", "F.SH"]  # i=0 最低动量 → i=5 最高动量


def _dates(n: int):
    return [f"2024{1 + i // 28:02d}{1 + i % 28:02d}" for i in range(n)]


def _write(tmp_path, dates):
    price, adj = [], []
    for ci, code in enumerate(CODES):
        g = -0.002 + ci * 0.001  # 单调漂移 → mom20 单调递增于 ci
        for di, d in enumerate(dates):
            close = 10.0 * ((1.0 + g) ** di)
            price.append({
                "stock_code": code, "trade_date": d,
                "open": close, "high": close, "low": close, "close": close,
                "volume": 1000.0, "amount": close * 1000.0,
            })
            adj.append({"stock_code": code, "trade_date": d, "adj_factor": 1.0})
    cache = tmp_path / "cache"
    store.write_dataset(cache, "price", pl.DataFrame(price))
    store.write_dataset(cache, "adj_factor", pl.DataFrame(adj))
    return cache


def test_model_score_universe_ranks_by_coef(tmp_path):
    dates = _dates(30)
    cache = _write(tmp_path, dates)
    ctx = FactorContext(DataLayer(cache), dates[-1], CODES)

    # 正系数:按动量从高到低 → F(i=5)居首。
    pos = model_score_universe(ctx, {"feature_cols": ["f_mom20"], "coef": [1.0], "intercept": 0.0})
    assert pos.scores.row(0, named=True)["stock_code"] == "F.SH"
    assert "percentile" in pos.scores.columns and "score" in pos.scores.columns

    # 负系数:反转 → A(i=0,最低动量)居首,证明模型系数驱动排名。
    neg = model_score_universe(ctx, {"feature_cols": ["f_mom20"], "coef": [-1.0], "intercept": 0.0})
    assert neg.scores.row(0, named=True)["stock_code"] == "A.SH"


def test_run_eod_uses_active_model_negative_coef_picks_low_momentum(tmp_path):
    dates = _dates(30)
    cache = _write(tmp_path, dates)
    today, effective = dates[28], dates[29]
    prices_today = {c: 10.0 * ((1.0 + (-0.002 + i * 0.001)) ** 28) for i, c in enumerate(CODES)}
    open_next = {c: 10.0 * ((1.0 + (-0.002 + i * 0.001)) ** 29) for i, c in enumerate(CODES)}

    account = SimAccount(cash=1_000_000.0, costs=CostModel.from_config())
    res = run_eod(
        data=DataLayer(cache), codes=CODES, today=today, effective_date=effective,
        account=account, bench_closes=list(range(100, 125)),  # 上行 → 大盘择时放行
        prices_today=prices_today, open_prices_next=open_next,
        params={"buy_threshold": 0.0, "max_holdings": 3, "market_ma_days": 20},
        model={"feature_cols": ["f_mom20"], "coef": [-1.0], "intercept": 0.0},
    )
    bought = {s.stock_code for s in res.signals if s.action == "buy" and not s.blocked}
    assert res.market_open is True
    # 负系数模型 → 选最低动量的 A/B/C(3 个槽位),最高动量 F 不入选。
    assert "A.SH" in bought
    assert "F.SH" not in bought
