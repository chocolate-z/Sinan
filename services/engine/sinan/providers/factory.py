"""标准注册表工厂:按 BYO 凭据构建 Tushare/AkShare/Realtime 三源注册表。"""

from __future__ import annotations

import time
from typing import Callable

from .. import config
from .akshare_provider import AkShareProvider
from .credentials import CredentialSource, EnvCredentialSource
from .realtime_provider import RealtimeProvider
from .registry import ProviderRegistry
from .tushare_provider import TushareProvider


def build_registry(
    credentials: CredentialSource | None = None,
    *,
    clock: Callable[[], float] = time.monotonic,
    sleep: Callable[[float], None] = time.sleep,
) -> ProviderRegistry:
    credentials = credentials or EnvCredentialSource()
    providers = [
        TushareProvider(credentials.get_token("tushare")),
        AkShareProvider(),
        RealtimeProvider(),
    ]
    rate_limits = {
        "tushare": config.rate_limit_for("tushare"),
        "akshare": config.rate_limit_for("akshare"),
        "realtime_sina": config.rate_limit_for("realtime_sina"),
    }
    return ProviderRegistry(providers, rate_limits=rate_limits, clock=clock, sleep=sleep)
