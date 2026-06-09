<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAppStore } from '../../stores/app';
import { useTradingStore } from '../../stores/trading';
import { api } from '../../api/client';
import { formatPnl } from '../../lib/pnl';
import { fmt } from '../../lib/format';
import { drawdownSeries } from '../../lib/backtest';
import PageHero from '../../ui/PageHero.vue';
import EquityChart from '../../ui/charts/EquityChart.vue';
import RiskBar from '../../ui/charts/RiskBar.vue';
import Icon from '../../shell/Icon.vue';

const app = useAppStore();
const trading = useTradingStore();
const router = useRouter();

// 净值图周期:对最近一次回测净值曲线按区间切片(真实数据,非死控件)。
const PERIODS = [
  { key: '1m', label: '近1月' },
  { key: '6m', label: '近6月' },
  { key: 'ytd', label: '今年' },
  { key: 'all', label: '全部' },
];
const period = ref('6m');

// 总览净值曲线来源 = 最近一次回测(样本外);无回测则诚实空状态。
const equity = ref<any | null>(null);

onMounted(async () => {
  if (!app.onboardingDone) return;
  trading.fetchModel();
  trading.fetchPersonal();
  trading.fetchLivePnl();
  try {
    const list = await api.backtests(); // 按 created_at 倒序
    if (list.length) equity.value = await api.backtest(list[0].id);
  } catch {
    equity.value = null;
  }
});

// ── 净值曲线 → EquityChart(按周期切片;组合/基准各自归一化到区间首值=1)──────
const navPoints = computed<any[]>(() => equity.value?.nav_curve ?? []);
const periodPoints = computed(() => {
  const pts = navPoints.value;
  if (!pts.length) return [];
  if (period.value === 'all') return pts;
  if (period.value === 'ytd') {
    const yr = pts[pts.length - 1].date.slice(0, 4);
    return pts.filter((p) => p.date >= `${yr}-01-01`);
  }
  return pts.slice(period.value === '1m' ? -21 : -126);
});
const eqModel = computed(() => {
  const navs = periodPoints.value.map((p) => p.nav ?? 0);
  const base = navs[0] || 1;
  return navs.map((v) => v / base);
});
const eqBench = computed(() => {
  const raw = periodPoints.value.map((p) => (p.benchmark ?? null) as number | null);
  const b0 = raw.find((v) => v != null) ?? null;
  if (b0 == null) return [];
  return raw.map((v) => (v != null ? v / b0 : 0)) as number[];
});
const eqDD = computed(() => {
  const navs = periodPoints.value.map((p) => p.nav ?? 0);
  return drawdownSeries(navs).map((v) => v * 100);
});
const eqMarkers = computed(() => {
  const idx = new Map<string, number>();
  periodPoints.value.forEach((p, i) => idx.set(p.date, i));
  const out: Array<{ i: number; t: 'buy' | 'sell' }> = [];
  for (const t of equity.value?.trades ?? []) {
    const i = idx.get(t.trade_date);
    if (i != null) out.push({ i, t: t.side === 'buy' ? 'buy' : 'sell' });
  }
  return out;
});
const hasEquity = computed(() => eqModel.value.length >= 2);

// ── 风控闸:从真实模型持仓算可计算的约束(集中度/持仓占用/当日回撤);行业/波动待数据接入 ──────
const hasRisk = computed(() => trading.modelHoldings.length > 0);
const maxHolding = computed(() =>
  trading.modelHoldings.reduce((m, h) => Math.max(m, h.market_value ?? 0), 0),
);
const concentration = computed(() =>
  modelMV.value > 0 ? Number(((maxHolding.value / modelMV.value) * 100).toFixed(1)) : 0,
);
const modelDD = computed(() => {
  const d = trading.modelPnlLatest?.drawdown;
  return d != null ? Number((Math.abs(d) * 100).toFixed(1)) : null;
});

function mvSum(holds: Array<{ market_value?: number | null }>): number {
  return holds.reduce((s, h) => s + (h.market_value ?? 0), 0);
}
const personalMV = computed(() => mvSum(trading.personalHoldings));
const modelMV = computed(() => mvSum(trading.modelHoldings));

const personalDay = computed(
  () => trading.livePersonal?.day_pnl ?? trading.personalPnlLatest?.day_pnl ?? null,
);
const modelDay = computed(() => trading.liveModel?.day_pnl ?? null);
const modelDayPct = computed(() => trading.modelPnlLatest?.day_pnl_pct ?? null);
const modelExcess = computed(() => trading.modelPnlLatest?.excess_pct ?? null);

function pct(v: number | null | undefined, dec = 2): string {
  return v == null ? '—' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(dec)}%`;
}
</script>

<template>
  <PageHero
    title="总览"
    :sub="`数据源 ${app.activeProvider ?? '未配置'} · 当日收益来自实时源「现价 vs 昨收」`"
  >
    <template #right>
      <button class="btn btn-secondary btn-sm" @click="router.push('/signals')">
        <Icon name="refresh" :size="14" /> 盘后跑一轮
      </button>
    </template>
  </PageHero>

  <div class="page-body">
    <!-- 首启引导 -->
    <div v-if="!app.onboardingDone" class="card card-pad guide">
      <h2 class="guide-title">欢迎使用司南</h2>
      <p class="guide-lead">全本机量化助手 —— 你的数据、你的 token、你的电脑;我们不碰任何数据。</p>
      <ol class="steps">
        <li><span class="n">1</span> 选择你自己的数据源(Tushare Pro / AkShare 免费)</li>
        <li><span class="n">2</span> 填入 token(仅加密存本机钥匙串)</li>
        <li><span class="n">3</span> 测试连接并建立本地缓存(可断点续传)</li>
      </ol>
      <button class="btn btn-primary" @click="router.push('/onboarding')">开始配置 →</button>
    </div>

    <template v-else>
      <!-- PnL 双卡 -->
      <div class="grid-2">
        <div class="card card-pad stat">
          <div class="stat-top">
            <span class="cap">个人账户 · 当日收益</span>
            <span class="ch-tag"><i style="background: var(--pnl-up)" />PnL</span>
          </div>
          <div class="stat-val mono" :class="app.pnlClass(personalDay ?? 0)">
            {{ personalDay == null ? '—' : '¥' + formatPnl(personalDay) }}
          </div>
          <div class="hairline" />
          <div class="stat-metrics">
            <div class="metric">
              <div class="m-k">持仓市值</div>
              <div class="m-v mono">¥{{ fmt(personalMV, 0) }}</div>
            </div>
            <div class="metric">
              <div class="m-k">实时口径</div>
              <div class="m-v mono">
                {{ trading.livePersonal?.degraded ? '部分缺价' : '现价×持仓' }}
              </div>
            </div>
          </div>
        </div>

        <div class="card card-pad stat">
          <div class="stat-top">
            <span class="cap">模型模拟盘 · 当日收益</span>
            <span class="ch-tag"><i style="background: var(--pnl-up)" />PnL</span>
          </div>
          <div class="stat-val mono" :class="app.pnlClass(modelDay ?? modelDayPct ?? 0)">
            {{ modelDay != null ? '¥' + formatPnl(modelDay) : pct(modelDayPct) }}
          </div>
          <div
            v-if="modelDay != null && modelDayPct != null"
            class="stat-delta mono"
            :class="app.pnlClass(modelDayPct)"
          >
            {{ modelDayPct >= 0 ? '▲' : '▼' }} {{ pct(modelDayPct) }}
          </div>
          <div class="hairline" />
          <div class="stat-metrics">
            <div class="metric">
              <div class="m-k">持仓市值</div>
              <div class="m-v mono">¥{{ fmt(modelMV, 0) }}</div>
            </div>
            <div class="metric">
              <div class="m-k">当日超额(vs 沪深300)</div>
              <div class="m-v mono" :class="modelExcess != null ? app.pnlClass(modelExcess) : ''">
                {{ pct(modelExcess) }}
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 净值曲线(最近一次回测,样本外)+ 风控闸 -->
      <div class="grid-21">
        <div class="card">
          <div class="card-head">
            <div>
              <h3 class="card-title">模型净值 vs 沪深300</h3>
              <span class="card-sub">{{
                hasEquity ? '最近一次回测 · 样本外 · 含回撤' : '累计净值 · 前复权 · 含回撤'
              }}</span>
            </div>
            <div v-if="hasEquity" class="segmented">
              <button
                v-for="p in PERIODS"
                :key="p.key"
                :class="{ on: period === p.key }"
                @click="period = p.key"
              >
                {{ p.label }}
              </button>
            </div>
          </div>
          <div v-if="hasEquity" class="eq-legend">
            <span class="lg"><i class="ln model" />模型净值</span>
            <span class="lg"><i class="ln bench" />沪深300</span>
            <span class="lg"><i class="sw dd" />回撤</span>
            <span class="lg"><i class="mk buy" />买</span>
            <span class="lg"><i class="mk sell" />卖</span>
          </div>
          <div class="card-pad">
            <EquityChart
              v-if="hasEquity"
              :model="eqModel"
              :bench="eqBench"
              :dd="eqDD"
              :markers="eqMarkers"
              :height="232"
            />
            <div v-else class="empty">
              <div class="empty-icon"><Icon name="market" :size="20" /></div>
              <div class="empty-title">净值曲线待接入</div>
              <div class="empty-desc">
                到「回测」生成一次样本外净值曲线,或随盘后调度逐日累计后在此展示(模型线=品牌紫,基准=中性虚线,回撤阴影,买卖点
                ▲蓝/▼橙)。
              </div>
              <button class="btn btn-primary btn-sm" @click="router.push('/backtest')">
                去回测 →
              </button>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-head">
            <div>
              <h3 class="card-title">风控闸</h3>
              <span class="card-sub">集中度 / 持仓占用 / 当日回撤(组合级,约束=默认基线)</span>
            </div>
            <span class="badge" :class="hasRisk ? 'badge-ok' : 'badge-idle'"
              ><span class="dot" />{{ hasRisk ? '当前组合' : '待跑一轮' }}</span
            >
          </div>
          <div class="card-pad">
            <div v-if="hasRisk" class="risk-list">
              <RiskBar label="单票集中度" :used="concentration" :limit="20" unit="%" />
              <RiskBar label="持仓占用" :used="trading.modelHoldings.length" :limit="5" unit="" />
              <RiskBar
                v-if="modelDD != null"
                label="当日回撤"
                :used="modelDD"
                :limit="12"
                unit="%"
              />
              <div class="risk-note cap">行业暴露 / 波动率 待接入(需行业分类与历史波动数据)</div>
            </div>
            <div v-else class="empty">
              <div class="empty-icon"><Icon name="shield" :size="20" /></div>
              <div class="empty-title">风控校验待生成</div>
              <div class="empty-desc">
                盘后跑一轮、模型盘建仓后,这里按真实持仓展示集中度、持仓占用与当日回撤的占用进度(按用量
                ok→warn→err 变色);行业暴露 / 波动率待数据接入。
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 今日信号(整宽) -->
      <div class="card">
        <div class="card-head">
          <div>
            <h3 class="card-title">今日信号</h3>
            <span class="card-sub">收盘后由因子模型生成</span>
          </div>
          <button class="btn btn-ghost btn-sm" @click="router.push('/signals')">查看全部</button>
        </div>
        <div class="card-pad">
          <div class="empty">
            <div class="empty-icon"><Icon name="signals" :size="20" /></div>
            <div class="empty-title">今日尚未生成信号</div>
            <div class="empty-desc">到「信号」页盘后跑一轮,产出当日买卖信号与被风控拦截组。</div>
            <button class="btn btn-primary btn-sm" @click="router.push('/signals')">
              立即跑一轮 →
            </button>
          </div>
        </div>
      </div>

      <p class="disclaimer">
        司南是研究与纪律辅助工具,不是投资顾问。所有信号/回测/模拟盘仅供研究参考,不构成投资建议。
      </p>
    </template>
  </div>
</template>

<style scoped>
.page-body {
  padding: 28px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.grid-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
}
.grid-21 {
  display: grid;
  grid-template-columns: minmax(0, 2.1fr) minmax(0, 1fr);
  gap: 20px;
  align-items: start;
}
.stat {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.stat-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.ch-tag {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: var(--fs-cap);
  color: var(--text-3);
  font-family: var(--font-mono);
}
.ch-tag i {
  width: 7px;
  height: 7px;
  border-radius: 2px;
}
.stat-val {
  font-size: var(--fs-mono-lg);
  font-weight: 600;
  line-height: 1;
  letter-spacing: -0.01em;
}
.stat-delta {
  font-size: var(--fs-sub);
  font-weight: 600;
  margin-top: -6px;
}
.stat-metrics {
  display: flex;
  gap: 24px;
}
.m-k {
  font-size: 11px;
  color: var(--text-3);
  margin-bottom: 3px;
  white-space: nowrap;
}
.m-v {
  font-size: 13px;
  color: var(--text-1);
  font-weight: 500;
}

/* 净值卡图例 */
.eq-legend {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 22px 0;
  font-size: var(--fs-sub);
  color: var(--text-2);
}
.lg {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.ln {
  width: 14px;
  height: 0;
  border-top: 2px solid var(--accent);
}
.ln.bench {
  border-top-style: dashed;
  border-top-color: var(--benchmark);
}
.sw {
  width: 9px;
  height: 9px;
  border-radius: 2px;
}
.sw.dd {
  background: var(--status-err);
  opacity: 0.55;
}
.mk {
  width: 0;
  height: 0;
  border-left: 4px solid transparent;
  border-right: 4px solid transparent;
}
.mk.buy {
  border-bottom: 7px solid var(--status-ok);
}
.mk.sell {
  border-top: 7px solid var(--status-warn);
}
.risk-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.risk-note {
  color: var(--text-3);
  padding-top: 4px;
  border-top: 0.5px solid var(--border-faint);
}

.guide {
  max-width: 560px;
}
.guide-title {
  margin: 0 0 8px;
  font-size: var(--fs-h2);
}
.guide-lead {
  color: var(--text-2);
  margin: 0 0 16px;
}
.steps {
  list-style: none;
  padding: 0;
  margin: 0 0 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.steps li {
  display: flex;
  align-items: center;
  gap: 12px;
  color: var(--text-1);
}
.steps .n {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--accent-bg);
  color: var(--accent);
  font-size: var(--fs-cap);
  font-weight: 600;
  flex: none;
}
.disclaimer {
  margin: 4px 0 0;
  color: var(--text-3);
  font-size: var(--fs-cap);
}

@media (max-width: 1080px) {
  .grid-21 {
    grid-template-columns: 1fr;
  }
}
</style>
