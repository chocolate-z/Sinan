"""冻结分发入口:PyInstaller 把本模块打成 `sinan-engine.exe`(单 sidecar)。

supervisor 的 `engine_frozen` 规格以**无参**方式启动本 exe,端口/数据目录经环境变量下发
(SINAN_ENGINE_PORT / SINAN_DATA_DIR / SINAN_IPC_TOKEN)。开发期也可 `python -m sinan` 同入口启动,
减少 dev 与冻结分发的漂移。

⚠️ multiprocessing.freeze_support() 必须最先调用:冻结后,特征面板多核(ProcessPoolExecutor,
build_feature_panel workers>1)会以「重新启动本 exe」的方式 spawn 子进程;freeze_support 让子进程跑
multiprocessing 引导逻辑(回到那个 worker 函数)而非再起一个 uvicorn 服务器、无限自我复制。
"""

from __future__ import annotations

import multiprocessing
import os


def main() -> None:
    # 重导入放函数内:multiprocessing 子进程在 freeze_support() 阶段就会退出,绝不触达这里 →
    # 子进程不必加载 uvicorn/app,启动更快。
    import uvicorn

    from sinan.app import app

    port = int(os.environ.get("SINAN_ENGINE_PORT", "59915"))
    # 仅本机回环;零外联(红线)。冻结分发不开 reload(无源码可watch)。
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="info")


if __name__ == "__main__":
    multiprocessing.freeze_support()  # 必须在任何多进程逻辑之前;冻结子进程在此返回/退出。
    main()
