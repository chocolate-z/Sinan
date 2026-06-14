<script setup lang="ts">
// 行情 · 板块视角(全市场快照):全A涨跌广度 + 行业板块卡网格 + 涨跌排行 + 下钻抽屉
// (板块→成分股→个股日K)。数据全来自 api 全市场快照(engine 按 PIT 聚合);缺数据诚实空。
// 注:个股叶子用日K(Candles);北向「主力净流入」需 moneyflow(无),v1 不展示资金流向卡。
import { computed, onMounted, ref } from 'vue';
import { api } from '../../api/client';
import { useAppStore } from '../../stores/app';
import { fmt } from '../../lib/format';
import PageHero from '../../ui/PageHero.vue';
import Sparkline from '../../ui/charts/Sparkline.vue';
import Candles from '../../ui/charts/Candles.vue';
import Icon from '../../shell/Icon.vue';

const app = useAppStore();

interface Sector {
  name: string;
  chg: number;
  count: number;
  up: number;
  down: number;
  lead: string;
  lead_chg: number;
  spark: number[];
}
interface Breadth {
  total: number;
  up: number;
  down: number;
  flat: number;
  avg_chg: number;
}

const loading = ref(false);
const error = ref<string | null>(null);
const asof = ref<string | null>(null);
const breadth = ref<Breadth | null>(null);
const sectors = ref<Sector[]>([]);
const sort = ref<'desc' | 'asc'>('desc'); // 涨幅优先 / 跌幅优先

// 下钻抽屉:板块 → 成分股 → 个股日K
const openSector = ref<Sector | null>(null);
const constituents = ref<any[]>([]);
const loadingCons = ref(false);
const selStock = ref<{ stock_code: string; name?: string | null } | null>(null);
const bars = ref<any[]>([]);
const loadingK = ref(false);

// 板块涨跌家数(从 sectors 派生,纯展示)+ 抽屉成分股上涨/下跌数。
const sectorBreadth = computed(() => ({
  up: sectors.value.filter((s) => s.chg > 0).length,
  down: sectors.value.filter((s) => s.chg < 0).length,
}));
const consBreadth = computed(() => ({
  up: constituents.value.filter((c) => (c.chg ?? 0) > 0).length,
  down: constituents.value.filter((c) => (c.chg ?? 0) < 0).length,
}));

async function loadSnapshot() {
  loading.value = true;
  error.value = null;
  try {
    const r = await api.marketSnapshot();
    asof.value = r?.asof ?? null;
    breadth.value = r?.breadth ?? null;
    sectors.value = r?.sectors ?? [];
  } catch (e) {
    error.value = String(e);
    breadth.value = null;
    sectors.value = [];
  } finally {
    loading.value = false;
  }
}

const sortedSectors = computed(() => {
  const s = [...sectors.value];
  s.sort((a, b) => (sort.value === 'desc' ? b.chg - a.chg : a.chg - b.chg));
  return s;
});
const maxAbsChg = computed(() =>
  sectors.value.reduce((m, s) => Math.max(m, Math.abs(s.chg)), 0.01),
);

function sparkColor(chg: number): string {
  return chg >= 0 ? 'var(--pnl-up)' : 'var(--pnl-down)';
}
function pctTxt(v: number | null | undefined): string {
  return v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
}

async function openDrill(sec: Sector) {
  openSector.value = sec;
  selStock.value = null;
  bars.value = [];
  constituents.value = [];
  loadingCons.value = true;
  try {
    const r = await api.marketSector(sec.name);
    constituents.value = r?.constituents ?? [];
  } catch {
    constituents.value = [];
  } finally {
    loadingCons.value = false;
  }
}
function closeDrill() {
  openSector.value = null;
  selStock.value = null;
}
async function pickStock(s: { stock_code: string; name?: string | null }) {
  selStock.value = s;
  loadingK.value = true;
  bars.value = [];
  try {
    const r = await api.prices(s.stock_code, { adjust: 'qfq', limit: 120 });
    bars.value = r?.rows ?? [];
  } catch {
    bars.value = [];
  } finally {
    loadingK.value = false;
  }
}
const candleData = computed(() =>
  bars.value.map((b) => ({ o: b.open, h: b.high, l: b.low, c: b.close, v: b.volume ?? 0 })),
);

onMounted(() => {
  if (app.onboardingDone) loadSnapshot();
});
</script>

<template>
  <PageHero title="行情" sub="沪深A股 · 行业板块视角 · 收盘后全市场快照">
    <template #right>
      <span v-if="asof" class="mono src-tag">{{ asof }} 收盘</span>
      <button class="btn btn-secondary btn-sm" :disabled="loading" @click="loadSnapshot">
        <Icon name="refresh" :size="13" /> {{ loading ? '刷新中…' : '刷新' }}
      </button>
    </template>
  </PageHero>

  <div class="page-body">
    <p v-if="error" class="banner banner-err">{{ error }}</p>

    <!-- 全 A 涨跌广度(替代大盘指数条;真实) -->
    <div v-if="breadth" class="breadth card">
      <div class="bd-cell">
        <div class="bd-k">全 A 平均涨跌</div>
        <div class="bd-v mono" :class="app.pnlClass(breadth.avg_chg)">
          {{ pctTxt(breadth.avg_chg) }}
        </div>
      </div>
      <div class="bd-cell">
        <div class="bd-k">上涨</div>
        <div class="bd-v mono" :class="app.pnlClass(1)">{{ breadth.up }}</div>
      </div>
      <div class="bd-cell">
        <div class="bd-k">下跌</div>
        <div class="bd-v mono" :class="app.pnlClass(-1)">{{ breadth.down }}</div>
      </div>
      <div class="bd-cell">
        <div class="bd-k">平盘</div>
        <div class="bd-v mono">{{ breadth.flat }}</div>
      </div>
      <div class="bd-bar">
        <div class="bd-up" :style="{ width: (breadth.up / breadth.total) * 100 + '%' }" />
        <div class="bd-flat" :style="{ width: (breadth.flat / breadth.total) * 100 + '%' }" />
        <div class="bd-down" :style="{ width: (breadth.down / breadth.total) * 100 + '%' }" />
      </div>
      <span class="bd-total mono">{{ breadth.total }} 只</span>
    </div>

    <div v-if="sectors.length" class="cols">
      <!-- 左:板块卡网格 -->
      <div class="sectors-col">
        <div class="sectors-head">
          <div class="sec-label-row">
            <div class="sec-label">行业板块</div>
            <span class="sec-breadth mono">
              <span :class="app.pnlClass(1)">{{ sectorBreadth.up }} 涨</span>
              <span :class="app.pnlClass(-1)">{{ sectorBreadth.down }} 跌</span>
            </span>
          </div>
          <div class="segmented">
            <button :class="{ on: sort === 'desc' }" @click="sort = 'desc'">涨幅</button>
            <button :class="{ on: sort === 'asc' }" @click="sort = 'asc'">跌幅</button>
          </div>
        </div>
        <div class="sector-grid">
          <button
            v-for="s in sortedSectors"
            :key="s.name"
            class="card sector-card"
            @click="openDrill(s)"
          >
            <div class="sc-top">
              <div class="sc-name-wrap">
                <div class="sc-name">{{ s.name }}</div>
                <div class="sc-lead">领涨 {{ s.lead }}</div>
              </div>
              <div class="sc-chg mono" :class="app.pnlClass(s.chg)">{{ pctTxt(s.chg) }}</div>
            </div>
            <Sparkline
              v-if="s.spark.length >= 2"
              :values="s.spark"
              :width="206"
              :height="28"
              :color="sparkColor(s.chg)"
            />
            <div v-else class="sc-nospark" />
            <div class="sc-foot">
              <span class="sc-cap">涨 / 跌 家数</span>
              <span class="sc-ud mono">
                <span :class="app.pnlClass(1)">{{ s.up }}</span>
                <span class="sc-sep">/</span>
                <span :class="app.pnlClass(-1)">{{ s.down }}</span>
              </span>
            </div>
          </button>
        </div>
      </div>

      <!-- 右:板块涨跌排行 -->
      <div class="card rank-card">
        <div class="card-head">
          <div>
            <h3 class="card-title">板块涨跌排行</h3>
            <span class="card-sub">今日 · 行业等权</span>
          </div>
          <span class="ch-tag"><i style="background: var(--pnl-up)" />PnL</span>
        </div>
        <div class="rank-list">
          <button
            v-for="(s, i) in [...sectors].sort((a, b) => b.chg - a.chg)"
            :key="s.name"
            class="rank-row"
            @click="openDrill(s)"
          >
            <span class="rank-n mono" :class="{ top: i < 3 }">{{ i + 1 }}</span>
            <div class="rank-main">
              <div class="rank-r1">
                <span class="rank-name">{{ s.name }}</span>
                <span class="rank-chg mono" :class="app.pnlClass(s.chg)">{{ pctTxt(s.chg) }}</span>
              </div>
              <div class="rank-bar">
                <div
                  class="rank-fill"
                  :style="{
                    width: Math.min(100, (Math.abs(s.chg) / maxAbsChg) * 100) + '%',
                    background: sparkColor(s.chg),
                  }"
                />
              </div>
            </div>
          </button>
        </div>
        <p class="rank-note cap">资金流向待北向数据接入(主力净流入需 moneyflow,本数据源未授权)。</p>
      </div>
    </div>

    <!-- 诚实空:区分「无任何行情」与「有广度但缺行业分类」两种,避免自相矛盾 -->
    <div v-else-if="!loading" class="card">
      <div class="empty">
        <div class="empty-icon"><Icon name="market" :size="20" /></div>
        <template v-if="breadth">
          <div class="empty-title">已有全市场广度,暂缺行业分类</div>
          <div class="empty-desc">
            板块视角需个股行业分类。请确认数据源为 <b>Tushare</b>(免费源不含行业字段)且已配置 token,
            然后点右上「刷新」拉取一次行业分类 —— 之后离线 / 重启亦可复用(本地参考元数据)。
          </div>
        </template>
        <template v-else>
          <div class="empty-title">暂无全市场快照</div>
          <div class="empty-desc">
            需先到「设置 → 数据源」建立本地缓存(含日线 + 行业);建好后这里按行业聚合展示板块视角。
          </div>
        </template>
      </div>
    </div>

    <p class="disclaimer">
      板块视角按本地缓存的日线 + 个股行业聚合(收盘价口径);仅供研究,非投资建议。个股行业取自数据源
      基础分类,申万一级与北向资金流向为后续增强。
    </p>

    <!-- 下钻抽屉:板块 → 成分股 → 个股日K -->
    <template v-if="openSector">
      <div class="drawer-scrim" @click="closeDrill" />
      <aside class="drawer card">
        <div class="drawer-head">
          <button v-if="selStock" class="dh-back" title="返回成分股" @click="selStock = null">
            <Icon name="chevR" :size="16" style="transform: rotate(180deg)" />
          </button>
          <div class="dh-title">
            <template v-if="selStock">
              <span class="dh-name">{{ selStock.name || selStock.stock_code }}</span>
              <span class="dh-code mono">{{ selStock.stock_code }}</span>
            </template>
            <template v-else>
              <span class="dh-name">{{ openSector.name }}</span>
              <span class="dh-code mono" :class="app.pnlClass(openSector.chg)">{{
                pctTxt(openSector.chg)
              }}</span>
              <span class="dh-sub">{{ constituents.length || openSector.count }} 只成分股</span>
            </template>
          </div>
          <button class="dh-close" title="关闭" @click="closeDrill">
            <Icon name="alert" :size="14" style="display: none" />✕
          </button>
        </div>

        <div class="drawer-body">
          <!-- 个股日K -->
          <template v-if="selStock">
            <div v-if="loadingK" class="empty"><div class="empty-title">加载 K 线…</div></div>
            <Candles v-else-if="bars.length" :data="candleData" :height="320" :ma="[5, 10, 20]" />
            <div v-else class="empty">
              <div class="empty-icon"><Icon name="db" :size="20" /></div>
              <div class="empty-title">本地无该股日线缓存</div>
              <div class="empty-desc">到「设置 → 数据源」建立缓存后查看日K。</div>
            </div>
          </template>
          <!-- 成分股列表 -->
          <template v-else>
            <div v-if="loadingCons" class="empty"><div class="empty-title">加载成分股…</div></div>
            <template v-else-if="constituents.length">
              <div class="cons-stats">
                <div class="cs">
                  <span class="cs-k cap">上涨</span>
                  <span class="cs-v mono" :class="app.pnlClass(1)">{{ consBreadth.up }}</span>
                </div>
                <div class="cs">
                  <span class="cs-k cap">下跌</span>
                  <span class="cs-v mono" :class="app.pnlClass(-1)">{{ consBreadth.down }}</span>
                </div>
                <div class="cs">
                  <span class="cs-k cap">成分股</span>
                  <span class="cs-v mono">{{ constituents.length }}</span>
                </div>
              </div>
              <table class="dt dt-compact">
                <thead>
                  <tr>
                    <th>名称 / 代码</th>
                    <th class="num">现价</th>
                    <th class="num">涨跌幅</th>
                    <th class="num">换手</th>
                    <th style="width: 28px" />
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="c in constituents" :key="c.stock_code" @click="pickStock(c)">
                    <td>
                      <div class="cons-name">
                        <span class="nm">{{ c.name || c.stock_code }}</span>
                        <span class="cd mono">{{ c.stock_code }}</span>
                      </div>
                    </td>
                    <td class="num">{{ c.price == null ? '—' : fmt(c.price) }}</td>
                    <td class="num" :class="app.pnlClass(c.chg)">{{ pctTxt(c.chg) }}</td>
                    <td class="num c2">{{ c.turnover == null ? '—' : c.turnover + '%' }}</td>
                    <td class="c-chev">›</td>
                  </tr>
                </tbody>
              </table>
            </template>
            <div v-else class="empty">
              <div class="empty-title">该板块暂无成分股数据</div>
            </div>
            <p class="drawer-hint cap">点击任意成分股查看日K走势</p>
          </template>
        </div>
      </aside>
    </template>
  </div>
</template>

<style scoped>
.page-body {
  padding: 28px;
  display: flex;
  flex-direction: column;
  gap: 20px;
  position: relative;
}
.src-tag {
  font-size: var(--fs-sub);
  color: var(--text-3);
}
.banner {
  margin: 0;
  padding: 9px 14px;
  border-radius: var(--r-md);
  font-size: var(--fs-sub);
}
.banner-err {
  color: var(--status-err);
  background: var(--status-err-bg);
  border: 0.5px solid var(--status-err);
}

/* 全A广度条 */
.breadth {
  display: flex;
  align-items: center;
  gap: 24px;
  padding: 14px 20px;
}
.bd-cell {
  flex: none;
}
.bd-k {
  font-size: var(--fs-cap);
  color: var(--text-3);
  margin-bottom: 3px;
}
.bd-v {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-1);
}
.bd-bar {
  flex: 1;
  height: 8px;
  border-radius: 4px;
  overflow: hidden;
  display: flex;
  background: var(--bg-input);
}
.bd-up {
  background: var(--pnl-up);
}
.bd-flat {
  background: var(--text-3);
  opacity: 0.4;
}
.bd-down {
  background: var(--pnl-down);
}
.bd-total {
  flex: none;
  font-size: var(--fs-cap);
  color: var(--text-3);
}

/* 两栏:板块网格 + 排行 */
.cols {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 360px;
  gap: 20px;
  align-items: start;
}
.sectors-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}
.sector-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(238px, 1fr));
  gap: 14px;
}
.sector-card {
  text-align: left;
  cursor: pointer;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.sector-card:hover {
  border-color: var(--border-strong);
}
.sc-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}
.sc-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-1);
}
.sc-chg {
  font-size: 18px;
  font-weight: 700;
  letter-spacing: -0.01em;
}
.sc-nospark {
  height: 28px;
}
.sc-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 11px;
  border-top: 0.5px solid var(--border-faint);
}
.sc-lead {
  font-size: 10.5px;
  color: var(--text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sc-ud {
  font-size: 12px;
  flex: none;
}
.sec-label-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.sec-breadth {
  display: inline-flex;
  gap: 8px;
  font-size: 11px;
}
.sc-name-wrap {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}
.sc-cap {
  font-size: 10px;
  color: var(--text-3);
}
.cons-stats {
  display: flex;
  gap: 28px;
  padding: 10px 14px;
  border-bottom: 0.5px solid var(--border-faint);
}
.cons-stats .cs {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.cons-stats .cs-v {
  font-size: 14px;
  font-weight: 600;
}
.c-chev {
  color: var(--text-3);
  text-align: center;
  width: 28px;
}
.sc-sep {
  color: var(--text-3);
  margin: 0 3px;
}

/* 排行 */
.rank-list {
  padding: 6px 8px 0;
}
.rank-row {
  display: flex;
  align-items: center;
  gap: 11px;
  width: 100%;
  padding: 8px 10px;
  border-radius: var(--r-sm);
  cursor: pointer;
  text-align: left;
}
.rank-row:hover {
  background: var(--bg-elevated);
}
.rank-n {
  width: 18px;
  text-align: center;
  font-size: 12px;
  font-weight: 700;
  color: var(--text-3);
  flex: none;
}
.rank-n.top {
  color: var(--accent);
}
.rank-main {
  flex: 1;
  min-width: 0;
}
.rank-r1 {
  display: flex;
  justify-content: space-between;
  margin-bottom: 5px;
}
.rank-name {
  font-size: 12.5px;
  color: var(--text-1);
  font-weight: 500;
}
.rank-chg {
  font-size: 12.5px;
  font-weight: 600;
}
.rank-bar {
  height: 4px;
  border-radius: 2px;
  background: var(--bg-input);
  overflow: hidden;
}
.rank-fill {
  height: 100%;
  border-radius: 2px;
  opacity: 0.85;
}
.rank-note {
  padding: 12px 16px;
  color: var(--text-3);
}

/* 下钻抽屉 */
.drawer-scrim {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  z-index: 60;
}
.drawer {
  position: fixed;
  top: var(--titlebar-h);
  right: 0;
  bottom: var(--statusbar-h);
  width: 560px;
  max-width: 90vw;
  z-index: 61;
  display: flex;
  flex-direction: column;
  border-radius: 0;
  animation: drawer-in 160ms var(--ease-out);
}
@keyframes drawer-in {
  from {
    transform: translateX(20px);
    opacity: 0.6;
  }
  to {
    transform: translateX(0);
    opacity: 1;
  }
}
.drawer-head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 18px;
  border-bottom: 0.5px solid var(--border);
}
.dh-back,
.dh-close {
  width: 30px;
  height: 30px;
  border-radius: var(--r-sm);
  border: none;
  background: transparent;
  color: var(--text-2);
  cursor: pointer;
  display: grid;
  place-items: center;
  flex: none;
}
.dh-back:hover,
.dh-close:hover {
  background: var(--bg-elevated);
  color: var(--text-1);
}
.dh-title {
  flex: 1;
  display: flex;
  align-items: baseline;
  gap: 10px;
  min-width: 0;
}
.dh-name {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-1);
}
.dh-code {
  font-size: 12px;
  color: var(--text-3);
}
.dh-sub {
  font-size: 11.5px;
  color: var(--text-3);
}
.drawer-body {
  flex: 1;
  overflow: auto;
  padding: 12px 0;
}
.cons-name {
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.cons-name .nm {
  font-weight: 500;
  color: var(--text-1);
  font-size: 12.5px;
}
.cons-name .cd {
  font-size: 10.5px;
  color: var(--text-3);
}
.c2 {
  color: var(--text-2);
}
.drawer-hint {
  padding: 12px 16px;
  color: var(--text-3);
}
.disclaimer {
  margin: 4px 0 0;
  color: var(--text-3);
  font-size: var(--fs-cap);
}
@media (max-width: 1080px) {
  .cols {
    grid-template-columns: 1fr;
  }
}
</style>
