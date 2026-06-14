# 司南 Sinan

面向中国 A 股个人投资者的**可分发本地量化桌面软件**(原型「罗盘」的正式化重写)。
地基三属性贯穿每一层:**BYO(自带数据源)· 全本机运行 · 可分发(随包零数据/零模型/零 token)**。

> 司南是研究与纪律辅助工具,不是投资顾问,更不是赚钱机器。所有信号/打分/回测/模拟盘仅供研究参考,
> 不构成投资建议;模拟盘为纸面前向验证,不进行任何自动真实下单。完整设计见 [`SINAN_DESIGN.md`](SINAN_DESIGN.md)。

## 下载安装(Windows x64)

最新安装包见 [**Releases**](https://github.com/chocolate-z/Sinan/releases/latest):`Sinan_*_x64-setup.exe`(推荐,体积小)或 `Sinan_*_x64_en-US.msi`。首次启动会拉起本地引擎与网关,约需十几秒。

> 🇨🇳 **国内下载**:GitHub 的安装包 CDN(`release-assets.githubusercontent.com`)在国内常被拒连,直接点可能下不动。
> **解决办法:在下载链接前拼一个国内镜像前缀**,例如(以 v0.1.0 为例):
>
> ```
> https://gh-proxy.com/https://github.com/chocolate-z/Sinan/releases/download/v0.1.0/Sinan_0.1.0_x64-setup.exe
> ```
>
> 某个镜像失效时,把前缀换成 `https://ghfast.top/` 或 `https://ghproxy.net/` 再试;实在不行就在能联网的机器上下好再拷过去。

## 当前状态:M0 地基完成 ✅

M0 = **Onboarding + 数据源接入 + 零数据冷启动建缓存**,严格按总纲⑦自底向上构建,每步自测。

| 步  | 内容                                                                       | 自测                                          |
| --- | -------------------------------------------------------------------------- | --------------------------------------------- |
| 1   | `packages/shared-contracts` 契约单一真相源(spec/\*.json → TS+Py 绑定)      | TS 10 · Py 6(双端 ↔ spec 一致性)              |
| 2   | engine Provider 抽象 + Tushare/AkShare/Realtime + 注册表(限流/断路器/降级) | Py 28(令牌桶/断路器/路由/降级/3 源 mock HTTP) |
| 3   | SQLite 迁移 + DuckDB 布局 + `data.asof` PIT 取数                           | Py 10(ann_date 防泄漏黄金测试 + 截断不变式)   |
| 4   | engine `cache_build` 作业(限速/断点续传/增量/SSE)                          | Py 9(续传无重复/增量跳过/降级/FastAPI)        |
| 5   | api 网关:SQLite 单一写者 + /jobs + SSE 总线 + 凭据代理                     | Node 10 + **实测双 sidecar 联通**             |
| 6   | Tauri 外壳:端口探测/会话 token/sidecar 规格/ports.json                     | Rust 12(shell-core)                           |
| 7   | 前端:AppShell + Onboarding 向导 + 数据源设置页 + 锁定守卫                  | Vitest 11 + vue-tsc + vite build              |

**合计 96 个自动化测试** + api↔engine 实时联通验证。

## 目录

```
sinan/
├─ packages/shared-contracts/   # ★ 跨服务契约单一真相源(spec JSON + TS/Py 绑定)
├─ services/
│  ├─ engine/                   # FastAPI:Provider/缓存/data.asof(仅 engine 写列式缓存)
│  └─ api/                      # NestJS+Fastify:SQLite 单一写者/REST/SSE/凭据代理
├─ apps/desktop/
│  ├─ shell-core/               # Rust 纯逻辑(端口/token/规格),已单测
│  ├─ src-tauri/                # Tauri 2 外壳(监护双 sidecar)
│  └─ src/                      # Vue3 前端
├─ config.defaults.json         # 打包默认(三层配置最底层)
└─ SINAN_DESIGN.md              # 蓝图总纲 + 五专章
```

## 先决条件

Node ≥ 20(pnpm)、Python ≥ 3.11、Rust ≥ 1.80(仅外壳)。本机已验证:Node 24 / Python 3.13 / Rust 1.95。

## 安装

```bash
pnpm install                                  # JS 工作区(契约/api/前端)
python -m venv .venv                          # 引擎 venv
.venv/Scripts/pip install -e packages/shared-contracts/python -e services/engine
```

## 测试(每步自测)

```bash
# 契约(TS + Py)
(cd packages/shared-contracts && node node_modules/vitest/vitest.mjs run)
.venv/Scripts/python -m pytest packages/shared-contracts/python/tests -q
# 引擎(Provider/缓存/data.asof)
(cd services/engine && ../../.venv/Scripts/python -m pytest -q)
# api(单一写者/凭据红线/作业编排)
(cd services/api && node node_modules/typescript/bin/tsc -p tsconfig.build.json && node --test "dist/test/*.test.js")
# 外壳核心(Rust)
(cd apps/desktop/shell-core && cargo test)
# 前端(红线解耦/守卫/锁定 + 类型 + 构建)
(cd apps/desktop && node node_modules/vitest/vitest.mjs run && node node_modules/vue-tsc/bin/vue-tsc.js --noEmit -p tsconfig.app.json)
```

## 开发期运行(双 sidecar)

```bash
# engine(:59915)
.venv/Scripts/python -m uvicorn sinan.app:app --host 127.0.0.1 --port 59915
# api(:59914),指向 engine
SINAN_ENGINE_PORT=59915 node services/api/dist/src/main.js
# 前端(:5914)
pnpm --filter @sinan/desktop dev
```

Tauri 外壳会自动完成上述编排(端口探测顺延 → 会话 token → 起 engine → 起 api → 解锁前端)。

## 红线落地(违反即回退)

1. **无未来函数**:所有取数走 `data.asof`,财务按 `ann_date`;黄金测试守护(`test_datalayer.py`)。
2. **无虚假回测**:成本/purge/walk-forward 在 M2 引入,口径硬校验(本里程碑未涉及)。
3. **不夸大收益**:样本内外分离、AUC 0.52 如实标注(M3 起 UI 落地)。
4. **token 永不落明文**:只入 OS 钥匙串,DB 无明文列,响应/日志/SSE 不含 token;CSP 仅本机回环。
5. **无自动真实下单**:仅纸面模拟盘 + 手动个人持仓(M1 起)。
6. **前端不直连 engine;engine 不写 SQLite**:前端只打 api;engine 结果经 api 落库。

## 已知约束(本环境)

- **Tauri 应用 crate 未在此环境编译**:Cargo 镜像不可达,`apps/desktop/src-tauri` 写就但未离线编译;
  其非平凡逻辑已抽到 `shell-core` 并单测通过。联网环境 `cargo build` 即可。
- **真实建缓存需用户数据源**:`cache_build` 走用户自配源(Tushare/AkShare)出网;离线/无 token 时
  以 mock/quick 模式自测。连通测试请用真实 token 手测一次(BYO)。
