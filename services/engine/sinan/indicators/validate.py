"""自定义因子校验:静态白名单 + 随机日穿越测试(防未来函数)。

穿越测试:对历史日 T,用「全量数据」与「截断到 <=T 的数据」分别求值 asof-T,
若结果不一致 → 表达式引用了未来数据 → 判定含未来函数,拒绝注册(红线#1)。
"""

from __future__ import annotations

from dataclasses import dataclass

import polars as pl

from .operators import FIELDS, OP_NAMES
from .safe_eval import UnsafeExpression, compile_expr


def eval_compiled(panel: pl.DataFrame, expr: pl.Expr, asof: str | None = None) -> pl.DataFrame:
    """对 panel(long: stock_code,trade_date,fields)求值,返回每股 asof(或最新)一行 [stock_code,value]。"""
    df = panel.sort(["stock_code", "trade_date"]).with_columns(expr.alias("value"))
    if asof is not None:
        df = df.filter(pl.col("trade_date") <= asof)
    return (
        df.sort("trade_date")
        .group_by("stock_code", maintain_order=True)
        .last()
        .select("stock_code", "value")
        .sort("stock_code")
    )


def evaluate(panel: pl.DataFrame, expr_str: str, asof: str | None = None) -> pl.DataFrame:
    return eval_compiled(panel, compile_expr(expr_str), asof)


def crossing_test(panel: pl.DataFrame, expr_str: str, asof: str) -> bool:
    """True = 无未来函数(全量与截断<=T 求值一致)。"""
    full = evaluate(panel, expr_str, asof)
    trunc = evaluate(panel.filter(pl.col("trade_date") <= asof), expr_str, asof)
    return full.equals(trunc)


@dataclass
class ValidationResult:
    ok: bool
    errors: list[str]
    lookahead_ok: bool | None  # 穿越测试结果(给了样本才有)
    fields: list[str]
    functions: list[str]


def validate(
    expr_str: str, panel: pl.DataFrame | None = None, asof: str | None = None
) -> ValidationResult:
    errors: list[str] = []
    lookahead: bool | None = None
    try:
        compile_expr(expr_str)
    except UnsafeExpression as e:
        errors.append(str(e))

    if not errors and panel is not None and asof is not None:
        try:
            lookahead = crossing_test(panel, expr_str, asof)
            if not lookahead:
                errors.append("含未来函数:穿越测试不通过(截断 >T 重算结果不一致)")
        except Exception as e:  # noqa: BLE001
            errors.append(f"求值失败:{e}")
            lookahead = False

    return ValidationResult(
        ok=not errors,
        errors=errors,
        lookahead_ok=lookahead,
        fields=sorted(FIELDS),
        functions=sorted(OP_NAMES),
    )
