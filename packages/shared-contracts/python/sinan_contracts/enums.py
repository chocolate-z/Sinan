"""跨服务枚举 Python 绑定 —— 镜像自 spec/enums.json。"""

from __future__ import annotations

from enum import Enum


class _StrEnum(str, Enum):
    def __str__(self) -> str:  # 让序列化/日志输出取值而非 "Class.MEMBER"
        return str(self.value)


class Provider(_StrEnum):
    TUSHARE = "tushare"
    AKSHARE = "akshare"
    REALTIME_SINA = "realtime_sina"
    REALTIME_TENCENT = "realtime_tencent"


class ProviderStatus(_StrEnum):
    OK = "ok"
    ERROR = "error"
    UNKNOWN = "unknown"


class Dataset(_StrEnum):
    PRICE = "price"
    ADJ_FACTOR = "adj_factor"
    DAILY_BASIC = "daily_basic"
    FUNDAMENTAL = "fundamental"
    FINA_INDICATOR = "fina_indicator"
    NORTHBOUND = "northbound"
    INDEX_OHLCV = "index_ohlcv"
    INDEX_WEIGHT = "index_weight"
    SW_INDUSTRY = "sw_industry"


class JobType(_StrEnum):
    CACHE_BUILD = "cache_build"
    INCREMENTAL = "incremental"
    TRAIN = "train"
    SIGNAL_GEN = "signal_gen"
    PAPER_RUN = "paper_run"
    NEWS_FETCH = "news_fetch"


class JobStatus(_StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    PAUSED = "paused"
    DONE = "done"
    FAILED = "failed"
    CANCELED = "canceled"


class JobTrigger(_StrEnum):
    MANUAL = "manual"
    SCHEDULE = "schedule"
    ONBOARDING = "onboarding"


class Board(_StrEnum):
    SH = "sh"
    SZ = "sz"
    BJ = "bj"


class Portfolio(_StrEnum):
    MODEL = "model"
    PERSONAL = "personal"


class SignalAction(_StrEnum):
    BUY = "buy"
    SELL = "sell"
    HOLD = "hold"


class TradeSide(_StrEnum):
    BUY = "buy"
    SELL = "sell"


class TradeReason(_StrEnum):
    SIGNAL = "signal"
    STOP_LOSS = "stop_loss"
    TAKE_PROFIT = "take_profit"
    RANK_OUT = "rank_out"
    MARKET_FILTER = "market_filter"
    MANUAL = "manual"


class LogLevel(_StrEnum):
    DEBUG = "debug"
    INFO = "info"
    WARN = "warn"
    ERROR = "error"


class OnboardingStep(_StrEnum):
    WELCOME = "welcome"
    SELECT_SOURCE = "select_source"
    CREDENTIAL = "credential"
    TEST = "test"
    BUILD_CACHE = "build_cache"
    DONE = "done"


class ModelType(_StrEnum):
    ELASTICNET = "elasticnet"


class ModelStatus(_StrEnum):
    DRAFT = "draft"
    RUNNING = "running"
    ARCHIVED = "archived"


# 供 consistency 测试逐项比对 spec/enums.json。
ENUM_MIRROR: dict[str, list[str]] = {
    "Provider": [e.value for e in Provider],
    "ProviderStatus": [e.value for e in ProviderStatus],
    "Dataset": [e.value for e in Dataset],
    "JobType": [e.value for e in JobType],
    "JobStatus": [e.value for e in JobStatus],
    "JobTrigger": [e.value for e in JobTrigger],
    "Board": [e.value for e in Board],
    "Portfolio": [e.value for e in Portfolio],
    "SignalAction": [e.value for e in SignalAction],
    "TradeSide": [e.value for e in TradeSide],
    "TradeReason": [e.value for e in TradeReason],
    "LogLevel": [e.value for e in LogLevel],
    "OnboardingStep": [e.value for e in OnboardingStep],
    "ModelType": [e.value for e in ModelType],
    "ModelStatus": [e.value for e in ModelStatus],
}
