"""通达信(TDX)公式子系统的异常。与 indicators 沙箱同思想:解析期静态拒绝不安全/非法公式。"""

from __future__ import annotations


class TdxError(Exception):
    """TDX 公式基类错误。"""


class TdxSyntaxError(TdxError):
    """词法/语法错误(无法解析)。"""


class TdxUnsafeError(TdxError):
    """安全/红线错误:未知函数、负 REF(前视)、非常量窗口参数等 —— 结构上拒绝未来函数与注入。"""
