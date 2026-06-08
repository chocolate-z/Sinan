"""自定义因子 DSL 的白名单字段与算子。算子全部映射为 polars 表达式:
时序算子按 stock_code 分组(panel 预排序 by trade_date),横截面算子按 trade_date 分组。
只提供「回看」算子(rolling/shift 正向),不暴露任何前视算子 —— 配合穿越测试杜绝未来函数。
"""

from __future__ import annotations

import polars as pl

# 暴露给用户表达式的 PIT 安全字段别名。
FIELDS: frozenset[str] = frozenset(
    {
        "open", "high", "low", "close", "vol", "volume", "amount", "pct_change",
        "pe_ttm", "pb", "ps_ttm", "total_mv", "circ_mv", "turnover_rate", "dv_ttm",
        "roe", "north_hold_ratio",
    }
)


def _expr(v) -> pl.Expr:
    return v if isinstance(v, pl.Expr) else pl.lit(v)


def _w(d) -> int:
    n = int(d)
    if n <= 0:
        raise ValueError(f"窗口/滞后参数必须为正整数,收到 {d}(负值会引入未来函数)")
    return n


# 时序算子(按个股、panel 已按日期升序)
def _delay(x, d):
    return _expr(x).shift(_w(d)).over("stock_code")


def _ts_mean(x, d):
    return _expr(x).rolling_mean(_w(d)).over("stock_code")


def _ts_std(x, d):
    return _expr(x).rolling_std(_w(d)).over("stock_code")


def _ts_sum(x, d):
    return _expr(x).rolling_sum(_w(d)).over("stock_code")


def _ts_max(x, d):
    return _expr(x).rolling_max(_w(d)).over("stock_code")


def _ts_min(x, d):
    return _expr(x).rolling_min(_w(d)).over("stock_code")


def _ts_delta(x, d):
    e = _expr(x)
    return (e - e.shift(_w(d))).over("stock_code")


def _ema(x, d):
    return _expr(x).ewm_mean(span=_w(d)).over("stock_code")


def _rsi(x, d):
    e = _expr(x)
    delta = (e - e.shift(1)).over("stock_code")
    gain = pl.when(delta > 0).then(delta).otherwise(0.0)
    loss = pl.when(delta < 0).then(-delta).otherwise(0.0)
    avg_gain = gain.rolling_mean(_w(d)).over("stock_code")
    avg_loss = loss.rolling_mean(_w(d)).over("stock_code")
    rs = avg_gain / avg_loss
    return 100.0 - 100.0 / (1.0 + rs)


# 横截面算子(按交易日)
def _rank(x):
    return _expr(x).rank().over("trade_date")


def _zscore(x):
    e = _expr(x)
    return ((e - e.mean()) / e.std()).over("trade_date")


# 基础
def _where(cond, a, b):
    return pl.when(cond).then(_expr(a)).otherwise(_expr(b))


OPS: dict = {
    # 基础
    "abs": lambda x: _expr(x).abs(),
    "log": lambda x: _expr(x).log(),
    "sign": lambda x: _expr(x).sign(),
    "sqrt": lambda x: _expr(x).sqrt(),
    "max": lambda a, b: pl.max_horizontal(_expr(a), _expr(b)),
    "min": lambda a, b: pl.min_horizontal(_expr(a), _expr(b)),
    "where": _where,
    # 横截面
    "rank": _rank,
    "cs_rank": _rank,
    "zscore": _zscore,
    "cs_zscore": _zscore,
    # 时序
    "delay": _delay,
    "ts_delay": _delay,
    "ts_mean": _ts_mean,
    "ma": _ts_mean,
    "ts_std": _ts_std,
    "ts_sum": _ts_sum,
    "ts_max": _ts_max,
    "ts_min": _ts_min,
    "ts_delta": _ts_delta,
    "ema": _ema,
    "rsi": _rsi,
}

OP_NAMES: frozenset[str] = frozenset(OPS)
