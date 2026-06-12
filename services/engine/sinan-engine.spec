# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller 规格:把引擎冻结成 sidecar `sinan-engine`(one-dir)。

为何 one-dir 而非 one-file:
- 多进程(特征面板多核 ProcessPoolExecutor)子进程会重启本 exe;one-file 每个子进程都要把整个
  bundle 解压到临时目录 → 慢且易出问题。one-dir 依赖已在磁盘,子进程秒起。
- 启动更快(无解压)。代价:产物是个目录,作为 Tauri `resources` 目录打包(非 externalBin 单文件)。

构建(在 services/engine 下,venv 激活、已 pip install pyinstaller):
    pyinstaller sinan-engine.spec --noconfirm
产出 dist/sinan-engine/sinan-engine.exe(+ 同目录依赖)。

⚠️ 首次构建大概率要补 hiddenimports/datas(PyInstaller 静态分析抓不全 sinan 的惰性 import 与
native 包数据)。跑出来若报 ModuleNotFoundError，把缺的模块加进 collect 列表再构建。
"""

from PyInstaller.utils.hooks import collect_all, collect_submodules

_datas, _binaries, _hidden = [], [], []

# 第三方(含 native 库/数据文件):collect_all 抓 .pyd/.dll/数据。
for _pkg in (
    "duckdb",
    "polars",
    "numpy",
    "scipy",
    "sklearn",
    "joblib",
    "threadpoolctl",
    "uvicorn",
    "fastapi",
    "starlette",
    "pydantic",
    "pydantic_core",
    "anyio",
    "sniffio",
    "h11",
    "click",
    "certifi",
    "httpx",
    "httpcore",
):
    try:
        _d, _b, _h = collect_all(_pkg)
        _datas += _d
        _binaries += _b
        _hidden += _h
    except Exception:  # 该包未安装/可选 → 跳过
        pass

# 本项目包:sinan 大量「函数内惰性 import」(app.py 里 from .training import …),静态分析抓不全 →
# 显式收齐全部子模块;契约包同理。
_hidden += collect_submodules("sinan")
_hidden += collect_submodules("sinan_contracts")
_hidden += collect_submodules("uvicorn")
_hidden += collect_submodules("sklearn")

a = Analysis(
    ["sinan/__main__.py"],
    pathex=["."],
    binaries=_binaries,
    datas=_datas,
    hiddenimports=_hidden,
    hookspath=[],
    runtime_hooks=[],
    excludes=["tkinter", "matplotlib", "PyQt5", "PySide6", "IPython", "pytest"],
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,  # one-dir:二进制/数据交给 COLLECT
    name="sinan-engine",
    console=True,  # sidecar 需读 stderr 排障;Tauri 子进程不弹窗(由壳的 windows_subsystem 控制)
    disable_windowed_traceback=False,
    target_arch=None,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,  # UPX 压缩易触发杀软误报 + 偶发 native 加载失败,关掉
    name="sinan-engine",
)
