<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api } from '../../api/client';
import { useAppStore } from '../../stores/app';
import { formatPnl, pnlClass } from '../../lib/pnl';
import {
  buildCandleChart,
  capEnabled,
  maPoints,
  movingAverage,
  quoteChange,
  type KBar,
  type QuoteRow,
} from '../../lib/market';

const app = useAppStore();

const codesInput = ref('600519.SH,000001.SZ,000300.SH');
const quotes = ref<QuoteRow[]>([]);
const quotesDegraded = ref(false);
const selected = ref<string | null>(null);
const bars = ref<KBar[]>([]);
const pricesDegraded = ref(false);
const adjust = ref<'qfq' | 'none'>('qfq');
const loadingQuotes = ref(false);
const loadingPrices = ref(false);
const error = ref<string | null>(null);

function parseCodes(): string[] {
  return codesInput.value
    .split(/[,\s]+/)
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean);
}

async function loadQuotes() {
  const codes = parseCodes();
  if (!codes.length) return;
  loadingQuotes.value = true;
  error.value = null;
  try {
    const res = await api.quotes(codes);
    quotes.value = res.quotes ?? [];
    quotesDegraded.value = Boolean(res.degraded);
    if (quotes.value.length && (!selected.value || !codes.includes(selected.value))) {
      selectCode(quotes.value[0].stock_code);
    }
  } catch (e) {
    error.value = String(e);
    quotes.value = [];
  } finally {
    loadingQuotes.value = false;
  }
}

async function loadPrices(code: string) {
  loadingPrices.value = true;
  try {
    const res = await api.prices(code, { adjust: adjust.value, limit: 250 });
    bars.value = res.rows ?? [];
    pricesDegraded.value = Boolean(res.degraded);
  } catch (e) {
    bars.value = [];
    pricesDegraded.value = false;
    error.value = String(e);
  } finally {
    loadingPrices.value = false;
  }
}

function selectCode(code: string) {
  selected.value = code;
  loadPrices(code);
}

function changeAdjust(a: 'qfq' | 'none') {
  if (adjust.value === a) return;
  adjust.value = a;
  if (selected.value) loadPrices(selected.value);
}

// ── 涨跌展示(盈亏色)──────────────────────────────────────────────────────
function chgClass(q: QuoteRow): string {
  const c = quoteChange(q.price, q.prev_close);
  return c.abs == null ? 'pnl-flat' : pnlClass(c.abs);
}
function chgAbs(q: QuoteRow): string {
  const c = quoteChange(q.price, q.prev_close);
  return c.abs == null ? '—' : formatPnl(c.abs);
}
function chgPct(q: QuoteRow): string {
  const c = quoteChange(q.price, q.prev_close);
  return c.pct == null ? '—' : `${c.pct >= 0 ? '+' : ''}${(c.pct * 100).toFixed(2)}%`;
}
function priceTxt(q: QuoteRow): string {
  return q.price == null ? '—' : q.price.toFixed(2);
}

// ── 图表几何(响应式)──────────────────────────────────────────────────────
const W = 720;
const H = 320;
const layout = { width: W, height: H, padTop: 12, padBottom: 20, padLeft: 8, padRight: 56 };
const chart = computed(() => buildCandleChart(bars.value, layout));
const closes = computed(() => bars.value.map((b) => b.close));
const ma5 = computed(() => maPoints(movingAverage(closes.value, 5), chart.value));
const ma10 = computed(() => maPoints(movingAverage(closes.value, 10), chart.value));
const ma20 = computed(() => maPoints(movingAverage(closes.value, 20), chart.value));
const yLabels = computed(() => {
  const c = chart.value;
  if (!bars.value.length) return [];
  return [c.yMax, (c.yMax + c.yMin) / 2, c.yMin].map((v) => ({ v, y: c.scaleY(v) }));
});

const selectedName = computed(
  () => quotes.value.find((q) => q.stock_code === selected.value)?.name ?? selected.value ?? '',
);
const northboundOn = computed(() => capEnabled(app.providers, app.activeProvider, 'NORTHBOUND'));
const fundamentalOn = computed(() => capEnabled(app.providers, app.activeProvider, 'FUNDAMENTAL'));

onMounted(() => {
  if (app.onboardingDone) loadQuotes();
});
</script>

<template>
  <div class="page">
    <header class="page-head">
      <h1>行情</h1>
      <p class="sub">日线 · 实时报价来自新浪/腾讯「现价 vs 昨收」</p>
    </header>

    <div class="m-card">
      <div class="m-toolbar">
        <label class="field-label">
          自选代码
          <input
            v-model="codesInput"
            class="m-field codes-field"
            placeholder="600519.SH,000001.SZ"
            @keyup.enter="loadQuotes"
          />
        </label>
        <button class="m-btn m-btn--primary" :disabled="loadingQuotes" @click="loadQuotes">
          {{ loadingQuotes ? '刷新中…' : '刷新报价' }}
        </button>
      </div>
    </div>

    <p v-if="error" class="status-err msg">{{ error }}</p>
    <p v-if="quotesDegraded" class="status-warn msg">
      部分标的暂无实时报价(实时源不可达或非交易时段)。
    </p>

    <!-- 报价列表 -->
    <div class="m-card">
      <table v-if="quotes.length" class="m-table num">
        <thead>
          <tr>
            <th>代码</th>
            <th>名称</th>
            <th class="r">现价</th>
            <th class="r">涨跌</th>
            <th class="r">涨跌幅</th>
            <th>来源</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="q in quotes"
            :key="q.stock_code"
            class="row"
            :class="{ sel: q.stock_code === selected }"
            @click="selectCode(q.stock_code)"
          >
            <td>{{ q.stock_code }}</td>
            <td>{{ q.name ?? '—' }}</td>
            <td class="r" :class="chgClass(q)">{{ priceTxt(q) }}</td>
            <td class="r" :class="chgClass(q)">{{ chgAbs(q) }}</td>
            <td class="r" :class="chgClass(q)">{{ chgPct(q) }}</td>
            <td class="m-muted">{{ q.source ?? '—' }}</td>
          </tr>
        </tbody>
      </table>
      <p v-else class="m-muted empty-hint">输入自选代码并「刷新报价」查看实时行情。</p>
    </div>

    <!-- K 线 -->
    <div v-if="selected" class="m-card">
      <div class="chart-head">
        <h3>
          {{ selectedName }} <span class="m-muted code-tag">{{ selected }}</span>
        </h3>
        <div class="m-segmented adjust-seg">
          <button :class="{ on: adjust === 'qfq' }" @click="changeAdjust('qfq')">前复权</button>
          <button :class="{ on: adjust === 'none' }" @click="changeAdjust('none')">不复权</button>
        </div>
        <div class="legend">
          <span class="lg ma5">MA5</span>
          <span class="lg ma10">MA10</span>
          <span class="lg ma20">MA20</span>
        </div>
      </div>

      <p v-if="pricesDegraded" class="status-warn small">
        复权因子缺失,展示原始价(切换 Tushare Pro 可前复权)。
      </p>

      <div v-if="loadingPrices" class="m-muted pad">加载 K 线…</div>
      <svg
        v-else-if="bars.length"
        class="kline"
        :viewBox="`0 0 ${W} ${H}`"
        preserveAspectRatio="xMidYMid meet"
      >
        <g class="grid">
          <line
            v-for="l in yLabels"
            :key="`g${l.v}`"
            :x1="layout.padLeft"
            :x2="W - layout.padRight"
            :y1="l.y"
            :y2="l.y"
          />
          <text v-for="l in yLabels" :key="`t${l.v}`" :x="W - layout.padRight + 4" :y="l.y + 3">
            {{ l.v.toFixed(2) }}
          </text>
        </g>
        <g v-for="(c, i) in chart.candles" :key="i" :class="c.up ? 'candle-up' : 'candle-down'">
          <line class="wick" :x1="c.x" :x2="c.x" :y1="c.highY" :y2="c.lowY" />
          <rect :x="c.bodyX" :y="c.bodyY" :width="c.bodyW" :height="c.bodyH" />
        </g>
        <polyline v-if="ma5" class="ma ma5" :points="ma5" />
        <polyline v-if="ma10" class="ma ma10" :points="ma10" />
        <polyline v-if="ma20" class="ma ma20" :points="ma20" />
      </svg>
      <div v-else class="empty-k">
        <p class="m-muted">本地无「{{ selected }}」的行情缓存。</p>
        <p class="m-muted">请在「设置 → 数据源」建立本地缓存后再查看 K 线。</p>
      </div>
    </div>

    <!-- 扩展数据:免费源北向/财务置灰(诚实告知) -->
    <div class="m-card">
      <h3 class="card-title">扩展数据</h3>
      <div class="ext-grid">
        <div class="ext" :class="{ off: !northboundOn }">
          <div class="ext-h">北向资金 <span v-if="!northboundOn" class="lock">🔒</span></div>
          <p v-if="northboundOn" class="m-muted">
            当前数据源支持北向持股;持股占比趋势将随估值页接入。
          </p>
          <p v-else class="m-muted">当前数据源不支持北向数据,切换 Tushare Pro 可启用。</p>
        </div>
        <div class="ext" :class="{ off: !fundamentalOn }">
          <div class="ext-h">基本面 <span v-if="!fundamentalOn" class="lock">🔒</span></div>
          <p v-if="fundamentalOn" class="m-muted">
            当前数据源支持财务/估值;PE/PB/ROE 将随估值页接入。
          </p>
          <p v-else class="m-muted">当前数据源不支持财务数据,切换 Tushare Pro 可启用。</p>
        </div>
      </div>
    </div>

    <p class="disclaimer">
      行情仅供研究参考,非投资建议。实时价来自第三方公开源,可能延迟或缺失;K
      线走本地缓存,前复权随最新日动态生成。
    </p>
  </div>
</template>

<style scoped>
.page-head {
  margin-bottom: var(--sp-4);
}
.page-head .sub {
  color: var(--c-text-3);
  font-size: var(--fs-cap);
  margin-top: 2px;
}
.m-card {
  margin-bottom: var(--sp-3);
}

/* 工具条:自选代码输入 + 刷新 */
.field-label {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  font-size: var(--fs-cap);
  color: var(--c-text-2);
}
.codes-field {
  min-width: 260px;
}

.msg {
  margin: 0 0 var(--sp-3);
  font-size: var(--fs-cap);
}

/* 报价表:选中行用品牌弱底(交互语义,守红线) */
.empty-hint {
  margin: 0;
  padding: var(--sp-2) 0;
}
.row {
  cursor: pointer;
}
.row.sel,
.row.sel:hover {
  background: var(--accent-weak);
}

/* K 线头部 */
.chart-head {
  display: flex;
  align-items: center;
  gap: var(--sp-4);
  flex-wrap: wrap;
  margin-bottom: var(--sp-3);
}
.chart-head h3 {
  margin: 0;
  font-size: var(--fs-h3);
}
.code-tag {
  font-size: var(--fs-cap);
  font-weight: 400;
}
.legend {
  display: flex;
  gap: var(--sp-3);
  font-size: var(--fs-cap);
  margin-left: auto;
}
.legend .ma5 {
  color: #e8973a;
}
.legend .ma10 {
  color: var(--accent);
}
.legend .ma20 {
  color: #8b5cf6;
}
.small {
  font-size: var(--fs-cap);
  margin: 0 0 var(--sp-2);
}

/* SVG K 线:蜡烛用盈亏色(涨跌语义),MA 折线保留局部品牌色 */
.kline {
  width: 100%;
  height: auto;
  display: block;
}
.candle-up {
  fill: var(--pnl-up);
  stroke: var(--pnl-up);
}
.candle-down {
  fill: var(--pnl-down);
  stroke: var(--pnl-down);
}
.wick {
  stroke-width: 1;
}
.ma {
  fill: none;
  stroke-width: 1.25;
}
.ma5 {
  stroke: #e8973a;
}
.ma10 {
  stroke: var(--accent);
}
.ma20 {
  stroke: #8b5cf6;
}
.grid line {
  stroke: var(--c-hairline);
  stroke-width: 1;
}
.grid text {
  fill: var(--c-text-3);
  font-size: 10px;
  font-family: var(--font-num);
}
.empty-k,
.pad {
  padding: var(--sp-5) var(--sp-2);
  text-align: center;
}
.empty-k p {
  margin: var(--sp-1) 0;
}

/* 扩展数据 */
.card-title {
  margin: 0 0 var(--sp-3);
  font-size: var(--fs-h3);
}
.ext-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--sp-3);
}
.ext {
  border: 1px solid var(--c-hairline);
  border-radius: var(--r-md);
  background: var(--c-surface-2);
  padding: var(--sp-4);
}
.ext.off {
  opacity: 0.55;
}
.ext-h {
  font-weight: 600;
  margin-bottom: var(--sp-1);
}
.ext p {
  margin: 0;
}
.lock {
  font-size: var(--fs-cap);
}

.disclaimer {
  margin-top: var(--sp-5);
  color: var(--c-text-3);
  font-size: var(--fs-cap);
}
</style>
