<script setup lang="ts">
// 基金穿透:输入若干基金(+权重)→ 拆到底层股票暴露 + 行业分布。
// 红线#3:季报只披露前十大重仓,穿透天然部分 —— 全程显「已披露覆盖率」,绝不补满未披露部分。
// 红线#1:持仓按披露日(ann_date)PIT,不偷看未来披露(由 engine 保证)。
import { computed, ref } from 'vue';
import { api } from '../../api/client';
import PageHero from '../../ui/PageHero.vue';
import Icon from '../../shell/Icon.vue';

interface FundRow {
  fund_code: string;
  weight: number;
}
const funds = ref<FundRow[]>([{ fund_code: '', weight: 1 }]);
const loading = ref(false);
const error = ref<string | null>(null);
const result = ref<any | null>(null);

function addFund() {
  funds.value.push({ fund_code: '', weight: 1 });
}
function removeFund(i: number) {
  funds.value.splice(i, 1);
  if (!funds.value.length) addFund();
}
const validFunds = computed(() => funds.value.filter((f) => f.fund_code.trim()));

async function run() {
  const holdings = validFunds.value.map((f) => ({
    fund_code: f.fund_code.trim().toUpperCase(),
    weight: Number(f.weight) > 0 ? Number(f.weight) : 1,
  }));
  if (!holdings.length) return;
  loading.value = true;
  error.value = null;
  try {
    result.value = await api.fundLookthrough({ holdings, refresh: true });
  } catch (e) {
    error.value = String(e);
    result.value = null;
  } finally {
    loading.value = false;
  }
}

function pct(v: number | null | undefined, digits = 1): string {
  return v == null ? '—' : (v * 100).toFixed(digits) + '%';
}
// 暴露/行业条:相对整体覆盖率(最大暴露)归一,纯展示量级(accent 通道,非盈亏色)。
const maxStock = computed(() =>
  Math.max(0.0001, ...(result.value?.stocks ?? []).map((s: any) => s.weight || 0)),
);
const maxSector = computed(() =>
  Math.max(0.0001, ...(result.value?.sectors ?? []).map((s: any) => s.weight || 0)),
);
function bar(w: number, max: number): number {
  return Math.round((Math.max(0, w) / max) * 100);
}
</script>

<template>
  <PageHero
    title="基金穿透"
    sub="把基金 / ETF 拆到底层股票暴露 · 季报披露口径(前十大重仓)· 诚实显已披露覆盖率"
  >
    <template #right>
      <button class="btn btn-primary btn-sm" :disabled="loading || !validFunds.length" @click="run">
        <Icon name="refresh" :size="14" /> {{ loading ? '穿透中…' : '穿透' }}
      </button>
    </template>
  </PageHero>

  <div class="page-body">
    <!-- 输入:基金 + 权重 -->
    <div class="card card-pad">
      <div class="card-head bare">
        <div>
          <h3 class="card-title">持有的基金</h3>
          <span class="card-sub"
            >填基金代码(如 159919.SZ / 000001.OF)+ 相对权重(金额或占比皆可,内部归一)</span
          >
        </div>
      </div>
      <div class="fund-rows">
        <div v-for="(f, i) in funds" :key="i" class="fund-row">
          <input
            v-model="f.fund_code"
            class="input mono"
            placeholder="基金代码"
            @keyup.enter="run"
          />
          <input v-model.number="f.weight" class="input mono wt" type="number" min="0" step="0.1" />
          <button class="row-x" title="移除" @click="removeFund(i)">
            <Icon name="x" :size="13" />
          </button>
        </div>
      </div>
      <div class="fund-actions">
        <button class="btn btn-ghost btn-sm" @click="addFund">
          <Icon name="plus" :size="13" /> 添加基金
        </button>
        <button
          class="btn btn-primary btn-sm"
          :disabled="loading || !validFunds.length"
          @click="run"
        >
          {{ loading ? '穿透中…' : '穿透' }}
        </button>
      </div>
      <p class="hint cap">
        穿透会按需拉取这几只基金的最新披露持仓(需数据源有基金持仓权限);拉不到则用已有缓存,诚实降级。
      </p>
      <p v-if="error" class="msg-err"><Icon name="alert" :size="14" /> {{ error }}</p>
    </div>

    <template v-if="result && result.stocks">
      <!-- 覆盖率诚实横幅 -->
      <div class="cover card">
        <div class="cover-main">
          <span class="cover-k cap">已披露覆盖</span>
          <span class="cover-v mono">{{ pct(result.total_coverage, 0) }}</span>
          <span class="cover-sub">净值(季报前十大口径)</span>
        </div>
        <div class="cover-bar">
          <div class="cover-fill" :style="{ width: pct(result.total_coverage, 0) }" />
        </div>
        <p class="cover-note cap">{{ result.note }}</p>
      </div>

      <div v-if="result.degraded?.length" class="banner banner-warn">
        <Icon name="alert" :size="14" />
        <span>{{ result.degraded.join(' · ') }}</span>
      </div>

      <div class="cols">
        <!-- 个股暴露 -->
        <div class="card">
          <div class="card-head">
            <div>
              <h3 class="card-title">底层个股暴露</h3>
              <span class="card-sub">占组合净值比(已披露部分)· {{ result.stocks.length }} 只</span>
            </div>
            <span class="ch-tag"><i style="background: var(--accent)" />暴露=Accent</span>
          </div>
          <table v-if="result.stocks.length" class="dt">
            <thead>
              <tr>
                <th>标的</th>
                <th>行业</th>
                <th class="num" style="width: 200px">暴露</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="s in result.stocks" :key="s.stock_code">
                <td>
                  <div class="sym">
                    <span class="nm">{{ s.name || s.stock_code }}</span>
                    <span class="cd mono">{{ s.stock_code }}</span>
                  </div>
                </td>
                <td class="ind">{{ s.industry || '—' }}</td>
                <td>
                  <div class="exp">
                    <span class="exp-v mono">{{ pct(s.weight, 2) }}</span>
                    <span class="exp-track"
                      ><span class="exp-fill" :style="{ width: bar(s.weight, maxStock) + '%' }"
                    /></span>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
          <div v-else class="empty"><div class="empty-title">无底层持仓</div></div>
        </div>

        <!-- 行业分布 -->
        <div class="card">
          <div class="card-head">
            <div>
              <h3 class="card-title">行业分布</h3>
              <span class="card-sub">按底层个股行业聚合</span>
            </div>
          </div>
          <div v-if="result.sectors?.length" class="sectors">
            <div v-for="s in result.sectors" :key="s.industry" class="sec">
              <div class="sec-top">
                <span class="sec-name">{{ s.industry }}</span>
                <span class="sec-v mono">{{ pct(s.weight, 1) }}</span>
              </div>
              <div class="sec-track">
                <span class="sec-fill" :style="{ width: bar(s.weight, maxSector) + '%' }" />
              </div>
            </div>
          </div>
          <div v-else class="empty">
            <div class="empty-title">暂无行业分布</div>
            <div class="empty-desc">需个股行业分类(数据源为 Tushare 且已拉行业元数据)。</div>
          </div>
        </div>
      </div>

      <!-- 逐基金披露明细 -->
      <div class="card">
        <div class="card-head">
          <div>
            <h3 class="card-title">逐基金披露</h3>
            <span class="card-sub">各基金最近披露的报告期 + 覆盖率(透明可核)</span>
          </div>
        </div>
        <table class="dt">
          <thead>
            <tr>
              <th>基金</th>
              <th class="num">组合权重</th>
              <th>披露报告期</th>
              <th>公告日</th>
              <th class="num">已披露覆盖</th>
              <th class="num">持仓数</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="f in result.funds" :key="f.fund_code">
              <td class="mono">{{ f.fund_code }}</td>
              <td class="num">{{ pct(f.weight, 1) }}</td>
              <td class="mono dim">{{ f.end_date || '—' }}</td>
              <td class="mono dim">{{ f.ann_date || '—' }}</td>
              <td class="num">{{ pct(f.disclosed_coverage, 0) }}</td>
              <td class="num dim">{{ f.n_holdings }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <div v-else-if="!loading" class="card">
      <div class="empty">
        <div class="empty-icon"><Icon name="portfolio" :size="20" /></div>
        <div class="empty-title">填入基金,看真实底层暴露</div>
        <div class="empty-desc">
          输入持有的基金 / ETF(+权重)→ 穿透到底层股票与行业分布。季报只披露前十大重仓,故穿透为部分,
          会如实标注覆盖率。
        </div>
      </div>
    </div>

    <p class="disclaimer">
      穿透基于公募季报披露的前十大重仓(占净值约 30–70%),其余未披露部分不穿透、不补满;持仓按披露日
      PIT。 仅供研究,非投资建议。
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
.card-head.bare {
  margin-bottom: 12px;
}
.fund-rows {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.fund-row {
  display: flex;
  gap: 8px;
  align-items: center;
}
.fund-row .input {
  flex: 1;
}
.fund-row .wt {
  width: 96px;
  flex: none;
}
.row-x {
  width: 30px;
  height: 30px;
  border-radius: var(--r-sm);
  border: none;
  background: transparent;
  color: var(--text-3);
  cursor: pointer;
  display: grid;
  place-items: center;
  flex: none;
}
.row-x:hover {
  background: var(--bg-elevated);
  color: var(--text-1);
}
.fund-actions {
  display: flex;
  justify-content: space-between;
  margin-top: 12px;
}
.hint {
  margin: 12px 0 0;
  color: var(--text-3);
  line-height: 1.6;
}
.msg-err {
  margin: 10px 0 0;
  color: var(--status-err);
  font-size: var(--fs-sub);
  display: flex;
  align-items: center;
  gap: 6px;
}

/* 覆盖率横幅 */
.cover {
  padding: 16px 20px;
}
.cover-main {
  display: flex;
  align-items: baseline;
  gap: 10px;
}
.cover-v {
  font-size: 26px;
  font-weight: 700;
  color: var(--text-1);
}
.cover-sub {
  font-size: 12px;
  color: var(--text-3);
}
.cover-bar {
  height: 8px;
  border-radius: 4px;
  background: var(--bg-input);
  overflow: hidden;
  margin: 10px 0 8px;
}
.cover-fill {
  height: 100%;
  border-radius: 4px;
  background: var(--accent-grad);
}
.cover-note {
  margin: 0;
  color: var(--text-3);
  line-height: 1.6;
}
.banner-warn {
  margin: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 14px;
  border-radius: var(--r-md);
  font-size: var(--fs-sub);
  color: var(--status-warn);
  background: var(--status-warn-bg, var(--bg-elevated));
  border: 0.5px solid var(--status-warn);
}

.cols {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
  gap: 20px;
  align-items: start;
}
.sym {
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.sym .nm {
  font-weight: 500;
  color: var(--text-1);
  font-size: 12.5px;
}
.sym .cd {
  font-size: 10.5px;
  color: var(--text-3);
}
.ind {
  color: var(--text-2);
  font-size: 12px;
}
.dim {
  color: var(--text-3);
}
.exp {
  display: flex;
  align-items: center;
  gap: 9px;
  justify-content: flex-end;
}
.exp-v {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text-1);
}
.exp-track {
  width: 90px;
  height: 6px;
  border-radius: 3px;
  background: var(--bg-input);
  overflow: hidden;
  flex: none;
}
.exp-fill {
  display: block;
  height: 100%;
  border-radius: 3px;
  background: var(--accent-grad);
}
.sectors {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px 18px;
}
.sec-top {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 5px;
}
.sec-name {
  font-size: 12.5px;
  color: var(--text-1);
}
.sec-v {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text-1);
}
.sec-track {
  height: 7px;
  border-radius: 4px;
  background: var(--bg-input);
  overflow: hidden;
}
.sec-fill {
  display: block;
  height: 100%;
  border-radius: 4px;
  background: var(--accent-grad);
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
