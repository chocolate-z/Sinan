"""定位并加载 canonical spec/*.json(单一真相源)。

解析顺序:
1. 环境变量 SINAN_CONTRACTS_SPEC_DIR(打包/冻结期可显式指定);
2. 包内随附副本 sinan_contracts/spec/(wheel 打包时拷贝,M6);
3. 仓库内源位置 packages/shared-contracts/spec/(editable/in-repo)。
"""

from __future__ import annotations

import json
import os
from functools import lru_cache
from pathlib import Path
from typing import Any


def _candidate_dirs() -> list[Path]:
    dirs: list[Path] = []
    env = os.environ.get("SINAN_CONTRACTS_SPEC_DIR")
    if env:
        dirs.append(Path(env))
    here = Path(__file__).resolve()
    dirs.append(here.parent / "spec")  # 包内副本
    dirs.append(here.parents[2] / "spec")  # 仓库源:packages/shared-contracts/spec
    return dirs


@lru_cache(maxsize=1)
def spec_dir() -> Path:
    for d in _candidate_dirs():
        if (d / "capabilities.json").is_file():
            return d
    raise FileNotFoundError(
        "找不到 shared-contracts spec 目录;请设置 SINAN_CONTRACTS_SPEC_DIR 或在仓库内运行。"
    )


@lru_cache(maxsize=None)
def load_spec(name: str) -> Any:
    path = spec_dir() / name
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)
