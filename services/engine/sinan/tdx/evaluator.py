"""TDX 公式求值:AST → polars 表达式(每股时序,PIT 安全)。

双模求值:每个表达式产出 Const(纯常量标量)或 Series(polars 表达式)。
- 窗口/平滑参数(REF/MA/SUM/HHV/LLV/SMA/EMA/COUNT 的 N、SMA 的 M)必须求值为常量,否则报错
  (MVP 限定:α 须为常数才能走 ewm 快路;变量窗口留 v2 的逐根 scan)。
- 时序算子一律 .over("stock_code")(面板已按 stock_code 分组、trade_date 升序),防跨股串联。

红线#1(无未来函数)结构保证:只实现回看算子(shift(+)/rolling/ewm/cum);REF 的 N<0(前视)
在 _int_window 直接拒(TdxUnsafeError)。配合 crossing 黄金测试(全量==截断≤T)双保险。

关键正确性(易错点,黄金测试锁死):
- SMA(X,N,M) = 中国式递归加权,α=M/N,必须 ewm_mean(alpha=M/N, adjust=False) —— 不是
  rolling_mean,也不是 ewm(span=N);N 非整数(如 3.2)保留浮点,绝不取整。
- EMA(X,N) = α=2/(N+1),ewm_mean(span=N, adjust=False)。
- CROSS(A,B) = (A−B 前一根 ≤0) 且 (当前根 >0),只在上穿瞬间为真。
"""

from __future__ import annotations

from dataclasses import dataclass

import polars as pl

from .ast_nodes import BinOp, Call, Name, Num, Program, Str, UnaryOp
from .errors import TdxError, TdxUnsafeError
from .parser import parse

# TDX 字段名(小写)→ 面板列名。面板由 _build_tdx_panel 提供。
_FIELD_MAP = {
    "close": "close", "open": "open", "high": "high", "low": "low",
    "vol": "volume", "volume": "volume", "amount": "amount",
}


@dataclass
class Const:
    value: float


@dataclass
class Series:
    expr: pl.Expr
    is_bool: bool = False


def _as_series(v) -> pl.Expr:
    return pl.lit(v.value) if isinstance(v, Const) else v.expr


def _as_const(v, who: str) -> float:
    if not isinstance(v, Const):
        raise TdxError(f"{who} 的该参数必须是常量(MVP 不支持变量窗口/平滑系数)")
    return v.value


def _int_window(v, who: str, *, allow_zero: bool) -> int:
    c = _as_const(v, who)
    if c < 0:
        raise TdxUnsafeError(f"{who} 的窗口参数 {c} 为负 —— 负向引用会引入未来函数(红线#1),拒绝")
    n = int(round(c))
    if n != c:
        raise TdxError(f"{who} 的窗口参数必须为整数,收到 {c}")
    if n == 0 and not allow_zero:
        raise TdxError(f"{who} 的窗口参数必须为正整数")
    return n


def _truthy(v: Series) -> pl.Expr:
    """TDX「非零为真」:布尔列直接用,数值列转 (x != 0)。"""
    return v.expr if v.is_bool else (_as_series(v) != 0)


def _over(e: pl.Expr) -> pl.Expr:
    return e.over("stock_code")


# ── 函数注册表(白名单;未列出的函数 → 报错)──────────────────────────────────
def _f_ref(args):
    x, n = args
    k = _int_window(n, "REF", allow_zero=True)
    return Series(_over(_as_series(x).shift(k)))


def _f_ma(args):
    x, n = args
    k = _int_window(n, "MA", allow_zero=False)
    return Series(_over(_as_series(x).rolling_mean(k, min_periods=1)))


def _f_sum(args):
    x, n = args
    k = _int_window(n, "SUM", allow_zero=True)
    e = _as_series(x)
    return Series(_over(e.cum_sum() if k == 0 else e.rolling_sum(k, min_periods=1)))


def _f_hhv(args):
    x, n = args
    k = _int_window(n, "HHV", allow_zero=True)
    e = _as_series(x)
    return Series(_over(e.cum_max() if k == 0 else e.rolling_max(k, min_periods=1)))


def _f_llv(args):
    x, n = args
    k = _int_window(n, "LLV", allow_zero=True)
    e = _as_series(x)
    return Series(_over(e.cum_min() if k == 0 else e.rolling_min(k, min_periods=1)))


def _f_sma(args):
    x, n, m = args
    nn = _as_const(n, "SMA.N")
    mm = _as_const(m, "SMA.M")
    if nn <= 0:
        raise TdxError("SMA 的 N 必须 > 0")
    if not (0 < mm <= nn):
        raise TdxError(f"SMA 要求 0 < M <= N(收到 M={mm}, N={nn})")
    # α=M/N 的递归加权;adjust=False 才是 Y_t=α·X+(1-α)·Y_{t-1}(与通达信逐位相等)。N 保留浮点。
    return Series(_over(_as_series(x).ewm_mean(alpha=mm / nn, adjust=False, min_periods=1)))


def _f_ema(args):
    x, n = args
    nn = _as_const(n, "EMA.N")
    if nn <= 0:
        raise TdxError("EMA 的 N 必须 > 0")
    return Series(_over(_as_series(x).ewm_mean(alpha=2.0 / (nn + 1.0), adjust=False, min_periods=1)))


def _f_cross(args):
    a, b = args
    d = _as_series(a) - _as_series(b)
    cross = (_over(d.shift(1)) <= 0) & (d > 0)
    return Series(cross.fill_null(False), is_bool=True)


def _f_if(args):
    cond, a, b = args
    return Series(pl.when(_truthy(cond)).then(_as_series(a)).otherwise(_as_series(b)))


def _f_count(args):
    cond, n = args
    k = _int_window(n, "COUNT", allow_zero=True)
    flag = pl.when(_truthy(cond)).then(1).otherwise(0)
    return Series(_over(flag.cum_sum() if k == 0 else flag.rolling_sum(k, min_periods=1)))


def _f_max(args):
    a, b = args
    return Series(pl.max_horizontal(_as_series(a), _as_series(b)))


def _f_min(args):
    a, b = args
    return Series(pl.min_horizontal(_as_series(a), _as_series(b)))


def _f_abs(args):
    (x,) = args
    return Series(_as_series(x).abs())


# 函数名 → (实现, 参数个数)
_FUNCS: dict[str, tuple] = {
    "ref": (_f_ref, 2),
    "ma": (_f_ma, 2),
    "sum": (_f_sum, 2),
    "hhv": (_f_hhv, 2),
    "llv": (_f_llv, 2),
    "sma": (_f_sma, 3),
    "ema": (_f_ema, 2),
    "cross": (_f_cross, 2),
    "if": (_f_if, 3),
    "iff": (_f_if, 3),
    "count": (_f_count, 2),
    "max": (_f_max, 2),
    "min": (_f_min, 2),
    "abs": (_f_abs, 1),
}

# 绘制/标注函数:MVP 不渲染,但其首个参数是「条件信号」→ 抽取为可选信号列。
_DRAW_FUNCS = {"drawtext", "drawicon", "stickline", "drawnumber", "drawkline"}


class _Env:
    def __init__(self) -> None:
        self.vars: dict[str, Series | Const] = {}

    def get(self, ident: str):
        return self.vars.get(ident.upper())

    def set(self, ident: str, val) -> None:
        self.vars[ident.upper()] = val


def _eval(node, env: _Env):
    if isinstance(node, Num):
        return Const(node.value)
    if isinstance(node, Str):
        raise TdxError("字符串不能用于数值计算")
    if isinstance(node, Name):
        v = env.get(node.ident)
        if v is not None:
            return v
        col = _FIELD_MAP.get(node.ident.lower())
        if col is not None:
            return Series(pl.col(col))
        raise TdxError(f"未知字段或变量:{node.ident}")
    if isinstance(node, UnaryOp):
        v = _eval(node.operand, env)
        if node.op == "-":
            return Const(-v.value) if isinstance(v, Const) else Series(-_as_series(v))
        return Series(~_truthy(v), is_bool=True)  # not
    if isinstance(node, BinOp):
        return _eval_binop(node, env)
    if isinstance(node, Call):
        return _eval_call(node, env)
    raise TdxError(f"无法求值的节点 {type(node).__name__}")


def _eval_binop(node: BinOp, env: _Env):
    op = node.op
    left = _eval(node.left, env)
    right = _eval(node.right, env)
    if op in ("and", "or"):
        lb, rb = _truthy(left), _truthy(right)
        return Series((lb & rb) if op == "and" else (lb | rb), is_bool=True)
    # 常量折叠(两侧皆常量 → 标量,供窗口参数如 N-1)
    if isinstance(left, Const) and isinstance(right, Const):
        a, b = left.value, right.value
        if op == "+":
            return Const(a + b)
        if op == "-":
            return Const(a - b)
        if op == "*":
            return Const(a * b)
        if op == "/":
            return Const(a / b if b != 0 else 0.0)
        return Const(1.0 if _CMP_PY[op](a, b) else 0.0)
    le, re = _as_series(left), _as_series(right)
    if op == "+":
        return Series(le + re)
    if op == "-":
        return Series(le - re)
    if op == "*":
        return Series(le * re)
    if op == "/":
        # 安全除:分母 0 → 0(防 inf 污染递归 SMA/EMA;一字板 HHV==LLV 即此情形)
        return Series(pl.when(re != 0).then(le / re).otherwise(0.0))
    return Series(_CMP_PL[op](le, re), is_bool=True)


_CMP_PY = {
    "<": lambda a, b: a < b, "<=": lambda a, b: a <= b,
    ">": lambda a, b: a > b, ">=": lambda a, b: a >= b,
    "==": lambda a, b: a == b, "!=": lambda a, b: a != b,
}
_CMP_PL = {
    "<": lambda a, b: a < b, "<=": lambda a, b: a <= b,
    ">": lambda a, b: a > b, ">=": lambda a, b: a >= b,
    "==": lambda a, b: a == b, "!=": lambda a, b: a != b,
}


def _eval_call(node: Call, env: _Env):
    fn = _FUNCS.get(node.func)
    if fn is None:
        raise TdxUnsafeError(f"不支持的函数:{node.func.upper()}(白名单外,拒绝)")
    impl, arity = fn
    if len(node.args) != arity:
        raise TdxError(f"{node.func.upper()} 需要 {arity} 个参数,收到 {len(node.args)}")
    return impl([_eval(a, env) for a in node.args])


@dataclass
class CompiledFormula:
    """编译产物:输出列(name→Series)+ 临时变量列表 + 信号候选名。"""

    outputs: dict[str, Series]
    temps: list[str]
    signals: list[str]  # 可作检测信号的输出名(布尔列 / DRAWTEXT 条件)


def compile_program(src: str) -> CompiledFormula:
    """解析 + 求值整段公式 → 输出列。不需数据(polars 表达式惰性);非法/不安全即抛 TdxError。"""
    prog: Program = parse(src)
    env = _Env()
    outputs: dict[str, Series] = {}
    temps: list[str] = []
    signals: list[str] = []
    draw_idx = 0
    for st in prog.statements:
        if st.kind in ("temp", "output"):
            val = _eval(st.expr, env)
            if isinstance(val, Const):  # 标量赋值(如 N:=5)只入环境,不作列
                env.set(st.name, val)
                if st.kind == "output":
                    outputs[st.name] = Series(pl.lit(val.value))
                continue
            env.set(st.name, val)
            if st.kind == "output":
                outputs[st.name] = val
                if val.is_bool:
                    signals.append(st.name)
            else:
                temps.append(st.name)
        else:  # bare:绘制/标注语句,抽取其条件作信号
            if isinstance(st.expr, Call) and st.expr.func in _DRAW_FUNCS and st.expr.args:
                cond = _eval(st.expr.args[0], env)
                label = None
                for a in st.expr.args:
                    if isinstance(a, Str):
                        label = a.value
                        break
                draw_idx += 1
                name = label or f"信号{draw_idx}"
                base, k = name, 1
                while name in outputs:
                    k += 1
                    name = f"{base}{k}"
                outputs[name] = Series(_truthy(cond), is_bool=True)
                signals.append(name)
    # 输出里数值列若整体是「IF(cond,正,0)」式信号(非布尔但可!=0 触发),也列为候选信号。
    for nm, s in outputs.items():
        if nm not in signals:
            signals.append(nm)
    return CompiledFormula(outputs=outputs, temps=temps, signals=signals)


def trigger_expr(s: Series) -> pl.Expr:
    """某输出列 → 当日「是否触发」布尔:布尔列取真;数值列取 (!=0 且非空)。"""
    if s.is_bool:
        return s.expr.fill_null(False)
    return (_as_series(s) != 0) & _as_series(s).is_not_null()
