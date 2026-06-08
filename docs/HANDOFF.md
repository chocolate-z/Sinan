# 司南 Sinan · 开发交接文档(给下一位 Claude Code)

> 这份文档让你在新会话里**无缝接手**司南的开发。先读本文,再读 [`../SINAN_DESIGN.md`](../SINAN_DESIGN.md)(权威蓝图)。
> 项目记忆(`~/.claude` 下 MEMORY.md / sinan-m0-state.md / sinan-redlines.md)若在同一项目目录会自动召回,本文是其可提交的完整版。

---

## 1. 这是什么 / 现在到哪了

**司南** = 面向中国 A 股个人投资者的**可分发本地量化桌面软件**。地基三属性不可妥协:
**BYO(自带数据源)· 全本机(数据/凭据不出本机)· 可分发(随包零数据/零模型/零 token)**。

技术形态:**Tauri 2(Rust 外壳)+ Vue3 前端 + 两个 sidecar:api(NestJS+Fastify,:59914)/ engine(FastAPI,:59915)**。
存储:SQLite(事务元数据,**仅 api 写**)+ DuckDB/parquet(分析大矩阵,**仅 engine 写**)。

**进度:M0 完成、M1 功能闭环基本完成、外加 M3/M4 的两个引擎核心。** 仓库 **公开**:https://github.com/chocolate-z/Sinan
**CI 三 job 全绿**(node / python / rust),每次 push 自动验证。**约 159 个自动化测试**。

已实现(可运行、带测试):

- **shared-contracts**:`spec/*.json` 单一真相源 + TS(Zod)/Py(Pydantic) 双绑定,一致性测试防漂移。
- **engine**:Provider 抽象(Tushare/AkShare/Realtime + 注册表:令牌桶/断路器/优雅降级)、`data.asof` PIT 取数、`cache_build`(限速/断点续传/SSE)、**因子库+横截面+IC/等权打分**、**模拟盘**(成本/账户 T+1/风控决策链/盘后编排 run_eod)、**指标 DSL 安全沙箱+穿越测试**、**训练设备/CPU 核心解析**。
- **api**:SQLite 单一写者 + 迁移(0001 基础、0002 M1 交易/账本)、/jobs+SSE、凭据代理、**交易闭环落库**(signals/trades/holdings/sim_account/daily_pnl,模型/个人物理分账)、**盘后自动调度**、**实时当日收益**。
- **apps/desktop/shell-core**(Rust):端口探测/会话 token/sidecar 规格/ports.json(已单测)。`src-tauri`(Tauri 2 外壳)写就,需联网 `cargo build`。
- **前端**:AppShell + 5 步 Onboarding 向导 + 数据源设置 + **总览双账 / 信号(含拦截组)/ 持仓双账** + 锁定守卫 + 设计令牌(盈亏色与系统色严格解耦)。

---

## 2. 六条红线(违反即回退,改任何东西都要守住)

1. **无未来函数**:取数走 `data.asof`;财务按 `ann_date`(非 end_date);信号滞后 1 日;T+1 撮合;切分仅日期+purge+embargo;自定义因子过穿越测试。**黄金测试不过不合并。**
   - 已埋测试:`services/engine/tests/test_datalayer.py`(ann_date PIT)、`test_factors.py`(截断>T==全量)、`test_runner.py`(T 日估值与 T+1 价无关)、`test_indicators.py`(穿越测试)。
2. **无虚假回测**:只测 `train_end+purge` 之后;必含成本(印花税0.05%+佣金+冲击);禁随机切分。(M2)
3. **不夸大收益**:报告指标一律样本外;样本内外并列;AUC 0.52 如实标注为正常。(M3 UI)
4. **token 永不落明文**:只入 OS 钥匙串;DB/日志/SSE/前端响应**永不**出现明文;CSP 仅本机回环;除用户自配源 + 签名更新外**零外联**。
   - 已埋测试:`services/api/test/credential.test.ts`、`migration.test.ts`(credentials 表无明文列)、`e2e.test.ts`(响应不含 token)。
5. **无自动真实下单**:仅纸面模拟盘 + 手动个人持仓;不接券商交易接口。
6. **前端不直连 engine;engine 不写 SQLite**:前端只打 api(:59914);engine 结果经 api 回传落库;模型/个人两套账本**物理隔离、严禁误聚合**。

> 已用**多智能体红线审计**(Workflow)验证两次,均 PASS(并曾抓出一个真实的未来函数 bug 并修复)。改完关键代码后建议再跑一次审计。

---

## 3. 仓库结构

```
Sinan/
├─ packages/shared-contracts/   契约单一真相源:spec/*.json + src(TS) + python/sinan_contracts(Py)
├─ services/
│  ├─ engine/sinan/             providers/ data/ factors/ paper/ indicators/ training/ cache/ app.py
│  └─ api/src/                  db/(sqlite/migrator/repository + migrations/*.sql) modules/(core/jobs/providers/trading/scheduler) secrets/ engine/ bus/ lib/
├─ apps/desktop/
│  ├─ shell-core/               Rust 纯逻辑(std-only,已测)
│  ├─ src-tauri/                Tauri 2 外壳(supervisor + lib.rs)
│  └─ src/                      Vue3:shell/ pages/ stores/ api/ lib/ design/ router/
├─ .github/workflows/           ci.yml(全层测试)+ release.yml(Tauri 发布脚手架,M6)
├─ .cargo/config.toml           项目级 cargo 国内源(CI 会先删它走默认 crates.io)
├─ config.defaults.json         打包默认(端口/风控/切分/成本/限流/settings 默认)
├─ README.md  SINAN_DESIGN.md  docs/HANDOFF.md(本文)
```

---

## 4. 怎么跑 / 怎么测(关键:绕过坑)

环境:Node 24(pnpm 11)、Python 3.13(本机 venv 在 `.venv`)、Rust 1.95。仓库根有 `.venv` 与各 `node_modules`(已装)。

### 安装(干净检出时)

```bash
pnpm install
python -m venv .venv
.venv/Scripts/pip install -e packages/shared-contracts/python -e "services/engine[test]"
```

### 跑测试(⚠ 直接调工具,不要用 `pnpm run` —— 见坑①)

```bash
# 契约 TS / Py
(cd packages/shared-contracts && node node_modules/vitest/vitest.mjs run)
.venv/Scripts/python -m pytest packages/shared-contracts/python/tests -q
# 引擎(provider/缓存/data.asof/因子/模拟盘/指标/设备)
(cd services/engine && ../../.venv/Scripts/python -m pytest -q)
# api(单写者/凭据红线/作业/交易闭环/调度/实时收益)—— 用 node:test
(cd services/api && node node_modules/typescript/bin/tsc -p tsconfig.build.json && node --test "dist/test/*.test.js")
# 外壳核心(Rust)
(cd apps/desktop/shell-core && cargo test)
# 前端(红线解耦/守卫/信号逻辑 + 类型 + 构建)
(cd apps/desktop && node node_modules/vitest/vitest.mjs run && node node_modules/vue-tsc/bin/vue-tsc.js --noEmit -p tsconfig.app.json && node node_modules/vite/bin/vite.js build)
# 全仓 lint/format
node node_modules/eslint/bin/eslint.js .
node node_modules/prettier/bin/prettier.cjs --check .
```

### 运行看效果(浏览器路径,最快)

开三个终端(api 的 CORS 已放行本机 localhost 任意端口):

```bash
# 1) engine
.venv/Scripts/python -m uvicorn sinan.app:app --host 127.0.0.1 --port 59915
# 2) api(指向 engine;内存钥匙串免装原生 keyring)
SINAN_ENGINE_PORT=59915 SINAN_SECRET_STORE=memory node services/api/dist/src/main.js
# 3) 前端 dev(端口 5914)
pnpm --filter @sinan/desktop dev    # 或 (cd apps/desktop && node node_modules/vite/bin/vite.js)
```

浏览器开 http://localhost:5914 → Onboarding(选 AkShare 免费源可免 token;快速模式建少量缓存)→ 信号页「盘后跑一轮」(填信号日 T / 生效日 T+1)→ 总览双卡 / 信号含拦截组 / 持仓双账。

> 真实建缓存需用户数据源出网(BYO);离线时缓存/打分会空,但 UI 全链路可走通。连通测试请用真实 Tushare token 手测一次。

### 桌面壳(Tauri)运行

`apps/desktop/src-tauri` 需 `cargo build`(国内源已在项目级 `.cargo/config.toml` 配好,首次较久)。`tauri dev` 时 supervisor 起 engine/api;开发用环境变量配 sidecar 命令:`SINAN_PYTHON`、`SINAN_NODE`、`SINAN_API_ENTRY=services/api/dist/src/main.js`。**本环境 cargo 镜像曾不可达,Tauri 壳未在此编译过——联网下应可。**

---

## 5. 环境坑(务必知道,否则会卡)

1. **pnpm 11 预运行检查会因「ignored build scripts」报错**:别用 `pnpm --filter X run`;**直接调** `node node_modules/...`(如上)。esbuild 已在 `pnpm-workspace.yaml` 的 `onlyBuiltDependencies` 批准;有 hook 会反复往该文件塞无效的 `allowBuilds:` 占位,忽略它。
2. **依赖被 hook 自动升级到最新大版本**(zod 4 / vitest 4 / vite 8 / vue-tsc 3 / eslint 10 / pinia 3 / vue-router 5 / @types/node 25 …)。**不要回退**;改动后逐层重测即可(目前都通过)。
3. **`.gitignore` 千万别用裸目录名**(`cache/` `logs/` `models/`)——会吞掉同名源码包(`sinan/cache`、`pages/logs`),本地有文件但 CI 缺失。运行期数据按**文件类型**忽略(`*.db/*.parquet/*.duckdb/*.log`),数据本就在 `$APPDATA` 仓库外。
4. **api 用 Node 内置 `node:sqlite`**(无原生 better-sqlite3);ESM(`"type":"module"`),所以相对 import 带 `.js` 后缀。
5. **CI 在境外 runner**:用默认 crates.io/npm/PyPI;项目级 cargo 国内源由 ci.yml/release.yml 的 rust 步骤 `rm -f .cargo/config.toml` 跳过。
6. **没有 `gh` CLI**。看 Actions 结果可用 GitHub REST API(公开仓库免鉴权):`GET /repos/chocolate-z/Sinan/actions/runs`;**下载 job 日志**要手动处理 302 到 Azure 签名 URL 时**不要转发 Authorization 头**(否则 401)。可参考我用过的 Python 片段(urllib + 自定义 HTTPRedirectHandler)。
7. **提交/推送**:git user 已配(xiaozhong);凭据管理器有缓存 token,`git push` 直接可用;提交信息结尾加 `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`。
8. **本机命令用 Bash 工具时**:Windows + git-bash;venv python 在 `.venv/Scripts/python.exe`;每条命令是全新 shell(系统环境变量自动重读)。

---

## 6. 约定(请延续)

- **契约先行**:任何跨服务端点/枚举先改 `packages/shared-contracts/spec/*.json` + TS + Py 三处,一致性测试会校验。
- **每步自测**:每个切片都带测试;红线相关必须有断言(尤其防未来函数的黄金/穿越测试)。
- **SQL 与契约同步**:迁移 CHECK 枚举由 `services/engine/tests/test_sql_contract.py` 守护(读全部迁移,断言与契约枚举一致)。
- **盈亏色 vs 系统色解耦**:盈亏只用 `pnl-*`(经 `app.pnlClass`/`lib/pnl`),系统状态只用 `status-*`;方向(买/卖)用系统色,不用盈亏色。
- **节奏**:做一刀 → 全绿 → commit+push → 用 REST API 轮询确认 CI 绿 → 继续。
- **ultracode**:会话开启时用 Workflow 跑多智能体审计/评审做对抗式验证(已两次用于红线审计)。

---

## 7. 路线图与「下一刀」

**M1 收尾(剩余,偏展示)**

- **行情页 `/market`**:实时报价列表(api `/quotes` 经 RealtimeProvider)+ K 线(本地 parquet);免费源北向/财务字段置灰。当前 `/market` 仍是 Locked 占位。
- **模型净值 vs 沪深300 曲线 + 回撤阴影**(总览/回测页)—— 需净值序列,衔接 M2。

**M2 回测引擎 + 诚实评估**(下一个大里程碑)

- 事件驱动+向量化、逐日撮合(T+1/成本/滑点);时序切分+purge+embargo;walk-forward 跨牛熊;绩效全集(年化/超额/IR/Sharpe/MaxDD/换手/RankIC/ICIR);硬校验 `backtest_start > train_end+purge` 否则拒跑;回测页(净值 vs 基准 + 回撤阴影 + 月度热力图 + 防未来函数提示条)。引擎里 `paper/` 的成本/账户/风控可复用。

**M3 训练**(设备解析 `training/device.py` 已就绪)、**M4 指标库 UI**(引擎 DSL 已就绪,缺三栏编辑器页 + IC 质检)、**M5 资讯/估值/桌面特性**、**M6 打包分发+自动更新**(release.yml 脚手架已在,需冻结 sidecar:engine PyInstaller / api Node SEA,放 `src-tauri/binaries`)。

**建议接手第一刀**:行情页 `/market`(补齐 M1 最后可见页,纯前端+一个 quotes 端点,易测易演示),随后进入 M2 回测引擎。

---

## 8. 关键文件索引(快速定位)

| 关注点            | 文件                                                                        |
| ----------------- | --------------------------------------------------------------------------- |
| 防未来函数取数    | `services/engine/sinan/data/datalayer.py`                                   |
| 因子/打分         | `services/engine/sinan/factors/{library,score,cross_section}.py`            |
| 模拟盘/风控/编排  | `services/engine/sinan/paper/{costs,account,risk,eod,runner}.py`            |
| 指标安全沙箱      | `services/engine/sinan/indicators/{safe_eval,operators,validate}.py`        |
| engine HTTP       | `services/engine/sinan/app.py`                                              |
| 单写者仓储        | `services/api/src/db/repository.ts` + `migrations/*.sql`                    |
| 交易闭环/实时收益 | `services/api/src/modules/trading.ts`                                       |
| 盘后调度          | `services/api/src/modules/scheduler.ts` + `lib/schedule.ts`                 |
| 凭据红线          | `services/api/src/secrets/*`                                                |
| 前端页            | `apps/desktop/src/pages/{dashboard,signals,portfolio,onboarding,settings}/` |
| 前端纯逻辑        | `apps/desktop/src/lib/{pnl,signals,guard}.ts`                               |
| 外壳逻辑          | `apps/desktop/shell-core/src/*.rs` + `src-tauri/src/lib.rs`                 |
| 契约              | `packages/shared-contracts/spec/*.json`                                     |
