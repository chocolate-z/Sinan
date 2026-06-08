"""自定义因子表达式安全沙箱:基于 ast.parse 的白名单遍历,绝不 eval 原生 Python。

禁止:import、属性访问(.x)、下标([])、含 `__`、lambda、推导式、调用非白名单函数、
赋值/语句。只允许:数值常量、白名单字段名、白名单函数调用、算术/比较/布尔/三元。
编译为单个 polars 表达式;时序/横截面语义由 operators 的 .over(...) 承担(只回看,不前视)。
"""

from __future__ import annotations

import ast

import polars as pl

from .operators import FIELDS, OPS


class UnsafeExpression(ValueError):
    pass


_ALLOWED_NODES = (
    ast.Expression,
    ast.BinOp,
    ast.UnaryOp,
    ast.BoolOp,
    ast.Compare,
    ast.Call,
    ast.Name,
    ast.Load,
    ast.Constant,
    ast.IfExp,
    # 运算符
    ast.Add, ast.Sub, ast.Mult, ast.Div, ast.Pow, ast.Mod,
    ast.USub, ast.UAdd, ast.Not,
    ast.And, ast.Or,
    ast.Lt, ast.Gt, ast.LtE, ast.GtE, ast.Eq, ast.NotEq,
)

_BINOPS = {
    ast.Add: lambda a, b: a + b,
    ast.Sub: lambda a, b: a - b,
    ast.Mult: lambda a, b: a * b,
    ast.Div: lambda a, b: a / b,
    ast.Pow: lambda a, b: a**b,
    ast.Mod: lambda a, b: a % b,
}

_CMP = {
    ast.Lt: lambda a, b: a < b,
    ast.Gt: lambda a, b: a > b,
    ast.LtE: lambda a, b: a <= b,
    ast.GtE: lambda a, b: a >= b,
    ast.Eq: lambda a, b: a == b,
    ast.NotEq: lambda a, b: a != b,
}


def _to_expr(v) -> pl.Expr:
    return v if isinstance(v, pl.Expr) else pl.lit(v)


def validate_ast(node: ast.AST) -> None:
    """递归校验:任一不在白名单的节点 / 危险名 → UnsafeExpression。"""
    for child in ast.walk(node):
        if not isinstance(child, _ALLOWED_NODES):
            raise UnsafeExpression(f"不允许的语法:{type(child).__name__}")
        if isinstance(child, ast.Name) and "__" in child.id:
            raise UnsafeExpression(f"非法标识符:{child.id}")
        if isinstance(child, ast.Call):
            if not isinstance(child.func, ast.Name):
                raise UnsafeExpression("只允许调用白名单函数")
            if child.func.id not in OPS:
                raise UnsafeExpression(f"未知函数:{child.func.id}")
            if child.keywords or any(isinstance(a, ast.Starred) for a in child.args):
                raise UnsafeExpression("函数调用不支持关键字/解包参数")


def _compile(node: ast.AST):
    if isinstance(node, ast.Expression):
        return _compile(node.body)
    if isinstance(node, ast.Constant):
        if isinstance(node.value, bool) or not isinstance(node.value, (int, float)):
            raise UnsafeExpression("只允许数值常量")
        return node.value
    if isinstance(node, ast.Name):
        if "__" in node.id:
            raise UnsafeExpression(f"非法标识符:{node.id}")
        if node.id not in FIELDS:
            raise UnsafeExpression(f"未知字段:{node.id}(可用字段见 FIELDS)")
        return pl.col(node.id)
    if isinstance(node, ast.BinOp):
        op = _BINOPS.get(type(node.op))
        if op is None:
            raise UnsafeExpression(f"不允许的二元运算:{type(node.op).__name__}")
        return op(_to_expr(_compile(node.left)), _to_expr(_compile(node.right)))
    if isinstance(node, ast.UnaryOp):
        operand = _compile(node.operand)
        if isinstance(node.op, ast.USub):
            return -_to_expr(operand)
        if isinstance(node.op, ast.UAdd):
            return _to_expr(operand)
        if isinstance(node.op, ast.Not):
            return ~_to_expr(operand)
        raise UnsafeExpression("不允许的一元运算")
    if isinstance(node, ast.BoolOp):
        exprs = [_to_expr(_compile(v)) for v in node.values]
        out = exprs[0]
        for e in exprs[1:]:
            out = (out & e) if isinstance(node.op, ast.And) else (out | e)
        return out
    if isinstance(node, ast.Compare):
        if len(node.ops) != 1 or len(node.comparators) != 1:
            raise UnsafeExpression("只支持单个比较")
        cmp = _CMP.get(type(node.ops[0]))
        if cmp is None:
            raise UnsafeExpression("不允许的比较运算")
        return cmp(_to_expr(_compile(node.left)), _to_expr(_compile(node.comparators[0])))
    if isinstance(node, ast.IfExp):
        return pl.when(_to_expr(_compile(node.test))).then(
            _to_expr(_compile(node.body))
        ).otherwise(_to_expr(_compile(node.orelse)))
    if isinstance(node, ast.Call):
        fn = node.func
        if not isinstance(fn, ast.Name) or fn.id not in OPS:
            raise UnsafeExpression("只允许调用白名单函数")
        args = [_compile(a) for a in node.args]
        try:
            return OPS[fn.id](*args)
        except (TypeError, ValueError) as e:
            raise UnsafeExpression(f"{fn.id} 参数错误:{e}") from e
    raise UnsafeExpression(f"不允许的语法:{type(node).__name__}")


def compile_expr(expr_str: str) -> pl.Expr:
    """解析并编译为 polars 表达式;不安全语法抛 UnsafeExpression。"""
    try:
        tree = ast.parse(expr_str, mode="eval")
    except SyntaxError as e:
        raise UnsafeExpression(f"语法错误:{e}") from e
    validate_ast(tree)
    return _to_expr(_compile(tree))
