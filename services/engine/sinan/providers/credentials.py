"""凭据来源抽象。

红线#6:engine 不拥有钥匙串。token 由 api(钥匙串持有者)在请求时下发到 engine,
用完即弃。engine 侧只见明文于内存、绝不落盘/落日志。
- RequestCredentialSource:生产路径,token 随请求体/头传入。
- EnvCredentialSource:开发/测试路径,从 SINAN_TOKEN_<PROVIDER> 读取。
"""

from __future__ import annotations

import os
from typing import Mapping, Protocol


class CredentialSource(Protocol):
    def get_token(self, provider: str) -> str | None: ...


class RequestCredentialSource:
    """每次 api→engine 请求构造一次,持有本次请求下发的明文 token。"""

    def __init__(self, tokens: Mapping[str, str] | None = None) -> None:
        self._tokens = dict(tokens or {})

    def get_token(self, provider: str) -> str | None:
        return self._tokens.get(provider)


class EnvCredentialSource:
    """开发/测试:从环境变量 SINAN_TOKEN_<PROVIDER 大写> 读取。"""

    def get_token(self, provider: str) -> str | None:
        return os.environ.get(f"SINAN_TOKEN_{provider.upper()}")
