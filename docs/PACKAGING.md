# 司南 v1 打包(M6):dev 形态 → 可双击安装包

目标:把当前「Tauri 壳 + 两个从源码跑的 sidecar(Python engine / Node api)」做成 Windows 可分发安装包(MSI/NSIS),目标机无需装 Python/Node。

## 架构现状(好消息:壳已为冻结分发预留)

`apps/desktop/src-tauri/src/lib.rs` 的 supervisor 启动顺序:探测端口(59900–59999)→ 生成会话 token → 写 `runtime/ports.json` → 起 engine → 健康探测 → 起 api → 健康探测 → 通知前端解锁。关窗优雅终止,不留孤儿。

`build_spec()` **已内置 dev / frozen 双模式**(`apps/desktop/shell-core/src/supervisor.rs`):
- engine:`SINAN_ENGINE_BIN` 设了 → `engine_frozen(exe)`(**无参** exe,端口从 `SINAN_ENGINE_PORT` env 读);否则 dev 走 `SINAN_PYTHON -m uvicorn`。
- api:`SINAN_API_BIN` 设了 → `api_frozen(exe)`(无参 exe);否则 dev 走 `SINAN_NODE <SINAN_API_ENTRY>`。
- `base_env()` 给两者下发 `SINAN_API_PORT / SINAN_ENGINE_PORT / SINAN_IPC_TOKEN / SINAN_DATA_DIR`。
- 数据目录:生产 = `%APPDATA%/Sinan`(Windows),可被 `SINAN_DATA_DIR` 覆盖。

所以打包要做的三件事:① 把两个 sidecar 冻成 exe;② 让壳在**生产态**(dev.mjs 不设 `SINAN_*_BIN`)自动定位包内 exe;③ tauri 把 exe/目录打进安装包。

## Sidecar 1 — engine(PyInstaller one-dir)✅ 脚手架就绪

- 入口:`services/engine/sinan/__main__.py`(`freeze_support()` + 从 `SINAN_ENGINE_PORT` 起 uvicorn)。**`freeze_support()` 必需**——多核特征面板的 ProcessPoolExecutor 子进程会重启本 exe,否则无限自我复制。
- 规格:`services/engine/sinan-engine.spec`(one-dir,关 UPX,排除 tkinter/matplotlib)。
- 构建:
  ```
  cd services/engine
  ../../.venv/Scripts/python.exe -m pip install pyinstaller
  ../../.venv/Scripts/pyinstaller.exe sinan-engine.spec --noconfirm
  # 产出 dist/sinan-engine/sinan-engine.exe(+ 同目录依赖)
  ```
- 自测(脱离源码,验证冻结产物能起):
  ```
  set SINAN_ENGINE_PORT=59950 & dist\sinan-engine\sinan-engine.exe
  # 另开:curl http://127.0.0.1:59950/healthz  → {"status":"ok",...}
  ```
- ⚠️ 首跑大概率补 hiddenimports(sinan 惰性 import / sklearn / duckdb native)。报 ModuleNotFoundError 就把模块加进 spec 的 collect 列表重构。

## Sidecar 2 — api(Node SEA)⬜ 待做

- api 已从 env 读端口(`SINAN_API_PORT`/`SINAN_ENGINE_PORT`),`api_frozen` 跑无参 exe 即可。
- 难点:`@napi-rs/keyring`(native `.node`,生产存 token 到 OS 钥匙串,红线#4)不能塞进 SEA blob → 需随 exe 同目录附带 `.node`,且 require 能找到。`node:sqlite` 是 Node≥22 内置(SEA 基座用 Node≥22 即可)。
- 计划:esbuild 把 `dist/src/main.js` 打成单 CJS(externalize `@napi-rs/keyring`)→ Node SEA 注入 blob → 产出 `sinan-api.exe` + 同目录 `*.node`。备选:`@yao-pkg/pkg`。

## Tauri 打包 + 壳生产态定位 ⬜ 待做

- engine 是 one-dir 目录 → 走 tauri `bundle.resources`(把 `dist/sinan-engine/` 整目录打进 `resources/engine/`);api 单 exe 可 `resources` 或 `externalBin`。
- 壳改 `build_spec()`:生产态(无 `SINAN_ENGINE_BIN`/`SINAN_PYTHON`)用 `tauri::path resource_dir` 解析 `resources/engine/sinan-engine.exe`、`resources/sinan-api.exe`,设为 frozen。dev 行为不变。
- `multiprocessing.freeze_support()` 已在 engine 入口 ✓(打包必需,否则子进程递归)。

## 构建顺序(总)

1. 冻 engine(PyInstaller) → 自测 healthz。
2. 冻 api(SEA) → 自测 healthz(连 engine)。
3. 壳生产态定位改 + tauri resources 配置。
4. `pnpm --filter @sinan/desktop tauri build` → 出 MSI/NSIS。⚠️ **先停 `pnpm dev`**(cargo/rustc 锁)。
5. 装机 smoke(理想:干净机 / 至少未装 Python+Node 的环境):双击安装 → 引导(输 token)→ 建缓存(小股票池)→ 质检 → 训练 → 信号 → 行情。验 token 落 OS 钥匙串、数据落 `%APPDATA%/Sinan`、关窗无孤儿进程。

## 风险 / 迭代点

- PyInstaller 抓不全 sinan 惰性 import / sklearn / duckdb → 迭代补 spec。
- 多进程 + 冻结:已 freeze_support;若打包后多核异常,临时回退 `feature_workers=1`(壳/请求可控)不影响正确性。
- SEA + native `.node`:require 解析路径,需 `.node` 与 exe 同目录。
- 杀软误报:关 UPX(已关);必要时 EV 签名(v1-beta 可暂不签,提示用户「未知发布者」放行)。
- 体积:engine bundle 含 sklearn/scipy/duckdb,数百 MB 正常。
