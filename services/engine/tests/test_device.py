"""训练设备 / CPU 核心动态配置自测。"""

from sinan.training import resolve_device


def test_auto_uses_all_cores():
    cfg = resolve_device("auto", "cpu", cpu_count=8, gpu_available=False)
    assert cfg.num_threads == 8
    assert cfg.device == "cpu"
    assert cfg.cpu_count == 8


def test_explicit_threads_within_range():
    cfg = resolve_device(4, "cpu", cpu_count=8, gpu_available=False)
    assert cfg.num_threads == 4


def test_threads_clamped_to_cores():
    assert resolve_device(100, "cpu", cpu_count=8, gpu_available=False).num_threads == 8
    assert resolve_device(0, "cpu", cpu_count=8, gpu_available=False).num_threads == 1
    assert resolve_device(-3, "cpu", cpu_count=8, gpu_available=False).num_threads == 1


def test_gpu_auto_and_fallback():
    # auto + 有 GPU → gpu
    assert resolve_device("auto", "auto", cpu_count=8, gpu_available=True).device == "gpu"
    # 请求 gpu 但不可用 → 回退 cpu
    assert resolve_device("auto", "gpu", cpu_count=8, gpu_available=False).device == "cpu"
    # auto + 无 GPU → cpu
    assert resolve_device("auto", "auto", cpu_count=8, gpu_available=False).device == "cpu"


def test_bad_threads_value_falls_back_to_auto():
    cfg = resolve_device("garbage", "cpu", cpu_count=6, gpu_available=False)
    assert cfg.num_threads == 6
