"""训练设备 / CPU 核心动态配置。

train_threads / train_device 存于 SQLite settings(用户可热改 = 动态),engine 训练时读取并
经 resolve_device 钳制:线程数 [1, 物理/逻辑核数];device='auto' 时探测 GPU,缺则回退 CPU。
**绝不上云**:仅本机计算。
"""

from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class DeviceConfig:
    device: str  # 'cpu' | 'gpu'
    num_threads: int
    gpu_available: bool
    cpu_count: int

    @property
    def note(self) -> str:
        gpu = "有 CUDA" if self.gpu_available else "无 CUDA"
        return f"检测到 CPU {self.cpu_count} 核 / {gpu};本次用 {self.device}、{self.num_threads} 线程"


def detect_gpu() -> bool:
    """探测 CUDA(torch 可选)。不可导入则视为无 GPU,纯 CPU 跑。"""
    if os.environ.get("SINAN_FORCE_NO_GPU") == "1":
        return False
    try:
        import torch  # type: ignore

        return bool(torch.cuda.is_available())
    except Exception:
        return False


def resolve_device(
    train_threads: str | int | None = "auto",
    device: str = "auto",
    *,
    cpu_count: int | None = None,
    gpu_available: bool | None = None,
) -> DeviceConfig:
    """把用户设置解析为可执行的设备配置。

    train_threads: 'auto'/'max'/None → 用全部核;整数 → 钳制到 [1, cores]。
    device: 'auto'(有 GPU 用 GPU)/ 'cpu' / 'gpu'(不可用回退 CPU)。
    cpu_count / gpu_available 可注入,便于确定性单测。
    """
    cores = cpu_count if cpu_count is not None else (os.cpu_count() or 1)
    cores = max(1, int(cores))
    gpu = gpu_available if gpu_available is not None else detect_gpu()

    dev = device.lower()
    if dev == "auto":
        dev = "gpu" if gpu else "cpu"
    elif dev == "gpu" and not gpu:
        dev = "cpu"  # 请求 GPU 但不可用 → 回退
    if dev not in ("cpu", "gpu"):
        dev = "cpu"

    if train_threads in (None, "auto", "max", ""):
        n = cores
    else:
        try:
            n = int(train_threads)
        except (TypeError, ValueError):
            n = cores
    n = max(1, min(n, cores))  # 钳制 [1, cores]

    return DeviceConfig(device=dev, num_threads=n, gpu_available=gpu, cpu_count=cores)
