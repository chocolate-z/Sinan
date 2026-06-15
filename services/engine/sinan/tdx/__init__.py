"""通达信(TDX)公式子系统(MVP:检测/扫描)。

公开 API:
- validate(src):静态校验 → {ok, errors, outputs, temps, signals}。
- scan(dl, codes, src, asof, signal):全市场扫描 → 当日触发该信号的股票清单。

红线#1(无未来函数):取数走 DataLayer(≤asof);算子仅回看;负 REF 解析期拒;crossing 黄金测试守护。
红线#6:engine 不写库 —— scan 只读缓存返结果,落库由 api 负责。绝不用 Python eval(自建解释器)。
不支持分时:一律日频近似(诚实)。
"""

from __future__ import annotations

from typing import Sequence

import polars as pl

from .errors import TdxError, TdxSyntaxError, TdxUnsafeError
from .evaluator import CompiledFormula, compile_program, trigger_expr

__all__ = [
    "validate",
    "scan",
    "compile_program",
    "CompiledFormula",
    "TdxError",
    "TdxSyntaxError",
    "TdxUnsafeError",
]

_PANEL_FIELDS = ["stock_code", "trade_date", "open", "high", "low", "close", "volume", "amount"]


def validate(src: str) -> dict:
    """静态校验 TDX 公式(不需数据)。非法/不安全 → ok=False + 中文错误。"""
    try:
        c = compile_program(src)
    except TdxError as e:
        return {"ok": False, "errors": [str(e)], "outputs": [], "temps": [], "signals": []}
    except Exception as e:  # noqa: BLE001 — 词法/语法等兜底为诚实错误,不抛 500
        return {"ok": False, "errors": [f"解析失败:{e}"], "outputs": [], "temps": [], "signals": []}
    return {
        "ok": True,
        "errors": [],
        "outputs": list(c.outputs),
        "temps": c.temps,
        "signals": c.signals,
    }


def _resolve_signal(c: CompiledFormula, signal: str | None) -> str:
    if signal:
        if signal not in c.outputs:
            raise TdxError(f"信号列「{signal}」不存在;可选:{list(c.outputs)}")
        return signal
    if c.signals:
        return c.signals[0]
    if c.outputs:
        return next(iter(c.outputs))
    raise TdxError("公式无输出列(用 : 定义至少一个输出/信号,如 建仓:CROSS(...))")


def scan(
    dl,
    codes: Sequence[str] | None,
    src: str,
    asof: str,
    *,
    signal: str | None = None,
) -> dict:
    """全市场扫描:逐股算公式,返回 asof 当日「触发该信号」的股票清单(布尔筛选,非打分排序)。"""
    c = compile_program(src)
    name = _resolve_signal(c, signal)
    s = c.outputs[name]

    px = dl.asof("price", asof, codes=list(codes) if codes else None, fields=_PANEL_FIELDS)
    if px.is_empty():
        return {"asof": None, "signal": name, "outputs": list(c.outputs), "hits": [], "scanned": 0}
    panel = px.sort(["stock_code", "trade_date"])

    last = (
        panel.select(
            "stock_code",
            "trade_date",
            s.expr.alias("_v"),
            trigger_expr(s).alias("_t"),
        )
        .group_by("stock_code", maintain_order=True)
        .last()
    )
    hits = last.filter(pl.col("_t")).sort("stock_code")
    return {
        "asof": panel["trade_date"].max(),
        "signal": name,
        "outputs": list(c.outputs),
        "scanned": last.height,
        "hits": [
            {"stock_code": r["stock_code"], "date": r["trade_date"], "value": r["_v"]}
            for r in hits.iter_rows(named=True)
        ],
    }
