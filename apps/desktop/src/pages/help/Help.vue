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
  { k: '行情', v: '实时报价 + 本地 K 线(前复权,PIT 安全)。' },
  { k: '指标', v: '因子真实样本外质检 + 自定义因子 DSL 编辑/权重。' },
  { k: '模型', v: 'ML 模型训练、版本库、激活。' },
  { k: '回测', v: '逐日撮合回测,净值 vs 基准、回撤、月度热力图、逐笔/逐日明细。' },
  { k: '信号', v: '盘后跑一轮出信号(买/卖/被拦截),T+1 撮合。' },
  { k: '持仓', v: '模型模拟盘 + 个人持仓两套独立账本。' },
  { k: '设置', v: '数据源/凭据、外观主题、数据更新。' },
  { k: '日志', v: '运行日志(建缓存/调度/错误)。' },
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
        token)。定位是「诚实、纪律化、可解释」——长期略微跑赢沪深300 + 回撤更小,不是暴富工具。
      </p>
    </div>

    <!-- 完整工作流 -->
    <div class="card">
      <div class="card-head">
        <div>
          <h3 class="card-title">完整工作流</h3>
          <span class="card-sub">配源 → 建缓存 → 质检 → 训练 → 回测 → 模拟盘</span>
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
