<script setup lang="ts">
// 指标 · 因子库(M4 接真实)。对因子库逐因子算真实 IC 均值 / ICIR / 覆盖度 + IC 时序 + 十分位分层收益。
// 红线#3:IC/ICIR/覆盖度 中性通道;分层收益 PnL 通道;缺数据 coverage=0 如实(不造假)。
import { computed, reactive, ref } from 'vue';
import { api, ApiError } from '../../api/client';
import PageHero from '../../ui/PageHero.vue';
import Icon from '../../shell/Icon.vue';
import ICChart from '../../ui/charts/ICChart.vue';
import DecileBars from '../../ui/charts/DecileBars.vue';

const report = ref<any | null>(null);
const selectedName = ref<string | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);
const form = reactive({ start: '', end: '', label_horizon: 5 });

// 自定义因子 DSL 编辑器:沙箱白名单 + 仅回看算子(结构上防未来函数,红线#1)。
const expr = ref('zscore(-pe_ttm) + rank(roe)');
const validating = ref(false);
const validation = ref<any | null>(null);
async function validateExpr() {
  if (!expr.value.trim()) return;
  validating.value = true;
  try {
    validation.value = await api.validateIndicator(expr.value);
  } catch (e) {
    const d = e instanceof ApiError ? e.detail : e;
    validation.value = { ok: false, errors: [String(d ?? e)], fields: [], functions: [] };
  } finally {
    validating.value = false;
  }
}

const GROUP_LABEL: Record<string, string> = {
  value: '价值',
  quality: '质量',
  momentum: '动量',
  northbound: '北向',
  growth: '成长',
  sentiment: '情绪',
  volatility: '波动',
  moneyflow: '资金流',
  reversal: '反转',
};
function groupLabel(g: string) {
  return GROUP_LABEL[g] ?? g;
}

const factors = computed<any[]>(() => report.value?.factors ?? []);
const selected = computed(
  () => factors.value.find((f) => f.name === selectedName.value) ?? factors.value[0] ?? null,
);

function ic(v: number | null | undefined): string {
  return v == null ? '—' : (v >= 0 ? '' : '−') + Math.abs(v).toFixed(3);
}
function pct(v: number | null | undefined): string {
  return v == null ? '—' : (v * 100).toFixed(0) + '%';
}

async function run() {
  if (!form.start || !form.end) return;
  loading.value = true;
  error.value = null;
  try {
    report.value = await api.indicatorsQuality({ ...form });
    selectedName.value = report.value?.factors?.[0]?.name ?? null;
  } catch (e) {
    const d = e instanceof ApiError ? e.detail : e;
    error.value = d && typeof d === 'object' ? JSON.stringify(d) : String(d ?? e);
    report.value = null;
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <PageHero
    title="指标 · 因子库"
    sub="多因子模型的原子构建块 · 对因子库做真实样本外质检(IC 均值 / ICIR / 覆盖度 / 十分位分层)"
  />

  <div class="page-body">
    <!-- 色彩通道说明 -->
    <div class="ch-legend">
      <span class="ch-tag"
        ><i style="background: var(--text-2)" />IC / ICIR / 覆盖度 = 中性通道</span
      >
      <span class="ch-tag"><i style="background: var(--pnl-up)" />分层收益 = PnL 通道</span>
      <span class="ch-tag"><i style="background: var(--accent)" />IC 时序正负 = Accent / 中性</span>
    </div>

    <!-- 质检参数 -->
    <div class="card">
      <div class="card-head">
        <div>
          <h3 class="card-title">因子质检</h3>
          <span class="card-sub"
            >逐日横截面 RankIC(因子值 vs 前向收益)· 区间内真实计算,低 IC 如实</span
          >
        </div>
      </div>
      <div class="card-pad">
        <div class="form-row">
          <div class="field">
            <label class="field-label">起始日</label>
            <input v-model="form.start" class="input mono" type="date" />
          </div>
          <div class="field">
            <label class="field-label">结束日</label>
            <input v-model="form.end" class="input mono" type="date" />
          </div>
          <div class="field narrow">
            <label class="field-label">前向(交易日)</label>
            <input v-model.number="form.label_horizon" class="input mono" type="number" min="1" />
          </div>
          <button
            class="btn btn-primary run-btn"
            :disabled="loading || !form.start || !form.end"
            @click="run"
          >
            {{ loading ? '质检中…' : '运行质检' }}
          </button>
        </div>
        <p v-if="error" class="msg-err"><Icon name="alert" :size="14" /> {{ error }}</p>
      </div>
    </div>

    <!-- 自定义因子 DSL 编辑器(防未来函数:仅回看算子)-->
    <div class="card">
      <div class="card-head">
        <div>
          <h3 class="card-title">自定义因子 · DSL 校验</h3>
          <span class="card-sub"
            >白名单字段 + 仅「回看」算子(rolling/shift 正向),结构上无未来函数 ——
            写不出前视表达式(红线#1)</span
          >
        </div>
      </div>
      <div class="card-pad">
        <div class="dsl-row">
          <input
            v-model="expr"
            class="input mono dsl-input"
            placeholder="如 zscore(-pe_ttm) + rank(roe)"
            @keyup.enter="validateExpr"
          />
          <button
            class="btn btn-primary"
            :disabled="validating || !expr.trim()"
            @click="validateExpr"
          >
            {{ validating ? '校验中…' : '校验表达式' }}
          </button>
        </div>

        <div v-if="validation" class="dsl-result">
          <span class="badge" :class="validation.ok ? 'badge-ok' : 'badge-err'">
            <span class="dot" />{{ validation.ok ? '校验通过 · 结构上无未来函数' : '校验失败' }}
          </span>
          <p v-for="(er, i) in validation.errors" :key="i" class="dsl-err">
            <Icon name="alert" :size="13" /> {{ er }}
          </p>
        </div>

        <div
          v-if="validation && (validation.fields?.length || validation.functions?.length)"
          class="dsl-ref"
        >
          <div class="dsl-ref-row">
            <span class="dsl-ref-k">可用字段</span>
            <span class="dsl-chips">
              <span v-for="f in validation.fields" :key="f" class="chip mono">{{ f }}</span>
            </span>
          </div>
          <div class="dsl-ref-row">
            <span class="dsl-ref-k">可用算子</span>
            <span class="dsl-chips">
              <span v-for="fn in validation.functions" :key="fn" class="chip mono">{{ fn }}</span>
            </span>
          </div>
        </div>
        <p class="dsl-note cap">
          注册自定义因子(持久化 +
          接入打分/质检)在后续里程碑;当前可用本工具校验表达式的安全性与无未来函数。
        </p>
      </div>
    </div>

    <!-- 因子表 + 详情 -->
    <div v-if="report" class="cols">
      <div class="card">
        <div class="card-head">
          <div>
            <h3 class="card-title">因子库</h3>
            <span class="card-sub"
              >{{ report.start }} ~ {{ report.end }} · {{ report.n_dates }} 交易日 ·
              {{ report.n_codes }} 标的</span
            >
          </div>
          <span class="ch-tag"><i style="background: var(--text-2)" />中性</span>
        </div>
        <table class="dt">
          <thead>
            <tr>
              <th style="width: 150px">因子</th>
              <th>类别</th>
              <th class="num">IC 均值</th>
              <th class="num">ICIR</th>
              <th class="num">覆盖度</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="f in factors"
              :key="f.name"
              class="row"
              :class="{ sel: selected?.name === f.name }"
              @click="selectedName = f.name"
            >
              <td>
                <span class="f-name mono">{{ f.name }}</span>
              </td>
              <td>
                <span class="chip">{{ groupLabel(f.group) }}</span>
              </td>
              <td class="num">{{ ic(f.ic_mean) }}</td>
              <td class="num dim">{{ ic(f.icir) }}</td>
              <td class="num dim">{{ pct(f.coverage) }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="card card-pad detail">
        <div class="detail-head">
          <h3 class="card-title">{{ selected?.name ?? '—' }}</h3>
          <span v-if="selected" class="chip">{{ groupLabel(selected.group) }}</span>
        </div>
        <template v-if="selected">
          <div class="mini-grid">
            <div class="mini">
              <div class="mini-k">IC 均值</div>
              <div class="mini-v mono">{{ ic(selected.ic_mean) }}</div>
            </div>
            <div class="mini">
              <div class="mini-k">ICIR</div>
              <div class="mini-v mono">{{ ic(selected.icir) }}</div>
            </div>
            <div class="mini">
              <div class="mini-k">覆盖度</div>
              <div class="mini-v mono">{{ pct(selected.coverage) }}</div>
            </div>
            <div class="mini">
              <div class="mini-k">IC 天数</div>
              <div class="mini-v mono">{{ selected.ic_series?.length ?? 0 }}</div>
            </div>
          </div>

          <template v-if="selected.coverage > 0">
            <div class="cap detail-label">IC 时序(逐日 RankIC)</div>
            <div class="chart-box"><ICChart :values="selected.ic_series" /></div>
            <div class="cap detail-label">十分位分层 · 平均前向收益</div>
            <div class="chart-box"><DecileBars :values="selected.deciles" /></div>
          </template>
          <div v-else class="empty mini-empty">
            <div class="empty-title">该因子无数据</div>
            <div class="empty-desc">
              当前数据源缺该因子所需字段(如免费源无北向),覆盖度 0,如实不补强。
            </div>
          </div>
        </template>
      </div>
    </div>

    <!-- 未质检:诚实空状态 -->
    <div v-else class="card">
      <div class="card-pad">
        <div class="empty">
          <div class="empty-icon"><Icon name="indicator" :size="20" /></div>
          <div class="empty-title">运行因子质检以查看真实 IC / 分层</div>
          <div class="empty-desc">
            选定区间后「运行质检」,在本地缓存上算每个因子的真实样本外
            RankIC、ICIR、覆盖度与十分位分层收益 —— 低 IC / 缺数据如实(红线#3)。需先建缓存。
          </div>
        </div>
      </div>
    </div>

    <p class="disclaimer">
      IC / ICIR / 覆盖度属中性通道(因子研究指标,非盈亏色);十分位分层收益属 PnL
      通道。所有结果为真实样本外计算,不夸大、不补强。
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
.ch-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
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

.form-row {
  display: flex;
  align-items: flex-end;
  gap: 14px;
  flex-wrap: wrap;
}
.field {
  display: flex;
  flex-direction: column;
}
.field.narrow {
  width: 130px;
}
.field .field-label {
  margin-bottom: 6px;
}
.field .input {
  min-width: 150px;
}
.run-btn {
  height: 30px;
}
.msg-err {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 14px 0 0;
  padding: 9px 13px;
  border-radius: var(--r-md);
  font-size: var(--fs-sub);
  color: var(--status-err);
  background: var(--status-err-bg);
  border: 0.5px solid color-mix(in srgb, var(--status-err) 30%, transparent);
}

/* DSL 编辑器 */
.dsl-row {
  display: flex;
  gap: 10px;
}
.dsl-input {
  flex: 1;
}
.dsl-result {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 14px;
}
.dsl-err {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  font-size: var(--fs-sub);
  color: var(--status-err);
}
.dsl-ref {
  margin-top: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.dsl-ref-row {
  display: flex;
  gap: 12px;
  align-items: baseline;
}
.dsl-ref-k {
  flex: none;
  width: 64px;
  font-size: var(--fs-cap);
  color: var(--text-3);
}
.dsl-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.dsl-note {
  margin: 16px 0 0;
  color: var(--text-3);
  letter-spacing: 0;
  text-transform: none;
}

.cols {
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr);
  gap: 20px;
  align-items: start;
}
.f-name {
  font-weight: 500;
  color: var(--text-1);
}
.dim {
  color: var(--text-2);
}

.detail-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
}
.mini-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  margin-bottom: 18px;
}
.mini {
  background: var(--bg-panel-2);
  border-radius: var(--r-sm);
  padding: 10px 12px;
}
.mini-k {
  font-size: 10.5px;
  color: var(--text-3);
  margin-bottom: 4px;
}
.mini-v {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-1);
}
.detail-label {
  margin-bottom: 8px;
}
.chart-box {
  margin-bottom: 18px;
}
.detail .chart-box:last-of-type {
  margin-bottom: 0;
}
.mini-empty {
  padding: 24px 16px;
}

.disclaimer {
  margin: 4px 0 0;
  color: var(--text-3);
  font-size: var(--fs-cap);
  line-height: 1.6;
}

@media (max-width: 1080px) {
  .cols {
    grid-template-columns: 1fr;
  }
}
</style>
