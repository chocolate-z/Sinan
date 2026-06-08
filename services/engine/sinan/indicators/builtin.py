"""内置技术/基础指标:用同一套安全 DSL 表达,可直接被用户引用/叠加。"""

from __future__ import annotations

# name -> (category, expr)。expr 走 safe_eval 编译,与自定义指标同一引擎。
BUILTIN_INDICATORS: dict[str, tuple[str, str]] = {
    "ma5": ("trend", "ma(close, 5)"),
    "ma20": ("trend", "ma(close, 20)"),
    "ma60": ("trend", "ma(close, 60)"),
    "ema12": ("trend", "ema(close, 12)"),
    "rsi14": ("momentum", "rsi(close, 14)"),
    "mom20": ("momentum", "close / delay(close, 20) - 1"),
    "reversal5": ("momentum", "0 - (close / delay(close, 5) - 1)"),
    "vol20": ("volatility", "ts_std(pct_change, 20)"),
    "turn20": ("liquidity", "ts_mean(turnover_rate, 20)"),
    "ep": ("value", "where(pe_ttm > 0, 1 / pe_ttm, 0)"),
    "bp": ("value", "where(pb > 0, 1 / pb, 0)"),
    "north_chg5": ("northbound", "ts_delta(north_hold_ratio, 5)"),
}
