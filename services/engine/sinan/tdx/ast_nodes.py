"""TDX 公式 AST 节点(dataclass)。"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class Num:
    value: float


@dataclass
class Str:
    value: str


@dataclass
class Name:
    ident: str  # 字段(CLOSE)或已定义名(VAR1/N)


@dataclass
class Call:
    func: str  # 小写归一后的函数名
    args: list  # list[Expr]


@dataclass
class BinOp:
    op: str  # + - * / < <= > >= == != and or
    left: object
    right: object


@dataclass
class UnaryOp:
    op: str  # - / not
    operand: object


@dataclass
class Statement:
    kind: str  # 'temp'(:=) | 'output'(:) | 'bare'
    name: str | None  # 赋值左侧名;bare 为 None
    expr: object
    modifiers: str = ""  # 绘制修饰(STICK/COLOR../LINETHICK..),仅记录不参与计算


@dataclass
class Program:
    statements: list = field(default_factory=list)
