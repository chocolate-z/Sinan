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

> 当前司南端到端可跑(配源 → 缓存 → 因子质检/自定义因子 → 训练 → 回测 → 模拟盘出信号),诚实/纪律/本机三性守住,约 290 测试 CI 绿。
> **「可分发」地基已联网验证(2026-06-10,见 §11.3):真实 Tushare token 端到端 smoke 跑通 + `cargo build` 成功编译 Tauri 桌面壳(产出 13MB 可执行)。**

### 11.1 可扩展功能(按价值/可做性排序)

1. ✅ **回测用激活模型 / 自定义因子(本会话完成)**:`run_backtest` 现支持 `model=`/`custom=`,口径与实盘 `run_eod` 一致。契约 `BacktestScoring=[auto,equal_weight,model,custom]`;engine 透传 + `BacktestResult.scoring` 如实回传实际口径;api `backtest.ts` 解析 `scoring`/`model_id`(可「先回测再激活」任一版本)+ **诚实 train_end=max(模型训练截止, 用户值) 守卫**(以模型回测绝不踩进训练窗口,红线#2)+ ISO 日期校验(纵深);迁移 `0007` 加 `scoring`/`model_id` 列(CHECK 入契约白名单);前端回测页打分口径分段选择 + 模型版本选择 + 口径出处徽标 + **因子降级如实显示**(红线#3,审计抓出的在产缺口已修)。黄金测试:模型/自定义 PIT 截断不变式 + 模型路径守卫拒跑。**第四次多智能体对抗式红线审计(5 探针×对抗复核)PASS**(无在产 blocker;抓出并修复前端 degraded 不渲染=红线#3 在产违反)。约 ~285 测试,CI 绿。
2. ✅ **自定义因子权重(本会话完成)**:`custom_factors` 加 `weight` 列(迁移 `0008`,默认 1.0);`composite_score(weights=)` 按行跳 null 的加权均值(全 1.0 走等权零回归,weight=0 剔除,全 0 兜底等权);`score_universe` 从 custom 构造 weights;契约加 `custom_factors_update`(PUT);api `createCustom` 读 weight + 新 PUT 端点改权重/启用态(非负有限数校验);前端 `/indicators` 创建表单 weight + 已存因子 inline 改权重 + 启用开关。**权重经 `customFactorsForQuality` 自动贯穿实盘 `run_eod` 与回测 `run_backtest`(口径一致)**。约 ~290 测试,CI 绿。**剩余**:ICIR 自动加权(目前手动)、更多内置因子。
3. **更多内置因子 + DSL 算子**:扩 `factors/library.py`(成长/情绪/反转族)与 `indicators/operators.py`(更多回看算子);新因子若需新数据走 `required_caps` 降级。
4. **M3 v2 LightGBM / ensemble**:`ModelType` 加 `lightgbm`;`training/train.py` 加非线性分支(lightgbm 建议做可选 extra 保「可分发」轻量);GPU 走 `resolve_device` 已就绪。
   - **(用户决策 2026-06-10:排在「联网验证可分发地基」之后再做。)** 推理两条路线:① 轻装=`dump_model()` 导出树为 JSON + polars/numpy 自实现树遍历(保住「模型=JSON·推理零重依赖·随包零模型」地基,工作量中等);② 简单=运行时依赖 lightgbm `predict`(破坏轻装,打包带二进制)。树模型更易过拟合 → 诚实 OOS 口径(IS/OOS 并列 + `layered_*`)更吃重。红线#1 不受影响(特征 asof / walk-forward+purge 管线复用)。
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
- ✅ **Tauri 壳已在本机编译通过(2026-06-10)**:cargo 镜像(aliyun)恢复可达;`cargo build` 产出 13MB debug 可执行。修了 2 个真实「可分发」缺口(否则 M6 打包必炸):① `tauri.conf.json` 非法 `comment` 字段(Tauri 2 schema 严格,拒任意字段)② 缺失 `icons/`(Windows 资源需 `icon.ico`,已用 Pillow 生成品牌图标全套)。**仍待**:`tauri dev` 实跑 sidecar supervisor 起停 + `tauri build` 出安装包(需冻结 sidecar:engine PyInstaller / api Node SEA + WiX/NSIS,留 M6)。
- **日期 ISO 校验只覆盖回测入口**:`/backtests` 已加 `train_end`/`backtest_start`/`backtest_end` 的 `^\d{4}-\d{2}-\d{2}$` 校验(红线#2 纵深);`/models/train` 的 `train_start`/`train_end` 尚未加同款校验(目前同样靠前端 date input 隐式保证 ISO),可补齐成统一中间件。模型 `train_end` 入库后回测端比较亦默认其为 ISO。

### 11.3 联网验证「可分发」地基(2026-06-10,已做)

用户提供真实 Tushare token,在本机联网环境验证地基两半,**均通过**:

- **A 半 · Tauri 桌面壳编译**:cargo 镜像(aliyun,项目级 `.cargo/config.toml`)恢复可达;`cargo build`(src-tauri)从干净状态编译几百个 crate(tauri 2.11 / wry / webview2-com / tao …)成功,产出 13MB debug 可执行(`target/debug/sinan-desktop.exe`)。过程中**抓出并修复 2 个一直藏着的真实缺口**(CI 不编 Tauri、只编 shell-core,故从未暴露):① `tauri.conf.json` 里用 `comment` 键当注释 → Tauri 2 config schema 严格拒任意字段;② `src-tauri/icons/` 整个目录缺失 → Windows 资源生成需 `icon.ico`。修法:删 `comment`、用 Pillow 生成品牌图标(紫渐变圆角 + 指南针指针)`icon.png`/`icon.ico`/多尺寸。
- **B 半 · 真实数据端到端 smoke**:6 只大盘股 × 2024 全年 → `CacheBuilder` 真实建缓存(`done 6/6`,24 覆盖项,price/adj/daily_basic/**北向**全拉到,242 交易日)→ `score_universe` 真实打分(coverage 0.8,ep/bp/mom20/north_chg5 有效;**roe 诚实降级**——CacheBuilder 不建 fundamental 数据集,符合预期)→ `run_backtest` 真实回测(154 天 / 7 笔 / 含成本,degraded 随结果带出)。**整条数据链在真实数据下跑通**。
- **token 能力位(该号积分)**:✅ DAILY_OHLCV / ADJ_FACTOR / DAILY_BASIC / NORTHBOUND / SW_INDUSTRY / TRADE_CAL;❌ FUNDAMENTAL / FINA_INDICATOR / INDEX_OHLCV / INDEX_WEIGHT / REALTIME_QUOTE(更高积分门槛)。故 roe 因子与回测沪深300基准在该号下会降级(诚实空,非 bug)。
- **红线在真实数据下成立**:#4 token 全程只走环境变量、绝不落文件/日志/库;#3 roe 降级如实、coverage 如实;#1/#2 回测走 train_end+purge 守卫、scoring 如实、含成本。⚠️ smoke 回测的「年化/夏普」是手选小样本、无指数基准,**绝不代表真实策略业绩**,仅证明链路跑通。

**仍待(M6 / 联网续做)**:`tauri dev` 实跑 sidecar supervisor 起停 + 端口握手;`tauri build` 出安装包(需冻结 sidecar:engine PyInstaller / api Node SEA,经 `externalBin` 注入 + WiX/NSIS 打包);CacheBuilder 接 `fundamental`/`index_ohlcv` 数据集(让 roe/基准在足额积分下可用);经 api/前端走一遍完整 HTTP 链路(本次 smoke 直调 engine 模块验证数据正确性,未起 sidecar 验证架构链路)。

### 11.4 桌面端实跑 + UI 打磨(2026-06-10,本会话 13 commits,93d0b00→127d81b,CI 全绿)

用真实 Tushare token(5100 积分)在桌面端实跑(`pnpm dev` 一键起),抓出并修了一大批「只有真跑桌面端才暴露」的真 bug + 做了一轮 UI 打磨。

**桌面端实跑修的真 bug(CI 抓不到 —— CI 不编 Tauri / 不跑桌面 HTTP 链路)**:

- **CORS 漏 methods(最坑,一串现象的总根因)**:`services/api/src/bootstrap.ts` `enableCors` 只配 origin,@fastify/cors 默认只放 GET/HEAD/POST → `PUT`(保存 token `/credential`、设主源 `/active`)、`DELETE`、`PATCH` 的预检全被拒 → **保存 token 静默失败 → 能力探测全「未授权」**(伪装成「setActive Failed to fetch」「全未授权」等多个无关现象)。修:显式列全 methods + allowedHeaders(content-type, x-sinan-token);e2e 回归测试(OPTIONS 预检断言)。
- **能力探测误判**:`tushare_provider.py` `test_connection` 的 `_PROBE` 只传 `{limit:1}`,而 income/fina_indicator/index_daily 必填 `ts_code` → tushare 返回「必填参数」(非积分/权限错)被 `except ProviderError:caps=False` 误判为无权限 → 5100 分账号财务/指数显示「未授权」。修:`_PROBE` 改为每接口带必填参数(ts_code/index_code),让 tushare 真正跑权限校验;`test_tushare.py` 回归测试。
- **前端 content-type 400**:`apps/desktop/src/api/client.ts` 无条件给所有请求加 `content-type:json`,但无 body 的 POST(provider/test、onboarding/complete、models/activate)→ Fastify 400「Body cannot be empty」。修:仅 `opts.body !== undefined` 才加 content-type。
- **Tauri capabilities 缺失**:`src-tauri/capabilities/` 目录根本不存在(gen 权限空 `{}`)→ 窗口控制(最小/最大/关闭)+ `data-tauri-drag-region` 拖拽全被拒。新增 `capabilities/default.json` 授 `core:window:*`(minimize/maximize/toggle-maximize/start-dragging/close)。
- **vite watch src-tauri**:vite 监视 `src-tauri/target/`,cargo build 写文件时 `EBUSY` 崩溃(白屏)。`vite.config` 加 `server.watch.ignored: ['**/src-tauri/**']`。
- tauri.conf 非法 `comment` 字段 + `icons/` 缺失(见 §11.3,A 半已修)。

**UI 打磨(本会话)**:

- 品牌 logo 换四色 Fluent 风(`shell/Logo.vue` + `src-tauri/icons/*` 用 Pillow 重生成);标题栏版本号读真实 `package.json`(全项目统一 **0.1.0**);能力探测中文标签抽 `lib/caps.ts` 共享(设置页+引导页);指标质检按钮/输入框重叠修复;Sidebar 文案。
- 自定义 `ui/DatePicker.vue` 替换 4 页(指标/回测/模型/信号)原生日历(玻璃弹层 + accent 选中 + 月份导航 + 今天/清除)。
- **引导嵌主界面**(用户要、贴设计稿):未完成 onboarding 时 `Dashboard.vue` 在 AppShell 内(侧栏可见)渲染 `<OnboardingWizard>`,`finish()`→`bootstrap()` 更新 `onboardingDone` 响应式切回总览;`/onboarding` 去 `noShell`;`OnboardingWizard` 去全屏极光 + `min-height:100%`。
- 前端端口 5914 → **9521**(`vite.config` port + `tauri.conf` devUrl;改了要重编 Tauri 才生效)。
- 一键 **`pnpm dev`**(`scripts/dev.mjs`:编译契约/api → cargo build → 起 vite:9521 → 起桌面壳 + 注入 `SINAN_PYTHON`/`SINAN_API_ENTRY` 等 env;Ctrl+C 一并停。已实跑验证)。
- **`/help` 帮助页**(`pages/help/Help.vue`,侧栏系统组:产品定位/工作流/逐页/六红线/FAQ)。

**⚠️ 给下一位的关键提醒**:

- **真实 token 已在对话明文出现两次,用户已重置。新会话务必让用户在引导页输入 token,绝不让其贴进对话。**
- 桌面端跑法:`pnpm dev`(一键)。⚠️ dev 用 `SINAN_SECRET_STORE=memory` → token 重启不持久,每次重跑要重输 token + 重走引导。
- 本机环境曾有多个残留 `cargo`/`rustc` 进程互等 package cache 锁导致 `pnpm dev` 卡在「Blocking waiting for file lock」→ `Stop-Process cargo,rustc` 清掉即可(非脚本 bug)。
- **核心数据流还没在桌面端完整跑通过一次**(建缓存→质检→训练→回测出真实结果)。这几轮用户一直在调 UI/外壳,这是最该补的端到端验证。

**待办(用户明确提 + 候选,按优先级)**:

1. **DatePicker 美观优化**(用户反馈还不够美;截图见指标/模型页)。
2. **关闭确认对话 + 系统托盘**(关窗时问「最小化到托盘 / 退出软件」;Tauri 托盘 + `lib.rs` 的 `WindowEvent::CloseRequested` 拦截 → 前端弹对话 → 设置项记忆选择;capabilities 需加托盘权限)。
3. **持仓建仓苹果风重设计**(`pages/portfolio/Portfolio.vue`:那两个无 label 的框是「股数」「成本价」;用户要搜索补全代码/名称 → 需新 api(engine `tushare_provider.stock_list` 未暴露给前端,要加端点)+ 加仓减仓移动加权成本自动计算 + 苹果风表单)。
4. **真实数据跑通验证**(建缓存→质检→训练→回测,桌面端真实数据端到端;用户已有 token、能力全可用)。
5. M6 打包(`tauri build` 安装包 + 冻结 sidecar);M5 资讯;M3 v2 LightGBM(用户倾向轻装:JSON 树+polars 推理);ICIR 自动加权;CacheBuilder 接 fundamental/index_ohlcv;设置页 PUT;`/models/train` ISO 校验。

### 11.5 本会话(很长的一轮:UI 控件 + 一批真实 bug 修复 + 可观测性 + 设计审计,12 commits,07cf2bf→0a58279,CI 全绿)

> 接手必读:这一轮做了很多,但**有一个用户最在意的 bug 没修好**(单日期框样式),用户自己找到了真因(padding)。还有一份**完整的设计稿还原审计**留给 v2。

**已完成并 CI 绿(按时间)**:

- **DatePicker 三次迭代**(`07cf2bf` macOS 风 → `eb3d5e9` AntD 风 + Teleport 根治弹层裁切 → `0a58279` 触发器 button→div + 锁高)。⚠️ **见下「未解决」**。
- **`cbb6bfe` 训练/质检 500 根因 = undici 300s 超时**:api→engine 走全局 fetch(undici)默认 headersTimeout=300s;大区间训练逐日构建特征面板 5 股 2018-2026 实测 **339.6s** > 300s → `UND_ERR_HEADERS_TIMEOUT` → api 收到 fetch failed → 非 EngineError → NestJS 通用 500(引擎其实在算,结果有限/JSON 合法,**非算法错**)。修:`engine.client` 长耗时端点(train/backtest/factorQuality/paperRun)改走 **`node:http`(默认无响应超时)**;undici 不可直接 import,用 node 内置 http。**同 commit 修缓存覆盖未落库**(CacheBuilder coverage 只进返回值、从不进 SSE 事件 → api data_coverage 永空 → 设置页误判未建缓存)。`bb71a9a` 把 coverage 改逐股增量回传(all-stocks 友好 + 部分构建 + 重建回填)。
- **`261597f` 缓存损坏 parquet 自愈**:写入中断留 0 字节 parquet → 下次 read_parquet 即「File out of specification: header+footer ≥12 bytes」→ 整个建缓存崩。修:**原子写**(`_atomic_write_parquet` 临时文件+os.replace)+ **安全读**(`_safe_read_parquet` 读到损坏→删除自愈 + 返回 None);`data/store.py`。
- **`2ca2900` RangePicker(仿 AntD Vue)**:`ui/RangePicker.vue` 单框「开始→结束」+ 双月面板 + 区间高亮 + Teleport;替换 **指标/回测/模型** 三处起止对(单独日期如训练截止/信号日仍用单 `DatePicker`)。
- **持仓建仓弹窗端到端**(`d4956e4` 股票搜索 API:契约 `stocks_search` + engine `/engine/stocks/search`(provider.stock_list 内存 memo,无 token 诚实空)+ api 代理 + `api.searchStocks`;`0108ba4` `repository.personalAdjust(op=set/add/reduce)` 移动加权成本;`ebccfd7` `ui/Modal.vue` + `ui/StockSearch.vue` + Portfolio 卡片右上「建仓」+ 每行加/减/删 + 加仓预览加权均价)。
- **`35822a7`** 能力探测结果缓存(设置页 caps 回落到该源已存的 caps_json,只点「测试连通」才重测)+ 重建缓存不必重输 token(OnboardingWizard 默认主源 + 检测已配置凭据 → 显示「已配置」直接「继续并测试」)。
- **`fa7d368` 长任务写入统一日志(可观测性)**:`repo.logInsert` 本就「落库+发 SSE」,接到建缓存(逐股:`缓存 600519.SH · 2018-01-02~2026-06-09 · price/adj/basic/north · N 行`)/ 训练 / 质检 / 回测(开始+完成+耗时+失败)。**日志页(持久+实时流)= 切菜单不丢的可观测面**。

**⚠️ 未解决(v2 高优先,用户最在意)**:

- **单日期框被撑成竖排高框**(回测「训练截止」、信号「信号日 T / 生效日 T+1」用的是单 `DatePicker`)。表现:占位文字居中 + 日历图标在下,框约 64px 高,而非 30px 单行。**用户自己定位到:是 padding 问题。** 我试过 button→div + 显式 `height:30px`+box-sizing+nowrap(`0a58279`)**仍未解决** → 说明根因不在触发器元素,而在某处 **padding**(候选:`.field`/`.input`/页面 `.runner`/`.dp` 包裹层的纵向 padding,或 `.input { padding: 0 10px }` 被更具体规则覆盖)。**下一会话第一件事:在桌面端 DevTools 里量 `.dp-trigger` 的 computed height/padding,定位那条 padding 改掉。** 注:同页 `RangePicker`(div 触发器)单行正常,可对照其 computed 样式找差异。

**v2 设计稿还原(用户要"严格按 design_handoff_sinan 还原",本会话已做 10-agent 并行审计,结论如下)**:

- **决策(用户拍板)**:**保留"实现比 mock 设计稿更真实"的改进**(真实 API / 诚实空态 / 能力探测真值 / 隐私多列 / 引导多了欢迎步+token 复用)——v2 只修**纯视觉漂移**,不回退真实接口。
- 🔴 **Blocker — 行情页完全没还原**:设计稿(`design_source/src/pages/market.jsx`)是**行业板块视角**(大盘指数条 + 板块卡片网格 + 涨跌排行 + 资金流向 Top6 + 右滑下钻抽屉:板块→成分股列表→**个股分时图**);当前实现是报价表 + 日K线,完全不同。⚠️ **数据可行性**:分时图需分钟数据,用户 token **没有**(有日线/复权/每日指标/北向/**申万行业**/交易日历)。建议方案:**真实板块视角**(用日线+申万行业做板块卡/排行/资金流/成分股列表;叶子分时用日K替代)。用户答复倾向未最终敲定(会话提前收尾),v2 开始时再确认。
- 🟠 **Major 漂移(清晰可还原,数据多已具备)**:① 总览 PnL 双卡缺**迷你 Sparkline 净值图**(`ui/charts/Sparkline.vue` 已存,接最近净值点);② 指标因子表缺**权重列(进度条)+ 启用开关**(5列 vs 设计7列);③ 模型缺**「因子构成」卡**(数据在 `detail.feature_importance`)+ 风控约束应是**带进度条 RiskBar**(`ui/charts/RiskBar.vue` 已存)非纯文字;④ 信号拦截表第4/5列都显示 `reason`(应为 `blockedBy` 拦截规则 + `note` 说明 两字段,需 trading store / 后端补字段);⑤ 持仓**当日盈亏格应两行(金额+百分比)**,现只「—」;⑥ 设置数据源网格应**固定 4 列**、能力探测**固定 3 列**(现 auto-fit 回流变形,纯 CSS);⑦ 引导 logo 背景应**紫渐变+发光**(现普通卡片,纯 CSS)+ 缺**「本地数据目录」第3数据源** + 副标题「本机」→「本地」;⑧ 外壳 Logo 应**单色罗盘**(现 Fluent 四色花朵 `shell/Logo.vue`)+ **状态栏缺「缓存 GB·条数」+ 实时时钟**。
- 🟢 **回测页:零漂移**(配色三通道全对、布局/卡片/热力图/逐笔逐日均还原到位)。
- 审计全文(逐页 design vs impl vs fix)在本会话 workflow 输出,可在 v2 重跑 `design-fidelity-audit` 工作流复现。

**其他本会话提出、未做的候选**:

- **页面状态跨导航持久化**(用户痛点:切菜单后表单/进度丢)。已提两方案:① 全局「运行中」指示器(状态栏显示"训练中…/建缓存 45%",任何页可见,轻量);② 表单+进度搬进 pinia store(完整但重)。日志页已部分缓解(能看在不在跑)。
- 关闭确认 + 系统托盘(§11.4 待办②,仍未做)。

**⚠️ 给下一位**:

- token 本会话又多次明文出现,**新会话务必让用户在引导页输入,绝不让其贴对话**。
- 本会话期间检测到**并发会话**(另一个 Claude 会话/手动 git 曾 commit「股票搜索端点+持仓弹窗」又 `git reset` 回 eb3d5e9,清掉了未提交的工作)→ **提醒用户别同时开多个会话编辑同一仓库**。本会话「股票搜索 API」是重做的。

### 11.6 本会话(单日期框修复 + v2 视觉漂移闭环 + 状态持久化 + 运行进度,9 commits d791ad6→e880cdb,CI 全绿)

> 接手必读:本轮把 §11.5 留下的「单日期框」彻底修了,并按 v2 决策做完 8 项 🟠 视觉漂移 + ③ 状态持久化 + 运行进度提示。**唯一剩下的大件 = 🔴 行情页全市场快照(已完整定方案+锁决策,未动工,见下)。**

**验证手法(本轮关键)**:用 Claude Preview MCP 起**独立** vite(`--port 9530`,不碰用户的 9521),经 `__vue_app__.config.globalProperties.$pinia._s` 拿 store、`getComputedStyle`/注入临时数据,**实测**每刀效果(DevTools 级)。`.claude/launch.json` 已留(autoPort:false / port 9530)。

**已完成并 CI 绿**:

- **`d791ad6` 单日期框竖排根因 = `empty` 修饰类撞设计系统全局 `.empty`**:DatePicker/RangePicker 触发器「未选值」加的 `empty` 类,与 `components.css` 的空状态容器 `.empty`(flex-direction:column + padding 40 24 居中)同名撞车;且触发器是 `.field`(列 flex)的 flex item,隐式 `min-height:auto` 让其按列内容撑高 → 盖掉显式 `height:30px`(故上轮锁高无效)。**改 `empty`→`is-empty`**(两 picker 模板+scoped)。DevTools 实测 82px 竖排 → 30px 单行。⚠️ 这是「动态修饰类撞全局工具类」的通病,以后加修饰类避开 `.empty/.card/.input` 等全局名。
- **`2186881` 🟠1 外壳/设置/引导**:状态栏右补实时时钟(本机 HH:MM:SS)、左补「缓存 N 条」(真实 `coverage.total_rows`,**无 GB 字段→不造 GB**);app store 加 `coverage`+`refreshCoverage`(进 bootstrap)。设置数据源网格 `repeat(4,1fr)`、能力探测 `repeat(3,1fr)`。引导 logo 紫渐变软底+accent 描边+发光(**保留四色 Fluent,不回退单色罗盘**——用户拍板)、副标题「本机」→「本地」。**未加引导「本地数据目录」第3源**(后端无 local provider,加=造假,红线#3)。
- **`1d71236` 🟠2 总览/持仓**:总览 PnL 双卡补 104×40 迷你 Sparkline(真实 `daily_pnl.total_assets` 近 40 点;不足 2 点不画;涨跌用 `--pnl-up/--pnl-down` 令牌随 invert 自动交换)。持仓「当日盈亏」由恒「—」改两行(金额+%),数据复用 `pnlToday.by_holding`(trading store 此前丢弃,现补类型 `LiveHolding`/`LivePnl` 并消费);报价不可用的行诚实「—」。**实测 600396.SH 真实 -7.12%**(引擎报价日线回退,token 无实时仍有值)。
- **`8085d69` 🟠3 指标(模型页不改)**:指标因子表补「权重/启用」两列(5→7 列贴设计)——自定义因子显示真实权重条+可用开关(`updateFactor`),内置因子「等权/内置」(诚实不伪造可编辑)。**模型页风控约束**经评估**保留文本未改**:模型页风控是静态配置基线(止损/止盈/单票上限),无「当前利用率」,套 RiskBar 须伪造 used 值(违反红线#3);设计的「因子构成」已由真实 `detail.feature_importance` 覆盖。
- **`34e68c4` 🟠4 信号拦截两列**:修「第4/5列都显示 reason」——拆「拦截规则(短标签 badge)/说明(规则解释)」,`lib/signals` 加 `blockRule()/blockNote()` 由真实 reason 派生(拦截组实际 reason∈{rank_out,market_filter})。**不伪造实例级数字**(未引入后端 note 字段;要「排名第N/阈值X」级具体说明需 engine 出信号时补结构化 note 落库)。+1 测试。
- **`b3036dd` + `c14dbd0` ③ 页面状态搬 pinia store**:新增 `stores/{backtest,models,indicators}.ts` + trading 加 signalToday/Effective/Tab。**低改动「投影」模式**:`form = store.form`(同一 reactive,v-model 直接写 store 留存);其余 `computed(() => store.x)` 只读投影;可写项(showForm/expr/factorName/factorWeight/selectedName/tab)用**可写 computed**;动作转调 store。**模板与派生 computed 全不动**。效果:长 run() 由 store 拥有 → 离开页面不中断、结果回填;表单/DSL/选中/tab 切菜单留存。实测四页全留存。
- **`e880cdb` 运行进度提示**:`ui/RunningBar.vue`(不定式动画条 + 诚实「已运行 mm:ss」,自足无后端)接入回测/训练/质检运行态。**不伪造 %**——真实 %/ETA 需 engine 在 walk-forward/逐日循环流式发进度(jobs+SSE,同建缓存),**列为后端跟进**。

**🔴 行情页全市场快照(task #6,已锁方案+决策,未动工)**:

- 用户拍板:**真实板块视角·全市场快照**;**行业口径=申万一级(index_classify L1 + index_member 成分,失败优雅降级到 `stock_basic.industry`)**;**行业映射=engine 内存 memo 按需拉**(不改 CacheBuilder);缺数据三处:**指数条→全A涨跌广度(真实)、资金→北向(有则真无则诚实空)、个股叶子→日K(复用 `/engine/prices`+`Candles.vue`)**。
- 数据底盘已摸清:缓存 **3486 股 × 2018-01-02~2026-06-11(~22M 行)**;`DataLayer.latest_asof(dataset, asof, fields, codes)` 取 ≤asof 最新行;`_price_map` 取某字段;`kline()` 取日K;`registry.fetch(Capability.SW_INDUSTRY, ...)` / `provider.stock_list()`。**price 数据集是否含 pre_close 待确认**(算当日涨跌要昨收;否则取前一交易日 close)。
- 实施(契约先行→engine→api→前端,逐刀全绿;**旧行情页保留到前端最后一刀切换,全程不破**):① engine `factors/market.py`:全市场最新交易日快照→个股日涨跌→按申万一级聚合(板块涨跌=成分等权均值/涨跌家数/领涨股/近N日板块 Sparkline)+北向汇总+全A广度;② 契约 `market_snapshot`/`market_sector` + api 代理;③ 前端按 `design_source/src/pages/market.jsx` 重写(全A广度条+板块卡网格 Segmented 排序+右涨跌排行/北向流向+下钻抽屉:板块→成分表→个股日K)。守红线#1(asof PIT)/#3(诚实空)/#6(engine 不写库)。
- ⚠️ market.jsx 等 `design_source` 文件在本会话起始就是**已修改未提交**状态(用户本轮扩写了市场设计,+400 行),是当前设计真相源;勿覆盖。

**⚠️ 给下一位**:① token 让用户在引导页输入,绝不贴对话;② dev 用 memory 钥匙串,token 重启不持久;③ `pnpm dev` 卡 file lock → Stop-Process cargo,rustc;④ 别同开多会话改同仓库。

**本会话续(用户验机后报的真 bug + 性能,3 commits)**:

- **`880b766` 持仓现价富集 + 日志滚动**:持仓行「现价/市值/浮动盈亏/盈亏比例/当日盈亏」恒「—」真因=持仓接口只返原始行(手录股数+成本,现价不入库),从不取现价估值(「今日实时盈亏」走另一条 `livePnl` 路径故能算)。修:api `PortfolioController.enrich()` 用 `engine.quotes`(本 token 走日线收盘回退)算 current_price/market_value/float_pnl/prev_close/day_pnl,model+personal 查询/加减仓/删除均富集,报价不可用诚实留 null;前端 `Holding` 加 prev_close/day_pnl,Portfolio 逐行当日盈亏改读富集持仓(与现价同源)。⚠️ **是 api 后端改动 → 需重启 `pnpm dev`(重编 api)才生效**。日志:`.dt-wrap` 加 `max-height:calc(100vh - 290px)` → 滚动落「系统事件」卡内而非整页。
- **`7fcccf8` 性能(用户#1优先级,DONE)**:`DataLayer` 每实例物化数据集到 duckdb 临时表(首次 asof 按 codes 分区裁剪整段读入,后续逐日 asof 只内存切片)。质检/训练逐日 asof 从「N 次重扫 parquet」→「1 次读入 + N 次内存查询」(分钟→秒)。**WHERE/QUALIFY/ORDER 不变 → PIT 不变式不受影响,158 engine 测试全过**。进一步向量化(整段一次算全因子)留后续。

**用户拍板的发布前开发顺序(① 已完成)**:① 性能✓ → ② 🔴行情页 → ③ 真实进度%(回测/训练接 jobs+SSE)→ ④ M6 打包 → ⑤ 多专家视角 UX 评审(Workflow,发布前质量关)。

**🔴 行情页后端 scoping 收尾(可直接写 `factors/market.py`)**:

- 行业:`sw_industry` 数据集**在 layout 有定义(PIT by in_date)但 CacheBuilder `_DATASET_FETCH` 没建 → 未缓存**。按拍板走 provider:申万一级 `index_classify`(L1)+`index_member` 成分,进程内 memo,失败优雅降级 `stock_basic.industry`。
- 个股当日涨跌:**`COLS_PRICE` 无 pre_close** → 取 price asof 每股最后 2 个 close 算 chg(物化后内存查询快);daily_basic 是否有 pct_chg 待确认。
- 宇宙=price 缓存 distinct stock_code(3486);最新日=max trade_date;北向已缓存。
- 实施序:契约 `market_snapshot`/`market_sector` → engine `factors/market.py`(全A广度+板块聚合) → api 代理 → 前端按 `market.jsx` 整页重写(下钻叶子日K复用 `/prices`+`Candles.vue`)。旧行情页保留到最后一刀切换。守红线#1/#3/#6。

### 11.7 发布冲刺(本大会话续:性能/建缓存/真bug/信号可读/行情页里程碑,~13 commits,CI 全绿)

用户拍板发布前顺序「① 性能 → ② 行情页 → ③ 真实进度% → ④ 打包 → ⑤ 多专家UX评审」。本轮做完 ①②:

- **`7fcccf8` ① 性能(质检/训练)**:DataLayer 每实例物化数据集到 duckdb 临时表 → 逐日 asof 由「重扫 parquet」降为内存查询(分钟→秒)。WHERE/QUALIFY/ORDER 不变,PIT 不受影响,158 测试过。
- **`d743907` 建缓存 O(N²)→O(N)**(用户验机报「太慢 + 建缓存失败」,根因):`write_dataset` 把每股写进**共享 board×year 分区文件**(读整文件+重写)→ O(N²) 写 + coverage_for O(N²) 读;超大分区内存重写很可能是「失败」根因。修:**分股文件 `<code>.parquet`**(只动自身小文件 O(stock))+ coverage_for 只 glob 该股文件 + **DataLayer 物化对非财务按主键去重**(旧 part.parquet 与新分股文件安全共存,财务 PIT 不动)。实测写入线性(~7ms/股);新增迁移共存去重测试。⚠️ engine 改动需重启 `pnpm dev`;用户可直接重建缓存(分股布局快速重抓,旧数据读端兼容不丢)。
- **`371241d` 信号加名称+板块**:engine `/engine/stocks/names`(复用 stock_list memo)+ api 富集 signals 名称(单例缓存);前端 `boardLabel` 派生**交易所板块**(沪/深主板·创业板·科创板·北交所,纯前端)。⚠️ 名称是 api 改动需重启。
- **`a4c356b` 运行进度计时跨导航不重置**:RunningBar 开始时间搬进 store(`startedAt`)+`:since` 投影(原本组件本地计时,切走切回重挂归零=「每次进来 0 秒」bug)。
- **`0b79fd7` 日志滚动落卡内**:AppShell `.body-inner` 改 `height:100%`+flex 列;日志 `.events-card` flex 填充、`.dt-wrap` 内部滚动(原 max-height 魔法数太贴窗口仍整页滚)。其余页超高仍整页滚(已验)。
- **`880b766` 持仓现价富集**:api `PortfolioController.enrich()` 用 engine.quotes 算 现价/市值/浮动盈亏/当日盈亏(原本只返手录股数+成本,全「—」)。⚠️ api 改动需重启。
- **`c96d045`+`44064ab`+`d9c932c` 🔴 行情页里程碑(板块视角,3 刀)**:engine `factors/market.py`(全A广度+按行业聚合板块卡:涨跌/家数/领涨/近N日 Sparkline + 成分股)+ DataLayer `latest_dates`/`window` + provider stock_list 加 industry + `/engine/market/{snapshot,sector}`(slice1,test_market.py);契约 `market_snapshot`/`market_sector` + api 代理 + 前端 api(slice2);前端 Market.vue **整页重写**为板块视角(全A广度条 + 板块卡网格 Segmented排序 + 涨跌排行 + 下钻抽屉→成分表→个股日K Candles)(slice3,注入数据实测全渲染)。**行业=stock_basic.industry**(可靠 v1,一次调用覆盖全市场);**申万一级**(更干净 28 类,需申万成分 API+积分)与**北向资金流向**(需 moneyflow)为 v1 后续增强。⚠️ 整条需重启 `pnpm dev`(engine+api)走真实数据。

**发布剩余(③④⑤)**:③ 真实进度%(回测/训练接 jobs+SSE 流式,现仅「已用时」)、④ M6 打包(冻结 sidecar 出安装包)、⑤ 多专家视角 UX 评审(Workflow,发布前质量关)。lib/market 随行情页重写已不被 Market.vue 使用(其纯函数 + market.test.ts 仍在,轻度可清理)。约 ~340 测试 CI 绿。

**⚠️ 必读**:本轮多处 engine/api 后端改动(性能/建缓存/持仓/信号名称/行情页)**需重启 `pnpm dev`(重编 engine+api)才在桌面端生效**;纯前端(进度/日志/板块列/板块视图)HMR 即时。token 让用户引导页输入,绝不贴对话。

### 11.8 训练/质检 SSE 流式进度(发布项③)+ 行情页空 meta 崩溃修复 + 凭据指纹诚实化

用户验机报三件真 bug:训练/质检 `ECONNRESET` 失败且全程零反馈想看「提升/下降」明细;引导测试连接「已配置/已连接」却「未配置 token/连接异常」自相矛盾(=重建带入指纹问题);行情页 500。

- **行情页空 meta 崩溃(诚实降级,先修)**:`factors/market.py` `_meta_frame({})` 用空列表建 DataFrame → `stock_code` 推断成 `Null` → 与左侧 `str` join 抛 `SchemaError` 500。根因:有价格缓存但本会话无 token → `_industry_meta` 拿不到 stock_list 行业映射。修=给 `_meta_frame` 显式 `schema=Utf8`(空时列也 str)→ 左 join 保留全行、全A广度照算、板块诚实空。+2 回归测试(有行情+空 meta / 成分股空 meta)。
- **训练/质检 SSE 流式进度(发布项③,核心)**:`build_feature_panel`/`run_train`/`factor_quality` 加可选 `on_progress` 回调(回调异常被吞,绝不影响计算);`/engine/train`、`/engine/factors/quality` 由一次性 JSON 改 **`StreamingResponse`**(新 `_sse_compute` 包装器:worker 线程跑 compute(emit),逐进度事件推流,末尾 `{stage:'done',result}` 或 `{stage:'error',status,detail}`;守卫 422 / ValueError 400 走 error 事件 status,预检失败如无缓存仍开流前抛 400)。事件:特征面板 `day X/N` · 训练逐折 `IS/OOS IC` · 质检逐因子 `IC/ICIR/覆盖`。api `engine.client.ts` 加 `slowPostStream`(node:http 无超时,解析 SSE,done→resolve(result)/error→EngineError;流意外断无 done→诚实报错不当成功);`models.ts`/`indicators.ts` 把进度事件**边收边写统一日志**。**双重收益**:① 持续数据流保活长连接,根治 4h 空闲被对端重置的 `ECONNRESET`;② 日志页变实时训练控制台(满足「看提升/下降」)。`models_train`/`indicators_quality` 对前端**返回 JSON 形状不变**(流式仅 api↔engine 内部)→ 前端页面零改动;且 api 服务端跑完即落库/落日志,**前端连接即便中断模型仍保存**。前端 `Logs.vue` 加**自动轮询(默认 3s,切走即停)**→ 进度逐条实时显现。
- **凭据指纹诚实化(修矛盾)**:dev `SINAN_SECRET_STORE=memory` token 重启即丢,但指纹落 SQLite 持久 → `info()` 只看 DB 指纹报「已配置」,实际 `getToken` 为 null。修=`CredentialService.info()` **交叉校验密钥库真有 token**:DB 有指纹但 `store.get` 取不到 → 诚实报 `configured:false`(引导提示重输,不再「已配置·无需重输」却测试失败)。+1 回归测试(模拟重启:指纹在/token 丢→info 报未配置)。⚠️ 仅诚实化 UI;**dev 下 token 仍重启不持久**(根治需把 dev 切真实钥匙串/文件加密存,有破 `pnpm dev` 风险,留给用户拍板)。
- 全绿:engine pytest 164 · api node:test 57 · 前端 vitest 71 + typecheck 干净。⚠️ engine+api 后端改动**需重启 `pnpm dev`** 才在桌面端生效;Logs.vue 自动轮询 HMR 即时。

**训练提速(用户报「太慢/利用 CPU」,①+②叠加 ~4–8×,实测 400股×1000天 234s→58s=4.1×)**:瓶颈实测=逐日特征面板,非单核——真因是逐日「重扫 ≤asof 全历史再排序」随区间 O(N²) 累积 + 逐日×逐因子固定开销。

- **① 有界取数(算法,PIT 安全、结果不变)**:`DataLayer.latest_asof` 改 **SQL QUALIFY 每股直取最新一行**(替代「取全历史再 polars group_by.last」,只返 ~股数 行);新增 **`recent_asof`**(每股 ≤asof 最近 n 行,QUALIFY row_number≤n)。`Factor` 加 `lookback` 字段(ep/bp/roe=0、mom20=20、north=5;自定义 DSL=None);`FactorContext(lookback=)` → `history()` 走 recent_asof 只取最近窗口;`build_feature_panel` 派生 `ctx_lookback=任一None→None(自定义在场不裁剪保正确,红线#3)否则 max+5`。黄金测试:窗口 == 无界逐值相等。单核 ~1.5–1.8×(随股数增大)。
- **② 多核并行(进程池按日期分块)**:`build_feature_panel(workers=)`:workers>1 且因子全可 pickle(无自定义闭包,以 lookback≠None 为代理)且日数≥40 → 按 30 天/块 `ProcessPoolExecutor` 并行,**进程内 `_WORKER_DL` 缓存复用物化**(同 worker 跨块不重物化),per-chunk 回传「features」进度(复用串行事件形状,api 日志一致)。`'auto'=min(核-1,4)`(每 worker 各物化一份缓存 → N×内存,4 控内存;用户可调高)。**并行失败/spawn 不支持/内存不足 BrokenProcessPool → except 自动退串行(1×内存,correctness 不丢)**。`run_train`/`factor_quality`/engine 端点加 `feature_workers`(默认 None→`'auto'`,**默认开多核**;路由测试显式传 1 保串行)。黄金测试:直调 `_build_panel_parallel` == 串行(绕过兜底确保真跑并行)。
- 提速无需 api/前端改动(engine 默认 auto)。⚠️ **M6 打包**:PyInstaller 冻结 sidecar 用 ProcessPoolExecutor 需 `multiprocessing.freeze_support()`,否则子进程递归启动——打包时务必加。自定义因子质检暂不并行(闭包不可 pickle)、不裁剪窗口(回看未知保正确),留 v2(可从 DSL 推导 max 窗口 + 传 specs 重建)。

- **训练页股票池 + 并行核数控件 = DONE**:`Models.vue` 训练表单加 ① **股票池**(`StockSearch` 篮子 + chips,默认空=全 A;指定后 codes 下发 → 训练量随股票数线性下降,单项最大提速杠杆)② **并行核数** select(自动/1/2/4/8 → `feature_workers`)。贯穿:`stores/models.ts TrainForm`(+codes/codeNames/feature_workers,`train()` 剔除 display-only codeNames、空 codes 省略)→ api `models.ts`(透传 codes+feature_workers)→ engine.client `TrainRequest.feature_workers`。新增 `icons.ts` 的 `x` 图标。api 57 + 前端 vitest 71 + 双 typecheck 绿。⚠️ StockSearch 需 token 才有补全(无 token 诚实空,但默认全 A 不依赖搜索)。**质检页**同款控件待加(同理可贯穿 factor_quality)。
- **发布剩余**:③ 余项=真实 **%/ETA + 前端实时进度条**(训练/质检已流式但前端仅靠日志页看;可让 Models/Indicators 页直接订阅 SSE 显进度条/转 jobs+`subscribeJob`);质检页补股票池/workers 控件。④ M6 打包(含 freeze_support)、⑤ UX 评审照旧。
- 提速后全绿:engine pytest **166** · api node:test 57 · 前端 vitest 71 + typecheck 干净。

### 11.9 M6 打包 = DONE(v0.1.0 首个可分发包,本会话云端发布)

用户「准备发布第一版」→ 把 dev 形态做成 Windows 安装包,云端 GitHub Actions 构建 + 发 Release。

- **发布就绪审计(7-agent workflow)**:核心逻辑 + 6 红线 + ~290 测试全绿,**唯一 blocker = 可分发**(两个 sidecar 没冻结)。顺带收口 `/news` 桩(隐藏+重定向 /dashboard,M5 留 v2);核实 B5「token 泄漏」非真漏洞(tushare 错误不回显 token)。
- **B1 engine 冻结**:`sinan/__main__.py`(`freeze_support()` 必需——多核子进程会重启本 exe;端口从 `SINAN_ENGINE_PORT` env)+ `sinan-engine.spec`(PyInstaller **one-dir** 利于多进程 + 关 UPX)。产出 536MB one-dir;healthz/providers/indicators/sklearn 端点全验通。
- **B2 api 冻结**:**不走 SEA,走「随包 node.exe + esbuild 单 CJS bundle」**(实测 `node api-bundle.cjs` 跑通,比 SEA 找 native keyring 稳;supervisor 复用 `api_dev(node, bundle)`)。esbuild external 掉 NestJS 惰性可选包 + keyring;**import.meta.url 坑**(CJS 下空)用 `--define + banner pathToFileURL(__filename)` 修。🔴 **`@napi-rs/keyring` 一直没装**(dev memory store 掩盖)→ 已 add@1.3.0;**native .node 在独立平台子包 `keyring-win32-x64-msvc`**,build-sidecars 须补拷(否则生产 require 崩)。
- **B3 壳生产态定位**:`lib.rs build_spec` 优先级 = 显式 BIN > dev env(dev.mjs)> 生产从 `resource_dir/sidecars/` 定位;`tauri.conf.json bundle.resources=["sidecars/**/*"]`;`scripts/build-sidecars.mjs` 一键(可移植:esbuild JS API、`SINAN_PYTHON` 覆盖)。`.github/workflows/release.yml` 改 windows runner 云端冻 sidecar + tauri-action 发草稿。
- **🔴 装机一条龙四个真 bug(只有真打包才暴露,dev 全程掩盖;靠 sidecar stdout/stderr 重定向到 `runtime/{engine,api}.log` 才抓到)**:① **健康超时 15s→120s**(冻结 engine 冷启动导入数百 MB + Defender 扫描数十秒,15s 误判→不起 api→卡启动遮罩);② **node 写无效 stdout 崩**(GUI 壳无控制台,子进程继承无效 std 句柄)→ 重定向到日志文件给有效句柄;③ **`\?\` 前缀**(tauri `resource_dir` 带 Windows 扩展长度前缀,node 解析主模块脚本路径 `realpathSync` 崩 `lstat 'D:' EISDIR`)→ 剥前缀(引擎 exe 经 CreateProcess 不受影响,仅 node 脚本中招);④ **多核 fork 死锁**(Linux 默认 fork 复制带 polars/duckdb 线程的进程,CI engine 测试卡死)→ 进程池强制 `spawn` 上下文(全平台一致=Windows 既有行为)。另:`bundle.icon` 补 `icon.ico`(MSI 必需)、sidecar `CREATE_NO_WINDOW`(不弹黑控制台窗)。
- **验证**:本地 release exe 实测 engine+api 都起、api /providers 200;`Sinan_0.1.0_x64_en-US.msi`(226MB)/`Sinan_0.1.0_x64-setup.exe`(154MB)本地出包成功。云端 take3 含全部修复构建中→出 v0.1.0 草稿 Release(prerelease,人工复核 Publish)。engine 167 测试绿。
- **剩余/已知**:装机 smoke 仍需用户在干净/无 Python+Node 环境双击装走「引导→建缓存→质检→信号」一条龙(本机 release exe 已验启动,但完整业务流 + token 落 OS 钥匙串持久 + 关窗无孤儿 待真装机确认);beta 未签名(提示「未知发布者」);仅 Windows x64(macos/linux 需参数化平台 keyring 子包 + 平台 PyInstaller)。

### 11.10 在线更新(Tauri updater + Ed25519 签名,本会话)

用户要在线更新。完整 Tauri updater 链路:已装版本启动时查 GitHub Release 签名清单 → 有新版下载/验签/安装/relaunch。

- **签名**:`tauri signer generate -p "" --ci` 生成 Ed25519 密钥对;私钥写 `apps/desktop/.tauri-keys/`(**gitignore,绝不入库**),公钥内嵌 `tauri.conf plugins.updater.pubkey`。私钥经 GitHub secrets API(libsodium SealedBox 加密,系统 python 的 pynacl)推送至仓库 Secret `TAURI_SIGNING_PRIVATE_KEY`(空密码)——**全程不回显私钥**。
- **Rust**:`tauri-plugin-updater` + `tauri-plugin-process`(relaunch);`lib.rs` 注册;capabilities 加 `updater:default`/`process:allow-restart`。
- **配置**:`bundle.createUpdaterArtifacts:true` + `plugins.updater.endpoints=["https://github.com/chocolate-z/Sinan/releases/latest/download/latest.json"]`。
- **前端**:`lib/updater.ts`(check/downloadAndInstall 进度/relaunch,非 Tauri/离线 try-catch 静默)+ `ui/UpdateBanner.vue`(启动 4s 后静默查,有新版才浮层:版本/release body/进度条/一键更新重启)挂 `AppShell`。
- **CI**:`release.yml` 注入 `TAURI_SIGNING_PRIVATE_KEY` + 密码空串;**`prerelease:false`**(关键:updater endpoint 的 `releases/latest` 不解析到 prerelease)→ tauri-action 自动签 bundle + 生成上传 `latest.json`。
- **升级路径**:take3 包无 updater 不能自更新;**装 take4 包(带 updater)后,以后 `git tag vX.Y.Z` 推送 → 云端签名出包发 Release → 旧版启动自动发现并一键更新**。⚠️ 改 endpoint 的 owner/repo 若仓库迁移要同步;换签名密钥需同步换 pubkey + Secret。cargo check + 前端 typecheck/eslint/vitest 71 全绿。

### 11.11 交接状态(2026-06-12 会话末)— v0.1.0 已发布

**当前状态**:v0.1.0 已正式公开发布(可分发 Windows 安装包 + Tauri 在线自动更新)。功能层面 v1 早已完整(缓存→因子→信号→回测→训练→持仓→行情全闭环,6 红线守牢,engine 167 + api 57 + 前端 71 测试绿,CI 三 job 绿)。本会话从 dev 形态一路真打包真发布,挖修 8 个「只有真打包才暴露」的 bug(§11.9)+ 在线更新全链路(§11.10)。

**发新版**:`git tag vX.Y.Z && git push origin vX.Y.Z` → 云端 windows runner 自动冻 sidecar + 签名出包 + **公开发布** Release(releaseDraft=false);装着的旧版启动自动弹更新浮层一键升级。签名 Secret `TAURI_SIGNING_PRIVATE_KEY` 已配;私钥在 gitignore 的 `apps/desktop/.tauri-keys/sinan-updater.key`(别删,换库/换钥需同步 pubkey+Secret+endpoint)。

**待办(优先级)**:

- 🔴 **唯一硬收尾**:干净机/别人电脑装 v0.1.0 走完整业务流验收(本机已验证 engine+api 都能起,但完整业务流 + token 落 OS 钥匙串持久 + 关窗无残留,还没在真·干净环境过)。排障看 `%APPDATA%\Sinan\runtime\{engine,api}.log`(sidecar 日志已重定向到这)。
- 🟡 **v1 小打磨(半天)**:质检页(Indicators)加股票池/核数控件(训练页 Models 已有,同改法)· Models/Indicators 页实时进度条(现仅日志页看进度)· 模型 OOS 警告(IC 0.50–0.53 正常非失败)· 行情快照降级标记 · `/models/train` ISO 日期校验 · README 红线声明。
- 🐛 单日期框被撑成竖排高框(DatePicker padding;DevTools 量 `.dp-trigger` 对照同页 RangePicker)。
- ⚪ **v2**:LightGBM/ensemble · ICIR 自动加权 · 自定义因子并行 · 资讯页(M5)· 系统托盘+关闭确认 · 申万一级/北向(需更高 Tushare 积分)· 财务 PIT 精准化。

### 11.12 v0.1.1 装机收口(干净机后台 + 国内下载/更新,本会话)

用户在干净机装包后台起不来 + GitHub 下载被墙。手动跑 `sinan-engine.exe` 报 `[Errno 10048] bind 59915`——**引擎本体健康(到 Application startup complete),唯一失败是端口被占**(AVX2/缺 DLL/杀软全被实证排除)。定位:① 用户装的是 **`268d66a` 之前的旧本地包**(缺日志重定向/路径前缀/超时/多核四修复,故「有 ports.json 无日志」);② `ports.rs::allocate` 本就 `TcpListener::bind` 探测、**对孤儿端口免疫**(占用即顺延),孤儿毒不到当前代码——失败纯属旧包。顺带挖出独立真 bug:**`config.defaults.json` 没打进冻结包**(spec/build/base_env 都没带它)→ 冻结版任何读 `defaults()` 的功能 FileNotFoundError(dev 在仓库根能找到故掩盖)。

**修复(出 v0.1.1;engine 170 + shell-core 12 + `cargo check` 全绿)**:
- **config.defaults.json 打包**:`sinan-engine.spec` datas 加 `SPECPATH/../../config.defaults.json`(落 one-dir 包根)+ `config.py _find_defaults` frozen 时显式查 `sys._MEIPASS`/exe 同级(+3 回归 `tests/test_config_frozen.py`)。
- **shell.log**:`lib.rs` 监护器自身留痕(独立于子进程 stdout 重定向)——拉起引擎前每步/spawn 失败/健康结果都落 `runtime/shell.log`,根治「有 ports.json 无线索」盲区。
- **子进程秒退检测**:`wait_ready`→`wait_ready_or_exit`,readiness 循环 `child.try_wait()`,绑定失败/崩溃立即报错 + 记退出码,不傻等 120s。
- **国内下载/更新(GitHub+公共代理,用户拍板;非对象存储——用户只有 Gitee,免费版 100MB 装不下 148/217MB 包)**:README + release.yml 发布说明加 `gh-proxy.com` 镜像下载;updater 端点改「镜像 `latest-cn.json` 优先、GitHub `latest.json` 兜底」+ CI 发版产出把下载 URL 前缀成镜像的 `latest-cn.json`(签名与下载源无关、仍验签)。⚠️ **依赖公共代理活着**,长期稳定仍建议上对象存储。

**发版**:已 bump 0.1.0→0.1.1(tauri.conf/Cargo/package.json/Cargo.lock)。`git tag v0.1.1 && git push origin v0.1.1` → 云端构建公开发布(自带镜像下载说明)。

**本会话六视角专家评审已跑(部分子任务撞用量上限,5am 恢复),确认的真 bug 待修**:🔴 外壳崩溃不自动重启(`lib.rs` docstring 谎称「指数退避重启」,实际 spawn 一次不监控,sidecar 中途崩=静默假死)· api 无会话 token 校验(红线#4/#6 服务端没真拦,任何本机进程可驱动全部端点)· train/backtest 阻塞同步无 job 行(切导航即丢)· logs 表无界增长。🟠 PM/设计:信号页两个空日期框无引导(小白不友好)· 品牌 logo 花朵 vs 设计稿罗盘 · 设置页仅 3/7 tab。🟢 评审纠正:DatePicker 高框 bug 已修(height:30px)、行情页已还原、多数设计漂移已解决。性能:backtest `run_eod` 仍 O(N²)(无 lookback 裁剪、逐日重取基准)。**用户产品反馈**:信号日/生效日难懂 · 因子太少(实际只 bp+北向起作用,token 缺财务) · 模型有没有用看不出 → 计划:信号日自动填+一键跑、因子库扩充(只依赖日线的动量/反转/波动/换手等)、模型 vs 等权基线对比、模拟盘买卖流水(`/trades` 数据+接口已就绪,`Portfolio.vue` 未展示)。

**gotcha**:dev `pnpm dev`(token 内存存重启丢,引导页重输)· 别同开多会话改同仓库(曾被 git reset 清掉未提交工作)· 改 engine/api 需重启 dev · 打包改动需停 dev 跑 `node scripts/build-sidecars.mjs` 再 tauri build · cargo/rustc 残锁卡 dev 用 Stop-Process 清。
