<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useTradingStore, type Holding } from '../../stores/trading';
import { useAppStore } from '../../stores/app';
import { formatPnl } from '../../lib/pnl';
import { fmt, fmtInt, fmtPct } from '../../lib/format';
import { reasonLabel } from '../../lib/signals';
import { api } from '../../api/client';
import PageHero from '../../ui/PageHero.vue';
import Icon from '../../shell/Icon.vue';
import Modal from '../../ui/Modal.vue';
import StockSearch from '../../ui/StockSearch.vue';

const trading = useTradingStore();
const app = useAppStore();
const tab = ref<'personal' | 'model'>('personal');

// 建仓 / 加仓 / 减仓 弹窗
type DialogMode = 'create' | 'add' | 'reduce';
const dialog = reactive({
  open: false,
  mode: 'create' as DialogMode,
  code: '',
  name: '',
  shares: 0,
  price: 0,
  curShares: 0, // 现有股数 / 成本(加减仓预览 + 校验)
  curCost: 0,
});
const submitting = ref(false);
const dialogError = ref<string | null>(null);

const dialogTitle = computed(() =>
  dialog.mode === 'create'
    ? '建仓'
    : `${dialog.mode === 'add' ? '加仓' : '减仓'} · ${dialog.name || dialog.code}`,
);
// 加仓后的移动加权均价预览(口径与服务端 personalAdjust 一致)
const previewCost = computed<number | null>(() => {
  if (dialog.mode !== 'add' || !(dialog.shares > 0) || !(dialog.price > 0)) return null;
  const total = dialog.curShares + dialog.shares;
  return total > 0
    ? (dialog.curShares * dialog.curCost + dialog.shares * dialog.price) / total
    : null;
});

function openCreate() {
  Object.assign(dialog, {
    open: true,
    mode: 'create',
    code: '',
    name: '',
    shares: 0,
    price: 0,
    curShares: 0,
    curCost: 0,
  });
  dialogError.value = null;
}
function openAdjust(h: Holding, mode: 'add' | 'reduce') {
  Object.assign(dialog, {
    open: true,
    mode,
    code: h.stock_code,
    name: h.stock_name || '',
    shares: 0,
    price: h.current_price ?? h.avg_cost ?? 0,
    curShares: h.shares,
    curCost: h.avg_cost,
  });
  dialogError.value = null;
}
function onPick(s: { code: string; name: string }) {
  dialog.code = s.code;
  dialog.name = s.name;
}
async function submitDialog() {
  dialogError.value = null;
  if (!dialog.code) {
    dialogError.value = '请先选择股票';
    return;
  }
  if (!(dialog.shares > 0)) {
    dialogError.value = '股数必须 > 0';
    return;
  }
  if (dialog.mode !== 'reduce' && !(dialog.price > 0)) {
    dialogError.value = '价格 / 成本必须 > 0';
    return;
  }
  if (dialog.mode === 'reduce' && dialog.shares > dialog.curShares) {
    dialogError.value = `最多可减 ${dialog.curShares} 股`;
    return;
  }
  submitting.value = true;
  try {
    await trading.addPersonal({
      stock_code: dialog.code,
      stock_name: dialog.name || undefined,
      shares: dialog.shares,
      price: dialog.price,
      op: dialog.mode === 'reduce' ? 'reduce' : 'add',
    });
    dialog.open = false;
  } catch (e) {
    const d = (e as { detail?: unknown })?.detail;
    dialogError.value = d && typeof d === 'object' ? JSON.stringify(d) : String(d ?? e);
  } finally {
    submitting.value = false;
  }
}

// 模拟盘买卖流水(只对模型账户;个人持仓为手动建仓,不入流水)。
const trades = ref<any[]>([]);
async function loadTrades() {
  try {
    trades.value = (await api.trades('model')) ?? [];
  } catch {
    trades.value = [];
  }
}

onMounted(() => {
  trading.fetchPersonal();
  trading.fetchModel();
  trading.fetchLivePnl();
  loadTrades();
});

// ---- 真实数据派生(不改数据来源,仅由真实持仓/盈亏聚合)----
const holdings = computed(() =>
  tab.value === 'personal' ? trading.personalHoldings : trading.modelHoldings,
);
const pnlLatest = computed(() =>
  tab.value === 'personal' ? trading.personalPnlLatest : trading.modelPnlLatest,
);
const live = computed(() => (tab.value === 'personal' ? trading.livePersonal : trading.liveModel));

// 逐行「当日盈亏」(金额+百分比):来自持仓富集字段(现价 vs 昨收 × 持仓),与现价/市值/
// 浮动盈亏同源(api 按最新报价富集)。报价不可用的标的 day_pnl 为 null → 该行诚实「—」。
const dayByCode = computed<Record<string, { pnl: number; pct: number }>>(() => {
  const out: Record<string, { pnl: number; pct: number }> = {};
  for (const h of holdings.value) {
    if (h.day_pnl != null && h.current_price != null && h.prev_close) {
      out[h.stock_code] = { pnl: h.day_pnl, pct: (h.current_price / h.prev_close - 1) * 100 };
    }
  }
  return out;
});
// 合计当日盈亏:仅汇总有真实当日数据的行(口径与逐行一致);无任何行有数据则不汇总。
const totalDay = computed<number | null>(() => {
  const vals = Object.values(dayByCode.value);
  return vals.length ? vals.reduce((s, v) => s + v.pnl, 0) : null;
});

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
          <button v-else class="btn btn-primary btn-sm" @click="openCreate">
            <Icon name="plus" :size="14" /> 建仓
          </button>
        </div>
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
            <th v-if="tab === 'personal'" class="num" style="width: 116px"></th>
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
              <div v-if="dayByCode[h.stock_code]" class="cell-day">
                <span :class="app.pnlClass(dayByCode[h.stock_code].pnl)">{{
                  (dayByCode[h.stock_code].pnl > 0 ? '+' : '') +
                  fmtInt(Math.round(dayByCode[h.stock_code].pnl))
                }}</span>
                <span class="day-pct" :class="app.pnlClass(dayByCode[h.stock_code].pnl)">{{
                  fmtPct(dayByCode[h.stock_code].pct)
                }}</span>
              </div>
              <span v-else class="c3">—</span>
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
              <div class="row-actions">
                <button class="act-btn" title="加仓" @click="openAdjust(h, 'add')">加</button>
                <button class="act-btn" title="减仓" @click="openAdjust(h, 'reduce')">减</button>
                <button
                  class="act-btn danger"
                  title="删除"
                  @click="trading.removePersonal(h.stock_code)"
                >
                  删
                </button>
              </div>
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
              <span v-if="totalDay == null" class="c3">—</span>
              <span v-else class="foot-strong" :class="app.pnlClass(totalDay)">
                {{ (totalDay > 0 ? '+' : '') + fmtInt(Math.round(totalDay)) }}
              </span>
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
              : '点击右上「建仓」录入你的真实持仓即可跟踪当日收益与浮盈;不会自动下单,数据仅存本机。'
          }}
        </div>
        <button v-if="tab === 'personal'" class="btn btn-primary btn-sm" @click="openCreate">
          <Icon name="plus" :size="14" /> 建仓
        </button>
      </div>
    </div>

    <!-- 买卖流水 + 运行说明(模拟盘,只对模型账户) -->
    <div v-if="tab === 'model'" class="card">
      <div class="card-head">
        <div>
          <h3 class="card-title">模型模拟盘 · 买卖流水</h3>
          <span class="card-sub">
            每个交易日 15:30 盘后自动跑一轮(需 App 保持打开);T 日出信号、T+1
            开盘成交。也可到「信号」页手动「盘后跑一轮」。
          </span>
        </div>
        <button class="btn btn-ghost btn-sm" @click="loadTrades">
          <Icon name="refresh" :size="14" /> 刷新
        </button>
      </div>
      <table v-if="trades.length" class="dt">
        <thead>
          <tr>
            <th style="width: 110px">日期</th>
            <th style="width: 160px">标的</th>
            <th>方向</th>
            <th class="num">股数</th>
            <th class="num">成交价</th>
            <th class="num">金额</th>
            <th>原因</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(t, i) in trades" :key="i">
            <td class="col-code">{{ t.trade_date }}</td>
            <td>
              <div class="cell-stock">
                <span class="cs-name">{{ t.stock_name || t.code }}</span>
                <span class="cs-code mono">{{ t.code }}</span>
              </div>
            </td>
            <td>
              <span class="badge" :class="t.side === 'buy' ? 'badge-ok' : 'badge-warn'"
                ><span style="font-size: 9px">{{ t.side === 'buy' ? '▲' : '▼' }}</span>
                {{ t.side === 'buy' ? '买入' : '卖出' }}</span
              >
            </td>
            <td class="num">{{ fmtInt(t.shares) }}</td>
            <td class="num c2">{{ fmt(t.price) }}</td>
            <td class="num">{{ t.amount == null ? '—' : fmtInt(Math.round(t.amount)) }}</td>
            <td>{{ reasonLabel(t.reason) }}</td>
          </tr>
        </tbody>
      </table>
      <div v-else class="empty">
        <div class="empty-icon"><Icon name="signals" :size="20" /></div>
        <div class="empty-title">暂无买卖记录</div>
        <div class="empty-desc">
          模拟盘每次盘后跑一轮产生的买卖会记录在此;到「信号」页选信号日并「盘后跑一轮」即可生成。
        </div>
      </div>
    </div>

    <p class="disclaimer">
      个人与模型两套账本完全独立;仅供研究,非投资建议;模拟盘不进行任何自动真实下单。估值采用收盘价,当日盈亏来自实时源「现价
      vs 昨收」。
    </p>

    <!-- 建仓 / 加仓 / 减仓 弹窗 -->
    <Modal v-model="dialog.open" :title="dialogTitle" :width="420">
      <div class="dlg">
        <div v-if="dialog.mode === 'create'" class="dlg-field">
          <label class="field-label">股票(代码或名称)</label>
          <StockSearch @select="onPick" />
          <p v-if="dialog.code" class="dlg-picked mono">
            已选:{{ dialog.name }} · {{ dialog.code }}
          </p>
        </div>
        <div v-else class="dlg-field">
          <label class="field-label">标的</label>
          <div class="dlg-stock mono">
            {{ dialog.name || dialog.code }} · {{ dialog.code }}
            <span class="dlg-cur"
              >现 {{ fmtInt(dialog.curShares) }} 股 @ {{ fmt(dialog.curCost) }}</span
            >
          </div>
        </div>

        <div class="dlg-row">
          <div class="dlg-field">
            <label class="field-label">{{ dialog.mode === 'reduce' ? '减少股数' : '股数' }}</label>
            <input
              v-model.number="dialog.shares"
              class="input mono"
              type="number"
              min="0"
              step="100"
            />
          </div>
          <div class="dlg-field">
            <label class="field-label">{{
              dialog.mode === 'create'
                ? '成本价'
                : dialog.mode === 'add'
                  ? '加仓价'
                  : '成交价(选填)'
            }}</label>
            <input
              v-model.number="dialog.price"
              class="input mono"
              type="number"
              min="0"
              step="0.01"
            />
          </div>
        </div>

        <p v-if="previewCost != null" class="dlg-preview">
          加仓后均价 ≈ <b class="mono">{{ fmt(previewCost) }}</b>
          <span class="dlg-cur">(现 {{ fmt(dialog.curCost) }})</span>
        </p>
        <p v-if="dialogError" class="dlg-err"><Icon name="alert" :size="13" /> {{ dialogError }}</p>
      </div>
      <template #footer>
        <button class="btn btn-secondary" @click="dialog.open = false">取消</button>
        <button class="btn btn-primary" :disabled="submitting" @click="submitDialog">
          {{ submitting ? '提交中…' : '确定' }}
        </button>
      </template>
    </Modal>
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

/* 行内 加/减/删 操作 */
.row-actions {
  display: inline-flex;
  gap: 5px;
  justify-content: flex-end;
}
.act-btn {
  width: 26px;
  height: 24px;
  border: 0.5px solid var(--border);
  border-radius: var(--r-sm);
  background: var(--bg-input);
  color: var(--text-2);
  font-size: 12px;
  cursor: pointer;
  transition:
    background var(--t-fast) var(--ease),
    color var(--t-fast) var(--ease),
    border-color var(--t-fast) var(--ease);
}
.act-btn:hover {
  background: var(--accent-bg);
  color: var(--accent);
  border-color: var(--accent);
}
.act-btn.danger:hover {
  background: var(--status-err-bg);
  color: var(--status-err);
  border-color: var(--status-err);
}

/* 建仓 / 加减仓 弹窗 */
.dlg {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.dlg-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.dlg-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.dlg-field .input {
  width: 100%;
}
.dlg-picked {
  margin: 0;
  font-size: 11.5px;
  color: var(--accent);
}
.dlg-stock {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 9px 12px;
  border-radius: var(--r-md);
  background: var(--bg-input);
  border: 0.5px solid var(--border);
  font-size: 13px;
  color: var(--text-1);
}
.dlg-cur {
  font-size: 11px;
  color: var(--text-3);
}
.dlg-preview {
  margin: 0;
  font-size: 12.5px;
  color: var(--text-2);
}
.dlg-preview b {
  color: var(--accent);
}
.dlg-err {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  font-size: var(--fs-sub);
  color: var(--status-err);
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
.cell-day {
  display: flex;
  flex-direction: column;
  gap: 1px;
  align-items: flex-end;
}
.day-pct {
  font-size: 10.5px;
  opacity: 0.8;
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
