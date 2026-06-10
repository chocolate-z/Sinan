# 司南 Sinan · 开发交接文档(给下一位 Claude Code)

> 这份文档让你在新会话里**无缝接手**司南的开发。先读本文,再读 [`../SINAN_DESIGN.md`](../SINAN_DESIGN.md)(权威蓝图)。
> 项目记忆(`~/.claude` 下 MEMORY.md / sinan-m0-state.md / sinan-redlines.md)若在同一项目目录会自动召回,本文是其可提交的完整版。

---

## 1. 这是什么 / 现在到哪了

**司南** = 面向中国 A 股个人投资者的**可分发本地量化桌面软件**。地基三属性不可妥协:
**BYO(自带数据源)· 全本机(数据/凭据不出本机)· 可分发(随包零数据/零模型/零 token)**。

技术形态:**Tauri 2(Rust 外壳)+ Vue3 前端 + 两个 sidecar:api(NestJS+Fastify,:59914)/ engine(FastAPI,:59915)**。
存储:SQLite(事务元数据,**仅 api 写**)+ DuckDB/parquet(分析大矩阵,**仅 engine 写**)。

**进度:M0 / M1 闭环 / 行情 /market / M2 回测 均完成。前端按设计交接稿「整体重写」完成(9 页 + 收尾删别名/materials.css,见 §9)。M3 v1 训练完成(walk-forward ElasticNet → 样本内外 IC/ICIR → 模型版本库 → /models 真实页 → 激活 → 模型出信号;对抗式红线审计 3 维 PASS,见 §10)。M4 v1 指标库实接完成(`/indicators` 真实因子质检:逐因子 IC 均值/ICIR/覆盖度 + IC 时序 + 十分位分层,复用 M3 特征面板+前向标签+rank_ic)。** 仓库 **公开**:https://github.com/chocolate-z/Sinan
**CI 三 job 全绿**(node / python / rust),每次 push 自动验证。**约 250 个自动化测试**(前端 46)。
**数据/撮合一律日频,不支持分时(有意设计,契合 A 股 T+1)。**

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

**已完成(本会话新增)**

- ✅ **行情页 `/market`**:实时报价 + 本地 parquet K 线(`data.asof` PIT + qfq 前复权)+ 免费源北向/财务置灰。`engine /engine/prices` + api `GET /quotes`、`/prices/:code`。
- ✅ **全局 macOS 原生风 UI 重构**:设计令牌(SF 字体 / Apple 浅深色板 / 低饱和红涨绿跌 / vibrancy / 分层阴影,`design/tokens.css`)+ 控件类库 `design/materials.css`(`m-*`)+ **主题三态**(浅/深/跟随系统,`lib/theme.ts` + `stores/app` + `main.ts` 的 `matchMedia`)+ **自定义标题栏 `shell/TitleBar.vue`**(`tauri.conf.json` `decorations:false` + Win11 右上角窗口控制,`lib/tauri.ts` 探测 + 浏览器降级)。设置页「外观」切主题 + 涨跌反转。三色通道仍严格解耦(pnl/status/accent)。
- ✅ **M2 回测引擎(四刀闭环 + 红线审计收口)**:`backtest/splits.py`(时序切分 / purge / embargo / walk-forward / 硬守卫 `is_oos_clean`)+ `metrics.py`(绩效全集)+ `engine.py`(`run_backtest` 复用 `paper/` 逐日撮合,T 收盘估值 / T+1 开盘成交 / 含成本)+ `/engine/backtest` + api `/backtests`(migration `0003`)+ 回测页 `/backtest`(净值 vs 基准 + 回撤阴影 + 月度热力图 + 诚实口径提示条)。
  **第三次多智能体红线审计**(对抗式 5 agent)结论 **PASS**:实现层四红线无在产违反;曾抓出并已修复红线#1 黄金测试「假绿」→ 换为白盒 `test_backtest_valuation_asof_never_leads_decision_day`(spy `engine._price_map`,断言收盘估值取数 asof 恰为决策日 T),并对抗式自验(注入「估值取数前移到 T+1」会让该测试变红)。

- ✅ **回测口径与实盘一致(本会话完成,见 §11.1 #1)**:`run_backtest(model=,custom=)` 透传 `run_eod`;`scoring` 字段如实标注;api 解析 `scoring`/`model_id` + 诚实 `train_end=max` 守卫 + ISO 校验;迁移 `0007`;前端口径选择 + 出处 + degraded 显示。对抗式红线审计 PASS。

**M2 遗留 minor(非阻断,见审计报告;可后续排期)**

- 回测末日 T+1 成交「有成本无损益」(该笔持仓不进 nav 曲线)→ 末日 `fill=False` 或补一个终值估值点。
- 守卫 `purge` 与训练 `label_horizon` 解耦:M3 引入 ML 标签后,应在守卫处强制 `purge>=label_horizon`(当前纯因子策略 PIT,purge=0 不泄漏;前端 input 已设 min=1)。
- `metrics.daily_returns` 对 `nav=0` 跳过(组合 nav 恒>0 不触发)、`profit_factor` 可返回 inf(回测路径不传 `trade_pnls` 不触发)→ 健壮性可加固。
- 胜率/盈亏比/换手率未接入回测报告(需成交 FIFO 配对 / 逐日权重)。

**M3 v1 训练(本会话完成,见 §10)**

- ✅ 6 切片闭环:契约(ModelType/ModelStatus + train/models\_\* 端点)→ `training/features.py`+`labels.py`(特征面板/前向标签,黄金测试)→ `training/train.py`+`/engine/train`(walk-forward 训 ElasticNet,样本内外 IC/ICIR,硬守卫 `purge>=label_horizon`)→ api `0005_models` 模型版本库 + `models.ts` → 前端 `/models` 接真实(训练表单/版本卡/明细/激活)→ `factors/model_score_universe` + `run_eod(model=)` **模型出信号**(激活模型驱动每日选股)。
- 模型 = **线性系数 JSON**(无二进制/无文件/无外联);依赖 scikit-learn(仅训练用,推理纯 polars)。
- 对抗式红线审计 3 维 **PASS**(无未来函数泄漏 / 真 OOS / 不落库),并硬化(purge 真隔离 + 分层口径 `layered_*`+`metrics_note` 随 JSON 诚实标注)。

**M3 遗留 / v2(非阻断)**:LightGBM + ensemble(已定 v2 再上,做可选 extra 保持轻装);训练长任务走 jobs/SSE(当前同步,小样本足够);把模型评估的「分层口径」夏普换成接 M2 事件驱动回测的真实 OOS 净值(更严)。

**下一个大里程碑(候选)**

- ✅ **M4 v1 指标库实接(本会话完成)**:`factors/quality.py`(复用 M3 特征面板+前向标签+`rank_ic`,逐因子真实 IC 均值/ICIR/覆盖度 + IC 时序 + 十分位分层)+ `/engine/factors/quality` + api `GET /indicators/quality`(按需重算不落库)+ 前端 `/indicators`(质检区间表单 → 因子表 + 详情 `ui/charts/{ICChart,DecileBars}.vue`)。契约 `indicators_quality`/`factors_quality` 端点。
- ✅ **M4 v2 + v3(本会话完成,自定义因子端到端打通)**:DSL 校验编辑器(`/indicators` → api `indicators_validate` → engine 沙箱白名单+仅回看算子);**v3**:`factors/custom.py` 把 DSL 表达式包成与内置同构的 `Factor`(`_build_dsl_panel(ctx)` 经 FactorContext 取 <=asof 面板 PIT → `indicators/eval_compiled`)→ 接入 `factor_quality`(`custom=[{name,expr,group}]`,与内置并列算真实 IC/分层);api `0006_custom_factors` + CRUD(`custom_factors_*` 端点,创建前经沙箱校验拒非法/前视)+ `/indicators/quality` 自动下发启用的自定义因子;前端 `/indicators` 编辑→校验→保存→列表/删除。**红线#1 双保险**:PIT(ctx 只见<=asof)+ DSL 仅回看算子(结构上写不出前视),自定义因子过穿越测试(`test_custom_factor_no_future_function`)。⚠️ roe 按股广播(latest_financial asof 值,对 roe 做 ts 算子=扁平,非泄漏但丢时间变化,MVP 限制)。✅ **启用的自定义因子已接入 `score_universe` 等权打分**(`run_eod(custom=)` → 无模型时纳入每日选股;api `PaperService.run` 自动下发);对抗式红线审计 PASS(无泄漏/沙箱无逃逸)。**剩余**:因子权重(目前等权)、更多内置因子。
- **M5 资讯/估值/桌面特性**(`/news` 仍锁定)、**M6 打包分发+自动更新**(release.yml 脚手架已在,需冻结 sidecar;**本环境 cargo 镜像曾不可达**)。
- ✅ **诚实小缺口收口(本会话)**:总览净值曲线接最近一次回测(`EquityChart`,周期分段真实切片);总览风控闸接真实持仓(集中度/持仓占用/当日回撤 `RiskBar`,行业/波动待数据);回测补胜率/盈亏比/换手率(`_realized_trade_pnls` 移动加权成本重放;`profit_factor=inf` 置 None 保 JSON 安全)。
- 剩余诚实缺口:设置页自动刷新/盘后落库为只读(缺 PUT settings 端点);风控闸行业暴露/波动率待行业分类+历史波动数据;**未用真实 Tushare token 跑过端到端连通(建议手测一次)**。

> **数据/撮合一律日频**:`price` 是日线 OHLCV、撮合走 T+1 开盘价;**不支持分时(日内)交易**——这是契合 A 股 T+1 与多因子选股定位的有意设计,非数据缺陷(用户已确认知悉)。如要分时需新增 `MINUTE_OHLCV` 能力位 + 分钟数据集 + 分钟撮合,且依赖数据源能拿到分钟历史。

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

---

## 9. 前端「设计稿整体重写」进行中(接手必读)

用户提供了一份**高保真设计交接稿**,要求把整个前端 1:1 复刻成「**深色专业量化终端**」风(紫色品牌 + 玻璃磨砂 + 极光背景;参考 TradingView 深色 / Linear / Trae / Apple HIG)。**这是当前主线任务。**

### 9.1 设计稿位置(唯一真相源)

`docs/design_handoff_sinan/`(已入库):

- `README.md` —— **先读**:配色铁律、token、布局、9 屏、组件状态表。
- `design_source/assets/{tokens.css,components.css}` —— 设计令牌 + 组件(已迁入,见下)。
- `design_source/src/{ui,charts,shell,app,data}.jsx` + `src/pages/*.jsx` —— React 高保真原型(mock 数据,**仅视觉参考**)。
- `司南 Sinan (预览·离线单文件).html` —— 双击即可在浏览器看全部交互。
- 该目录已加入 `.prettierignore` 与 eslint ignores(参考稿不参与本仓库格式化)。

### 9.2 配色铁律(三通道,不可交叉)

- **PnL 盈亏**(仅金额/涨跌/收益):`.pnl-up`(红涨)/`.pnl-down`(绿跌),经 `app.pnlClass(v)`;反转走 `<html data-pnl-invert>`(`tokens.css` 用 `--pnl-pos/--pnl-neg` 基准交换,无循环)。**A 股红涨绿跌**。
- **Status 系统状态/买卖方向**:`.badge-ok/.badge-warn/.badge-err/.badge-idle` 或 `--status-*`(买=ok 蓝 / 卖=warn 橙)。
- **Accent 品牌**:`--accent` 紫色渐变,仅交互/选中/主按钮/模型净值线。
- 三者**绝不交叉**;IC/ICIR/综合分用中性。数字一律 `.mono` 等宽 tabular。

### 9.3 已迁入的设计系统(里程碑1 + 2a,已 commit、CI 绿)

- `src/design/tokens.css` —— **整套设计令牌**(深/浅双主题、玻璃 `--glass-*`、极光 `--aurora`、`--bg-*/--text-*/--status-*/--accent*/--pnl-*`、`--fs-*/--sp-*/--r-*`)+ **底部"兼容别名"块**把旧 `--c-*/--st-*/--font-ui/--shadow-*/--r-pill` 等映射到新令牌(让未迁移页面继续构建)。
  - ⚠️ **CSS 注释陷阱**:注释里别出现 `*/`(如写 `--c-*/--st-*` 会提前闭合注释 → lightningcss `Delim('*')` 构建失败)。已踩过。
- `src/design/components.css` —— 设计组件类:`.card`(玻璃卡)/`.card-head`/`.card-pad`/`.glist`/`.grow`/`.btn .btn-primary/-secondary/-ghost/-sm`/`.input`/`.field-label`/`.badge*`/`.chip`/`.segmented`/`.switch`/`.dt`(金融表,选中 `.sel` 左 2px accent)/`.empty`/`.live-dot`/`.nav-item`(选中紫胶囊)/`.src-card`/`.main-aurora`。
- `src/shell/`:`TitleBar.vue`(玻璃 + **Logo.vue** 花朵品牌 + 版本 + Win11 控制)、`Sidebar.vue`(玻璃 + `nav-chip` 线性图标 + 紫胶囊选中 + 数据源卡 + 主题切换;未配置数据源项 `.nav-item.disabled`)、`StatusBar.vue`(玻璃状态点)、`AppShell.vue`(极光背景,无 body 内边距 → 页面自带)、`Icon.vue`+`icons.ts`(单色线性图标)、`Logo.vue`(多色花朵 logo)。
- `src/ui/`:`PageHero.vue`(页内大标题,padding 34 28 0)、`charts/{EquityChart,Candles,Heatmap,Sparkline,RiskBar}.vue`(纯 SVG,`composables/useMeasure.ts` 响应式宽度,回调式 `:ref="setEl"`)。
- `src/lib/format.ts`(`fmt/fmtInt/fmtPct/fmtSigned`)。
- 默认深色(`stores/app.ts` `themePref:'dark'`;`index.html` `data-theme="dark"`)。`sidebar.test` 已改为断言 `.nav-item.disabled`。

### 9.4 已重写的页面(里程碑2a/2b,已 commit、CI 待确认)

- ✅ **总览 Dashboard**(范例,我亲手写):PageHero + PnL 双卡(真实当日收益/持仓市值/超额)+ 净值/今日信号**诚实空状态**(后端无序列,不造假)。
- ✅ **行情/信号/持仓/回测/引导/日志/锁定** 7 页(多智能体工作流并行重写):保留各页真实 api/store 逻辑,模板换设计组件。回测页用 `EquityChart`+`Heatmap`+买卖点;行情用 `Candles`。
  - ⚠️ 该工作流 **StructuredOutput 回收失败但文件已落盘**;我已 `vue-tsc + vite build + eslint` 验证通过、commit(`3cc15f1`)。**接手请刷新 dev 逐页核对视觉是否贴稿**(工作流产物未经像素级人工核对)。

### 9.5 接手要做的(剩余,按优先级)

1. **设置页 Settings.vue 未重写**(那轮 agent 没落盘),仍旧 `.m-*` 样式(经兼容别名渲染)。按 `design_source/src/pages/settings.jsx` 重写:数据源 provider 卡 + token `.input` + 能力探测网格 + 外观 `.glist`(主题三态 `.segmented` + 涨跌反转 `.switch` 带预览)。
2. **逐页核对/精修**已重写的 7 页对照离线预览,修视觉偏差;`OnboardingWizard.vue` 的罗盘 logo 也换成 `<Logo>`。
3. **新增两页**(设计稿有,需配 M3/M4 后端,可先做视觉壳 + 诚实空状态):**指标/因子库 `/indicators`**(`indicators.jsx`)、**策略/模型 `/models`(=strategy)**(`strategy.jsx`);解锁路由(`router/index.ts` 现指向 `Locked.vue`)。
4. **收尾清理**:全部页面迁完后,删除 `tokens.css` 兼容别名块 + `src/design/materials.css`(旧 `.m-*`)+ `pnl.css` 与 `components.css` 的重复,统一到设计令牌/类。
5. **验证节奏**:每迁一两页 → `cd apps/desktop && vue-tsc --noEmit -p tsconfig.app.json && vitest run && vite build`,再 `eslint apps/desktop/src` + 全库 `prettier --check .` → commit + push + 轮询 CI(REST,见 §5.6)。

### 9.6 重写方法论(沿用)

- 单页:**保留 `<script setup>` 逻辑/store/api 不动,只重写 `<template>` + `<style scoped>`**;后端缺的数据用**诚实空状态**(`.empty`),**绝不造假数字**(红线#3)。根结构用 `<PageHero>` + `<div class="page-body">`(padding 28、卡片间距 20),不要旧 `.page` 根。
- ultracode 会话:可用 Workflow 并行 fan-out 多页 + 对抗式审查(注意 schema agent 偶发不调 StructuredOutput → 工作流报失败但文件可能已落盘,需 `git status` 核对 + 自行验证)。

---

## 10. M3 v1 训练里程碑(已完成,接手必读)

把「多因子打分」升级为「ML 训练 + 样本外评估 + 模型版本库 + 模型出信号」。**v1 仅 ElasticNet**(线性,模型=系数 JSON,无二进制/无外联);LightGBM/ensemble 留 v2。

### 10.1 数据流(全程 PIT,红线#1)

```
features.py build_feature_panel(asof 逐日 compute_factor_matrix → date×code 标准化因子长表)
labels.py   build_forward_return_labels(hfq[T+h]/hfq[T]-1,前向,尾 h 日 null)
   └─ train.py run_train: walk_forward(label_horizon,embargo) 切折 → 每折 fit ElasticNet(train)
        → 逐日 RankIC(IS=train / OOS=test 物理隔离)→ 全段重训得最终系数
        → TrainResult{ic_is/ic_oos, icir_is/icir_oos, layered_sharpe_oos/layered_annual_return_oos,
                        metrics_note, feature_importance(|coef|归一), fold_metrics, model{coef,intercept,feature_cols} }
```

- **关键红线护栏(对抗审计已验,常驻测试已固化)**:① 特征只经 `data.asof`(只见<=T);② 标签是未来但**绝不进特征**(`usable` 来源 `feature_cols`,结构上排除 `'label'`);③ `run_train` 入口硬守卫 `purge>=label_horizon`(`TrainGuardError`→422),且 `effective_embargo=max(embargo,purge-label_horizon)` 让**实际折间隔离 >= purge**(回显名副其实);④ 横截面统计只在当日截面内(沿用 `winsorize_mad`/`zscore`)。
- **诚实口径(红线#3)**:IC/ICIR 中性通道;夏普/年化是**顶分位等权分层口径(按 horizon 非重叠抽样,无成本/换手)**,字段名带 `layered_` 前缀 + `metrics_note` 随 JSON 下发,**前端勿渲染成「策略真实夏普」**。样本内外并列存。

### 10.2 落库与端点(红线#6:engine 只算不写库)

- 契约:`ModelType=[elasticnet]` / `ModelStatus=[draft,running,archived]`(与 JobStatus 解耦);端点 engine `train`、api `models_train/list/get/activate`。
- engine `/engine/train`(仿 `/engine/backtest`,守卫 422 / 无缓存 400)。
- api `0005_models.sql`(`model_versions`,`model_type/status` CHECK 由契约守护,`test_sql_contract` 白名单已纳入)+ `Repository.{insertModelVersion,modelVersionsList,modelVersionGet,modelVersionActivate,activeModel}` + `modules/models.ts`。
- 前端 `/models`(`pages/models/Models.vue`):训练表单 → `POST /models/train`;真实版本卡(状态/样本外 IC/ICIR/分层夏普/诚实样本外徽标/激活);明细(样本内外 IC 并列 + 因子重要度条 + 逐折 OOS IC + `metrics_note` 诚实条)。

### 10.3 模型出信号(闭环)

- `factors/model_score_universe(ctx, model)`:`score=intercept+Σcoef·f`(同一 asof 特征,纯 polars 无 sklearn);缺失特征按 0(z-score 中性)计。
- `paper/runner.py run_eod(model=...)`:有模型用模型打分替换等权 `score_universe`,否则等权(诚实降级)。`/engine/paper/run` 透传 `model`。
- api `PaperService.run` 取 `repo.activeModel()`(running 模型系数)经 `paper_run` 下发 engine → 激活模型真正驱动每日选股。

### 10.4 关键文件

`services/engine/sinan/training/{features,labels,train,device}.py`、`factors/score.py`(`model_score_universe`)、`paper/runner.py`、`app.py`(`/engine/train`、`PaperRunReq.model`);`services/api/src/{db/migrations/0005_models.sql,db/repository.ts,engine/engine.client.ts,modules/models.ts}`;`apps/desktop/src/pages/models/Models.vue`。测试:`tests/test_training_{data,train}.py`、`test_model_signals.py`、`api/test/models.test.ts`。

> 改训练相关代码后,建议再跑一次 §6 的对抗式红线审计(本里程碑那次抓出 purge 语义瑕疵 + 分层口径标注不够硬,均已修)。

---

## 11. 可扩展方向与技术债(候选路线,接手可挑)

> 当前司南端到端可跑(配源 → 缓存 → 因子质检/自定义因子 → 训练 → 回测 → 模拟盘出信号),诚实/纪律/本机三性守住,约 270 测试 CI 绿。
> **最关键的下一步不是加功能,而是在联网环境用真实 Tushare token 跑一次端到端 + `cargo build` 编译 Tauri 壳,验证「可分发」这条地基。**

### 11.1 可扩展功能(按价值/可做性排序)

1. ✅ **回测用激活模型 / 自定义因子(本会话完成)**:`run_backtest` 现支持 `model=`/`custom=`,口径与实盘 `run_eod` 一致。契约 `BacktestScoring=[auto,equal_weight,model,custom]`;engine 透传 + `BacktestResult.scoring` 如实回传实际口径;api `backtest.ts` 解析 `scoring`/`model_id`(可「先回测再激活」任一版本)+ **诚实 train_end=max(模型训练截止, 用户值) 守卫**(以模型回测绝不踩进训练窗口,红线#2)+ ISO 日期校验(纵深);迁移 `0007` 加 `scoring`/`model_id` 列(CHECK 入契约白名单);前端回测页打分口径分段选择 + 模型版本选择 + 口径出处徽标 + **因子降级如实显示**(红线#3,审计抓出的在产缺口已修)。黄金测试:模型/自定义 PIT 截断不变式 + 模型路径守卫拒跑。**第四次多智能体对抗式红线审计(5 探针×对抗复核)PASS**(无在产 blocker;抓出并修复前端 degraded 不渲染=红线#3 在产违反)。约 ~285 测试,CI 绿。
2. **自定义因子权重**:目前等权合成;加权重(ICIR 加权或手动),`custom_factors` 表加 `weight` 列,`composite_score` 支持加权。
3. **更多内置因子 + DSL 算子**:扩 `factors/library.py`(成长/情绪/反转族)与 `indicators/operators.py`(更多回看算子);新因子若需新数据走 `required_caps` 降级。
4. **M3 v2 LightGBM / ensemble**:`ModelType` 加 `lightgbm`;`training/train.py` 加非线性分支(lightgbm 建议做可选 extra 保「可分发」轻量);GPU 走 `resolve_device` 已就绪。
5. **M5 资讯 / 估值**:`/news` 解锁;新增 provider 能力位 + 抓取管线 + 估值分析页。
6. **真实净值累计**:盘后调度逐日累计一条持久净值曲线(替代总览「取最近回测」),`daily_pnl` 已有逐日数据。
7. **业绩归因 + 报告导出**:因子贡献归因;回测/信号导出 PDF/Excel。
8. **桌面特性**(SINAN_DESIGN 已规划):盘后通知、悬浮窗、托盘最小化。
9. **模型组合 / 对比**:多模型 portfolio、版本对比择优。

### 11.2 需改进 / 技术债(均非阻断,诚实记录)

- **roe 按股广播=扁平**(`factors/custom.py`):自定义因子对 `roe` 做时序算子会退化(非泄漏,用的是 asof 值;但丢时间变化)→ 可做财务 PIT as-of join(`join_asof` by `ann_date`)修正。
- **/models 分层夏普非完整回测**:已用 `layered_*`+`metrics_note` 诚实标注;可接 M2 事件驱动 OOS 回测得更严口径。
- **回测末日 T+1「有成本无损益」**:M2 遗留 minor;末日 `fill=False` 或补终值估值点。
- **设置页只读**:自动刷新/盘后落库为展示;需 `settings_put` 端点接前端才能编辑。
- **风控闸 行业/波动待数据**:需 `sw_industry` 行业分类 + 历史波动序列。
- **前端页面大量 `any`**:api 响应未加 DTO;可在契约加响应 schema 提升类型安全。
- **性能**:`factor_quality`/`build_feature_panel` 逐日 asof 循环,大股票池可批量取数优化(一次 asof 拉全区间,内存切片)。
- **测试 fixture 单调合成盘**:IC 饱和到 1.0,IC 量级无法区分真信号与泄漏 —— 真护栏是结构守卫(已测);可加噪声盘让合法 OOS IC 落 0.3~0.7,提升「假绿」鉴别力。
- **Tauri 壳本环境未编译**:cargo 镜像不可达;联网环境需验证 sidecar supervisor 起停。
- **日期 ISO 校验只覆盖回测入口**:`/backtests` 已加 `train_end`/`backtest_start`/`backtest_end` 的 `^\d{4}-\d{2}-\d{2}$` 校验(红线#2 纵深);`/models/train` 的 `train_start`/`train_end` 尚未加同款校验(目前同样靠前端 date input 隐式保证 ISO),可补齐成统一中间件。模型 `train_end` 入库后回测端比较亦默认其为 ISO。
