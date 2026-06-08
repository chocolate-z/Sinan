"""三层配置加载:打包默认(config.defaults.json)< SQLite settings < SINAN_* 环境变量。

engine 进程只读 SQLite,不直接读 settings 表;运行期可变设置由 api 经请求参数下发。
本模块负责:定位 config.defaults.json、提供数据根目录、端口、限流默认、出网白名单。
机密(token)绝不进此体系 —— 只由 api 经请求头/体下发(红线#4)。
"""

from __future__ import annotations

import json
import os
from functools import lru_cache
from pathlib import Path
from typing import Any


def _find_defaults() -> Path:
    env = os.environ.get("SINAN_CONFIG_DEFAULTS")
    if env and Path(env).is_file():
        return Path(env)
    here = Path(__file__).resolve()
    # services/engine/sinan/config.py -> 仓库根在 parents[3]
    for base in [here, *here.parents]:
        candidate = base / "config.defaults.json"
        if candidate.is_file():
            return candidate
    raise FileNotFoundError("找不到 config.defaults.json;请设置 SINAN_CONFIG_DEFAULTS。")


@lru_cache(maxsize=1)
def defaults() -> dict[str, Any]:
    with _find_defaults().open("r", encoding="utf-8") as f:
        return json.load(f)


def data_dir() -> Path:
    """运行期用户数据根目录(绝不在安装目录内)。"""
    env = os.environ.get("SINAN_DATA_DIR")
    if env:
        p = Path(env)
    elif os.name == "nt":
        base = os.environ.get("APPDATA") or str(Path.home() / "AppData" / "Roaming")
        p = Path(base) / "Sinan"
    elif os.sys.platform == "darwin":  # type: ignore[attr-defined]
        p = Path.home() / "Library" / "Application Support" / "Sinan"
    else:
        p = Path.home() / ".local" / "share" / "sinan"
    p.mkdir(parents=True, exist_ok=True)
    return p


def cache_dir() -> Path:
    p = data_dir() / "cache"
    p.mkdir(parents=True, exist_ok=True)
    return p


def duckdb_path() -> Path:
    p = data_dir() / "duckdb"
    p.mkdir(parents=True, exist_ok=True)
    return p / "sinan.duckdb"


def sqlite_path() -> Path:
    return data_dir() / "sinan.db"


def rate_limit_for(provider: str) -> dict[str, Any]:
    rl = defaults().get("rate_limit_defaults", {})
    return dict(rl.get(provider, {"per_min": 120}))


def internal_token() -> str | None:
    """api→engine 内部调用校验 token(X-Sinan-Internal);由 Tauri 下发会话 token。"""
    return os.environ.get("SINAN_IPC_TOKEN")
