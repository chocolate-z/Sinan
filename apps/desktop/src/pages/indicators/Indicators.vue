<script setup lang="ts">
// 指标 · 因子库(v2)。内置因子(GET /factors)+ 自定义因子(/custom-factors)并到一张表:
// 类别 tab、IC/ICIR/覆盖(跑质检后填,没跑显示 —)、权重条、启用开关、选中详情(IC 时序 + 分层)。
// 启用/调权经 api 串进 run_eod / run_backtest —— 信号和回测里真生效,不是 UI 摆设。
// 红线#3:IC/ICIR/覆盖 中性通道;分层收益 PnL 通道;缺数据 coverage=0 / IC 显示 — 如实,绝不造假。
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
// 其余只读投影,动作转调 store。
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
const builtinList = computed(() => ind.builtinList);

const validateExpr = () => ind.validateExpr();
const saveFactor = () => ind.saveFactor();
const run = () => ind.run();

onMounted(() => {
  ind.loadFactors();
  ind.loadCustom();
});

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
  custom: '自定义',
};
function groupLabel(g: string) {
  return GROUP_LABEL[g] ?? g;
}

// 质检报告按因子名索引(报告里因子名是裸名 ep/bp/.../自定义名,与因子库命名一致)。
const reportByName = computed<Record<string, any>>(() => {
  const m: Record<string, any> = {};
  for (const f of report.value?.factors ?? []) m[f.name] = f;
  return m;
});

// 内置 + 自定义并成一张因子库表;IC/ICIR/覆盖从质检报告按名合并(没跑质检则空 → 显示 —)。
const libraryRows = computed<any[]>(() => {
  const rep = reportByName.value;
  const builtin = builtinList.value.map((f) => ({
    key: f.name,
    ref: f.name, // 内置因子用名做 PUT 主键
    label: f.label || f.name,
    category: f.category || groupLabel(f.group || ''),
    desc: f.desc || '',
    kind: 'builtin' as const,
    enabled: f.enabled !== false,
    weight: Number(f.weight ?? 1),
    rep: rep[f.name] ?? null,
  }));
  const custom = customList.value.map((c) => ({
    key: c.name,
    ref: c.id, // 自定义因子用 id 做 PUT/DELETE 主键
    label: c.name,
    category: groupLabel(c.group || 'custom'),
    desc: c.expr,
    kind: 'custom' as const,
    enabled: !!c.enabled,
    weight: Number(c.weight ?? 1),
    rep: rep[c.name] ?? null,
  }));
  return [...builtin, ...custom];
});

const totalCount = computed(() => libraryRows.value.length);
const enabledCount = computed(() => libraryRows.value.filter((r) => r.enabled).length);

// 类别过滤(段控件)。
const cat = ref('全部');
const cats = computed(() => ['全部', ...new Set(libraryRows.value.map((r) => r.category))]);
const filteredRows = computed(() =>
  cat.value === '全部'
    ? libraryRows.value
    : libraryRows.value.filter((r) => r.category === cat.value),
);

const selected = computed(
  () => libraryRows.value.find((r) => r.key === selectedName.value) ?? libraryRows.value[0] ?? null,
);

// 权重条:相对全表最大权重归一(诚实展示相对量级,非百分比)。
const maxWeight = computed(() => Math.max(1, ...libraryRows.value.map((r) => r.weight || 0)));
function weightBar(w: number): number {
  return Math.round((Math.max(0, w) / maxWeight.value) * 100);
}

// 启用/调权:内置走 /factors,自定义走 /custom-factors(同表统一入口);改完信号/回测里真生效。
function setEnabled(row: any, enabled: boolean) {
  if (row.kind === 'builtin') ind.updateBuiltin(row.ref, { enabled });
  else ind.updateFactor(row.ref, { enabled });
}
function setWeight(row: any, raw: string) {
  const weight = Number(raw);
  if (Number.isNaN(weight) || weight < 0) return;
  if (row.kind === 'builtin') ind.updateBuiltin(row.ref, { weight });
  else ind.updateFactor(row.ref, { weight });
}

// 删自定义因子(内置不可删):点一次进确认态,再点才真删,免误触。
const pendingDel = ref<string | null>(null);
function askDel(row: any) {
  pendingDel.value = pendingDel.value === row.ref ? null : row.ref;
}
function confirmDel(row: any) {
  ind.delFactor(row.ref);
  pendingDel.value = null;
  if (selectedName.value === row.key) selectedName.value = null;
}

function ic(v: number | null | undefined): string {
  return v == null ? '—' : (v >= 0 ? '' : '−') + Math.abs(v).toFixed(3);
}
function pct(v: number | null | undefined): string {
  return v == null ? '—' : (v * 100).toFixed(0) + '%';
}

// 「新建因子」滚动并聚焦到 DSL 编辑器。
function focusEditor() {
  const el = document.querySelector('.dsl-input') as HTMLElement | null;
  el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el?.focus();
}
</script>

<template>
  <PageHero
    title="指标 · 因子库"
    :sub="`多因子模型的原子构建块 · 共 ${totalCount} 个因子 · ${enabledCount} 个启用 · 启用与权重直接驱动信号 / 回测`"
  >
    <template #right>
      <button class="btn btn-primary btn-sm" @click="focusEditor">
        <Icon name="plus" :size="14" /> 新建因子
      </button>
    </template>
  </PageHero>

  <div class="page-body">
    <!-- 因子库:内置 + 自定义并表 + 详情(IC 来自质检,没跑显示 —)-->
    <div class="cols">
      <div class="card">
        <div class="card-head">
          <div>
            <h3 class="card-title">因子库</h3>
            <span class="card-sub">
              <template v-if="report">
                {{ report.start }} ~ {{ report.end }} · {{ report.n_dates }} 交易日 ·
                {{ report.n_codes }} 标的
              </template>
              <template v-else
                >内置 + 自定义因子统一管理 · 运行下方「因子质检」填入真实 IC / 分层</template
              >
            </span>
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
              <th class="num wt-th">权重</th>
              <th class="en-th">启用</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="r in filteredRows"
              :key="r.key"
              class="row"
              :class="{ sel: selected?.key === r.key, 'row-off': !r.enabled }"
              @click="selectedName = r.key"
            >
              <td>
                <div class="f-cell">
                  <span class="f-label">{{ r.label }}</span>
                  <span v-if="r.label !== r.key" class="f-key mono">{{ r.key }}</span>
                </div>
              </td>
              <td>
                <span class="chip">{{ r.category }}</span>
                <span v-if="r.kind === 'custom'" class="chip chip-custom">自定义</span>
              </td>
              <td class="num">{{ ic(r.rep?.ic_mean) }}</td>
              <td class="num dim">{{ ic(r.rep?.icir) }}</td>
              <td class="num dim">{{ pct(r.rep?.coverage) }}</td>
              <td class="num" @click.stop>
                <div class="wt-cell">
                  <input
                    class="input mono wt-in"
                    type="number"
                    min="0"
                    step="0.5"
                    :value="r.weight"
                    title="合成权重:1=等权,0=不参与,>1 放大该因子贡献"
                    @change="setWeight(r, ($event.target as HTMLInputElement).value)"
                  />
                  <div class="wt-bar">
                    <div
                      class="wt-fill"
                      :style="{ width: weightBar(r.weight) + '%', opacity: r.enabled ? 0.85 : 0.3 }"
                    />
                  </div>
                </div>
              </td>
              <td class="en-td" @click.stop>
                <label
                  class="cf-switch"
                  :title="r.enabled ? '已启用(点击禁用)' : '已禁用(点击启用)'"
                >
                  <input
                    type="checkbox"
                    :checked="r.enabled"
                    @change="setEnabled(r, ($event.target as HTMLInputElement).checked)"
                  />
                  <span class="cf-track"><span class="cf-knob" /></span>
                </label>
              </td>
            </tr>
          </tbody>
        </table>
        <p v-if="saveError" class="dsl-err lib-err">
          <Icon name="alert" :size="13" /> {{ saveError }}
        </p>
      </div>

      <!-- 因子详情 -->
      <div class="card card-pad detail">
        <template v-if="selected">
          <div class="detail-head">
            <h3 class="card-title">{{ selected.label }}</h3>
            <span class="chip">{{ selected.category }}</span>
            <span v-if="selected.kind === 'custom'" class="chip chip-custom">自定义</span>
          </div>
          <p v-if="selected.desc" class="factor-desc" :class="{ mono: selected.kind === 'custom' }">
            {{ selected.desc }}
          </p>
          <div class="mini-grid">
            <div class="mini">
              <div class="mini-k">IC 均值</div>
              <div class="mini-v mono">{{ ic(selected.rep?.ic_mean) }}</div>
            </div>
            <div class="mini">
              <div class="mini-k">ICIR</div>
              <div class="mini-v mono">{{ ic(selected.rep?.icir) }}</div>
            </div>
            <div class="mini">
              <div class="mini-k">覆盖度</div>
              <div class="mini-v mono">{{ pct(selected.rep?.coverage) }}</div>
            </div>
            <div class="mini">
              <div class="mini-k">IC 天数</div>
              <div class="mini-v mono">{{ selected.rep?.ic_series?.length ?? 0 }}</div>
            </div>
          </div>

          <template v-if="selected.rep && selected.rep.coverage > 0">
            <div class="cap detail-label">IC 时序(逐日 RankIC)</div>
            <div class="chart-box"><ICChart :values="selected.rep.ic_series" /></div>
            <div class="cap detail-label">十分位分层 · 平均前向收益</div>
            <div class="chart-box"><DecileBars :values="selected.rep.deciles" /></div>
          </template>
          <div v-else-if="report" class="empty mini-empty">
            <div class="empty-title">该因子无数据</div>
            <div class="empty-desc">
              当前数据源缺该因子所需字段(如免费源无北向),覆盖度 0,如实不补强。
            </div>
          </div>
          <div v-else class="empty mini-empty">
            <div class="empty-title">尚无 IC / 分层</div>
            <div class="empty-desc">
              运行下方「因子质检」即可在本地缓存上算该因子的真实样本外 IC 与分层。
            </div>
          </div>

          <!-- 自定义因子可删(内置不可删)-->
          <div v-if="selected.kind === 'custom'" class="detail-foot">
            <button
              v-if="pendingDel !== selected.ref"
              class="btn btn-ghost btn-sm"
              @click="askDel(selected)"
            >
              <Icon name="x" :size="13" /> 删除因子
            </button>
            <template v-else>
              <span class="del-confirm">确认删除「{{ selected.label }}」?</span>
              <button class="btn btn-ghost btn-sm" @click="pendingDel = null">取消</button>
              <button class="btn btn-danger btn-sm" @click="confirmDel(selected)">确认删除</button>
            </template>
          </div>
        </template>
        <div v-else class="empty mini-empty">
          <div class="empty-title">因子库为空</div>
          <div class="empty-desc">内置因子加载中,或新建一个自定义因子。</div>
        </div>
      </div>
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
        <!-- 保存为因子(校验通过后)→ 进上方因子库表,可调权/启用/删除 -->
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
        <p class="dsl-note cap">
          保存后的因子出现在上方因子库表;启用项(及权重)随每日选股与回测一同生效,口径一致。
        </p>
      </div>
    </div>

    <p class="disclaimer">
      IC / ICIR / 覆盖度属中性通道(因子研究指标,非盈亏色);十分位分层收益属 PnL
      通道。所有结果为真实样本外计算,不夸大、不补强。启用与权重经 api 串入信号 / 回测,真实生效。
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
.lib-err {
  margin: 12px 18px 4px;
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
.chip-custom {
  margin-left: 5px;
  color: var(--accent);
  border-color: color-mix(in srgb, var(--accent) 35%, transparent);
}
.factor-filter {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin: 0 0 12px;
  padding: 0 18px;
}
.factor-desc {
  font-size: 12.5px;
  color: var(--text-2);
  line-height: 1.6;
  margin: 0 0 16px;
}
.factor-desc.mono {
  font-size: 11.5px;
}
.dim {
  color: var(--text-2);
}
.row.row-off {
  opacity: 0.55;
}

/* 因子表「权重 / 启用」列 */
.wt-th {
  width: 116px;
}
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
.wt-in {
  width: 56px;
  text-align: right;
  padding: 4px 6px;
  height: 26px;
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
}
.en-td {
  text-align: center;
}
.en-td .cf-switch {
  vertical-align: middle;
}

.detail-head {
  display: flex;
  align-items: center;
  gap: 8px;
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
.detail-foot {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 18px;
  padding-top: 14px;
  border-top: 0.5px solid var(--border-faint);
}
.del-confirm {
  font-size: var(--fs-sub);
  color: var(--text-2);
  margin-right: auto;
}
.btn-danger {
  background: var(--status-err-bg);
  color: var(--status-err);
  border: 0.5px solid color-mix(in srgb, var(--status-err) 35%, transparent);
}
.btn-danger:hover {
  background: color-mix(in srgb, var(--status-err) 18%, transparent);
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
