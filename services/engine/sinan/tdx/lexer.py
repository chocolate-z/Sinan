"""TDX 公式词法分析:把公式文本切成 token 流。

支持:中文标识符、浮点数、单引号字符串、:= / : 赋值、比较/算术/逻辑算子、{...} 注释。
大小写不敏感由解析/求值层处理(函数名、字段名统一小写匹配);标识符原文保留(VAR1/准备拉升)。
"""

from __future__ import annotations

from dataclasses import dataclass

from .errors import TdxSyntaxError

# 多字符算子(先长后短匹配,避免 := 被切成 : 和 =)
_MULTI = [
    (":=", "ASSIGN_TEMP"),
    ("<=", "LE"),
    (">=", "GE"),
    ("<>", "NE"),
    ("!=", "NE"),
    ("==", "EQ"),
    ("&&", "AND"),
    ("||", "OR"),
]
_SINGLE = {
    ":": "ASSIGN_OUT",
    "<": "LT",
    ">": "GT",
    "=": "EQ",
    "+": "PLUS",
    "-": "MINUS",
    "*": "STAR",
    "/": "SLASH",
    "(": "LPAREN",
    ")": "RPAREN",
    ",": "COMMA",
    ";": "SEMI",
}


@dataclass
class Token:
    kind: str
    value: str
    pos: int


def _is_ident_start(c: str) -> bool:
    return c.isalpha() or c == "_" or "一" <= c <= "鿿"


def _is_ident_part(c: str) -> bool:
    return c.isalnum() or c == "_" or "一" <= c <= "鿿"


def tokenize(src: str) -> list[Token]:
    toks: list[Token] = []
    i, n = 0, len(src)
    while i < n:
        c = src[i]
        if c in " \t\r\n":
            i += 1
            continue
        if c == "{":  # TDX 块注释 {...}
            end = src.find("}", i + 1)
            if end < 0:
                raise TdxSyntaxError("注释 { 未闭合")
            i = end + 1
            continue
        if c == "'":  # 字符串 '建仓'
            end = src.find("'", i + 1)
            if end < 0:
                raise TdxSyntaxError("字符串引号未闭合")
            toks.append(Token("STRING", src[i + 1 : end], i))
            i = end + 1
            continue
        if c.isdigit() or (c == "." and i + 1 < n and src[i + 1].isdigit()):
            j = i
            while j < n and (src[j].isdigit() or src[j] == "."):
                j += 1
            num = src[i:j]
            if num.count(".") > 1:
                raise TdxSyntaxError(f"非法数字 {num}")
            toks.append(Token("NUMBER", num, i))
            i = j
            continue
        if _is_ident_start(c):
            j = i
            while j < n and _is_ident_part(src[j]):
                j += 1
            toks.append(Token("IDENT", src[i:j], i))
            i = j
            continue
        matched = False
        for text, kind in _MULTI:
            if src.startswith(text, i):
                toks.append(Token(kind, text, i))
                i += len(text)
                matched = True
                break
        if matched:
            continue
        if c in _SINGLE:
            toks.append(Token(_SINGLE[c], c, i))
            i += 1
            continue
        raise TdxSyntaxError(f"无法识别的字符 {c!r}(位置 {i})")
    toks.append(Token("EOF", "", n))
    return toks
