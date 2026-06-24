<script setup lang="ts">
// 使用说明 / 帮助页:产品定位、完整工作流、逐页说明、六红线、FAQ。纯静态内容(不打 api)。
import PageHero from '../../ui/PageHero.vue';
import Icon from '../../shell/Icon.vue';

const WORKFLOW = [
  {
    n: 1,
    page: '设置 · 数据源 / 引导',
    title: '配置数据源',
    desc: '选 Tushare Pro(需自备 token)或 AkShare(免费)→ 填 token → 测试连通(看能力探测,财务/指数等需足额积分)→ 设为主源。token 仅加密存本机钥匙串,绝不上传。',
  },
  {
    n: 2,
    page: '引导 · 建缓存',
    title: '建立本地缓存',
    desc: '拉日线/复权/每日指标/北向到本机 parquet(可断点续传)。建议先勾「快速模式」拉少量股票跑通。数据全在本机,随包零数据。',
  },
  {
    n: 3,
    page: '指标 · 因子库',
    title: '因子质检 / 自定义因子',
    desc: '对内置因子做真实样本外质检(IC 均值 / ICIR / 覆盖度 / 十分位分层);用 DSL 写自定义因子(白名单字段 + 仅回看算子,结构上防未来函数),设权重接入选股。',
  },
  {
    n: 4,
    page: '模型 · 策略',
    title: '训练模型',
    desc: 'walk-forward 滚动训练 ElasticNet,样本内外 IC/ICIR 并列(诚实标注),硬守卫防未来函数。训完激活 → 驱动每日选股。',
  },
  {
    n: 5,
    page: '回测',
    title: '诚实样本外回测',
    desc: '事件驱动逐日撮合 · T+1 开盘成交 · 含交易成本 · 仅测训练截止后。打分口径可选等权/模型/自定义因子,与实盘一致。硬守卫拒跑非诚实样本外。',
  },
  {
    n: 6,
    page: '信号 / 持仓',
    title: '模拟盘 + 个人持仓',
    desc: '盘后出信号(含被风控拦截组)→ T+1 撮合记账(纯纸面模拟,绝不真实下单)。个人持仓手动录入,跟踪当日收益/浮盈。模型/个人两套账本物理隔离。',
  },
];

const PAGES = [
  { k: '总览', v: '个人/模型双账当日收益、净值曲线(最近回测)、风控闸。未配置时显示引导。' },
  { k: '行情', v: '实时报价 + 本地 K 线(前复权,PIT 安全)、大盘指数、全市场涨跌广度。' },
  { k: '指标', v: '因子真实样本外质检 + 自动挖因子 + 自定义因子 DSL 编辑/权重。' },
  { k: '公式', v: '把通达信/同花顺选股公式在全市场跑一遍,看哪些股票满足条件(进阶)。' },
  { k: '模型', v: 'ML 模型训练(ElasticNet/LightGBM)、版本库、激活(进阶)。' },
  { k: '回测', v: '逐日撮合回测,净值 vs 基准、回撤、月度热力图、模型 vs 等权对比、导出。' },
  { k: '信号', v: '盘后跑一轮出信号(买/卖/被拦截),T+1 撮合。无需先训模型即可用。' },
  { k: '持仓', v: '模型模拟盘 + 个人持仓两套独立账本。' },
  { k: '基金穿透', v: '把基金/ETF 拆到底层股票,看真实个股与行业暴露(进阶)。' },
  { k: '设置', v: '数据源/凭据、外观主题、数据更新、盘后自动开关。' },
  { k: '日志', v: '运行日志(建缓存/调度/错误)。' },
  { k: '帮助', v: '本页:产品定位、工作流、名词解释、六红线、常见问题。' },
];

// 新手名词表:把全 app 高频量化黑话用一句大白话讲清(只解释概念,不碰收益承诺,合规)。
const GLOSSARY = [
  { t: '因子', d: '给股票打分排序的规则,比如「便宜的」「赚钱多的」「最近涨势好的」。' },
  { t: 'IC', d: '某个因子的打分和未来涨跌的相关性,越高越能选对股;0.03 以上就算不错。' },
  { t: 'ICIR', d: 'IC 的稳定性,越高说明这个因子越靠谱、不是碰运气。' },
  { t: '覆盖度', d: '有多少只股票能算出这个因子(缺数据的算不出)。' },
  { t: '十分位分层', d: '按因子打分把股票分成 10 档,看分高的那档是不是真涨得多。' },
  { t: '样本外', d: '拿模型没见过的、训练之后的数据来检验,防止「事后诸葛亮」式的自欺。' },
  { t: 'walk-forward', d: '只用过去数据训练、用之后的数据验证,一步步往前滚,贴近真实使用。' },
  { t: 'Purge / 隔离', d: '训练区间和检验区间之间空开几天,防止偷看到未来信息。' },
  { t: 'T+1', d: 'A 股规则:今天选出的票,最早明天开盘才能买入,司南撮合也照此。' },
  { t: '前复权', d: '把分红送股的影响还原掉,让历史价格和现在可比、曲线不跳空。' },
  { t: '北向资金', d: '外资通过沪深港通买卖 A 股的钱,常被当作聪明钱的风向标。' },
  { t: '综合分', d: '因子模型给每只股票的总打分,越高越被看好;是相对排序,不是涨跌预测。' },
  { t: '最大回撤', d: '从历史最高点最多往下亏过多少,衡量「最难熬的时候有多难熬」。' },
  { t: '夏普比率', d: '每承担一份波动换来多少超额回报,越大说明性价比越高。' },
  { t: '超额 / IR', d: '相对沪深300等基准多赚(或少赚)的部分;IR 是这种超额的稳定性。' },
  { t: '降级', d: '数据源没有某项数据时,司南诚实地空着、不编假数字,对应因子自动跳过。' },
];

const REDLINES = [
  '无未来函数:取数 PIT(data.asof),信号滞后 1 日,T+1 撮合,自定义因子过穿越测试。',
  '无虚假回测:只测训练截止+purge 之后,必含成本,禁随机切分。',
  '不夸大收益:指标一律样本外,样本内外并列,如实标注。',
  'token 永不落明文:只入本机钥匙串,DB/日志/界面绝不出现明文,零外联(除你自配数据源)。',
  '无自动真实下单:仅纸面模拟盘 + 手动个人持仓,不接券商交易接口。',
  '前端只打本机 api;模型/个人两套账本物理隔离,绝不误聚合。',
];

const FAQ = [
  {
    q: '能力探测显示「未授权」?',
    a: '需先「保存」token 再「测试连通」(测试用已保存的 token)。财务/财务指标/指数日线需 Tushare 2000 积分;实时报价走免费源(新浪/腾讯),不吃 tushare 积分。',
  },
  {
    q: '建缓存很慢?',
    a: '全市场 5000 只股票 × 多年 × 限速会比较久。先勾「快速模式」拉少量股票跑通;支持断点续传,中断可恢复。',
  },
  {
    q: '某些因子/基准显示「降级」?',
    a: '数据源缺该字段(如免费源无北向、积分不足无财务)时,司南诚实降级、绝不补假数字,并如实标注「预期更低」。',
  },
  {
    q: '总览/页面是空的?',
    a: '红线#3 诚实空:没有真实数据时显示空状态,不摆假数字。建缓存 + 盘后跑一轮后会用真实数据填充。',
  },
  {
    q: '模拟盘会真实买卖吗?',
    a: '不会(红线#5)。司南只做纸面模拟盘 + 手动个人持仓记账,不接任何券商交易接口。所有结果仅供研究,非投资建议。',
  },
  {
    q: '第一次用,最少几步能选出股票?',
    a: '三步:① 引导里配好数据源(没 token 就选免费 AkShare);② 建一次缓存(新手用「快速·5股」最快);③ 到「信号」页点「盘后跑一轮」。不需要先训练模型 —— 无模型时司南会用内置因子等权打分选股。',
  },
  {
    q: '必须先训练模型才能用吗?',
    a: '不必。训练模型是进阶玩法。新手直接到信号页跑一轮就能用内置因子选股;等想做自己的策略,再去「模型」页训练并激活。',
  },
  {
    q: '关掉软件后,盘后还会自动出信号吗?',
    a: '不会。盘后自动跑一轮需要软件保持运行(它不是后台常驻服务)。你也可以随时手动到信号页点「盘后跑一轮」。是否自动、几点跑可在「设置 · 数据更新」里开关。',
  },
];
</script>

<template>
  <PageHero
    title="帮助 · 使用说明"
    sub="司南是什么 · 完整工作流 · 逐页说明 · 六条红线 · 常见问题"
  />

  <div class="page-body">
    <!-- 产品定位 -->
    <div class="card card-pad">
      <h3 class="card-title">司南是什么</h3>
      <p class="lead">
        面向中国 A 股个人投资者的<b>可分发本地量化研究工具</b>。三条地基不可妥协:<b
          >BYO 自带数据源</b
        >、<b>全本机</b>(数据/凭据不出本机)、<b>可分发</b>(随包零数据/零模型/零
        token)。定位是「诚实、纪律化、可解释」——用纪律化的因子方法做研究,争取相对沪深300更稳的风险收益特征。<b>能否跑赢取决于市场与你的数据,司南不承诺任何收益</b>,更不是暴富工具。
      </p>
    </div>

    <!-- 5 分钟速成(给零基础用户的最短路径) -->
    <div class="card card-pad quickstart">
      <h3 class="card-title">🚀 第一次用?5 分钟先跑通(没有 token 也行)</h3>
      <p class="lead">
        不懂量化、手头没有 Tushare token?照这条最短路径走:① 数据源选<b>免费的 AkShare</b> → ②
        建缓存选<b>「快速 · 5 股」</b> → ③ 直接去<b>「信号」</b>页点一次「盘后跑一轮」。整条
        质检→选股就体验一遍了,只要几分钟,之后再决定要不要上 Tushare 拉全市场。<b
          >下面工作流里的训练/回测是进阶,新手可以先跳过。</b
        >
      </p>
    </div>

    <!-- 完整工作流 -->
    <div class="card">
      <div class="card-head">
        <div>
          <h3 class="card-title">完整工作流</h3>
          <span class="card-sub">配源 → 建缓存 →(可选:质检 / 训练 / 回测)→ 模拟盘出信号</span>
        </div>
      </div>
      <div class="card-pad flow">
        <div v-for="s in WORKFLOW" :key="s.n" class="flow-item">
          <span class="flow-n">{{ s.n }}</span>
          <div class="flow-body">
            <div class="flow-top">
              <span class="flow-title">{{ s.title }}</span>
              <span class="flow-page mono">{{ s.page }}</span>
            </div>
            <p class="flow-desc">{{ s.desc }}</p>
          </div>
        </div>
      </div>
    </div>

    <!-- 逐页说明 + 六红线 双栏 -->
    <div class="cols2">
      <div class="card">
        <div class="card-head">
          <h3 class="card-title">逐页说明</h3>
        </div>
        <div class="tbl-wrap">
          <table class="dt dt-compact">
            <tbody>
              <tr v-for="p in PAGES" :key="p.k">
                <td class="col-code">{{ p.k }}</td>
                <td class="dim">{{ p.v }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="card card-pad">
        <h3 class="card-title">六条红线(诚实与纪律)</h3>
        <ol class="redlines">
          <li v-for="(r, i) in REDLINES" :key="i">
            <span class="rl-n">{{ i + 1 }}</span
            >{{ r }}
          </li>
        </ol>
      </div>
    </div>

    <!-- 新手名词表 -->
    <div class="card card-pad">
      <h3 class="card-title">新手名词表 · 把黑话翻译成人话</h3>
      <div class="glossary">
        <div v-for="g in GLOSSARY" :key="g.t" class="gl-item">
          <span class="gl-t mono">{{ g.t }}</span>
          <span class="gl-d">{{ g.d }}</span>
        </div>
      </div>
    </div>

    <!-- FAQ -->
    <div class="card card-pad">
      <h3 class="card-title">常见问题</h3>
      <div class="faq">
        <details v-for="(f, i) in FAQ" :key="i" class="faq-item">
          <summary>
            <Icon name="chevR" :size="13" /><span>{{ f.q }}</span>
          </summary>
          <p>{{ f.a }}</p>
        </details>
      </div>
    </div>

    <p class="disclaimer">
      司南仅供量化研究与策略验证,不构成任何投资建议;模拟盘为纸面前向验证,不进行任何真实下单。
    </p>
  </div>
</template>

<style scoped>
.page-body {
  padding: 28px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.lead {
  margin: 0;
  font-size: var(--fs-body, 13px);
  line-height: 1.75;
  color: var(--text-2);
}
.lead b {
  color: var(--text-1);
  font-weight: 600;
}

/* 5 分钟速成卡:用 accent 细边框轻量突出 */
.quickstart {
  border: 0.5px solid var(--accent);
  background: var(--accent-bg);
}

/* 新手名词表 */
.glossary {
  margin-top: 10px;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px 24px;
}
@media (max-width: 1080px) {
  .glossary {
    grid-template-columns: 1fr;
  }
}
.gl-item {
  display: flex;
  gap: 10px;
  align-items: baseline;
}
.gl-t {
  flex: none;
  min-width: 84px;
  font-size: 12px;
  font-weight: 600;
  color: var(--accent);
}
.gl-d {
  font-size: var(--fs-sub);
  line-height: 1.6;
  color: var(--text-2);
}

/* 工作流 */
.flow {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.flow-item {
  display: flex;
  gap: 12px;
}
.flow-n {
  flex: none;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: var(--accent);
  color: #fff;
  font-size: 12px;
  font-weight: 600;
}
.flow-body {
  flex: 1;
  min-width: 0;
}
.flow-top {
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
}
.flow-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-1);
}
.flow-page {
  font-size: var(--fs-cap);
  color: var(--text-3);
}
.flow-desc {
  margin: 3px 0 0;
  font-size: var(--fs-sub);
  line-height: 1.6;
  color: var(--text-2);
}

/* 双栏 */
.cols2 {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 20px;
  align-items: start;
}
@media (max-width: 1080px) {
  .cols2 {
    grid-template-columns: 1fr;
  }
}
.tbl-wrap {
  max-height: 420px;
  overflow: auto;
}
.dim {
  color: var(--text-2);
  font-size: var(--fs-sub);
}

/* 红线 */
.redlines {
  margin: 10px 0 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 9px;
}
.redlines li {
  display: flex;
  gap: 8px;
  font-size: var(--fs-sub);
  line-height: 1.6;
  color: var(--text-2);
}
.rl-n {
  flex: none;
  width: 18px;
  height: 18px;
  border-radius: 5px;
  display: grid;
  place-items: center;
  background: var(--status-ok-bg);
  color: var(--status-ok);
  font-size: 11px;
  font-weight: 600;
}

/* FAQ */
.faq {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 6px;
}
.faq-item {
  border-bottom: 0.5px solid var(--border-faint);
  padding: 4px 0;
}
.faq-item summary {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  list-style: none;
  padding: 7px 0;
  font-size: 12.5px;
  font-weight: 500;
  color: var(--text-1);
}
.faq-item summary::-webkit-details-marker {
  display: none;
}
.faq-item summary :deep(svg) {
  transition: transform 0.15s var(--ease);
  color: var(--text-3);
}
.faq-item[open] summary :deep(svg) {
  transform: rotate(90deg);
}
.faq-item p {
  margin: 0 0 8px 21px;
  font-size: var(--fs-sub);
  line-height: 1.7;
  color: var(--text-2);
}

.disclaimer {
  margin: 4px 0 0;
  color: var(--text-3);
  font-size: var(--fs-cap);
  line-height: 1.6;
}
</style>
