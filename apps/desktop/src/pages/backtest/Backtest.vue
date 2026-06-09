<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { api } from '../../api/client';
import { pnlClass } from '../../lib/pnl';
import {
  buildNavCharts,
  honestyBadges,
  monthlyGrid,
  monthlyReturns,
  type ChartBox,
} from '../../lib/backtest';

const form = reactive({
  train_end: '',
  backtest_start: '',
  backtest_end: '',
  purge: 5,
  benchmark: '000300.SH',
});
const running = ref(false);
const error = ref<string | null>(null);
const result = ref<any | null>(null);
const history = ref<any[]>([]);

async function loadHistory() {
  try {
    history.value = await api.backtests();
  } catch {
    /* 列表失败不阻断 */
  }
}

async function runBacktest() {
  if (!form.train_end || !form.backtest_start || !form.backtest_end) return;
  running.value = true;
  error.value = null;
  try {
    result.value = await api.createBacktest({ ...form });
    await loadHistory();
  } catch (e: any) {
    const d = e?.detail;
    error.value = d && typeof d === 'object' && d.message ? d.message : String(d ?? e);
    result.value = null;
  } finally {
    running.value = false;
  }
}

async function loadOne(id: string) {
  error.value = null;
  try {
    result.value = await api.backtest(id);
  } catch (e) {
    error.value = String(e);
  }
}

onMounted(loadHistory);

// ── 图表几何 ───────────────────────────────────────────────────────────────
const NAV_W = 760;
const NAV_BOX: ChartBox = {
  width: NAV_W,
  height: 220,
  padTop: 10,
  padBottom: 16,
  padLeft: 8,
  padRight: 8,
};
const DD_BOX: ChartBox = {
  width: NAV_W,
  height: 84,
  padTop: 6,
  padBottom: 14,
  padLeft: 8,
  padRight: 8,
};
const navPoints = computed(() => result.value?.nav_curve ?? []);
const charts = computed(() => buildNavCharts(navPoints.value, NAV_BOX, DD_BOX));
const grid = computed(() => monthlyGrid(monthlyReturns(navPoints.value)));
const isHonest = computed(() => (result.value ? !!result.value.cost_included : true));
const badges = computed(() => honestyBadges(result.value?.purge ?? form.purge, isHonest.value));

const m = computed(() => result.value?.metrics ?? {});
function pct(v: number | null | undefined): string {
  return v == null ? '—' : `${(v * 100).toFixed(2)}%`;
}
function signed(v: number | null | undefined): string {
  return v == null ? '—' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(2)}%`;
}
function fixed(v: number | null | undefined): string {
  return v == null ? '—' : v.toFixed(2);
}
const MONTHS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];
</script>

<template>
  <div class="page">
    <header class="page-head">
      <h1>回测</h1>
      <p class="sub">事件驱动逐日撮合 · T+1 开盘成交 · 含交易成本 · 仅测训练截止后(诚实样本外)</p>
    </header>

    <!-- 防未来函数 / 诚实口径提示条(顶部恒显) -->
    <div class="honesty" :class="{ warn: !isHonest }">
      <span class="h-icon">{{ isHonest ? '🛡' : '⚠' }}</span>
      <span v-for="b in badges" :key="b" class="m-chip">{{ b }}</span>
      <span v-if="!isHonest" class="status-warn nonhonest">非诚实口径</span>
    </div>

    <!-- 参数表单 -->
    <div class="m-card">
      <div class="m-toolbar form">
        <label class="fld"
          >训练截止 <input v-model="form.train_end" class="m-field" type="date"
        /></label>
        <label class="fld"
          >回测起 <input v-model="form.backtest_start" class="m-field" type="date"
        /></label>
        <label class="fld"
          >回测止 <input v-model="form.backtest_end" class="m-field" type="date"
        /></label>
        <label class="fld"
          >purge <input v-model.number="form.purge" class="m-field narrow" type="number" min="1"
        /></label>
        <label class="fld">基准 <input v-model="form.benchmark" class="m-field narrow" /></label>
        <button
          class="m-btn m-btn--primary"
          :disabled="running || !form.train_end || !form.backtest_start || !form.backtest_end"
          @click="runBacktest"
        >
          {{ running ? '回测中…' : '跑回测' }}
        </button>
      </div>
      <p class="m-muted hint">
        硬校验:回测起必须晚于「训练截止 + purge 个交易日」,否则拒跑(防虚假回测)。
      </p>
    </div>

    <p v-if="error" class="status-err msg">{{ error }}</p>

    <template v-if="result">
      <!-- 绩效指标 -->
      <div class="kpis">
        <div class="m-card kpi">
          <div class="kpi-label">年化收益</div>
          <div class="kpi-val num" :class="pnlClass(m.annual_return ?? 0)">
            {{ signed(m.annual_return) }}
          </div>
        </div>
        <div class="m-card kpi">
          <div class="kpi-label">年化超额(vs 基准)</div>
          <div class="kpi-val num" :class="pnlClass(m.excess_return ?? 0)">
            {{ signed(m.excess_return) }}
          </div>
        </div>
        <div class="m-card kpi">
          <div class="kpi-label">最大回撤</div>
          <div class="kpi-val num">
            −{{ pct(m.max_drawdown) === '—' ? '' : pct(m.max_drawdown) }}
          </div>
        </div>
        <div class="m-card kpi">
          <div class="kpi-label">信息比率 IR <span class="hint-inline">(目标 0.5–1.0)</span></div>
          <div class="kpi-val num">{{ fixed(m.information_ratio) }}</div>
        </div>
        <div class="m-card kpi">
          <div class="kpi-label">夏普</div>
          <div class="kpi-val num">{{ fixed(m.sharpe) }}</div>
        </div>
        <div class="m-card kpi">
          <div class="kpi-label">跟踪误差</div>
          <div class="kpi-val num">{{ pct(m.tracking_error) }}</div>
        </div>
      </div>

      <!-- 净值 vs 基准 + 回撤阴影 -->
      <div class="m-card">
        <div class="chart-head">
          <h3>净值曲线</h3>
          <div class="legend">
            <span class="lg port">组合</span>
            <span v-if="charts.hasBenchmark" class="lg bench">{{ form.benchmark }}</span>
          </div>
          <span class="m-muted oos"
            >样本外 · 训练截止 {{ result.train_end }} 之后 · 起点归一化为 1</span
          >
        </div>
        <svg class="chart" :viewBox="`0 0 ${NAV_W} ${NAV_BOX.height}`" preserveAspectRatio="none">
          <polyline v-if="charts.benchmark" class="line bench" :points="charts.benchmark" />
          <polyline v-if="charts.portfolio" class="line port" :points="charts.portfolio" />
        </svg>
        <div class="dd-label m-muted">回撤(最深 {{ pct(Math.abs(charts.ddMin)) }})</div>
        <svg class="chart" :viewBox="`0 0 ${NAV_W} ${DD_BOX.height}`" preserveAspectRatio="none">
          <path v-if="charts.drawdown" class="dd-area" :d="charts.drawdown" />
        </svg>
      </div>

      <!-- 月度收益热力图 -->
      <div v-if="grid.length" class="m-card">
        <h3>月度收益(%)</h3>
        <div class="heat">
          <div class="heat-row head">
            <span class="heat-year"></span>
            <span v-for="mo in MONTHS" :key="mo" class="heat-cell m-muted">{{ mo }}月</span>
          </div>
          <div v-for="row in grid" :key="row.year" class="heat-row">
            <span class="heat-year">{{ row.year }}</span>
            <span
              v-for="(c, mi) in row.cells"
              :key="mi"
              class="heat-cell num"
              :class="c == null ? 'empty' : pnlClass(c)"
            >
              {{ c == null ? '·' : (c * 100).toFixed(1) }}
            </span>
          </div>
        </div>
      </div>
    </template>

    <!-- 历史回测 -->
    <div v-if="history.length" class="m-card">
      <h3>
        历史回测 <span class="m-muted">({{ history.length }})</span>
      </h3>
      <table class="m-table num">
        <thead>
          <tr>
            <th>区间</th>
            <th class="r">年化</th>
            <th class="r">超额</th>
            <th class="r">最大回撤</th>
            <th class="r">IR</th>
            <th class="r">天数</th>
            <th>时间</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="h in history" :key="h.id" class="row" @click="loadOne(h.id)">
            <td>{{ h.backtest_start }} ~ {{ h.backtest_end }}</td>
            <td class="r" :class="pnlClass(h.metrics?.annual_return ?? 0)">
              {{ signed(h.metrics?.annual_return) }}
            </td>
            <td class="r" :class="pnlClass(h.metrics?.excess_return ?? 0)">
              {{ signed(h.metrics?.excess_return) }}
            </td>
            <td class="r">{{ pct(h.metrics?.max_drawdown) }}</td>
            <td class="r">{{ fixed(h.metrics?.information_ratio) }}</td>
            <td class="r">{{ h.n_days }}</td>
            <td class="m-muted">{{ h.created_at?.slice(0, 10) }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 免责声明常驻(不依赖是否已有回测结果) -->
    <p class="disclaimer">
      历史回测不代表未来收益。现实预期是长期略微跑赢沪深300 + 回撤更小(目标 IR
      0.5–1.0),不是暴富。所有结果仅供研究参考,非投资建议;请用模拟盘前向验证数月后再谨慎考虑。
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
.honesty {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  flex-wrap: wrap;
  padding: var(--sp-2) var(--sp-3);
  border-radius: var(--r-md);
  background: var(--accent-weak);
  margin-bottom: var(--sp-3);
}
.honesty.warn {
  background: color-mix(in srgb, var(--st-warn) 16%, transparent);
}
.h-icon {
  font-size: 14px;
}
.nonhonest {
  font-weight: 600;
}
.form {
  align-items: flex-end;
}
.fld {
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: var(--fs-cap);
  color: var(--c-text-2);
}
.m-field.narrow {
  width: 110px;
}
.hint {
  margin-top: var(--sp-2);
  font-size: var(--fs-cap);
}
.hint-inline {
  color: var(--c-text-3);
  font-weight: 400;
}
.msg {
  margin: 0 0 var(--sp-3);
}
.kpis {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--sp-3);
  margin-bottom: var(--sp-3);
}
.kpi {
  padding: var(--sp-4);
}
.kpi-label {
  color: var(--c-text-3);
  font-size: var(--fs-cap);
  font-weight: 500;
}
.kpi-val {
  font-size: 22px;
  font-weight: 600;
  margin-top: 4px;
  letter-spacing: -0.01em;
}
.chart-head {
  display: flex;
  align-items: baseline;
  gap: var(--sp-4);
  flex-wrap: wrap;
  margin-bottom: var(--sp-2);
}
.chart-head h3 {
  margin: 0;
}
.legend {
  display: flex;
  gap: var(--sp-3);
  font-size: var(--fs-cap);
}
.legend .port {
  color: var(--accent);
}
.legend .bench {
  color: var(--c-text-3);
}
.oos {
  margin-left: auto;
  font-size: var(--fs-cap);
}
.chart {
  width: 100%;
  height: auto;
  display: block;
}
.line {
  fill: none;
  stroke-width: 1.5;
  vector-effect: non-scaling-stroke;
}
.line.port {
  stroke: var(--accent);
}
.line.bench {
  stroke: var(--c-text-3);
  stroke-dasharray: 4 3;
}
.dd-label {
  font-size: var(--fs-cap);
  margin: var(--sp-2) 0 0;
}
.dd-area {
  fill: var(--pnl-down);
  opacity: 0.22;
  stroke: var(--pnl-down);
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
}
.heat {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin-top: var(--sp-2);
  overflow-x: auto;
}
.heat-row {
  display: grid;
  grid-template-columns: 52px repeat(12, 1fr);
  gap: 3px;
  align-items: center;
}
.heat-year {
  font-size: var(--fs-cap);
  color: var(--c-text-2);
  font-family: var(--font-num);
}
.heat-cell {
  text-align: center;
  font-size: 11px;
  padding: 4px 2px;
  border-radius: var(--r-sm);
  background: var(--c-surface-2);
  min-width: 34px;
}
.heat-row.head .heat-cell {
  background: transparent;
}
.heat-cell.empty {
  color: var(--c-text-3);
  opacity: 0.5;
}
.row {
  cursor: pointer;
}
.disclaimer {
  margin: var(--sp-5) 0 var(--sp-3);
  color: var(--c-text-3);
  font-size: var(--fs-cap);
}
</style>
