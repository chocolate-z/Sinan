<script setup lang="ts">
// 指标 · 因子库(M4 接真实)。对因子库逐因子算真实 IC 均值 / ICIR / 覆盖度 + IC 时序 + 十分位分层收益。
// 红线#3:IC/ICIR/覆盖度 中性通道;分层收益 PnL 通道;缺数据 coverage=0 如实(不造假)。
import { computed, onMounted, ref } from 'vue';
import { useIndicatorsStore } from '../../stores/indicators';
import PageHero from '../../ui/PageHero.vue';
import RangePicker from '../../ui/RangePicker.vue';
import RunningBar from '../../ui/RunningBar.vue';
import Icon from '../../shell/Icon.vue';
import ICChart from '../../ui/charts/ICChart.vue';
import DecileBars from '../../ui/charts/DecileBars.vue';

const ind = useIndicatorsStore();
// 表单=store 同一 reactive 引用;DSL 输入(expr/名称/权重)与 selectedName 为可写投影;
// 其余只读投影,动作转调 store —— 模板与派生 computed 全不动。
const form = ind.form;
const expr = computed({ get: () => ind.expr, set: (v: string) => (ind.expr = v) });
const factorName = computed({
  get: () => ind.factorName,
  set: (v: string) => (ind.factorName = v),
});
const factorWeight = computed({
  get: () => ind.factorWeight,
  set: (v: number) => (ind.factorWeight = v),
});
const selectedName = computed({
  get: () => ind.selectedName,
  set: (v: string | null) => (ind.selectedName = v),
});
const report = computed(() => ind.report);
const loading = computed(() => ind.loading);
const error = computed(() => ind.error);
const validating = computed(() => ind.validating);
const saving = computed(() => ind.saving);
const saveError = computed(() => ind.saveError);
const validation = computed(() => ind.validation);
const customList = computed(() => ind.customList);

const validateExpr = () => ind.validateExpr();
const saveFactor = () => ind.saveFactor();
const updateFactor = (id: string, patch: { weight?: number; enabled?: boolean }) =>
  ind.updateFactor(id, patch);
const delFactor = (id: string) => ind.delFactor(id);
const run = () => ind.run();

onMounted(() => ind.loadCustom());

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

// 内置因子的人类名 + 释义(真实知识,非造数;自定义因子退回键名 + DSL 表达式)。
const FACTOR_META: Record<string, { label: string; desc: string }> = {
  f_bp: { label: '账面市值比 (BP)', desc: '净资产 / 市值,价值因子——数值越高,估值相对越"便宜"。' },
  f_ep: { label: '盈利市值比 (EP)', desc: '净利润 / 市值(市盈率倒数),价值因子,反映盈利相对估值。' },
  f_roe: { label: '净资产收益率 (ROE)', desc: '净利润 / 净资产,质量因子,衡量公司盈利能力。' },
  f_mom20: { label: '20 日动量', desc: '近 20 个交易日累计涨幅,趋势 / 动量因子。' },
  f_north: { label: '北向资金', desc: '陆股通近 5 日净流入强度,资金面因子。' },
};
function factorLabel(name: string): string {
  return FACTOR_META[name]?.label ?? name;
}
function factorDesc(f: { name: string }): string {
  return FACTOR_META[f.name]?.desc ?? customByName.value[f.name]?.expr ?? '';
}

// 因子分类过滤(段控件,从 group 派生类别)。
const cat = ref('全部');
const cats = computed(() => ['全部', ...new Set(factors.value.map((f) => groupLabel(f.group)))]);
const filteredFactors = computed(() =>
  cat.value === '全部'
    ? factors.value
    : factors.value.filter((f) => groupLabel(f.group) === cat.value),
);

// 「新建因子」滚动并聚焦到 DSL 编辑器。
function focusEditor() {
  const el = document.querySelector('.dsl-input') as HTMLElement | null;
  el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el?.focus();
}

// 因子表「权重 / 启用」列:仅自定义因子有真实可调权重/启用态;内置因子=等权·内置(诚实,
// 不伪造可编辑)。按名匹配已保存的自定义因子,拿真实 weight/enabled/id。
const customByName = computed<Record<string, any>>(() => {
  const m: Record<string, any> = {};
  for (const c of customList.value) m[c.name] = c;
  return m;
});
const maxWeight = computed(() => {
  let mx = 1;
  for (const f of factors.value) {
    const c = customByName.value[f.name];
    if (c) mx = Math.max(mx, Number(c.weight) || 0);
  }
  return mx || 1;
});
function weightBar(name: string): number {
  const c = customByName.value[name];
  const w = c ? Number(c.weight) || 0 : 1;
  return Math.round((w / maxWeight.value) * 100);
}

function ic(v: number | null | undefined): string {
  return v == null ? '—' : (v >= 0 ? '' : '−') + Math.abs(v).toFixed(3);
}
function pct(v: number | null | undefined): string {
  return v == null ? '—' : (v * 100).toFixed(0) + '%';
}
</script>

<template>
  <PageHero
    title="指标 · 因子库"
    sub="多因子模型的原子构建块 · 对因子库做真实样本外质检(IC 均值 / ICIR / 覆盖度 / 十分位分层)"
  >
    <template #right>
      <button class="btn btn-primary btn-sm" @click="focusEditor">
        <Icon name="plus" :size="14" /> 新建因子
      </button>
    </template>
  </PageHero>

  <div class="page-body">
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
          <div class="field field-range">
            <label class="field-label">质检区间</label>
            <RangePicker
              :model-value="[form.start, form.end]"
              placeholder-start="起始日"
              placeholder-end="结束日"
              @update:model-value="
                (v) => {
                  form.start = v[0];
                  form.end = v[1];
                }
              "
            />
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
        <RunningBar
          :active="loading"
          :since="ind.startedAt"
          :progress="ind.progress"
          label="质检中 · 逐日 RankIC"
        />
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
        <!-- 保存为因子(校验通过后)-->
        <div v-if="validation && validation.ok" class="dsl-save">
          <input
            v-model="factorName"
            class="input mono dsl-name"
            placeholder="因子名(英文,如 my_mom)"
          />
          <label class="cf-weight" title="合成权重:1=等权,0=不参与,>1 放大该因子贡献">
            权重
            <input
              v-model.number="factorWeight"
              class="input mono cf-weight-in"
              type="number"
              min="0"
              step="0.5"
            />
          </label>
          <button
            class="btn btn-secondary"
            :disabled="saving || !factorName.trim()"
            @click="saveFactor"
          >
            {{ saving ? '保存中…' : '保存为因子' }}
          </button>
        </div>
        <p v-if="saveError" class="dsl-err"><Icon name="alert" :size="13" /> {{ saveError }}</p>

        <!-- 已保存的自定义因子(启用者运行质检/选股时与内置并列;权重驱动合成,口径贯穿实盘+回测)-->
        <div v-if="customList.length" class="dsl-saved">
          <div class="cap dsl-saved-k">
            已保存因子 · 启用项进等权×权重合成(驱动每日选股 + 回测,口径一致)
          </div>
          <div
            v-for="c in customList"
            :key="c.id"
            class="dsl-saved-row"
            :class="{ 'row-off': !c.enabled }"
          >
            <label class="cf-switch" :title="c.enabled ? '已启用(点击禁用)' : '已禁用(点击启用)'">
              <input
                type="checkbox"
                :checked="c.enabled"
                @change="
                  updateFactor(c.id, { enabled: ($event.target as HTMLInputElement).checked })
                "
              />
              <span class="cf-track"><span class="cf-knob" /></span>
            </label>
            <span class="dsl-saved-name mono">{{ c.name }}</span>
            <span class="dsl-saved-expr mono">{{ c.expr }}</span>
            <label class="cf-weight" title="合成权重:1=等权,0=不参与,>1 放大该因子贡献">
              权重
              <input
                class="input mono cf-weight-in"
                type="number"
                min="0"
                step="0.5"
                :value="c.weight"
                @change="
                  updateFactor(c.id, { weight: Number(($event.target as HTMLInputElement).value) })
                "
              />
            </label>
            <button class="btn btn-ghost btn-sm" @click="delFactor(c.id)">删除</button>
          </div>
        </div>
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
        </div>
        <div class="factor-filter">
          <div class="segmented">
            <button v-for="c in cats" :key="c" :class="{ on: cat === c }" @click="cat = c">
              {{ c }}
            </button>
          </div>
          <span class="ch-legend">
            <span class="ch-tag"><i style="background: var(--text-2)" />IC/ICIR=中性</span>
            <span class="ch-tag"><i style="background: var(--pnl-up)" />分层收益=PnL</span>
            <span class="ch-tag"><i style="background: var(--accent)" />启用=Accent</span>
          </span>
        </div>
        <table class="dt">
          <thead>
            <tr>
              <th style="width: 150px">因子</th>
              <th>类别</th>
              <th class="num">IC 均值</th>
              <th class="num">ICIR</th>
              <th class="num">覆盖度</th>
              <th class="num">权重</th>
              <th class="en-th">启用</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="f in filteredFactors"
              :key="f.name"
              class="row"
              :class="{ sel: selected?.name === f.name }"
              @click="selectedName = f.name"
            >
              <td>
                <div class="f-cell">
                  <span class="f-label">{{ factorLabel(f.name) }}</span>
                  <span v-if="factorLabel(f.name) !== f.name" class="f-key mono">{{ f.name }}</span>
                </div>
              </td>
              <td>
                <span class="chip">{{ groupLabel(f.group) }}</span>
              </td>
              <td class="num">{{ ic(f.ic_mean) }}</td>
              <td class="num dim">{{ ic(f.icir) }}</td>
              <td class="num dim">{{ pct(f.coverage) }}</td>
              <td class="num">
                <div v-if="customByName[f.name]" class="wt-cell">
                  <span class="wt-v mono">{{ customByName[f.name].weight }}</span>
                  <div class="wt-bar">
                    <div class="wt-fill" :style="{ width: weightBar(f.name) + '%' }" />
                  </div>
                </div>
                <span v-else class="dim wt-eq">等权</span>
              </td>
              <td class="en-td" @click.stop>
                <label
                  v-if="customByName[f.name]"
                  class="cf-switch"
                  :title="customByName[f.name].enabled ? '已启用(点击禁用)' : '已禁用(点击启用)'"
                >
                  <input
                    type="checkbox"
                    :checked="customByName[f.name].enabled"
                    @change="
                      updateFactor(customByName[f.name].id, {
                        enabled: ($event.target as HTMLInputElement).checked,
                      })
                    "
                  />
                  <span class="cf-track"><span class="cf-knob" /></span>
                </label>
                <span v-else class="chip built-in">内置</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="card card-pad detail">
        <div class="detail-head">
          <h3 class="card-title">{{ selected ? factorLabel(selected.name) : '—' }}</h3>
          <span v-if="selected" class="chip">{{ groupLabel(selected.group) }}</span>
        </div>
        <template v-if="selected">
          <p v-if="factorDesc(selected)" class="factor-desc">{{ factorDesc(selected) }}</p>
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
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 14px;
}
.ch-tag {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: var(--fs-cap);
  color: var(--text-3);
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
.field-range {
  flex: 1 1 320px;
}
.field-range .input {
  min-width: 300px;
}
.field .field-label {
  margin-bottom: 6px;
}
.field .input {
  min-width: 150px;
}
/* narrow 字段的输入框不强制 150,否则撑破 130px 容器、溢出盖住「运行质检」按钮。 */
.field.narrow .input {
  min-width: 0;
  width: 100%;
}
.run-btn {
  height: 30px;
  flex: none;
  margin-left: auto;
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
.dsl-save {
  display: flex;
  gap: 10px;
  margin-top: 16px;
}
.dsl-name {
  max-width: 240px;
}
.dsl-saved {
  margin-top: 16px;
  padding-top: 14px;
  border-top: 0.5px solid var(--border-faint);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.dsl-saved-k {
  letter-spacing: 0;
  text-transform: none;
  margin-bottom: 2px;
}
.dsl-saved-row {
  display: flex;
  align-items: center;
  gap: 12px;
}
.dsl-saved-name {
  font-size: var(--fs-sub);
  color: var(--text-1);
  width: 110px;
  flex: none;
}
.dsl-saved-expr {
  flex: 1;
  font-size: 11.5px;
  color: var(--text-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsl-saved-row.row-off {
  opacity: 0.5;
}

/* 合成权重输入(中性,非盈亏色)*/
.cf-weight {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: none;
  font-size: var(--fs-cap);
  color: var(--text-3);
}
.cf-weight-in {
  width: 64px;
  text-align: right;
}

/* 启用开关(Status accent 通道:启用=accent)*/
.cf-switch {
  flex: none;
  display: inline-flex;
  cursor: pointer;
}
.cf-switch input {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
}
.cf-track {
  width: 30px;
  height: 17px;
  border-radius: 9px;
  background: var(--bg-base);
  border: 0.5px solid var(--border);
  display: inline-flex;
  align-items: center;
  padding: 1px;
  transition: background 0.15s var(--ease);
}
.cf-knob {
  width: 13px;
  height: 13px;
  border-radius: 50%;
  background: var(--text-3);
  transition:
    transform 0.15s var(--ease),
    background 0.15s var(--ease);
}
.cf-switch input:checked + .cf-track {
  background: var(--accent);
  border-color: transparent;
}
.cf-switch input:checked + .cf-track .cf-knob {
  transform: translateX(13px);
  background: #fff;
}

.cols {
  display: grid;
  grid-template-columns: minmax(0, 1.45fr) minmax(0, 1fr);
  gap: 20px;
  align-items: start;
}
.f-name {
  font-weight: 500;
  color: var(--text-1);
}
.f-cell {
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.f-label {
  font-weight: 500;
  color: var(--text-1);
}
.f-key {
  font-size: 10px;
  color: var(--text-3);
}
.factor-filter {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}
.factor-desc {
  font-size: 12.5px;
  color: var(--text-2);
  line-height: 1.6;
  margin: 0 0 16px;
}
.dim {
  color: var(--text-2);
}

/* 因子表「权重 / 启用」列 */
.en-th {
  width: 56px;
  text-align: center;
}
.wt-cell {
  display: flex;
  align-items: center;
  gap: 7px;
  justify-content: flex-end;
}
.wt-v {
  color: var(--text-1);
}
.wt-bar {
  width: 34px;
  height: 4px;
  background: var(--bg-input);
  border-radius: 2px;
  overflow: hidden;
  flex: none;
}
.wt-fill {
  height: 100%;
  background: var(--accent);
  opacity: 0.85;
}
.wt-eq {
  font-size: 11px;
  color: var(--text-3);
}
.en-td {
  text-align: center;
}
.en-td .cf-switch {
  vertical-align: middle;
}
.built-in {
  font-size: 10.5px;
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
