# Handoff: 司南 Sinan — 本机量化研究桌面 UI

## Overview
**司南(Sinan)** 是面向中国 A 股个人投资者的**本机量化桌面软件**(定位 Tauri 桌面 App,非网页 / 非移动端)。核心价值:**诚实、纪律化、可解释、数据隐私本地化**。用户在自己电脑上配置数据源,生成因子选股信号、跑回测、用模拟盘做纸面验证。气质为**专业量化 / 交易终端**(参考 TradingView 深色、Linear、Trae、Apple HIG),而非消费级理财 App。

本设计共 **9 个高保真页面** + 完整设计 token 体系,深色默认并提供浅色主题。

## About the Design Files
本包内的 HTML / JSX / CSS 是**设计参考稿(用 React + 原生 CSS 在浏览器里搭的高保真原型)**,用于精确传达**最终视觉与交互**,**不是要直接搬进生产环境的代码**。

任务是:**在目标代码库的既有技术栈里复刻这些设计**。本项目定位是 Tauri 桌面 App,推荐实现栈:
- **Tauri (Rust) + 前端框架**(React / Vue / Svelte 任一,与团队习惯一致)。
- 原型用的是 React 18 + 内联 JSX + 纯 CSS 变量,**没有用任何 UI 组件库**,因此设计 token 可 1:1 迁移到任何框架。
- 图表是**纯手写 SVG**(无 echarts/d3 依赖)。生产环境可改用 ECharts / TradingView Lightweight Charts / Recharts,但**务必保留本稿的视觉规格**(配色通道、细描边、回撤阴影、买卖点标记、紧凑表格)。

若目标库尚无前端环境,可自行选择最合适的框架落地,但需严格遵循下文 token 与配色铁律。

## Fidelity
**高保真(hifi)。** 颜色、字号、字重、间距、圆角、阴影、玻璃、动效均为最终值,请**像素级复刻**。所有示例数据为真实风格的中文 A 股数据(如 `600519.SH 贵州茅台`),实现时替换为真实数据源即可。

---

## ⚠️ 配色铁律(最重要,不可妥协)
存在**三套互不混用**的色彩通道。实现时建议用**语义化 token 名**强制区分,严禁交叉使用:

| 通道 | 用途 | 深色值 | 规则 |
|---|---|---|---|
| **① PnL 盈亏** | 仅金额 / 涨跌 / 收益 / 浮盈 | 涨/盈 `#e35d5b`(红)· 跌/亏 `#34b27e`(绿) | **A股惯例:红涨绿跌**(与欧美相反);可在设置反转为绿涨红跌 |
| **② Status 系统状态** | 任务 / 连接 / 健康 / 校验 / **买卖方向** | 正常`#4a90d9`蓝 · 警告`#d9913a`橙 · 错误`#d65953`红 · 空闲`#6b6e74` | 买入=蓝,卖出=橙(**方向用状态色,不用盈亏色**) |
| **③ Accent 品牌** | 交互 / 选中 / 主按钮 / 模型净值线 | `#6e63f5`→`#a06bff` 紫色渐变 | 涨跌绝不用品牌紫;"成功"绝不用盈亏绿 |
| 中性 Neutral | 文本 / 背景 / 描边 / 综合分 / IC·ICIR | 见灰阶 | 因子研究指标(IC/ICIR/综合分)用中性,非 PnL |

> 反转开关实现:在 `<html>` 上切换 `data-pnl="rg"`(红涨绿跌,默认)/ `data-pnl="gr"`。JS 里 `pnlClass(value, inverted)` 决定用 up 还是 down 类。

---

## Design Tokens
完整值见 `design_source/assets/tokens.css` 与可视化文档 `司南 Sinan — 设计规范.html`。摘要:

### 中性灰阶
| Token | 深色 | 浅色 | 用途 |
|---|---|---|---|
| `--bg-window` | `#151618` | `#ececee` | 标题栏 / 侧栏(最深) |
| `--bg-base` | `#18191c` | `#f6f6f7` | 主内容背景 |
| `--bg-panel` | `#212327` | `#ffffff` | 卡片基底 |
| `--bg-panel-2` | `#282a2f` | `#f3f3f5` | 嵌套面板 / 表头 |
| `--bg-elevated` | `#2e3036` | `#f0f0f2` | hover / 悬浮 |
| `--bg-input` | `#1b1c1f` | `#ffffff` | 输入框 |
| `--text-1` | `#e7e8ea` | `#1c1d21` | 主文本(柔白,非纯白) |
| `--text-2` | `#989ba1` | `#5d616a` | 次要 |
| `--text-3` | `#686b72` | `#989ca4` | 弱 / 禁用 |
| `--border` | `rgba(255,255,255,.072)` | `rgba(0,0,0,.10)` | 细描边 0.5px |
| `--border-strong` | `rgba(255,255,255,.12)` | `rgba(0,0,0,.16)` | 强描边 |

### 玻璃 / 阴影 / 极光(现代化质感)
- `--glass-card: rgba(34,36,43,.64)`;`--glass-chrome: rgba(20,21,25,.62)`;`--glass-blur: saturate(170%) blur(22px)`(卡片与外框磨砂玻璃)。
- `--shadow-card: 0 0 0 .5px rgba(0,0,0,.35), 0 1px 2px rgba(0,0,0,.25), 0 8px 22px -14px rgba(0,0,0,.7)`。
- `--accent-glow: 0 8px 24px -8px rgba(110,99,245,.55)`(主按钮 / 选中胶囊发光)。
- `--hi-edge: inset 0 .5px 0 rgba(255,255,255,.05)`(卡片顶部高光)。
- **极光**:主区背景叠加 3 处低透明度径向渐变(紫 / 青 / 品红),为玻璃提供景深 —— 见 `--aurora`。

### 字体
- Sans(界面):`-apple-system, "SF Pro Text", "Segoe UI", "PingFang SC", system-ui, sans-serif`
- **Mono(所有数字 / 金额 / 代码,务必等宽 tabular)**:`"SF Mono", "JetBrains Mono", "Roboto Mono", ui-monospace, Menlo, Consolas`,启用 `font-variant-numeric: tabular-nums`。

### 字号 / 字重层级
| 名称 | px / weight | 用途 |
|---|---|---|
| display | 30 / 700,`letter-spacing:-.025em` | 页面大标题 |
| h2 | 19–20 / 700 | 区块标题 |
| h3 | 15 / 600 | 卡片标题 |
| body | 13 / 400 | 正文 |
| sub | 12 / 400 | 副文 |
| caption | 11 / 600,`uppercase`,`letter-spacing:.06em` | 标签 |
| mono-lg | 30 / 600 | 大金额数字 |

### 间距 / 圆角 / 描边 / 动效
- 间距尺度:`4 / 8 / 12 / 16 / 20 / 24 / 32 / 40`;卡片内边距 22,页面内边距 28,卡片间距 20。
- 圆角:`xs 5 / sm 7 / md 10 / lg 14(卡片) / xl 18`。
- 描边:统一 **0.5px** 细线分层(优先于投影)。
- 动效:`--t-fast 110ms`(hover)、`--t-med 180ms`(开关/过渡);`--ease cubic-bezier(.2,.6,.2,1)`、`--ease-out cubic-bezier(.16,1,.3,1)`。

---

## 布局框架(桌面宽屏,固定结构 ≥1180px)
**注意:按用户要求已去掉"页面顶部工具栏",改为苹果式大标题随内容流动。**

```
┌────────────────────────────────────────────────────────────┐
│ 自定义标题栏 (36px, 玻璃): 🧭司南 Sinan v2.4.0 …拖拽… [─][▢][✕] │  Win11 窗口控制(右上)
├──────────┬─────────────────────────────────────────────────┤
│ 侧边导航  │  主内容区(玻璃卡片化, 内边距 28, 卡片间距 20)        │
│ (216px,  │   ▸ 页内大标题(display 30/700, 无边框, 随内容滚动)   │
│  玻璃,    │   ▸ 卡片 / 表格 / 图表…                            │
│  macOS    │                                                 │
│  Settings ├─────────────────────────────────────────────────┤
│  风格)    │ 底部状态栏 (28px, 玻璃): ●API ●引擎 …免责声明 …时间  │
└──────────┴─────────────────────────────────────────────────┘
```
- **侧栏导航**(216px,玻璃 `--glass-chrome`):分组 `监控 / 研究 / 交易 / 系统`。导航项为 **macOS System Settings 风格**:圆角图标 chip(23×23,`--r-sm`)+ 文字;**选中态 = 品牌紫渐变胶囊 + 发光**(`.nav-item.active`)。底部:数据源卡片(点击重开首启向导)+ 外观主题切换。
- **状态栏**:左侧 `●行情API 正常 / ●计算引擎 空闲 / ●数据更新 待今日盘后`(状态色圆点);右侧免责声明 `本工具仅供量化研究与策略验证,不构成任何投资建议` + 时间。

---

## Screens / Views(9 屏)
导航分组与路由 id 见 `design_source/src/shell.jsx`(`NAV` / `PAGES`)。

### 监控
**1. 总览 Dashboard** (`dashboard`)
- 双 PnL 卡:个人账户 / 模型模拟盘当日收益(大 mono 数字 30px,PnL 色),含 sparkline + 持仓市值/仓位/本月/净值/最大回撤迷你指标。
- 主图卡:**模型净值 vs 沪深300**(模型线=品牌紫,基准=中性灰虚线)+ **回撤子图(红色阴影)** + **买卖点标记(▲买=蓝 ▼卖=橙)**;周期分段(近1月/近6月/今年/全部)。
- 风控闸卡:多条风险进度条(集中度/行业暴露/波动率/当日回撤,按用量 ok→warn→err 变色)+ 校验项列表。
- **空状态引导**:"今日尚未生成信号" + CTA。

**2. 行情 Market** (`market`) — **板块视角 + 两级下钻**
- 顶部:**大盘指数条**(上证/深证/创业板/沪深300,点位 + 涨跌幅,PnL 色)。
- 左侧:**行业板块卡片网格**(`repeat(auto-fill, minmax(238px,1fr))`)。每张卡:板块名 + 领涨股、**涨跌幅(大号 PnL 色)**、迷你走势 sparkline、**主力资金净流入/流出(亿元,PnL 色)**、涨/跌家数。可按 涨跌幅 / 资金流入 / 成交额 切换排序。
- 右侧:**板块涨跌幅排行榜**(名次 + 强度条)+ **主力资金净流向 Top6**(双向条)+ 合计。
- **下钻 ① 板块 → 成分股**:点击任意板块卡片或排行行,从右侧滑出**抽屉(drawer,560px,玻璃 + 遮罩,见 `.drawer*` 样式)**,显示该板块**成分股列表**(名称/代码/现价/涨跌幅/主力净流入/换手),顶部汇总(净流入/涨/跌家数)。
- **下钻 ② 成分股 → 当日分时**:点击抽屉内任一成分股,抽屉切换为**个股分时详情**(返回箭头回上一级,Esc/✕ 关闭):大号现价 + 涨跌、**当日分时线图**(`Intraday` 组件:价格线按涨跌着色 + 昨收虚线基准 + 黄色均价线 + 上下午时段分隔 + 成交量子图 + 右侧价格/百分比刻度)、8 宫格指标(昨收/最高/最低/换手/成交额/主力净流入/市盈率/振幅)、加入自选 / 查看日K 按钮。
- 数据契约:`SECTOR_STOCKS`(板块→成分股 名称+代码+价格)、`enrichStocks(sector, chg)`(确定性生成个股指标)、`genIntraday(code, prevClose, chg)`(240 分钟分时序列:price/avg/vol)。均在 `src/data.jsx`。

### 研究
**3. 指标 / 因子库 Indicators** (`indicators`)
- 类别分段过滤(全部/动量/价值/质量/成长/情绪/波动/资金流/反转)。
- 因子表:因子名/类别 chip/**IC均值/ICIR/覆盖度**(中性色 mono)/权重(带条)/启用开关(Accent)。
- 右详情面板:描述、4 宫格指标、**IC 时序柱状(近36月,正=紫负=灰)**、**十分位分层回测柱状(D1–D10,收益用 PnL 色)**。
- 注:IC / ICIR / 综合分属**中性通道**;分层收益属 **PnL 通道**。

**4. 策略 / 模型 Strategy** (`strategy`)
- 模型选择卡 ×3(v2.4 运行中 / v2.3 已归档 / 实验·动量增强 验证中),状态徽章用 Status 色;选中=Accent 边+发光;显示样本外IC/夏普/年化。
- **模型流水线**(横向 5 步带箭头):数据落库 → 因子计算 → 合成打分 → 风控过滤 → 组合构建。
- 因子构成:启用因子权重条(Accent 渐变,按权重降序)。
- 股票池与规则(分组列表)+ 风控约束(进度条)。

### 交易
**5. 信号 Signals** (`signals`)
- 分段:入选信号 / 被风控拦截。
- 信号表:标的 / **方向(买=蓝 卖=橙 持有=灰,Status 通道)** / 综合分(中性灰条+数值)/ **因子贡献 chips(PnL 色 +/−)** / 入选原因。
- 拦截组:删除线标的 + 拦截规则徽章(warn)+ 说明。

**6. 持仓 Portfolio** (`portfolio`)
- 分段切换两套独立账本:模型模拟盘 / 个人持仓。
- 5 张汇总卡:总资产 / 持仓市值 / 可用现金 / **今日实时盈利(带脉冲实时点 `.live-dot`)** / 累计浮动盈亏。
- 持仓表:标的/股数/成本价/现价/市值/**当日盈亏(PnL,含当日%)**/浮动盈亏/盈亏比例/占比(带条),含合计 tfoot。

**7. 回测 Backtest** (`backtest`,数据最密集)
- **诚实口径提示条**(Status 蓝):训练截止 / Purge 5日 / 次日开盘撮合 / 万2.5费用 / "不代表未来收益"。
- 参数表单卡 + 6 张绩效卡(年化/超额/最大回撤/夏普/信息比率/跟踪误差)。
- **净值 vs 基准曲线 + 回撤阴影 + 买卖点 ▲▼**。
- **月度收益热力图**(红涨绿跌,随反转开关)。
- 逐笔成交表 + **逐日明细表(点某日展开当日持仓,行可展开)**。

### 系统
**8. 设置 Settings** (`settings`)
- 数据源:provider 卡 ×4(Tushare/AkShare/Wind/本地)+ token 输入(focus ring)+ 测试连通 + **能力探测网格**(可用/受限/未授权)+ 缓存信息。
- **数据更新**(分组列表):上次刷新时间(脉冲点 + mono 时间 + 立即刷新按钮)、自动刷新频率分段、盘后落库。
- 外观(分组列表):主题三态分段(深色/浅色/跟随系统)、**涨跌红绿反转开关(带 +1.82%/-1.13% 实时预览)**、数字等宽。
- 隐私与本地化:仅本机存储、崩溃诊断开关。

**9. 首启引导 Onboarding** (`onboarding`,全屏向导)
- 品牌头(紫渐变罗盘 logo)+ **4 步进度条**:选数据源 → 填 token → 测连通(idle/转圈/成功)→ 建缓存(进度条递增)。
- 底部上一步/下一步,完成进入主界面。从侧栏数据源卡可重新触发。

---

## Interactions & Behavior
- **路由**:`App` 用 `useState(page)` 切换 `PAGES[page]`;无 URL 路由(桌面 App)。生产可接真实路由。
- **主题**:`themePref`(dark/light/auto)→ 解析后写 `<html data-theme>`;auto 跟随 `prefers-color-scheme`。全部颜色走 CSS 变量,切换零闪烁。
- **涨跌反转**:`inv` 状态写 `<html data-pnl>`;`pnlClass(v, inv)` 返回 `pnl-up`/`pnl-down`。
- **选中 / 展开**:表格行点击高亮(`.dt tr.sel`,左侧 2px Accent 内阴影);逐日明细行点击展开当日持仓;因子行点击切换右侧详情。
- **分段控件 / 开关 / 输入**:见组件状态表。
- **hover**:卡片无位移;按钮/行/导航项 110ms 背景过渡;主按钮 hover `filter: brightness(1.08)`。
- **加载态**:`.skel` shimmer;首启测连通转圈 `.spin`;实时数据脉冲 `.live-dot`(1.8s)。
- **窗口控制**:标题栏右上 Win11 三键(最小化/最大化/关闭),关闭 hover 变红。Tauri 中接 `appWindow.minimize()/toggleMaximize()/close()`,拖拽区用 `data-tauri-drag-region`(原型用 `-webkit-app-region: drag`)。

## State Management
原型用组件内 `useState`。生产建议:
- 全局:`theme` / `pnlInverted` / `activeRoute` / `dataSource(连接态)` / `activeModelId`。
- 页面:行情选中标的、持仓账本(模型/个人)、信号 tab、回测展开日、因子选中/类别过滤、设置表单与刷新时间。
- 数据获取:行情(轮询/WS)、因子与信号(盘后批量)、回测(异步任务+进度)、持仓估值(现价×股数)。所有 mock 在 `design_source/src/data.jsx`,字段结构即建议的数据契约。

## 组件状态(默认 / hover / 选中 / 禁用)
| 组件 | 默认 | hover | 选中/激活 | 禁用 |
|---|---|---|---|---|
| 主按钮 | `accent-grad` + glow | `brightness(1.08)` | `brightness(.96)` | `opacity .4` |
| 次按钮 | `bg-elevated` + 描边 | `bg-popover` + 强描边 | — | `opacity .4` |
| 幽灵按钮 | 透明 / text-2 | `bg-elevated` / text-1 | — | — |
| 表格行 | 透明 | `bg-elevated` | `accent-bg` + 左 2px accent | — |
| 侧栏项 | text-2 | `bg-elevated`/text-1 | `accent-grad` 胶囊 + glow | — |
| 输入框 | `bg-input`+描边 | — | accent 边 + 3px `--accent-ring` | `opacity .4` |
| 分段控件 | text-2 | text-1 | `bg-elevated` 滑块 + 描边 | — |
| 开关 Switch | `bg-elevated` | — | `accent` 填充 + 滑块右移 | — |
| 徽章 Badge | 圆点+文字(状态色背景 14%) | — | — | — |
| Chip | `bg-panel-2`+描边 | — | — | — |

**金融表格规范**:数字列右对齐 + 等宽 tabular;表头弱化(text-3 / 11px / sticky 玻璃);行高 34(紧凑)/40(标准);hover 行高亮;可选中行左侧 Accent 标记。

## Assets / Icons
- **图标**:全部为内联 SVG 线性图标(`stroke-width 1.7`,见 `src/ui.jsx` 的 `I` 映射:dashboard/market/indicator/model/signals/portfolio/backtest/settings/search/sun/moon/db/shield/check/alert/refresh 等)。可替换为团队图标库(如 Lucide,风格一致)。
- **品牌罗盘 logo**:简单 SVG(圆 + 指针三角),`src/pages/onboarding.jsx` 的 `Compass`。
- **图表**:纯 SVG,无图片资源。无第三方图片 / 字体文件(字体走系统栈)。

## Files(设计源)
`design_source/` 下:
- `司南 Sinan.html` — 入口,按顺序加载下列脚本(React 18 + Babel standalone + 各 JSX)。
- `assets/tokens.css` — **全部设计 token(深/浅双主题)** ← 实现时优先迁移。
- `assets/components.css` — 组件类(card/btn/badge/chip/segmented/switch/dt 表格/nav-item/glist 等)。
- `src/data.jsx` — mock 数据 + 生成器(净值/K线/逐日/因子/模型),即数据契约。
- `src/ui.jsx` — 格式化函数(`fmt/fmtPct/fmtInt/pnlClass`)、基础组件、图标 `I`、`PageHero`。
- `src/charts.jsx` — 图表(EquityChart 净值+回撤、Candles 蜡烛+MA+量、Heatmap 热力图、Sparkline、RiskBar)。
- `src/shell.jsx` — 标题栏 / 侧栏 / 状态栏 / `NAV` / `PAGES`。
- `src/app.jsx` — `App`(路由 + 主题 + 反转状态)。
- `src/pages/*.jsx` — 9 个页面。

根目录另有:
- `司南 Sinan — 设计规范.html` — 可打印的 token 可视化文档(色板 + 规格)。
- `司南 Sinan (预览·离线单文件).html` — 自包含离线预览,**双击即可在浏览器查看全部交互**(无需联网/构建)。
```
推荐先打开"离线单文件"通览交互,再对照 design_source 与本 README 落地。
```

## 约束 / 红线复述
- 桌面宽屏 ≥1180px,中文界面,深色默认 + 浅色可切。
- 信息密集但有呼吸感与清晰层级;细描边分层优先于重投影。
- **三色通道永不交叉**(见上)。买卖方向用 Status 色,涨跌用 PnL 色(红涨绿跌,可反转)。
- 数字一律等宽 tabular 右对齐。
- **不得出现任何"暴富/稳赚"类营销措辞**;保留诚实/风险提示的视觉位置。
