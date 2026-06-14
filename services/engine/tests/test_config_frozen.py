"""冻结分发(PyInstaller)下 config.defaults.json 的定位回归。

只有真打包才暴露的缺口:冻结后 __file__ 在 _internal/sinan 下、向上 walk 找不到仓库根的
config.defaults.json → 任何读 defaults() 的功能(provider 测试/建缓存/成本模型)都 FileNotFoundError。
修复让 _find_defaults() 在 frozen 时显式查 sys._MEIPASS 与 exe 同级;这里两条路径都覆盖。
"""

from __future__ import annotations

import json

from sinan import config


def test_find_defaults_uses_meipass_when_frozen(tmp_path, monkeypatch):
    cfg = tmp_path / "config.defaults.json"
    cfg.write_text(json.dumps({"marker": "meipass"}), encoding="utf-8")
    monkeypatch.delenv("SINAN_CONFIG_DEFAULTS", raising=False)
    monkeypatch.setattr(config.sys, "frozen", True, raising=False)
    monkeypatch.setattr(config.sys, "_MEIPASS", str(tmp_path), raising=False)
    assert config._find_defaults() == cfg


def test_find_defaults_falls_back_to_exe_dir_when_frozen(tmp_path, monkeypatch):
    exe = tmp_path / "sinan-engine.exe"
    exe.write_bytes(b"")
    cfg = tmp_path / "config.defaults.json"
    cfg.write_text(json.dumps({"marker": "exedir"}), encoding="utf-8")
    monkeypatch.delenv("SINAN_CONFIG_DEFAULTS", raising=False)
    monkeypatch.setattr(config.sys, "frozen", True, raising=False)
    # 无 _MEIPASS,退到 exe 同级。
    monkeypatch.setattr(config.sys, "_MEIPASS", None, raising=False)
    monkeypatch.setattr(config.sys, "executable", str(exe), raising=False)
    assert config._find_defaults() == cfg


def test_env_override_still_wins(tmp_path, monkeypatch):
    cfg = tmp_path / "explicit.json"
    cfg.write_text(json.dumps({"marker": "env"}), encoding="utf-8")
    monkeypatch.setenv("SINAN_CONFIG_DEFAULTS", str(cfg))
    assert config._find_defaults() == cfg
