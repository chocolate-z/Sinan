"""训练流水线(M3)。本期先落地设备/CPU 核心动态配置;完整训练后续接入。"""

from .device import DeviceConfig, detect_gpu, resolve_device

__all__ = ["DeviceConfig", "detect_gpu", "resolve_device"]
