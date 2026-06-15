"""TDX 公式语法分析:token 流 → Program AST(递归下降 + 优先级爬升)。

文法(分号分隔多语句):
  program   := statement (';' statement)* ';'?
  statement := IDENT (':=' | ':') expr modifiers?    # 赋值(临时/输出)
             | expr modifiers?                        # 裸语句(如 DRAWTEXT(...))
  modifiers := (',' <任意 token>)*                    # 绘制属性 STICK/COLOR../LINETHICK..,整体忽略
优先级(低→高):or < and < 比较 < 加减 < 乘除 < 一元(- / not) < primary
"""

from __future__ import annotations

from .ast_nodes import BinOp, Call, Name, Num, Program, Statement, Str, UnaryOp
from .errors import TdxSyntaxError
from .lexer import Token, tokenize

_CMP = {"LT": "<", "LE": "<=", "GT": ">", "GE": ">=", "EQ": "==", "NE": "!="}


class _Parser:
    def __init__(self, toks: list[Token]) -> None:
        self.toks = toks
        self.i = 0

    def peek(self) -> Token:
        return self.toks[self.i]

    def next(self) -> Token:
        t = self.toks[self.i]
        self.i += 1
        return t

    def expect(self, kind: str) -> Token:
        t = self.peek()
        if t.kind != kind:
            raise TdxSyntaxError(f"期望 {kind},实际 {t.kind}({t.value!r},位置 {t.pos})")
        return self.next()

    # IDENT 是否是关键字算子(大小写不敏感)
    def _ident_is(self, t: Token, *words: str) -> bool:
        return t.kind == "IDENT" and t.value.upper() in words

    def parse(self) -> Program:
        prog = Program()
        while self.peek().kind != "EOF":
            if self.peek().kind == "SEMI":  # 空语句
                self.next()
                continue
            prog.statements.append(self._statement())
            if self.peek().kind == "SEMI":
                self.next()
            elif self.peek().kind != "EOF":
                t = self.peek()
                raise TdxSyntaxError(f"语句后期望 ; 或结束,实际 {t.value!r}(位置 {t.pos})")
        return prog

    def _statement(self) -> Statement:
        # 赋值:IDENT (':=' | ':') ...
        if self.peek().kind == "IDENT" and self.toks[self.i + 1].kind in ("ASSIGN_TEMP", "ASSIGN_OUT"):
            name = self.next().value
            kind = "temp" if self.next().kind == "ASSIGN_TEMP" else "output"
            expr = self._expr()
            mods = self._modifiers()
            return Statement(kind=kind, name=name, expr=expr, modifiers=mods)
        # 裸语句
        expr = self._expr()
        mods = self._modifiers()
        return Statement(kind="bare", name=None, expr=expr, modifiers=mods)

    def _modifiers(self) -> str:
        # 主表达式之后,逗号引导的绘制属性整体吞掉(到 ; 或 EOF),仅记录文本。
        parts: list[str] = []
        while self.peek().kind == "COMMA":
            self.next()
            while self.peek().kind not in ("SEMI", "EOF", "COMMA"):
                parts.append(self.next().value)
        return " ".join(parts)

    # ── 表达式(优先级爬升)──────────────────────────────────────────────
    def _expr(self):
        return self._or()

    def _or(self):
        left = self._and()
        while self._ident_is(self.peek(), "OR") or self.peek().kind == "OR":
            self.next()
            left = BinOp("or", left, self._and())
        return left

    def _and(self):
        left = self._cmp()
        while self._ident_is(self.peek(), "AND") or self.peek().kind == "AND":
            self.next()
            left = BinOp("and", left, self._cmp())
        return left

    def _cmp(self):
        left = self._add()
        while self.peek().kind in _CMP:
            op = _CMP[self.next().kind]
            left = BinOp(op, left, self._add())
        return left

    def _add(self):
        left = self._mul()
        while self.peek().kind in ("PLUS", "MINUS"):
            op = "+" if self.next().kind == "PLUS" else "-"
            left = BinOp(op, left, self._mul())
        return left

    def _mul(self):
        left = self._unary()
        while self.peek().kind in ("STAR", "SLASH"):
            op = "*" if self.next().kind == "STAR" else "/"
            left = BinOp(op, left, self._unary())
        return left

    def _unary(self):
        if self.peek().kind == "MINUS":
            self.next()
            return UnaryOp("-", self._unary())
        if self._ident_is(self.peek(), "NOT"):
            self.next()
            return UnaryOp("not", self._unary())
        return self._primary()

    def _primary(self):
        t = self.peek()
        if t.kind == "NUMBER":
            self.next()
            return Num(float(t.value))
        if t.kind == "STRING":
            self.next()
            return Str(t.value)
        if t.kind == "LPAREN":
            self.next()
            e = self._expr()
            self.expect("RPAREN")
            return e
        if t.kind == "IDENT":
            self.next()
            if self.peek().kind == "LPAREN":  # 函数调用
                self.next()
                args = []
                if self.peek().kind != "RPAREN":
                    args.append(self._expr())
                    while self.peek().kind == "COMMA":
                        self.next()
                        args.append(self._expr())
                self.expect("RPAREN")
                return Call(func=t.value.lower(), args=args)
            return Name(ident=t.value)
        raise TdxSyntaxError(f"表达式中意外的 {t.kind}({t.value!r},位置 {t.pos})")


def parse(src: str) -> Program:
    return _Parser(tokenize(src)).parse()
