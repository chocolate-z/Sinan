<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api } from '../../api/client';
import { useAppStore } from '../../stores/app';
import { formatPnl, pnlClass } from '../../lib/pnl';
import { fmt, fmtInt } from '../../lib/format';
import { capEnabled, quoteChange, type KBar, type QuoteRow } from '../../lib/market';
import PageHero from '../../ui/PageHero.vue';
import Candles from '../../ui/charts/Candles.vue';
import Icon from '../../shell/Icon.vue';

const app = useAppStore();

const codesInput = ref('600519.SH,000001.SZ,000300.SH');
const quotes = ref<QuoteRow[]>([]);
const quotesDegraded = ref(false);
const selected = ref<string | null>(null);
const bars = ref<KBar[]>([]);
const pricesDegraded = ref(false);
const adjust = ref<'qfq' | 'none'>('qfq');
const loadingQuotes = ref(false);
const loadingPrices = ref(false);
const error = ref<string | null>(null);
// 表内文本过滤(仅在已加载报价中检索,不触发数据源)。
const query = ref('');

function parseCodes(): string[] {
  return codesInput.value
    .split(/[,\s]+/)
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean);
}

async function loadQuotes() {
  const codes = parseCodes();
  if (!codes.length) return;
  loadingQuotes.value = true;
  error.value = null;
  try {
    const res = await api.quotes(codes);
    quotes.value = res.quotes ?? [];
    quotesDegraded.value = Boolean(res.degraded);
    if (quotes.value.length && (!selected.value || !codes.includes(selected.value))) {
      selectCode(quotes.value[0].stock_code);
    }
  } catch (e) {
    error.value = String(e);
    quotes.value = [];
  } finally {
    loadingQuotes.value = false;
  }
}

async function loadPrices(code: string) {
  loadingPrices.value = true;
  try {
    const res = await api.prices(code, { adjust: adjust.value, limit: 250 });
    bars.value = res.rows ?? [];
    pricesDegraded.value = Boolean(res.degraded);
  } catch (e) {
    bars.value = [];
    pricesDegraded.value = false;
    error.value = String(e);
  } finally {
    loadingPrices.value = false;
  }
}

function selectCode(code: string) {
  selected.value = code;
  loadPrices(code);
}

function changeAdjust(a: 'qfq' | 'none') {
  if (adjust.value === a) return;
  adjust.value = a;
  if (selected.value) loadPrices(selected.value);
}

// ── 涨跌展示(盈亏色)──────────────────────────────────────────────────────
function chgClass(q: QuoteRow): string {
  const c = quoteChange(q.price, q.prev_close);
  return c.abs == null ? 'pnl-flat' : pnlClass(c.abs);
}
function chgAbs(q: QuoteRow): string {
  const c = quoteChange(q.price, q.prev_close);
  return c.abs == null ? '—' : formatPnl(c.abs);
}
function chgPct(q: QuoteRow): string {
  const c = quoteChange(q.price, q.prev_close);
  return c.pct == null ? '—' : `${c.pct >= 0 ? '+' : ''}${(c.pct * 100).toFixed(2)}%`;
}
function priceTxt(q: QuoteRow): string {
  return q.price == null ? '—' : q.price.toFixed(2);
}

// 表内过滤:按代码/名称模糊匹配(已加载报价之内)。
const visibleQuotes = computed(() => {
  const k = query.value.trim().toUpperCase();
  if (!k) return quotes.value;
  return quotes.value.filter(
    (q) => q.stock_code.toUpperCase().includes(k) || (q.name ?? '').toUpperCase().includes(k),
  );
});

// 当前选中标的的报价行 + 涨跌(供右侧个股头)。
const cur = computed<QuoteRow | null>(
  () => quotes.value.find((q) => q.stock_code === selected.value) ?? null,
);
const selectedName = computed(() => cur.value?.name ?? selected.value ?? '');
const curChg = computed(() =>
  cur.value ? quoteChange(cur.value.price, cur.value.prev_close) : null,
);
const curChgClass = computed(() =>
  curChg.value?.abs == null ? 'pnl-flat' : pnlClass(curChg.value.abs),
);

// K 线数据(供 <Candles>);最新一根用于关键指标。
const candleData = computed(() =>
  bars.value.map((b) => ({ o: b.open, h: b.high, l: b.low, c: b.close, v: b.volume ?? 0 })),
);
const lastBar = computed<KBar | null>(() => bars.value[bars.value.length - 1] ?? null);

const northboundOn = computed(() => capEnabled(app.providers, app.activeProvider, 'NORTHBOUND'));
const fundamentalOn = computed(() => capEnabled(app.providers, app.activeProvider, 'FUNDAMENTAL'));

onMounted(() => {
  if (app.onboardingDone) loadQuotes();
});
</script>

<template>
  <PageHero title="行情" sub="沪深A股 · 自选与全市场报价 · 实时价「现价 vs 昨收」">
    <template #right>
      <span class="mono src-tag">{{ app.activeProvider ?? '未配置数据源' }}</span>
      <button class="btn btn-secondary btn-sm" :disabled="loadingQuotes" @click="loadQuotes">
        <Icon name="refresh" :size="13" /> {{ loadingQuotes ? '刷新中…' : '刷新报价' }}
      </button>
    </template>
  </PageHero>

  <div class="page-body">
    <p v-if="error" class="banner banner-err">{{ error }}</p>
    <p v-if="quotesDegraded" class="banner banner-warn">
      部分标的暂无实时报价(实时源不可达或非交易时段)。
    </p>

    <div class="split">
      <!-- 左:可搜索报价表 -->
      <div class="card quotes">
        <div class="quotes-head">
          <div class="search-wrap">
            <span class="search-ico"><Icon name="search" :size="14" /></span>
            <input v-model="query" class="input input-search" placeholder="搜索代码 / 名称" />
          </div>
          <input
            v-model="codesInput"
            class="input mono codes-field"
            placeholder="600519.SH,000001.SZ"
            @keyup.enter="loadQuotes"
          />
        </div>
        <div class="quotes-body">
          <table v-if="visibleQuotes.length" class="dt dt-compact">
            <thead>
              <tr>
                <th>代码 / 名称</th>
                <th class="num">现价</th>
                <th class="num">涨跌幅</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="q in visibleQuotes"
                :key="q.stock_code"
                :class="{ sel: q.stock_code === selected }"
                @click="selectCode(q.stock_code)"
              >
                <td>
                  <div class="qname">
                    <span class="nm">{{ q.name ?? '—' }}</span>
                    <span class="cd mono">{{ q.stock_code }}</span>
                  </div>
                </td>
                <td class="num" :class="chgClass(q)">{{ priceTxt(q) }}</td>
                <td class="num" :class="chgClass(q)">{{ chgPct(q) }}</td>
              </tr>
            </tbody>
          </table>
          <div v-else-if="quotes.length" class="empty">
            <div class="empty-icon"><Icon name="search" :size="20" /></div>
            <div class="empty-title">无匹配标的</div>
            <div class="empty-desc">没有与「{{ query }}」匹配的代码或名称。</div>
          </div>
          <div v-else class="empty">
            <div class="empty-icon"><Icon name="market" :size="20" /></div>
            <div class="empty-title">尚无报价</div>
            <div class="empty-desc">在右上输入自选代码并「刷新报价」即可查看实时行情。</div>
          </div>
        </div>
      </div>

      <!-- 右:个股头 + 指标 + K 线 -->
      <div class="card detail">
        <template v-if="selected">
          <div class="detail-head">
            <div class="dh-left">
              <div class="dh-name">
                <span class="nm">{{ selectedName }}</span>
                <span class="cd mono">{{ selected }}</span>
              </div>
              <div class="dh-quote">
                <span class="price mono" :class="curChgClass">{{ cur ? priceTxt(cur) : '—' }}</span>
                <span class="chg mono" :class="curChgClass">
                  {{ cur ? chgAbs(cur) : '—' }} {{ cur ? chgPct(cur) : '—' }}
                </span>
              </div>
            </div>
            <div class="segmented adjust-seg">
              <button :class="{ on: adjust === 'qfq' }" @click="changeAdjust('qfq')">前复权</button>
              <button :class="{ on: adjust === 'none' }" @click="changeAdjust('none')">
                不复权
              </button>
            </div>
          </div>

          <!-- 关键指标:取最新一根日 K(真实数据;缺则空状态省略) -->
          <div v-if="lastBar" class="metrics">
            <div class="metric">
              <div class="mk">今开</div>
              <div class="mv mono">{{ fmt(lastBar.open) }}</div>
            </div>
            <div class="metric">
              <div class="mk">最高</div>
              <div class="mv mono pnl-up">{{ fmt(lastBar.high) }}</div>
            </div>
            <div class="metric">
              <div class="mk">最低</div>
              <div class="mv mono pnl-down">{{ fmt(lastBar.low) }}</div>
            </div>
            <div class="metric">
              <div class="mk">收盘</div>
              <div class="mv mono">{{ fmt(lastBar.close) }}</div>
            </div>
            <div class="metric">
              <div class="mk">成交量</div>
              <div class="mv mono">
                {{ lastBar.volume != null ? fmtInt(lastBar.volume) : '—' }}
              </div>
            </div>
            <div class="metric">
              <div class="mk">成交额</div>
              <div class="mv mono">{{ lastBar.amount != null ? fmtInt(lastBar.amount) : '—' }}</div>
            </div>
          </div>

          <div class="ma-legend">
            <span class="lg"><i style="background: #e0b34a" />MA5</span>
            <span class="lg"><i style="background: #5aa9e6" />MA20</span>
            <span class="cap seg-note"
              >{{ adjust === 'qfq' ? '前复权' : '不复权' }} · 日K · 最近 {{ bars.length }} 根</span
            >
          </div>

          <p v-if="pricesDegraded" class="banner banner-warn inset">
            复权因子缺失,展示原始价(切换 Tushare Pro 可前复权)。
          </p>

          <div class="chart-wrap">
            <div v-if="loadingPrices" class="empty">
              <div class="empty-title">加载 K 线…</div>
            </div>
            <Candles v-else-if="bars.length" :data="candleData" :height="360" :ma="[5, 20]" />
            <div v-else class="empty">
              <div class="empty-icon"><Icon name="db" :size="20" /></div>
              <div class="empty-title">本地无「{{ selected }}」的行情缓存</div>
              <div class="empty-desc">
                到「设置 → 数据源」建立本地缓存后即可查看 K 线(可断点续传)。
              </div>
            </div>
          </div>

          <!-- 扩展数据:免费源北向/财务置灰(诚实告知,不造假) -->
          <div class="ext-grid">
            <div class="ext" :class="{ off: !northboundOn }">
              <div class="ext-h">
                北向资金
                <span v-if="!northboundOn" class="badge badge-idle"
                  ><Icon name="lock" :size="11" /> 未启用</span
                >
              </div>
              <p class="ext-p">
                {{
                  northboundOn
                    ? '当前数据源支持北向持股;持股占比趋势将随估值页接入。'
                    : '当前数据源不支持北向数据,切换 Tushare Pro 可启用。'
                }}
              </p>
            </div>
            <div class="ext" :class="{ off: !fundamentalOn }">
              <div class="ext-h">
                基本面 PE / PB / ROE
                <span v-if="!fundamentalOn" class="badge badge-idle"
                  ><Icon name="lock" :size="11" /> 未启用</span
                >
              </div>
              <p class="ext-p">
                {{
                  fundamentalOn
                    ? '当前数据源支持财务/估值;PE/PB/ROE 将随估值页接入。'
                    : '当前数据源不支持财务数据,切换 Tushare Pro 可启用。'
                }}
              </p>
            </div>
          </div>
        </template>

        <div v-else class="empty detail-empty">
          <div class="empty-icon"><Icon name="market" :size="20" /></div>
          <div class="empty-title">选择标的查看 K 线</div>
          <div class="empty-desc">在左侧报价表选中一只标的,查看日 K 走势与关键指标。</div>
        </div>
      </div>
    </div>

    <p class="disclaimer">
      行情仅供研究参考,非投资建议。实时价来自第三方公开源,可能延迟或缺失;K
      线走本地缓存,前复权随最新日动态生成。
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

/* 顶栏右侧数据源标签 */
.src-tag {
  font-size: var(--fs-sub);
  color: var(--text-3);
}

/* 提示横幅(系统状态色,与盈亏色解耦) */
.banner {
  margin: 0;
  padding: 9px 14px;
  border-radius: var(--r-md);
  font-size: var(--fs-sub);
  border: 0.5px solid transparent;
}
.banner-err {
  color: var(--status-err);
  background: var(--status-err-bg);
  border-color: var(--status-err);
}
.banner-warn {
  color: var(--status-warn);
  background: var(--status-warn-bg);
  border-color: var(--status-warn);
}
.banner.inset {
  margin: 0 16px;
}

/* 左报价 / 右明细 两栏 */
.split {
  display: grid;
  grid-template-columns: 352px minmax(0, 1fr);
  gap: 20px;
  align-items: start;
}

/* ── 左:可搜索报价表 ── */
.quotes {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.quotes-head {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px 16px;
  border-bottom: 0.5px solid var(--border-faint);
}
.search-wrap {
  position: relative;
}
.search-ico {
  position: absolute;
  left: 9px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-3);
  display: inline-flex;
  pointer-events: none;
}
.codes-field {
  font-size: var(--fs-cap);
  color: var(--text-2);
}
.quotes-body {
  max-height: 620px;
  overflow: auto;
}
.qname {
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.qname .nm {
  color: var(--text-1);
  font-weight: 500;
  font-size: 12.5px;
}
.qname .cd {
  font-size: 10.5px;
  color: var(--text-3);
}

/* ── 右:个股明细 ── */
.detail {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.detail-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  padding: 16px 22px;
  border-bottom: 0.5px solid var(--border-faint);
}
.dh-left {
  display: flex;
  align-items: baseline;
  gap: 18px;
  flex-wrap: wrap;
}
.dh-name {
  display: flex;
  align-items: baseline;
  gap: 9px;
}
.dh-name .nm {
  font-size: 19px;
  font-weight: 600;
  color: var(--text-1);
  letter-spacing: -0.01em;
}
.dh-name .cd {
  font-size: 12px;
  color: var(--text-3);
}
.dh-quote {
  display: flex;
  align-items: baseline;
  gap: 12px;
}
.dh-quote .price {
  font-size: 26px;
  font-weight: 600;
  line-height: 1;
  letter-spacing: -0.01em;
}
.dh-quote .chg {
  font-size: 14px;
  font-weight: 500;
}

/* 关键指标网格 */
.metrics {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  border-bottom: 0.5px solid var(--border-faint);
}
.metric {
  padding: 12px 18px;
  border-right: 0.5px solid var(--border-faint);
}
.metric:last-child {
  border-right: none;
}
.mk {
  font-size: var(--fs-cap);
  color: var(--text-3);
  margin-bottom: 4px;
}
.mv {
  font-size: 13px;
  color: var(--text-1);
  font-weight: 500;
}

/* MA 图例 */
.ma-legend {
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 12px 22px 4px;
}
.ma-legend .lg {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
  color: var(--text-2);
}
.ma-legend .lg i {
  width: 12px;
  height: 2px;
  border-radius: 1px;
}
.seg-note {
  margin-left: auto;
}

/* 图表容器 */
.chart-wrap {
  padding: 4px 16px 16px;
  min-height: 200px;
}

/* 扩展数据(诚实空状态) */
.ext-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  padding: 4px 22px 22px;
}
.ext {
  border: 0.5px solid var(--border);
  border-radius: var(--r-md);
  background: var(--bg-panel-2);
  padding: 16px;
}
.ext.off {
  opacity: 0.7;
}
.ext-h {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  font-size: var(--fs-body);
  color: var(--text-1);
  margin-bottom: 6px;
}
.ext-h .badge {
  height: 19px;
  padding: 0 7px;
  font-size: var(--fs-cap);
}
.ext-p {
  margin: 0;
  font-size: var(--fs-sub);
  color: var(--text-2);
  line-height: 1.5;
}

.detail-empty {
  flex: 1;
}

.disclaimer {
  margin: 4px 0 0;
  color: var(--text-3);
  font-size: var(--fs-cap);
}
</style>
