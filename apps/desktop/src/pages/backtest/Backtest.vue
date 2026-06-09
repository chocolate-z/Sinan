<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { api } from '../../api/client';
import { pnlClass } from '../../lib/pnl';
import { actionClass, actionLabel, reasonLabel } from '../../lib/signals';
import {
  buildNavCharts,
  honestyBadges,
  monthlyGrid,
  monthlyReturns,
  tradeMarkers,
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

// 买卖点(标在净值曲线上;方向用系统色,不用盈亏色)。
const trades = computed<any[]>(() => result.value?.trades ?? []);
const markers = computed(() =>
  tradeMarkers(trades.value, navPoints.value, NAV_BOX, charts.value.yMin, charts.value.yMax),
);

// 选中某天 → 展开当日持仓快照(可回溯)。
const selectedDay = ref<any | null>(null);
function selectDay(r: any) {
  selectedDay.value = selectedDay.value?.date === r.date ? null : r;
}

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
            <span class="lg buy">▲ 买</span>
            <span class="lg sell">▼ 卖</span>
          </div>
          <span class="m-muted oos"
            >样本外 · 训练截止 {{ result.train_end }} 之后 · 起点归一化为 1</span
          >
        </div>
        <div class="chart-wrap" :style="{ aspectRatio: `${NAV_W} / ${NAV_BOX.height}` }">
          <svg class="chart" :viewBox="`0 0 ${NAV_W} ${NAV_BOX.height}`" preserveAspectRatio="none">
            <polyline v-if="charts.benchmark" class="line bench" :points="charts.benchmark" />
            <polyline v-if="charts.portfolio" class="line port" :points="charts.portfolio" />
          </svg>
          <!-- 买卖点(系统色:买蓝 / 卖橙;非盈亏色) -->
          <span
            v-for="(mk, i) in markers"
            :key="i"
            class="marker"
            :class="mk.side === 'buy' ? 'buy' : 'sell'"
            :style="{ left: `${(mk.x / NAV_W) * 100}%`, top: `${(mk.y / NAV_BOX.height) * 100}%` }"
            :title="`${mk.date} ${mk.side === 'buy' ? '买' : '卖'} ${mk.code} ${mk.shares}股 @${mk.price}`"
            >{{ mk.side === 'buy' ? '▲' : '▼' }}</span
          >
        </div>
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

      <!-- 逐笔成交(买卖点明细) -->
      <div v-if="trades.length" class="m-card">
        <h3>
          逐笔成交 <span class="m-muted">({{ trades.length }})</span>
        </h3>
        <table class="m-table num">
          <thead>
            <tr>
              <th>日期</th>
              <th>方向</th>
              <th>代码</th>
              <th class="r">股数</th>
              <th class="r">成交价</th>
              <th class="r">金额</th>
              <th class="r">成本</th>
              <th>原因</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(t, i) in trades" :key="i">
              <td>{{ t.trade_date }}</td>
              <td>
                <span class="m-badge" :class="actionClass(t.side)">{{ actionLabel(t.side) }}</span>
              </td>
              <td>{{ t.code }}</td>
              <td class="r">{{ t.shares }}</td>
              <td class="r">{{ t.price?.toFixed(2) }}</td>
              <td class="r">{{ t.amount?.toFixed(0) }}</td>
              <td class="r m-muted">{{ t.fee_total?.toFixed(2) }}</td>
              <td class="m-muted">{{ reasonLabel(t.reason) }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 逐日明细(资产/盈亏/持仓变化;点某天展开当日持仓)-->
      <div class="m-card">
        <h3>逐日明细 <span class="m-muted">点某天看当日持仓</span></h3>
        <table class="m-table num">
          <thead>
            <tr>
              <th>日期</th>
              <th class="r">总资产</th>
              <th class="r">现金</th>
              <th class="r">持仓市值</th>
              <th class="r">当日盈亏</th>
              <th class="r">回撤</th>
              <th class="r">持仓数</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="r in navPoints"
              :key="r.date"
              class="row"
              :class="{ sel: selectedDay?.date === r.date }"
              @click="selectDay(r)"
            >
              <td>{{ r.date }}</td>
              <td class="r">{{ r.nav?.toFixed(0) }}</td>
              <td class="r m-muted">{{ r.cash?.toFixed(0) }}</td>
              <td class="r">{{ r.holding_value?.toFixed(0) }}</td>
              <td class="r" :class="pnlClass(r.day_return ?? 0)">{{ signed(r.day_return) }}</td>
              <td class="r m-muted">{{ r.drawdown ? pct(r.drawdown) : '—' }}</td>
              <td class="r">{{ r.positions?.length ?? 0 }}</td>
            </tr>
          </tbody>
        </table>

        <div v-if="selectedDay" class="snapshot">
          <div class="snap-head">
            {{ selectedDay.date }} 持仓
            <span class="m-muted"
              >(现金 {{ selectedDay.cash?.toFixed(0) }} · 持仓市值
              {{ selectedDay.holding_value?.toFixed(0) }})</span
            >
          </div>
          <p v-if="!selectedDay.positions?.length" class="m-muted">该日空仓。</p>
          <table v-else class="m-table num">
            <thead>
              <tr>
                <th>代码</th>
                <th class="r">股数</th>
                <th class="r">成本</th>
                <th class="r">市值</th>
                <th class="r">占比</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="p in selectedDay.positions" :key="p.code">
                <td>{{ p.code }}</td>
                <td class="r">{{ p.shares }}</td>
                <td class="r m-muted">{{ p.avg_cost?.toFixed(2) }}</td>
                <td class="r">{{ p.value?.toFixed(0) }}</td>
                <td class="r m-muted">{{ ((p.value / selectedDay.nav) * 100).toFixed(1) }}%</td>
              </tr>
            </tbody>
          </table>
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
.legend .buy {
  color: var(--st-info);
}
.legend .sell {
  color: var(--st-warn);
}
.oos {
  margin-left: auto;
  font-size: var(--fs-cap);
}
.chart-wrap {
  position: relative;
  width: 100%;
}
.chart {
  width: 100%;
  height: 100%;
  display: block;
}
/* 买卖点:绝对定位覆盖在曲线上,不随 svg 非等比缩放变形。方向用系统色(非盈亏色)。 */
.marker {
  position: absolute;
  transform: translate(-50%, -50%);
  font-size: 9px;
  line-height: 1;
  pointer-events: auto;
  cursor: default;
}
.marker.buy {
  color: var(--st-info);
}
.marker.sell {
  color: var(--st-warn);
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
.row.sel {
  background: var(--accent-weak);
}
.snapshot {
  margin-top: var(--sp-3);
  padding-top: var(--sp-3);
  border-top: 1px solid var(--c-hairline);
}
.snap-head {
  font-size: var(--fs-cap);
  font-weight: 600;
  margin-bottom: var(--sp-2);
}
.disclaimer {
  margin: var(--sp-5) 0 var(--sp-3);
  color: var(--c-text-3);
  font-size: var(--fs-cap);
}
</style>
