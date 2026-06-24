<script setup lang="ts">
import { computed, onMounted, watch } from 'vue';
import { useTradingStore } from '../../stores/trading';
import { actionLabel, blockNote, blockRule, factorEntries, reasonLabel } from '../../lib/signals';
import { useAppStore } from '../../stores/app';
import { fmtSigned } from '../../lib/format';
import PageHero from '../../ui/PageHero.vue';
import DatePicker from '../../ui/DatePicker.vue';
import Icon from '../../shell/Icon.vue';

const trading = useTradingStore();
const app = useAppStore();
// 信号日 / 生效日 / tab 留存于 store(切菜单不丢);v-model 经可写投影直接写 store。
const today = computed({
  get: () => trading.signalToday,
  set: (v: string) => (trading.signalToday = v),
});
const effective = computed({
  get: () => trading.signalEffective,
  set: (v: string) => (trading.signalEffective = v),
});
const tab = computed({
  get: () => trading.signalTab,
  set: (v: 'pass' | 'blocked') => (trading.signalTab = v),
});

// 小白友好:默认把「信号日」填成最新有数据的交易日,「生效日」自动跟随为下一交易日。
// 用户仍可手动改;值留 store,切菜单不丢。
function nextTradeDate(d: string): string {
  if (!d) return '';
  const dt = new Date(`${d}T00:00:00`);
  if (Number.isNaN(dt.getTime())) return '';
  do {
    dt.setDate(dt.getDate() + 1);
  } while (dt.getDay() === 0 || dt.getDay() === 6); // 跳过周末;节假日由后端数据缺失诚实处理
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return `${dt.getFullYear()}-${m}-${day}`;
}
function prefillDates() {
  const last = app.coverage?.last_date;
  if (last && !trading.signalToday) {
    trading.signalToday = last;
    if (!trading.signalEffective) trading.signalEffective = nextTradeDate(last);
  }
}
onMounted(() => {
  prefillDates();
  if (!app.coverage) void app.refreshCoverage().then(prefillDates);
});
// 信号日变更 → 生效日自动跟随下一交易日(改信号日后无需再手动算 T+1)。
watch(today, (d) => {
  if (d) trading.signalEffective = nextTradeDate(d);
});
// coverage 异步晚到时补填。
watch(
  () => app.coverage?.last_date,
  () => prefillDates(),
);

async function run() {
  if (!today.value || !effective.value) return;
  await trading.runPaper(today.value, effective.value);
}

function load() {
  if (today.value) trading.fetchSignals(today.value);
}

// 方向 → 徽章通道(系统色,Status 通道):买=ok 卖=warn 持有=idle。
// 与 actionClass(状态语义 class)解耦,仅供 .badge 着色;不占用盈亏色。
const DIR_BADGE: Record<string, string> = {
  buy: 'badge-ok',
  sell: 'badge-warn',
  hold: 'badge-idle',
};
function dirBadge(a: string): string {
  return DIR_BADGE[a] ?? 'badge-idle';
}

// 方向字形:买=▲ 卖=▼ 持有=—,颜色仍由 .badge-* 决定(Status 通道,不占盈亏色)。
const DIR_GLYPH: Record<string, string> = { buy: '▲', sell: '▼', hold: '—' };
function dirGlyph(a: string): string {
  return DIR_GLYPH[a] ?? '—';
}

// 综合分进度条宽度:score 为 0~1(与 .toFixed(3) 显示口径一致),换算成百分比并夹取 0~100。
function scorePct(score: number): string {
  return `${Math.max(0, Math.min(1, score)) * 100}%`;
}
</script>

<template>
  <PageHero
    title="信号"
    :sub="`基于多因子模型 · 盘后打分出信号 + 模拟撮合 · 纪律高于模型${trading.date ? ' · ' + trading.date : ''}`"
  >
    <template #right>
      <button
        class="btn btn-primary btn-sm"
        :disabled="!today || !effective || trading.loading"
        @click="run"
      >
        <Icon name="refresh" :size="14" /> {{ trading.loading ? '运行中…' : '盘后跑一轮' }}
      </button>
    </template>
  </PageHero>

  <div class="page-body">
    <!-- 运行工具条(卡内) -->
    <div class="card card-pad">
      <div class="runner">
        <label class="field">
          <span class="field-cap cap">信号日 T</span>
          <DatePicker v-model="today" placeholder="信号日 T" />
        </label>
        <label class="field">
          <span class="field-cap cap">生效日 T+1</span>
          <DatePicker v-model="effective" placeholder="生效日 T+1" />
        </label>
        <span class="spacer" />
        <button
          class="btn btn-primary"
          :disabled="!today || !effective || trading.loading"
          @click="run"
        >
          <Icon name="refresh" :size="14" />
          {{ trading.loading ? '运行中…' : '盘后跑一轮(出信号 + 模拟撮合)' }}
        </button>
        <button class="btn btn-secondary" :disabled="!today || trading.loading" @click="load">
          查看该日信号
        </button>
      </div>
      <p class="run-hint cap">
        信号日 = 最新有数据的交易日(已自动填);生效日 = 下一交易日,模拟盘按其开盘价撮合(T+1
        纪律)。可手动调整。
      </p>
      <p v-if="trading.error" class="run-err status-err">{{ trading.error }}</p>
    </div>

    <!-- 分段切换 + 通道图例 -->
    <div class="bar">
      <div class="segmented" role="tablist">
        <button role="tab" :aria-selected="tab === 'pass'" @click="tab = 'pass'">
          入选信号 · {{ trading.activeSignals.length }}
        </button>
        <button role="tab" :aria-selected="tab === 'blocked'" @click="tab = 'blocked'">
          被风控拦截 · {{ trading.blockedSignals.length }}
        </button>
      </div>
      <div class="legend">
        <span class="ch-tag"><i style="background: var(--status-ok)" />方向=Status</span>
        <span class="ch-tag"><i style="background: var(--text-2)" />综合分=中性</span>
        <span class="ch-tag"><i style="background: var(--pnl-up)" />因子贡献=PnL</span>
      </div>
    </div>

    <!-- 入选信号 -->
    <div v-if="tab === 'pass'" class="card">
      <table v-if="trading.activeSignals.length" class="dt">
        <thead>
          <tr>
            <th style="width: 150px">标的</th>
            <th style="width: 78px">方向</th>
            <th style="width: 120px">综合分</th>
            <th>因子贡献</th>
            <th>入选原因</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in trading.activeSignals" :key="s.stock_code">
            <td>
              <div class="sym">
                <span v-if="s.stock_name" class="sym-name">{{ s.stock_name }}</span>
                <span class="col-code">{{ s.stock_code }}</span>
              </div>
            </td>
            <td>
              <span class="badge" :class="dirBadge(s.action)">
                <span class="dir-glyph">{{ dirGlyph(s.action) }}</span
                >{{ actionLabel(s.action) }}
              </span>
            </td>
            <td>
              <div v-if="s.score != null" class="score">
                <span class="mono score-num">{{ s.score.toFixed(3) }}</span>
                <span class="score-track">
                  <span
                    class="score-fill"
                    :class="{ hi: s.score >= 0.7 }"
                    :style="{ width: scorePct(s.score) }"
                  />
                </span>
              </div>
              <span v-else class="cap dim">—</span>
            </td>
            <td>
              <div class="factors">
                <span
                  v-for="[f, v] in factorEntries(s.factor_breakdown).slice(0, 4)"
                  :key="f"
                  class="chip"
                >
                  {{ f }}
                  <span class="chip-val" :class="app.pnlClass(v)">{{ fmtSigned(v, 2) }}</span>
                </span>
                <span v-if="!factorEntries(s.factor_breakdown).length" class="cap dim">—</span>
              </div>
            </td>
            <td class="reason">{{ reasonLabel(s.reason) }}</td>
          </tr>
        </tbody>
      </table>
      <div v-else class="empty">
        <div class="empty-icon"><Icon name="signals" :size="20" /></div>
        <div class="empty-title">暂无生效信号</div>
        <div class="empty-desc">
          直接点上方「盘后跑一轮」就行 ——
          <b>无需先训练模型</b
          >,司南会用内置因子给股票打分选股;想进阶再去「模型」页训练自己的模型。产出当日买卖信号与被风控拦截组。
        </div>
      </div>
    </div>

    <!-- 被风控拦截组 -->
    <div v-else class="card">
      <template v-if="trading.blockedSignals.length">
        <div class="block-note">
          <span class="block-ico status-warn"><Icon name="shield" :size="15" /></span>
          <span class="block-txt"
            >以下标的初选入围,但被风控闸拦截,不进入交易候选 ——
            纪律高于模型。当前为打包默认风控基线(如大盘择时空仓、最多持仓 5
            只、单票集中度上限),<b>本版本暂不支持在界面里调整</b>,完整规则见<b>帮助</b>页。</span
          >
        </div>
        <table class="dt">
          <thead>
            <tr>
              <th style="width: 150px">标的</th>
              <th style="width: 78px">初选方向</th>
              <th style="width: 120px">综合分</th>
              <th style="width: 230px">拦截规则</th>
              <th>说明</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="s in trading.blockedSignals" :key="s.stock_code" class="blocked-row">
              <td>
                <div class="sym">
                  <span v-if="s.stock_name" class="sym-name struck">{{ s.stock_name }}</span>
                  <span class="col-code">{{ s.stock_code }}</span>
                </div>
              </td>
              <td>
                <span class="badge" :class="dirBadge(s.action)">
                  <span class="dir-glyph">{{ dirGlyph(s.action) }}</span
                  >{{ actionLabel(s.action) }}
                </span>
              </td>
              <td>
                <div v-if="s.score != null" class="score">
                  <span class="mono score-num">{{ s.score.toFixed(3) }}</span>
                  <span class="score-track">
                    <span
                      class="score-fill"
                      :class="{ hi: s.score >= 0.7 }"
                      :style="{ width: scorePct(s.score) }"
                    />
                  </span>
                </div>
                <span v-else class="cap dim">—</span>
              </td>
              <td>
                <span class="badge badge-warn"><span class="dot" />{{ blockRule(s.reason) }}</span>
              </td>
              <td class="reason">{{ blockNote(s.reason) }}</td>
            </tr>
          </tbody>
        </table>
      </template>
      <div v-else class="empty">
        <div class="empty-icon"><Icon name="shield" :size="20" /></div>
        <div class="empty-title">暂无被拦截的标的</div>
        <div class="empty-desc">初选入围但被风控闸拦下的标的会单独列在此处 —— 纪律高于模型。</div>
      </div>
    </div>

    <p class="disclaimer">
      仅供研究参考,非投资建议;模拟盘为纸面前向验证,不构成真实交易、不进行任何自动真实下单。
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

/* 运行工具条 */
.runner {
  display: flex;
  align-items: flex-end;
  gap: 14px;
  flex-wrap: wrap;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.field-cap {
  color: var(--text-2);
}
.field .input {
  width: 170px;
}
.spacer {
  flex: 1;
}
.run-err {
  margin: 14px 0 0;
  font-size: var(--fs-sub);
}
.run-hint {
  margin: 12px 0 0;
  color: var(--text-3);
}

/* 分段切换 + 图例 */
.bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.legend {
  display: flex;
  gap: 14px;
}
.ch-tag {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--text-3);
  font-family: var(--font-mono);
}
.ch-tag i {
  width: 7px;
  height: 7px;
  border-radius: 2px;
  flex: none;
}

/* 标的列:名称 + 代码 */
.sym {
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.sym-name {
  font-weight: 500;
  color: var(--text-1);
}
.sym-name.struck {
  text-decoration: line-through;
  text-decoration-color: var(--text-3);
}
.col-code {
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--text-3);
}

/* 方向字形:▲▼—,颜色继承 .badge-* */
.dir-glyph {
  font-size: 9px;
  line-height: 1;
}

/* 综合分:中性灰阶进度条 + mono 数值,不占任何颜色通道 */
.score {
  display: flex;
  align-items: center;
  gap: 9px;
}
.score-num {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-1);
}
.score-track {
  width: 56px;
  height: 5px;
  border-radius: 3px;
  background: var(--bg-input);
  overflow: hidden;
  flex: none;
}
.score-fill {
  display: block;
  height: 100%;
  border-radius: 3px;
  background: var(--text-3);
}
.score-fill.hi {
  background: var(--text-1);
}

/* 因子贡献 chips */
.factors {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.reason {
  color: var(--text-2);
  font-size: 12px;
  white-space: normal;
  max-width: 280px;
}
.dim {
  color: var(--text-3);
}

/* 拦截组 */
.block-note {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  border-bottom: 0.5px solid var(--border);
}
.block-ico {
  display: inline-flex;
  flex: none;
}
.block-txt {
  font-size: 12.5px;
  color: var(--text-2);
}
.block-txt b {
  color: var(--text-1);
  font-weight: 500;
}
.blocked-row {
  opacity: 0.92;
}

.disclaimer {
  margin: 4px 0 0;
  color: var(--text-3);
  font-size: var(--fs-cap);
}
</style>
