<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { api } from '../../api/client';
import { pnlClass } from '../../lib/pnl';
import { actionLabel, reasonLabel } from '../../lib/signals';
import { drawdownSeries, honestyBadges, monthlyGrid, monthlyReturns } from '../../lib/backtest';
import { fmt, fmtInt } from '../../lib/format';
import PageHero from '../../ui/PageHero.vue';
import EquityChart from '../../ui/charts/EquityChart.vue';
import Heatmap from '../../ui/charts/Heatmap.vue';
import Icon from '../../shell/Icon.vue';

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

// ── 净值曲线 → EquityChart 需要的数组(组合/基准各自归一化到首值=1;回撤为百分数)──────
const navPoints = computed<any[]>(() => result.value?.nav_curve ?? []);
const model = computed(() => {
  const navs = navPoints.value.map((p) => p.nav ?? 0);
  const base = navs[0] || 1;
  return navs.map((v) => v / base);
});
const bench = computed(() => {
  const raw = navPoints.value.map((p) => (p.benchmark ?? null) as number | null);
  const b0 = raw.find((v) => v != null) ?? null;
  if (b0 == null) return [];
  return raw.map((v) => (v != null ? v / b0 : 0)) as number[];
});
const ddSeries = computed(() => {
  const navs = navPoints.value.map((p) => p.nav ?? 0);
  return drawdownSeries(navs).map((v) => v * 100); // 百分数(≤0)
});
const maxDD = computed(() => (ddSeries.value.length ? Math.min(0, ...ddSeries.value) : 0));

// 买卖点 → {i:在 nav_curve 中的索引, t:'buy'|'sell'}(方向用系统色,不用盈亏色)。
const trades = computed<any[]>(() => result.value?.trades ?? []);
const chartMarkers = computed(() => {
  const idxByDate = new Map<string, number>();
  navPoints.value.forEach((p, i) => idxByDate.set(p.date, i));
  const out: Array<{ i: number; t: 'buy' | 'sell' }> = [];
  for (const t of trades.value) {
    const i = idxByDate.get(t.trade_date);
    if (i == null) continue;
    out.push({ i, t: t.side === 'buy' ? 'buy' : 'sell' });
  }
  return out;
});

// ── 月度热力图 → Heatmap 需要的 years + data[][](百分数)─────────────────────────
const grid = computed(() => monthlyGrid(monthlyReturns(navPoints.value)));
const heatYears = computed(() => grid.value.map((r) => r.year));
const heatData = computed(() =>
  grid.value.map((r) => r.cells.map((c) => (c == null ? null : c * 100))),
);

// ── 诚实口径 ──────────────────────────────────────────────────────────────────
const isHonest = computed(() => (result.value ? !!result.value.cost_included : true));
const badges = computed(() => honestyBadges(result.value?.purge ?? form.purge, isHonest.value));

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
</script>

<template>
  <PageHero
    title="回测"
    sub="事件驱动逐日撮合 · T+1 开盘成交 · 含交易成本 · 仅测训练截止后(诚实样本外)"
  >
    <template #right>
      <button
        class="btn btn-primary btn-sm"
        :disabled="running || !form.train_end || !form.backtest_start || !form.backtest_end"
        @click="runBacktest"
      >
        <Icon name="refresh" :size="14" /> {{ running ? '回测中…' : '跑回测' }}
      </button>
    </template>
  </PageHero>

  <div class="page-body">
    <!-- 诚实口径提示条(顶部恒显;非诚实标 badge-warn) -->
    <div class="honesty" :class="{ warn: !isHonest }">
      <span class="h-icon"><Icon :name="isHonest ? 'shield' : 'alert'" :size="15" /></span>
      <span class="h-lead">{{ isHonest ? '诚实口径' : '非诚实口径' }}</span>
      <span class="badge" :class="isHonest ? 'badge-ok' : 'badge-warn'"
        ><span class="dot" />样本外验证</span
      >
      <span v-for="b in badges" :key="b" class="chip">{{ b }}</span>
      <span class="h-tail">本回测不代表未来收益,仅供策略纪律性验证。</span>
    </div>

    <p v-if="error" class="msg-err"><Icon name="alert" :size="14" /> {{ error }}</p>

    <!-- 参数(左列)+ 绩效与净值(右列):有结果时左右双栏,无结果时参数卡全宽 -->
    <div :class="result ? 'bt-cols' : ''">
      <!-- 参数表单 -->
      <div class="card param-card">
        <div class="card-head">
          <div>
            <h3 class="card-title">回测参数</h3>
            <span class="card-sub"
              >硬校验:回测起必须晚于「训练截止 + purge 个交易日」,否则拒跑(防虚假回测)</span
            >
          </div>
        </div>
        <div class="card-pad">
          <div class="form-grid">
            <div class="field">
              <label class="field-label">训练截止</label>
              <input v-model="form.train_end" class="input mono" type="date" />
            </div>
            <div class="field">
              <label class="field-label">回测起</label>
              <input v-model="form.backtest_start" class="input mono" type="date" />
            </div>
            <div class="field">
              <label class="field-label">回测止</label>
              <input v-model="form.backtest_end" class="input mono" type="date" />
            </div>
            <div class="field narrow">
              <label class="field-label">Purge(交易日)</label>
              <input v-model.number="form.purge" class="input mono" type="number" min="1" />
            </div>
            <div class="field narrow">
              <label class="field-label">基准</label>
              <input v-model="form.benchmark" class="input mono" />
            </div>
            <div class="field btn-cell">
              <button
                class="btn btn-primary"
                :disabled="running || !form.train_end || !form.backtest_start || !form.backtest_end"
                @click="runBacktest"
              >
                {{ running ? '回测中…' : '跑回测' }}
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- 右列:KPI 网格 + 净值卡(竖排) -->
      <div v-if="result" class="bt-right">
        <!-- 绩效指标(6 卡:年化/超额走盈亏色;MaxDD/夏普/IR/跟踪误差 中性)-->
        <div class="kpis">
          <div class="card card-pad kpi">
            <div class="kpi-top">
              <span class="kpi-k">年化收益</span><span class="cap">ANN</span>
            </div>
            <div class="kpi-v mono" :class="pnlClass(m.annual_return ?? 0)">
              {{ signed(m.annual_return) }}
            </div>
          </div>
          <div class="card card-pad kpi">
            <div class="kpi-top">
              <span class="kpi-k">超额收益(vs 基准)</span><span class="cap">ALPHA</span>
            </div>
            <div class="kpi-v mono" :class="pnlClass(m.excess_return ?? 0)">
              {{ signed(m.excess_return) }}
            </div>
          </div>
          <div class="card card-pad kpi">
            <div class="kpi-top">
              <span class="kpi-k">最大回撤</span><span class="cap">MAX DD</span>
            </div>
            <div class="kpi-v mono pnl-down">
              {{ m.max_drawdown == null ? '—' : '−' + pct(m.max_drawdown) }}
            </div>
          </div>
          <div class="card card-pad kpi">
            <div class="kpi-top">
              <span class="kpi-k">夏普比率</span><span class="cap">SHARPE</span>
            </div>
            <div class="kpi-v mono neutral">{{ fixed(m.sharpe) }}</div>
          </div>
          <div class="card card-pad kpi">
            <div class="kpi-top">
              <span class="kpi-k">信息比率 <span class="kpi-hint">目标 0.5–1.0</span></span
              ><span class="cap">IR</span>
            </div>
            <div class="kpi-v mono neutral">{{ fixed(m.information_ratio) }}</div>
          </div>
          <div class="card card-pad kpi">
            <div class="kpi-top">
              <span class="kpi-k">跟踪误差</span><span class="cap">TE</span>
            </div>
            <div class="kpi-v mono neutral">{{ pct(m.tracking_error) }}</div>
          </div>
        </div>

        <!-- 净值 vs 基准 + 回撤阴影 + 买卖点 -->
        <div class="card">
          <div class="card-head">
            <div>
              <h3 class="card-title">净值 vs 基准 · 含买卖点</h3>
              <span class="card-sub"
                >样本外 · 训练截止 {{ result.train_end }} 之后 · 起点归一化为 1</span
              >
            </div>
            <div class="legend">
              <span class="lg"><i class="ln port" />模型</span>
              <span v-if="bench.length" class="lg"><i class="ln bench" />{{ form.benchmark }}</span>
              <span class="lg"><i class="mk buy" />买</span>
              <span class="lg"><i class="mk sell" />卖</span>
            </div>
          </div>
          <div class="card-pad">
            <EquityChart
              :model="model"
              :bench="bench"
              :dd="ddSeries"
              :markers="chartMarkers"
              :height="244"
            />
          </div>
        </div>
      </div>
      <!-- /bt-right -->
    </div>
    <!-- /bt-cols -->

    <template v-if="result">
      <!-- 月度收益热力图 -->
      <div v-if="heatYears.length" class="card">
        <div class="card-head">
          <div>
            <h3 class="card-title">月度收益热力图</h3>
            <span class="card-sub"
              >单月策略收益率(%) · 红涨绿跌(A股惯例)· 最深回撤
              {{ pct(Math.abs(maxDD / 100)) }}</span
            >
          </div>
          <span class="ch-tag"><i style="background: var(--pnl-up)" />PnL 通道</span>
        </div>
        <div class="card-pad">
          <Heatmap :years="heatYears" :data="heatData" />
        </div>
      </div>

      <!-- 逐笔成交 + 逐日明细 -->
      <div class="detail-grid">
        <!-- 逐笔成交(方向 = Status 通道:买=ok蓝 / 卖=warn橙)-->
        <div v-if="trades.length" class="card">
          <div class="card-head">
            <div>
              <h3 class="card-title">逐笔成交</h3>
              <span class="card-sub">{{ trades.length }} 笔 · 方向 = Status 通道</span>
            </div>
          </div>
          <div class="tbl-wrap">
            <table class="dt dt-compact">
              <thead>
                <tr>
                  <th>日期</th>
                  <th>方向</th>
                  <th>代码</th>
                  <th class="num">股数</th>
                  <th class="num">成交价</th>
                  <th class="num">金额</th>
                  <th class="num">成本</th>
                  <th>原因</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(t, i) in trades" :key="i">
                  <td class="col-code">{{ t.trade_date }}</td>
                  <td>
                    <span class="badge" :class="t.side === 'buy' ? 'badge-ok' : 'badge-warn'"
                      ><span class="dot" />{{ actionLabel(t.side) }}</span
                    >
                  </td>
                  <td class="col-code">{{ t.code }}</td>
                  <td class="num">{{ fmtInt(t.shares) }}</td>
                  <td class="num">{{ fmt(t.price) }}</td>
                  <td class="num">{{ fmtInt(Math.round(t.amount ?? 0)) }}</td>
                  <td class="num dim">{{ fmt(t.fee_total) }}</td>
                  <td class="dim">{{ reasonLabel(t.reason) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- 逐日明细(点某天展开当日持仓;盈亏走 pnl 色)-->
        <div class="card">
          <div class="card-head">
            <div>
              <h3 class="card-title">逐日明细</h3>
              <span class="card-sub">点击某日展开当日持仓</span>
            </div>
          </div>
          <div class="tbl-wrap">
            <table class="dt dt-compact">
              <thead>
                <tr>
                  <th class="w-chev"></th>
                  <th>日期</th>
                  <th class="num">总资产</th>
                  <th class="num">现金</th>
                  <th class="num">持仓市值</th>
                  <th class="num">当日盈亏</th>
                  <th class="num">回撤</th>
                </tr>
              </thead>
              <tbody>
                <template v-for="r in navPoints" :key="r.date">
                  <tr
                    class="row"
                    :class="{ sel: selectedDay?.date === r.date }"
                    @click="selectDay(r)"
                  >
                    <td class="chev">
                      <span :class="{ open: selectedDay?.date === r.date }"
                        ><Icon name="chevR" :size="13"
                      /></span>
                    </td>
                    <td class="col-code">{{ r.date }}</td>
                    <td class="num">{{ fmtInt(Math.round(r.nav ?? 0)) }}</td>
                    <td class="num dim">{{ fmtInt(Math.round(r.cash ?? 0)) }}</td>
                    <td class="num dim">{{ fmtInt(Math.round(r.holding_value ?? 0)) }}</td>
                    <td class="num" :class="pnlClass(r.day_return ?? 0)">
                      {{ signed(r.day_return) }}
                    </td>
                    <td class="num mono" :class="r.drawdown ? 'pnl-down' : 'dim'">
                      {{ r.drawdown ? '−' + pct(r.drawdown) : '—' }}
                    </td>
                  </tr>
                  <tr v-if="selectedDay?.date === r.date" class="snap-row">
                    <td colspan="7">
                      <div class="snap">
                        <div class="snap-head cap">
                          当日持仓 · {{ r.date }}
                          <span class="snap-meta mono"
                            >现金 {{ fmtInt(Math.round(r.cash ?? 0)) }} · 持仓市值
                            {{ fmtInt(Math.round(r.holding_value ?? 0)) }}</span
                          >
                        </div>
                        <p v-if="!r.positions?.length" class="snap-empty dim">该日空仓。</p>
                        <div v-else class="snap-list">
                          <div v-for="p in r.positions" :key="p.code" class="snap-item">
                            <span class="snap-code col-code">{{ p.code }}</span>
                            <span class="snap-val mono"
                              >{{ fmtInt(p.shares) }} 股 · {{ fmtInt(Math.round(p.value ?? 0)) }} ·
                              {{
                                r.nav ? (((p.value ?? 0) / r.nav) * 100).toFixed(1) + '%' : '—'
                              }}</span
                            >
                          </div>
                        </div>
                      </div>
                    </td>
                  </tr>
                </template>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </template>

    <!-- 历史回测 -->
    <div v-if="history.length" class="card">
      <div class="card-head">
        <div>
          <h3 class="card-title">历史回测</h3>
          <span class="card-sub">点击某行载入该次回测</span>
        </div>
        <span class="badge badge-idle"><span class="dot" />{{ history.length }} 次</span>
      </div>
      <div class="tbl-wrap">
        <table class="dt dt-compact">
          <thead>
            <tr>
              <th>区间</th>
              <th class="num">年化</th>
              <th class="num">超额</th>
              <th class="num">最大回撤</th>
              <th class="num">IR</th>
              <th class="num">天数</th>
              <th>时间</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="h in history"
              :key="h.id"
              class="row"
              :class="{ sel: result?.id === h.id }"
              @click="loadOne(h.id)"
            >
              <td class="col-code">{{ h.backtest_start }} ~ {{ h.backtest_end }}</td>
              <td class="num" :class="pnlClass(h.metrics?.annual_return ?? 0)">
                {{ signed(h.metrics?.annual_return) }}
              </td>
              <td class="num" :class="pnlClass(h.metrics?.excess_return ?? 0)">
                {{ signed(h.metrics?.excess_return) }}
              </td>
              <td class="num">{{ pct(h.metrics?.max_drawdown) }}</td>
              <td class="num">{{ fixed(h.metrics?.information_ratio) }}</td>
              <td class="num dim">{{ h.n_days }}</td>
              <td class="dim">{{ h.created_at?.slice(0, 10) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- 结果为空时的诚实空状态 -->
    <div v-if="!result && !history.length" class="card">
      <div class="empty">
        <div class="empty-icon"><Icon name="backtest" :size="20" /></div>
        <div class="empty-title">尚无回测结果</div>
        <div class="empty-desc">
          填入训练截止与样本外回测区间,「跑回测」生成一次诚实样本外净值曲线与逐笔/逐日明细。
        </div>
      </div>
    </div>

    <!-- 免责声明常驻 -->
    <p class="disclaimer">
      历史回测不代表未来收益。现实预期是长期略微跑赢沪深300 + 回撤更小(目标 IR
      0.5–1.0),不是暴富。所有结果仅供研究参考,非投资建议;请用模拟盘前向验证数月后再谨慎考虑。
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

/* ── 诚实口径提示条(系统色 status-ok 蓝;非诚实 warn 橙)──────────────────────── */
.honesty {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding: 11px 14px;
  border-radius: var(--r-md);
  background: var(--status-ok-bg);
  border: 0.5px solid color-mix(in srgb, var(--status-ok) 30%, transparent);
}
.honesty.warn {
  background: var(--status-warn-bg);
  border-color: color-mix(in srgb, var(--status-warn) 30%, transparent);
}
.h-icon {
  display: inline-flex;
  flex: none;
  color: var(--status-ok);
}
.honesty.warn .h-icon {
  color: var(--status-warn);
}
.h-lead {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text-1);
}
.h-tail {
  font-size: var(--fs-sub);
  color: var(--text-2);
}

/* ── 错误条 ──────────────────────────────────────────────────────────────────── */
.msg-err {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  padding: 9px 13px;
  border-radius: var(--r-md);
  font-size: var(--fs-sub);
  color: var(--status-err);
  background: var(--status-err-bg);
  border: 0.5px solid color-mix(in srgb, var(--status-err) 30%, transparent);
}

/* ── 参数 + 绩效双栏:左 300px 参数竖列,右 1fr(KPI 网格 + 净值)──────────────── */
.bt-cols {
  display: grid;
  grid-template-columns: 300px minmax(0, 1fr);
  gap: 20px;
  align-items: start;
}
.bt-right {
  display: flex;
  flex-direction: column;
  gap: 20px;
  min-width: 0;
}

/* ── 参数表单(全宽时 3 列横排;窄左列时单列竖排,按钮占满)────────────────────── */
.form-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px 16px;
  align-items: end;
}
.bt-cols .form-grid {
  grid-template-columns: 1fr;
  gap: 13px;
  align-items: stretch;
}
.field {
  display: flex;
  flex-direction: column;
}
.field-label {
  margin-bottom: 6px;
}
.field.btn-cell {
  justify-content: flex-end;
}
.field.btn-cell .btn {
  height: 30px;
}
.bt-cols .field.btn-cell .btn {
  width: 100%;
}

/* 窄屏:双栏退化为单列 */
@media (max-width: 1080px) {
  .bt-cols {
    grid-template-columns: 1fr;
  }
  .bt-cols .form-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    align-items: end;
  }
  .bt-cols .field.btn-cell .btn {
    width: auto;
  }
}

/* ── 绩效卡 ──────────────────────────────────────────────────────────────────── */
.kpis {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}
.kpi {
  padding: 16px;
}
.kpi-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 10px;
}
.kpi-k {
  font-size: 11.5px;
  color: var(--text-2);
}
.kpi-hint {
  color: var(--text-3);
  font-size: var(--fs-cap);
}
.kpi-v {
  font-size: 22px;
  font-weight: 600;
  letter-spacing: -0.01em;
  line-height: 1;
}
.kpi-v.neutral {
  color: var(--text-1);
}

/* ── 图例 ────────────────────────────────────────────────────────────────────── */
.legend {
  display: flex;
  align-items: center;
  gap: 14px;
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

/* ── 逐笔 + 逐日 双栏 ────────────────────────────────────────────────────────── */
.detail-grid {
  display: grid;
  grid-template-columns: minmax(0, 0.92fr) minmax(0, 1.08fr);
  gap: 20px;
  align-items: start;
}
.tbl-wrap {
  max-height: 460px;
  overflow: auto;
}
.dim {
  color: var(--text-2);
}
.w-chev {
  width: 24px;
}
.chev {
  color: var(--text-3);
  width: 24px;
}
.chev span {
  display: inline-flex;
  transition: transform 0.15s var(--ease);
}
.chev span.open {
  transform: rotate(90deg);
}

/* 当日持仓展开行 */
.snap-row td {
  padding: 0;
  height: auto;
  background: var(--bg-base);
}
.snap {
  padding: 10px 16px 14px 46px;
}
.snap-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 8px;
  flex-wrap: wrap;
}
.snap-meta {
  font-size: var(--fs-cap);
  color: var(--text-3);
  letter-spacing: 0;
  text-transform: none;
  font-weight: 400;
}
.snap-empty {
  margin: 0;
  font-size: var(--fs-sub);
}
.snap-list {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0 32px;
}
.snap-item {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  font-size: var(--fs-sub);
  padding: 4px 0;
  border-bottom: 0.5px solid var(--border-faint);
}
.snap-code {
  color: var(--text-2);
}
.snap-val {
  color: var(--text-1);
  font-size: var(--fs-sub);
}

.disclaimer {
  margin: 4px 0 0;
  color: var(--text-3);
  font-size: var(--fs-cap);
  line-height: 1.6;
}

/* 窄屏退化 */
@media (max-width: 1080px) {
  .detail-grid {
    grid-template-columns: 1fr;
  }
}
</style>
