<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useTradingStore } from '../../stores/trading';
import { useAppStore } from '../../stores/app';
import { formatPnl } from '../../lib/pnl';
import { fmt, fmtInt, fmtPct } from '../../lib/format';
import PageHero from '../../ui/PageHero.vue';
import Icon from '../../shell/Icon.vue';

const trading = useTradingStore();
const app = useAppStore();
const tab = ref<'personal' | 'model'>('personal');

const form = reactive({ stock_code: '', stock_name: '', shares: 0, avg_cost: 0 });

async function addPersonal() {
  if (!form.stock_code || !form.shares || !form.avg_cost) return;
  await trading.addPersonal({ ...form });
  form.stock_code = '';
  form.stock_name = '';
  form.shares = 0;
  form.avg_cost = 0;
}

onMounted(() => {
  trading.fetchPersonal();
  trading.fetchModel();
  trading.fetchLivePnl();
});

// ---- 真实数据派生(不改数据来源,仅由真实持仓/盈亏聚合)----
const holdings = computed(() =>
  tab.value === 'personal' ? trading.personalHoldings : trading.modelHoldings,
);
const pnlLatest = computed(() =>
  tab.value === 'personal' ? trading.personalPnlLatest : trading.modelPnlLatest,
);
const live = computed(() => (tab.value === 'personal' ? trading.livePersonal : trading.liveModel));

// 持仓市值合计:有真实 market_value 才计入,否则为 null(诚实)
const totalMkt = computed<number | null>(() => {
  const hs = holdings.value;
  if (!hs.length) return null;
  if (hs.some((h) => h.market_value == null)) return null;
  return hs.reduce((s, h) => s + (h.market_value ?? 0), 0);
});
// 累计浮动盈亏合计:同上,缺一即不汇总
const totalFloat = computed<number | null>(() => {
  const hs = holdings.value;
  if (!hs.length) return null;
  if (hs.some((h) => h.float_pnl == null)) return null;
  return hs.reduce((s, h) => s + (h.float_pnl ?? 0), 0);
});
// 累计成本(用于盈亏比例):仅在数据齐全时
const totalCost = computed<number | null>(() => {
  const hs = holdings.value;
  if (!hs.length) return null;
  if (hs.some((h) => h.avg_cost == null)) return null;
  return hs.reduce((s, h) => s + h.avg_cost * h.shares, 0);
});
const totalFloatPct = computed<number | null>(() =>
  totalFloat.value != null && totalCost.value ? (totalFloat.value / totalCost.value) * 100 : null,
);

// 总资产:盈亏快照里的 total_assets(真实);可用现金 = 总资产 − 持仓市值(均真实才算)
const totalAssets = computed<number | null>(() => pnlLatest.value?.total_assets ?? null);
const cash = computed<number | null>(() =>
  totalAssets.value != null && totalMkt.value != null ? totalAssets.value - totalMkt.value : null,
);
// 仓位
const positionPct = computed<number | null>(() =>
  totalMkt.value != null && totalAssets.value ? (totalMkt.value / totalAssets.value) * 100 : null,
);

// 今日盈亏:优先实时源,否则盈亏快照
const dayPnl = computed<number | null>(
  () => live.value?.day_pnl ?? pnlLatest.value?.day_pnl ?? null,
);
const dayPnlPct = computed<number | null>(() => pnlLatest.value?.day_pnl_pct ?? null);

function floatPctOf(h: {
  float_pnl?: number | null;
  avg_cost: number;
  shares: number;
}): number | null {
  const cost = h.avg_cost * h.shares;
  return h.float_pnl != null && cost ? (h.float_pnl / cost) * 100 : null;
}
function weightOf(h: { market_value?: number | null }): number | null {
  return h.market_value != null && totalMkt.value ? (h.market_value / totalMkt.value) * 100 : null;
}
</script>

<template>
  <PageHero title="持仓" sub="持仓与账本 · 收盘价估值 · 个人/模型两套独立账本">
    <template #right>
      <div class="segmented">
        <button :class="{ on: tab === 'model' }" @click="tab = 'model'">模型模拟盘</button>
        <button :class="{ on: tab === 'personal' }" @click="tab = 'personal'">个人持仓</button>
      </div>
    </template>
  </PageHero>

  <div class="page-body">
    <!-- 账本汇总 -->
    <div class="summary-grid">
      <div class="card card-pad sm">
        <span class="cap">总资产</span>
        <span class="sm-val mono">{{
          totalAssets == null ? '—' : '¥' + fmtInt(Math.round(totalAssets))
        }}</span>
        <span class="sm-sub">{{ tab === 'model' ? '模拟盘净值' : '含可用现金' }}</span>
      </div>

      <div class="card card-pad sm">
        <span class="cap">持仓市值</span>
        <span class="sm-val mono">{{
          totalMkt == null ? '—' : '¥' + fmtInt(Math.round(totalMkt))
        }}</span>
        <span class="sm-sub">
          {{ holdings.length }} 只<template v-if="positionPct != null">
            · 仓位 {{ positionPct.toFixed(1) }}%</template
          >
        </span>
      </div>

      <div class="card card-pad sm">
        <span class="cap">可用现金</span>
        <span class="sm-val mono">{{ cash == null ? '—' : '¥' + fmtInt(Math.round(cash)) }}</span>
        <span class="sm-sub">{{ cash == null ? '需账本快照' : 'T+1 可用' }}</span>
      </div>

      <div class="card card-pad sm">
        <span class="cap">今日实时盈亏<span class="live-dot" /></span>
        <span class="sm-val mono" :class="dayPnl != null ? app.pnlClass(dayPnl) : ''">
          {{ dayPnl == null ? '—' : '¥' + formatPnl(dayPnl) }}
        </span>
        <span class="sm-sub mono" :class="dayPnlPct != null ? app.pnlClass(dayPnlPct) : ''">
          {{
            dayPnlPct == null ? (live?.degraded ? '部分缺价' : '实时待计') : fmtPct(dayPnlPct * 100)
          }}
        </span>
      </div>

      <div class="card card-pad sm">
        <span class="cap">累计浮动盈亏</span>
        <span class="sm-val mono" :class="totalFloat != null ? app.pnlClass(totalFloat) : ''">
          {{ totalFloat == null ? '—' : '¥' + formatPnl(totalFloat) }}
        </span>
        <span class="sm-sub mono" :class="totalFloatPct != null ? app.pnlClass(totalFloatPct) : ''">
          {{ totalFloatPct == null ? '需现价估值' : fmtPct(totalFloatPct) }}
        </span>
      </div>
    </div>

    <!-- 持仓明细 -->
    <div class="card">
      <div class="card-head">
        <div>
          <h3 class="card-title">
            {{ tab === 'model' ? '模型模拟盘 · 持仓明细' : '个人持仓 · 明细' }}
          </h3>
          <span class="card-sub">
            {{
              tab === 'model'
                ? '由策略自动调仓 · 纸面前向验证,不下达真实委托'
                : '手动录入,数据仅存本机,不会自动下单'
            }}
          </span>
        </div>
        <div class="ch-right">
          <span class="ch-tag"><i style="background: var(--pnl-up)" />浮盈=PnL</span>
          <button
            v-if="tab === 'model'"
            class="btn btn-ghost btn-sm"
            @click="
              trading.fetchModel();
              trading.fetchLivePnl();
            "
          >
            <Icon name="refresh" :size="14" /> 刷新
          </button>
        </div>
      </div>

      <!-- 个人:增仓表单 -->
      <div v-if="tab === 'personal'" class="add-bar">
        <input v-model="form.stock_code" class="input" placeholder="代码 如 600519.SH" />
        <input v-model="form.stock_name" class="input" placeholder="名称(选填)" />
        <input v-model.number="form.shares" class="input" type="number" placeholder="股数" />
        <input v-model.number="form.avg_cost" class="input" type="number" placeholder="成本价" />
        <button class="btn btn-primary btn-sm" @click="addPersonal">
          <Icon name="plus" :size="14" /> 建仓/加仓
        </button>
      </div>

      <table v-if="holdings.length" class="dt">
        <thead>
          <tr>
            <th style="width: 168px">标的</th>
            <th class="num">股数</th>
            <th class="num">成本价</th>
            <th class="num">现价</th>
            <th class="num">市值</th>
            <th class="num">当日盈亏</th>
            <th class="num">浮动盈亏</th>
            <th class="num">盈亏比例</th>
            <th class="num" style="width: 120px">占比</th>
            <th v-if="tab === 'personal'" class="num" style="width: 64px"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="h in holdings" :key="h.stock_code">
            <td>
              <div class="cell-stock">
                <span class="cs-name">{{ h.stock_name || h.stock_code }}</span>
                <span class="cs-code mono">{{ h.stock_code }}</span>
              </div>
            </td>
            <td class="num">{{ fmtInt(h.shares) }}</td>
            <td class="num c2">{{ fmt(h.avg_cost) }}</td>
            <td class="num">{{ h.current_price == null ? '—' : fmt(h.current_price) }}</td>
            <td class="num">
              {{ h.market_value == null ? '—' : fmtInt(Math.round(h.market_value)) }}
            </td>
            <td class="num">
              <span class="c3">—</span>
            </td>
            <td class="num">
              <span v-if="h.float_pnl == null" class="c3">—</span>
              <span v-else :class="app.pnlClass(h.float_pnl)">
                {{ (h.float_pnl > 0 ? '+' : '') + fmtInt(Math.round(h.float_pnl)) }}
              </span>
            </td>
            <td class="num">
              <span v-if="floatPctOf(h) == null" class="c3">—</span>
              <span v-else :class="app.pnlClass(h.float_pnl ?? 0)">{{
                fmtPct(floatPctOf(h)!)
              }}</span>
            </td>
            <td class="num">
              <div v-if="weightOf(h) != null" class="cell-weight">
                <span class="c2">{{ weightOf(h)!.toFixed(1) }}%</span>
                <div class="wbar">
                  <div class="wbar-fill" :style="{ width: weightOf(h)! + '%' }" />
                </div>
              </div>
              <span v-else class="c3">—</span>
            </td>
            <td v-if="tab === 'personal'" class="num">
              <button class="btn btn-ghost btn-sm" @click="trading.removePersonal(h.stock_code)">
                删除
              </button>
            </td>
          </tr>
        </tbody>
        <tfoot v-if="totalMkt != null || totalFloat != null">
          <tr class="foot">
            <td class="foot-label">合计</td>
            <td colspan="3"></td>
            <td class="num foot-strong">
              {{ totalMkt == null ? '—' : fmtInt(Math.round(totalMkt)) }}
            </td>
            <td class="num">
              <span class="c3">—</span>
            </td>
            <td class="num">
              <span v-if="totalFloat == null" class="c3">—</span>
              <span v-else class="foot-strong" :class="app.pnlClass(totalFloat)">
                {{ (totalFloat > 0 ? '+' : '') + fmtInt(Math.round(totalFloat)) }}
              </span>
            </td>
            <td class="num">
              <span v-if="totalFloatPct == null" class="c3">—</span>
              <span v-else class="foot-strong" :class="app.pnlClass(totalFloat ?? 0)">{{
                fmtPct(totalFloatPct)
              }}</span>
            </td>
            <td :colspan="tab === 'personal' ? 2 : 1"></td>
          </tr>
        </tfoot>
      </table>

      <!-- 诚实空状态 -->
      <div v-else class="empty">
        <div class="empty-icon"><Icon name="portfolio" :size="20" /></div>
        <div class="empty-title">
          {{ tab === 'model' ? '模拟盘暂无持仓' : '尚未录入个人持仓' }}
        </div>
        <div class="empty-desc">
          {{
            tab === 'model'
              ? '启用某模型并盘后跑一轮后,这里出现自动持仓(纸面验证,不下达真实委托)。'
              : '在上方录入你的真实持仓即可跟踪当日收益与浮盈;不会自动下单,数据仅存本机。'
          }}
        </div>
      </div>
    </div>

    <p class="disclaimer">
      个人与模型两套账本完全独立;仅供研究,非投资建议;模拟盘不进行任何自动真实下单。估值采用收盘价,当日盈亏来自实时源「现价
      vs 昨收」。
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

/* 汇总卡 */
.summary-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 16px;
}
.sm {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.sm .cap {
  display: flex;
  align-items: center;
  gap: 7px;
}
.sm-val {
  font-size: 21px;
  font-weight: 600;
  letter-spacing: -0.01em;
  line-height: 1;
  color: var(--text-1);
}
.sm-sub {
  font-size: 12px;
  color: var(--text-3);
}

/* card-head 右侧 */
.ch-right {
  display: flex;
  align-items: center;
  gap: 8px;
}
/* card-head 右侧 PnL 图例 */
.card-head .ch-tag {
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

/* 增仓表单 */
.add-bar {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 14px 16px;
  border-bottom: 0.5px solid var(--border);
}
.add-bar .input {
  flex: 1 1 130px;
  min-width: 0;
}
.add-bar .btn {
  flex: none;
}

/* 表格内单元 */
.cell-stock {
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.cs-name {
  font-weight: 500;
  color: var(--text-1);
}
.cs-code {
  font-size: 10.5px;
  color: var(--text-3);
}
.dt td.c2,
.c2 {
  color: var(--text-2);
}
.c3 {
  color: var(--text-3);
}
.cell-weight {
  display: flex;
  align-items: center;
  gap: 8px;
  justify-content: flex-end;
}
.wbar {
  width: 40px;
  height: 4px;
  background: var(--bg-input);
  border-radius: 2px;
  overflow: hidden;
  flex: none;
}
.wbar-fill {
  height: 100%;
  background: var(--accent);
  opacity: 0.7;
}

/* 合计行 */
.dt tfoot .foot td {
  height: 38px;
  border-top: 0.5px solid var(--border-strong);
  border-bottom: none;
}
.foot-label {
  color: var(--text-2);
  font-weight: 500;
}
.foot-strong {
  font-weight: 600;
}

.disclaimer {
  margin: 4px 0 0;
  color: var(--text-3);
  font-size: var(--fs-cap);
}

@media (max-width: 1100px) {
  .summary-grid {
    grid-template-columns: repeat(3, 1fr);
  }
}
</style>
