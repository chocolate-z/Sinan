<script setup lang="ts">
// 策略 / 模型(M3 接真实)。训练 walk-forward ElasticNet → 模型版本库 → 激活。
// 红线#3:样本内外 IC 并列;夏普/年化为分层口径(layered_,随 metrics_note 诚实标注);IC/ICIR 中性通道。
// 流水线为真实系统架构;股票池/风控/成本为打包默认基线(config.defaults.json 真值)。
import { computed, onMounted, ref } from 'vue';
import { useModelsStore } from '../../stores/models';
import { useAppStore } from '../../stores/app';
import { fmt, fmtPct } from '../../lib/format';
import PageHero from '../../ui/PageHero.vue';
import RangePicker from '../../ui/RangePicker.vue';
import RunningBar from '../../ui/RunningBar.vue';
import StockSearch from '../../ui/StockSearch.vue';
import Icon from '../../shell/Icon.vue';
import { useRouter } from 'vue-router';

const app = useAppStore();
const ms = useModelsStore();
const router = useRouter();
// 表单=store 同一 reactive 引用(v-model 直接写 store);showForm 可写投影;其余只读投影。
const form = ms.form;
const showForm = computed({ get: () => ms.showForm, set: (v: boolean) => (ms.showForm = v) });
const models = computed(() => ms.models);
const selectedId = computed(() => ms.selectedId);
const detail = computed(() => ms.detail);
const training = computed(() => ms.training);
const error = computed(() => ms.error);

const selectModel = (id: string) => ms.selectModel(id);
const train = () => ms.train();
const activate = (id: string, ev: Event) => ms.activate(id, ev);

// 股票池篮子:StockSearch 选中即加入(默认空=全 A);缩小股票池可大幅加速训练。
const stockSearch = ref<{ reset: () => void } | null>(null);
function addCode(s: { code: string; name: string }) {
  if (!form.codes.includes(s.code)) {
    form.codes.push(s.code);
    form.codeNames[s.code] = s.name;
  }
  stockSearch.value?.reset();
}
function removeCode(code: string) {
  form.codes = form.codes.filter((c) => c !== code);
  delete form.codeNames[code];
}
// 并行核数:null=自动(engine min(核-1,4));select 走字符串投影。
const WORKER_OPTS = ['auto', '1', '2', '4', '8'];
const workersModel = computed({
  get: () => (form.feature_workers == null ? 'auto' : String(form.feature_workers)),
  set: (v: string) => (form.feature_workers = v === 'auto' ? null : Number(v)),
});

const STATUS: Record<string, { kind: string; label: string }> = {
  running: { kind: 'ok', label: '运行中' },
  draft: { kind: 'warn', label: '草稿 · 待验证' },
  archived: { kind: 'idle', label: '已归档' },
};
function st(s: string) {
  return STATUS[s] ?? { kind: 'idle', label: s };
}
function ic(v: number | null | undefined): string {
  return v == null ? '—' : (v >= 0 ? '' : '−') + Math.abs(v).toFixed(3);
}
// 上线日期:从真实 created_at(epoch ms 或 ISO)取 YYYY-MM-DD;缺失诚实空。
function since(v: number | string | null | undefined): string {
  if (v == null) return '';
  const d = new Date(typeof v === 'number' ? v : v);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

onMounted(() => ms.fetchModels());

// —— 真实系统架构 / 打包默认基线(config.defaults.json)——
const PIPELINE: { icon: string; k: string; d: string }[] = [
  { icon: 'db', k: '数据落库', d: 'PIT 取数 · 防未来函数' },
  { icon: 'indicator', k: '因子计算', d: '横截面标准化 · 中性化' },
  { icon: 'signals', k: '合成打分', d: 'ElasticNet / ICIR 加权' },
  { icon: 'shield', k: '风控过滤', d: '阈值 / 流动性 / 择时' },
  { icon: 'portfolio', k: '组合构建', d: 'Top-N 等权 · T+1' },
];
const POOL_RULES = [
  { k: '持仓数量', v: 'Top 5 · 等权' },
  { k: '单票上限', v: '20%' },
  { k: '买入阈值', v: '综合分 ≥ 0.65' },
  { k: '卖出阈值', v: '综合分 ≤ 0.35' },
  { k: '最短持有', v: '10 交易日' },
  { k: '卖出冷却', v: '5 交易日' },
  { k: '流动性过滤', v: '60 日均额 ≥ 2 亿' },
  { k: '大盘择时', v: 'MA20 之上' },
  { k: '信号滞后', v: '1 日(防未来函数)' },
];
const RISK_RULES = [
  { k: '个股止损', v: '−12%' },
  { k: '个股止盈', v: '+30%' },
  { k: '组合止损', v: '−12%' },
];
const BT_RULES = [
  { k: 'Purge(切分隔离)', v: '5 交易日' },
  { k: 'Embargo(切分禁区)', v: '6 交易日' },
  { k: '印花税(仅卖出)', v: '0.05%' },
  { k: '佣金', v: '万 2.5 · 最低 5 元' },
  { k: '冲击 / 滑点', v: '5 bps' },
];
</script>

<template>
  <PageHero
    title="策略 · 模型"
    sub="多因子选股模型的训练、样本外评估与纪律化风控 · 默认基线随模型可调"
  >
    <template #right>
      <button class="btn btn-secondary btn-sm" @click="router.push('/backtest')">
        <Icon name="refresh" :size="14" /> 样本外回测
      </button>
      <button class="btn btn-primary btn-sm" @click="showForm = !showForm">
        <Icon name="plus" :size="14" /> 训练新模型
      </button>
    </template>
  </PageHero>

  <div class="page-body">
    <!-- 训练表单 -->
    <div v-if="showForm" class="card">
      <div class="card-head">
        <div>
          <h3 class="card-title">训练新模型</h3>
          <span class="card-sub"
            >walk-forward 滚动训练 ElasticNet · 硬守卫 purge ≥ label_horizon(防未来函数)</span
          >
        </div>
      </div>
      <div class="card-pad">
        <div class="form-grid">
          <div class="field" style="grid-column: span 2">
            <label class="field-label">训练区间</label>
            <RangePicker
              :model-value="[form.train_start, form.train_end]"
              placeholder-start="训练起"
              placeholder-end="训练止"
              @update:model-value="
                (v) => {
                  form.train_start = v[0];
                  form.train_end = v[1];
                }
              "
            />
          </div>
          <div class="field">
            <label class="field-label">标签前向(交易日)</label>
            <input v-model.number="form.label_horizon" class="input mono" type="number" min="1" />
          </div>
          <div class="field">
            <label class="field-label">Purge(≥前向)</label>
            <input v-model.number="form.purge" class="input mono" type="number" min="1" />
          </div>
          <div class="field">
            <label class="field-label">训练窗(交易日)</label>
            <input v-model.number="form.train_span" class="input mono" type="number" min="20" />
          </div>
          <div class="field">
            <label class="field-label">测试窗(交易日)</label>
            <input v-model.number="form.test_span" class="input mono" type="number" min="5" />
          </div>
          <div class="field">
            <label class="field-label">
              并行核数
              <span class="lyr">利用多核</span>
            </label>
            <select v-model="workersModel" class="input mono">
              <option v-for="w in WORKER_OPTS" :key="w" :value="w">
                {{ w === 'auto' ? '自动(≤4 核)' : w === '1' ? '1(串行)' : `${w} 核` }}
              </option>
            </select>
          </div>
          <!-- 股票池:默认全 A;指定篮子可大幅加速(训练量随股票数线性下降) -->
          <div class="field" style="grid-column: span 3">
            <label class="field-label">
              股票池
              <span class="lyr">{{
                form.codes.length ? `指定 ${form.codes.length} 只` : '全 A 股'
              }}</span>
            </label>
            <StockSearch
              ref="stockSearch"
              placeholder="搜索代码/名称加入股票池(留空=全 A);缩小可大幅加速"
              @select="addCode"
            />
            <div v-if="form.codes.length" class="pool-chips">
              <span v-for="c in form.codes" :key="c" class="pool-chip">
                <span class="pc-name">{{ form.codeNames[c] || c }}</span>
                <span class="pc-code mono">{{ c }}</span>
                <button class="pc-x" title="移除" @click="removeCode(c)">
                  <Icon name="x" :size="11" />
                </button>
              </span>
              <button class="pool-clear" @click="form.codes = []">清空</button>
            </div>
            <p class="form-hint pool-hint">
              留空 = 全 A 股(最慢)。指定股票池后训练量随股票数线性下降 —— 是单项最大的提速杠杆。
            </p>
          </div>
        </div>
        <div class="form-actions">
          <button
            class="btn btn-primary"
            :disabled="training || !form.train_start || !form.train_end"
            @click="train"
          >
            {{ training ? '训练中…' : '开始训练' }}
          </button>
          <span class="form-hint">数据来自本地缓存;无缓存请先到引导向导建立。</span>
        </div>
        <p v-if="error" class="msg-err"><Icon name="alert" :size="14" /> {{ error }}</p>
        <RunningBar
          :active="training"
          :since="ms.startedAt"
          :progress="ms.progress"
          label="训练中 · walk-forward 逐折"
        />
      </div>
    </div>

    <!-- 模型版本 -->
    <section>
      <div class="sec-row">
        <div class="sec-label">模型版本</div>
        <span class="ch-tag"><i style="background: var(--text-2)" />IC / ICIR = 中性通道</span>
      </div>
      <div v-if="models.length" class="model-grid">
        <button
          v-for="m in models"
          :key="m.id"
          class="model-card"
          :class="{ sel: selectedId === m.id }"
          @click="selectModel(m.id)"
        >
          <div class="mc-top">
            <span class="mc-name">{{ m.name || m.model_type }}</span>
            <span class="badge" :class="`badge-${st(m.status).kind}`"
              ><span class="dot" />{{ st(m.status).label }}</span
            >
          </div>
          <div class="mc-metrics">
            <div class="mc-kv">
              <div class="mc-k">样本外 IC</div>
              <div class="mc-v mono">{{ ic(m.ic_oos) }}</div>
            </div>
            <div class="mc-kv">
              <div class="mc-k">ICIR</div>
              <div class="mc-v mono">{{ ic(m.icir_oos) }}</div>
            </div>
            <div class="mc-kv">
              <div class="mc-k">夏普<span class="lyr">分层</span></div>
              <div class="mc-v mono">{{ m.layered_sharpe_oos?.toFixed(2) ?? '—' }}</div>
            </div>
            <div class="mc-kv">
              <div class="mc-k">年化<span class="lyr">分层</span></div>
              <div
                class="mc-v mono"
                :class="
                  m.layered_annual_return_oos != null
                    ? app.pnlClass(m.layered_annual_return_oos)
                    : ''
                "
              >
                {{
                  m.layered_annual_return_oos != null
                    ? fmtPct(m.layered_annual_return_oos * 100)
                    : '—'
                }}
              </div>
            </div>
          </div>
          <div class="mc-foot">
            <span class="mc-note">
              <span class="mc-range mono">{{ m.train_start }} ~ {{ m.train_end }}</span>
              <template v-if="since(m.created_at)">
                · 上线 <span class="mono">{{ since(m.created_at) }}</span>
              </template>
            </span>
            <span v-if="m.oos_clean" class="badge badge-ok mc-honest"
              ><span class="dot" />诚实样本外</span
            >
          </div>
          <div class="mc-actions">
            <span v-if="m.status === 'running'" class="mc-active mono">
              <Icon name="check" :size="12" /> 当前运行
            </span>
            <span v-else class="btn btn-secondary btn-sm" @click="activate(m.id, $event)"
              >激活</span
            >
          </div>
        </button>
      </div>
      <div v-else class="card">
        <div class="card-pad">
          <div class="empty">
            <div class="empty-icon"><Icon name="model" :size="20" /></div>
            <div class="empty-title">尚无已训练模型</div>
            <div class="empty-desc">
              点击右上「训练新模型」,在本地缓存上做一次诚实样本外 walk-forward 训练(ElasticNet),
              产出样本内外 IC、ICIR 与因子权重。
            </div>
            <button class="btn btn-primary btn-sm" @click="showForm = true">训练新模型 →</button>
          </div>
        </div>
      </div>
    </section>

    <!-- 模型详情 -->
    <div v-if="detail" class="card">
      <div class="card-head">
        <div>
          <h3 class="card-title">模型详情 · {{ detail.name || detail.model_type }}</h3>
          <span class="card-sub"
            >{{ detail.model_type }} · {{ detail.n_folds }} 折 · {{ fmt(detail.n_samples, 0) }} 样本
            · label_horizon {{ detail.label_horizon }} / purge {{ detail.purge }}</span
          >
        </div>
        <span class="badge" :class="`badge-${st(detail.status).kind}`"
          ><span class="dot" />{{ st(detail.status).label }}</span
        >
      </div>
      <div class="card-pad detail-body">
        <!-- 样本内外 IC 并列(红线#3)-->
        <div class="metric-row">
          <div class="metric-box">
            <div class="mb-k">IC 均值 · 内 / 外</div>
            <div class="mb-v mono">{{ ic(detail.ic_is) }} / {{ ic(detail.ic_oos) }}</div>
          </div>
          <div class="metric-box">
            <div class="mb-k">ICIR · 内 / 外</div>
            <div class="mb-v mono">{{ ic(detail.icir_is) }} / {{ ic(detail.icir_oos) }}</div>
          </div>
          <div class="metric-box">
            <div class="mb-k">夏普 <span class="lyr">分层</span></div>
            <div class="mb-v mono">{{ detail.layered_sharpe_oos?.toFixed(2) ?? '—' }}</div>
          </div>
          <div class="metric-box">
            <div class="mb-k">年化 <span class="lyr">分层</span></div>
            <div
              class="mb-v mono"
              :class="
                detail.layered_annual_return_oos != null
                  ? app.pnlClass(detail.layered_annual_return_oos)
                  : ''
              "
            >
              {{
                detail.layered_annual_return_oos != null
                  ? fmtPct(detail.layered_annual_return_oos * 100)
                  : '—'
              }}
            </div>
          </div>
        </div>

        <!-- 诚实口径标注(随数据走)-->
        <div v-if="detail.metrics_note" class="note-bar">
          <Icon name="shield" :size="14" /> <span>{{ detail.metrics_note }}</span>
        </div>

        <div class="detail-cols">
          <!-- 因子重要度 -->
          <div>
            <div class="cap sub-label">因子重要度 · |系数| 归一</div>
            <div v-if="detail.feature_importance?.length" class="fi-list">
              <div v-for="f in detail.feature_importance" :key="f.feature" class="fi-row">
                <span class="fi-name mono">{{ f.feature }}</span>
                <div class="fi-bar">
                  <div class="fi-fill" :style="{ width: Math.round(f.weight * 100) + '%' }" />
                </div>
                <span class="fi-w mono">{{ (f.weight * 100).toFixed(0) }}%</span>
              </div>
            </div>
            <p v-else class="dim">无</p>
            <p v-if="detail.degraded?.length" class="degraded">
              <span v-for="d in detail.degraded" :key="d" class="chip">{{ d }}</span>
            </p>
          </div>

          <!-- 逐折样本外 IC -->
          <div>
            <div class="cap sub-label">逐折样本外 IC</div>
            <div class="tbl-wrap">
              <table class="dt dt-compact">
                <thead>
                  <tr>
                    <th>折</th>
                    <th class="num">训练样本</th>
                    <th class="num">测试样本</th>
                    <th class="num">样本外 IC</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="f in detail.fold_metrics" :key="f.index">
                    <td class="col-code">#{{ f.index }}</td>
                    <td class="num dim">{{ fmt(f.n_train, 0) }}</td>
                    <td class="num dim">{{ fmt(f.n_test, 0) }}</td>
                    <td class="num">{{ ic(f.ic_oos) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 模型流水线(真实系统架构) -->
    <div class="card card-pad">
      <div class="pl-head">
        <h3 class="card-title">模型流水线</h3>
        <span class="card-sub">每个交易日收盘后自动执行</span>
      </div>
      <div class="pipeline">
        <template v-for="(s, i) in PIPELINE" :key="s.k">
          <div class="pl-step">
            <div class="pl-ic"><Icon :name="s.icon" :size="18" /></div>
            <div class="pl-k">{{ s.k }}</div>
            <div class="pl-d">{{ s.d }}</div>
          </div>
          <div v-if="i < PIPELINE.length - 1" class="pl-arrow">
            <Icon name="chevR" :size="16" />
          </div>
        </template>
      </div>
    </div>

    <!-- 规则 / 风控 / 口径(真实默认基线) -->
    <div class="cols">
      <div class="card">
        <div class="card-head">
          <div>
            <h3 class="card-title">股票池与规则</h3>
            <span class="card-sub">纪律化选股约束</span>
          </div>
        </div>
        <div class="rules">
          <div v-for="r in POOL_RULES" :key="r.k" class="rule">
            <span class="rule-k">{{ r.k }}</span>
            <span class="rule-v mono">{{ r.v }}</span>
          </div>
        </div>
      </div>
      <div class="right-col">
        <div class="card">
          <div class="card-head">
            <div>
              <h3 class="card-title">风控约束</h3>
              <span class="card-sub">组合级 · 与回测一致</span>
            </div>
            <span class="badge badge-ok"><span class="dot" />已启用</span>
          </div>
          <div class="rules">
            <div v-for="r in RISK_RULES" :key="r.k" class="rule">
              <span class="rule-k">{{ r.k }}</span>
              <span class="rule-v mono">{{ r.v }}</span>
            </div>
          </div>
        </div>
        <div class="card">
          <div class="card-head">
            <div>
              <h3 class="card-title">回测口径与成本</h3>
              <span class="card-sub">诚实样本外 · 含成本</span>
            </div>
          </div>
          <div class="rules">
            <div v-for="r in BT_RULES" :key="r.k" class="rule">
              <span class="rule-k">{{ r.k }}</span>
              <span class="rule-v mono">{{ r.v }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <p class="disclaimer">
      模型与评估一律样本外口径,样本内外并列、低 IC
      如实(红线#3);夏普/年化为顶分位分层口径,非完整回测,勿读作策略真实收益。默认基线单一真相源:config.defaults.json。不构成投资建议。
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
.sec-row {
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
.lyr {
  margin-left: 5px;
  font-size: 9px;
  color: var(--text-3);
  border: 0.5px solid var(--border);
  border-radius: 3px;
  padding: 0 3px;
  font-family: var(--font-sans);
  letter-spacing: 0;
}

/* 训练表单 */
.form-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px 16px;
}
.field {
  display: flex;
  flex-direction: column;
}
.field .field-label {
  margin-bottom: 6px;
}
.form-actions {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-top: 16px;
}
.form-hint {
  font-size: var(--fs-cap);
  color: var(--text-3);
}

/* 股票池篮子 */
.pool-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  margin-top: 10px;
}
.pool-chip {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 4px 6px 4px 10px;
  border-radius: var(--r-sm);
  background: var(--bg-panel-2);
  border: 0.5px solid var(--border);
}
.pc-name {
  font-size: 12px;
  color: var(--text-1);
}
.pc-code {
  font-size: 10.5px;
  color: var(--text-3);
}
.pc-x {
  display: grid;
  place-items: center;
  width: 16px;
  height: 16px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--text-3);
  cursor: pointer;
  transition:
    background var(--t-fast),
    color var(--t-fast);
}
.pc-x:hover {
  background: var(--status-err-bg);
  color: var(--status-err);
}
.pool-clear {
  border: none;
  background: transparent;
  color: var(--text-3);
  font-size: 11.5px;
  cursor: pointer;
  padding: 0 6px;
}
.pool-clear:hover {
  color: var(--accent);
}
.pool-hint {
  margin: 8px 0 0;
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

/* 模型版本卡 */
.model-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 16px;
}
.model-card {
  text-align: left;
  cursor: pointer;
  padding: 18px;
  border-radius: var(--r-lg);
  background: var(--glass-card);
  -webkit-backdrop-filter: var(--glass-blur);
  backdrop-filter: var(--glass-blur);
  border: 0.5px solid var(--border);
  box-shadow: var(--hi-edge), var(--shadow-card);
  display: flex;
  flex-direction: column;
  gap: 12px;
  transition:
    border-color var(--t-fast),
    box-shadow var(--t-fast);
}
.model-card.sel {
  border-color: var(--accent);
  box-shadow: var(--accent-glow);
}
.mc-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.mc-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-1);
}
.mc-metrics {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 18px;
}
.mc-k {
  font-size: 10.5px;
  color: var(--text-3);
  margin-bottom: 3px;
  display: flex;
  align-items: center;
}
.mc-v {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-1);
}
.mc-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.mc-note {
  font-size: 11px;
  color: var(--text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mc-range {
  font-size: 11px;
  color: var(--text-3);
}
.mc-honest {
  height: 18px;
  font-size: 10px;
}
.mc-actions {
  display: flex;
  justify-content: flex-end;
}
.mc-active {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: var(--fs-cap);
  color: var(--status-ok);
}

/* 详情 */
.detail-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.metric-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
}
.metric-box {
  background: var(--bg-panel-2);
  border-radius: var(--r-sm);
  padding: 11px 13px;
}
.mb-k {
  font-size: 10.5px;
  color: var(--text-3);
  margin-bottom: 5px;
  display: flex;
  align-items: center;
}
.mb-v {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-1);
}
.note-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 13px;
  border-radius: var(--r-md);
  background: var(--status-ok-bg);
  border: 0.5px solid color-mix(in srgb, var(--status-ok) 28%, transparent);
  font-size: var(--fs-sub);
  color: var(--text-2);
}
.note-bar svg {
  color: var(--status-ok);
  flex: none;
}
.detail-cols {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 24px;
  align-items: start;
}
.sub-label {
  margin-bottom: 10px;
}
.fi-list {
  display: flex;
  flex-direction: column;
  gap: 9px;
}
.fi-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.fi-name {
  font-size: var(--fs-sub);
  color: var(--text-1);
  width: 96px;
  flex: none;
}
.fi-bar {
  flex: 1;
  height: 7px;
  border-radius: 4px;
  background: var(--bg-input);
  overflow: hidden;
}
.fi-fill {
  height: 100%;
  border-radius: 4px;
  background: var(--accent-grad);
}
.fi-w {
  font-size: var(--fs-sub);
  color: var(--text-2);
  width: 36px;
  text-align: right;
}
.degraded {
  margin: 12px 0 0;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.tbl-wrap {
  max-height: 240px;
  overflow: auto;
}
.dim {
  color: var(--text-2);
}

/* 流水线 */
.pl-head {
  margin-bottom: 18px;
}
.pipeline {
  display: flex;
  align-items: stretch;
}
.pl-step {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 10px;
  padding: 4px 8px;
}
.pl-ic {
  width: 40px;
  height: 40px;
  border-radius: var(--r-md);
  display: grid;
  place-items: center;
  background: var(--accent-bg);
  color: var(--accent);
  border: 0.5px solid var(--border);
}
.pl-k {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text-1);
}
.pl-d {
  font-size: 10.5px;
  color: var(--text-3);
  line-height: 1.45;
}
.pl-arrow {
  display: flex;
  align-items: flex-start;
  padding-top: 14px;
  color: var(--text-3);
  flex: none;
}

/* 规则 */
.cols {
  display: grid;
  grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr);
  gap: 20px;
  align-items: start;
}
.right-col {
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.rules {
  padding: 4px 22px 14px;
}
.rule {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 4px;
  border-bottom: 0.5px solid var(--border-faint);
}
.rule:last-child {
  border-bottom: none;
}
.rule-k {
  font-size: 12.5px;
  color: var(--text-2);
}
.rule-v {
  font-size: 12.5px;
  color: var(--text-1);
  text-align: right;
}

.disclaimer {
  margin: 4px 0 0;
  color: var(--text-3);
  font-size: var(--fs-cap);
  line-height: 1.6;
}

@media (max-width: 1080px) {
  .cols,
  .detail-cols,
  .metric-row {
    grid-template-columns: 1fr;
  }
  .form-grid {
    grid-template-columns: 1fr 1fr;
  }
}
</style>
