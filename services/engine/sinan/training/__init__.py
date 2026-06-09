"""训练流水线(M3):设备解析 + 特征面板 + 前向标签(+ 后续训练器/路由)。"""

from .device import DeviceConfig, detect_gpu, resolve_device
from .features import FeaturePanel, build_feature_panel
from .labels import build_forward_return_labels

__all__ = [
    "DeviceConfig",
    "detect_gpu",
    "resolve_device",
    "FeaturePanel",
    "build_feature_panel",
    "build_forward_return_labels",
]
