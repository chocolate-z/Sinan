<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { useTradingStore } from '../../stores/trading';
import { useAppStore } from '../../stores/app';
import { formatPnl } from '../../lib/pnl';

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
});
</script>

<template>
  <div class="page">
    <header class="page-head">
      <h1>持仓</h1>
      <p class="sub">个人持仓与模型模拟盘两套账本完全独立</p>
    </header>

    <div class="m-segmented tabs">
      <button :class="{ on: tab === 'personal' }" @click="tab = 'personal'">个人持仓</button>
      <button :class="{ on: tab === 'model' }" @click="tab = 'model'">模型模拟盘</button>
    </div>

    <!-- 个人(手动维护)-->
    <section v-if="tab === 'personal'" class="ledger ledger--personal">
      <div class="m-card kpi">
        <div class="kpi-item">
          <span class="kpi-label">持仓数</span>
          <b class="num">{{ trading.personalHoldings.length }}</b>
        </div>
        <div v-if="trading.personalPnlLatest" class="kpi-item">
          <span class="kpi-label">当日盈亏</span>
          <b class="num" :class="app.pnlClass(trading.personalPnlLatest.day_pnl)">
            {{ formatPnl(trading.personalPnlLatest.day_pnl) }}
            ({{ (trading.personalPnlLatest.day_pnl_pct * 100).toFixed(2) }}%)
          </b>
        </div>
      </div>

      <div class="m-card">
        <div class="m-toolbar add">
          <input v-model="form.stock_code" class="m-field" placeholder="代码 如 600519.SH" />
          <input v-model="form.stock_name" class="m-field" placeholder="名称(选填)" />
          <input v-model.number="form.shares" class="m-field" type="number" placeholder="数量" />
          <input
            v-model.number="form.avg_cost"
            class="m-field"
            type="number"
            placeholder="成本价"
          />
          <button class="m-btn m-btn--primary" @click="addPersonal">+ 建仓/加仓</button>
        </div>

        <table v-if="trading.personalHoldings.length" class="m-table">
          <thead>
            <tr>
              <th>代码</th>
              <th>名称</th>
              <th class="r">数量</th>
              <th class="r">成本价</th>
              <th class="r">市值</th>
              <th class="r"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="h in trading.personalHoldings" :key="h.stock_code">
              <td class="num">{{ h.stock_code }}</td>
              <td>{{ h.stock_name ?? '—' }}</td>
              <td class="r num">{{ h.shares }}</td>
              <td class="r num">{{ h.avg_cost?.toFixed(2) }}</td>
              <td class="r num">{{ h.market_value?.toFixed(2) ?? '—' }}</td>
              <td class="r">
                <button
                  class="m-btn m-btn--ghost m-btn--sm"
                  @click="trading.removePersonal(h.stock_code)"
                >
                  删除
                </button>
              </td>
            </tr>
          </tbody>
        </table>
        <p v-else class="m-muted empty">
          记录你的真实持仓以跟踪当日收益(不会自动下单,数据仅存本机)。
        </p>
      </div>
    </section>

    <!-- 模型(自动只读)-->
    <section v-else class="ledger ledger--model">
      <div class="m-card kpi">
        <div v-if="trading.modelPnlLatest" class="kpi-item">
          <span class="kpi-label">模拟净值</span>
          <b class="num">{{ trading.modelPnlLatest.total_assets?.toFixed(0) }}</b>
        </div>
        <div v-if="trading.modelPnlLatest" class="kpi-item">
          <span class="kpi-label">当日</span>
          <b class="num" :class="app.pnlClass(trading.modelPnlLatest.day_pnl_pct)">
            {{ (trading.modelPnlLatest.day_pnl_pct * 100).toFixed(2) }}%
          </b>
        </div>
        <div v-if="trading.modelPnlLatest?.excess_pct != null" class="kpi-item">
          <span class="kpi-label">超额</span>
          <b class="num" :class="app.pnlClass(trading.modelPnlLatest.excess_pct)">
            {{ (trading.modelPnlLatest.excess_pct * 100).toFixed(2) }}%
          </b>
        </div>
        <span class="m-chip tag">纸面前向验证,非真实交易</span>
      </div>

      <div class="m-card">
        <table v-if="trading.modelHoldings.length" class="m-table">
          <thead>
            <tr>
              <th>代码</th>
              <th class="r">数量</th>
              <th class="r">成本价</th>
              <th class="r">进场日</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="h in trading.modelHoldings" :key="h.stock_code">
              <td class="num">{{ h.stock_code }}</td>
              <td class="r num">{{ h.shares }}</td>
              <td class="r num">{{ h.avg_cost?.toFixed(2) }}</td>
              <td class="r num">{{ (h as any).buy_date ?? '—' }}</td>
            </tr>
          </tbody>
        </table>
        <p v-else class="m-muted empty">启用某模型并盘后跑一轮后,这里出现自动持仓。</p>
      </div>
    </section>

    <p class="disclaimer">
      个人与模型两套账本完全独立;仅供研究,非投资建议;模拟盘不进行任何自动真实下单。
    </p>
  </div>
</template>

<style scoped>
.page-head {
  margin-bottom: var(--sp-4);
}
.page-head .sub {
  color: var(--c-text-3);
  font-size: var(--fs-cap);
  margin-top: 2px;
}
.tabs {
  margin-bottom: var(--sp-4);
}

/* 两套账本视觉分隔:个人(中性)/ 模型(轻微底色区分),各卡片留白充足 */
.ledger {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}
.ledger--model {
  border-left: 2px solid var(--c-border);
  padding-left: var(--sp-4);
  margin-left: 2px;
}

.kpi {
  display: flex;
  align-items: center;
  gap: var(--sp-6);
  flex-wrap: wrap;
  padding: var(--sp-5);
}
.kpi-item {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
}
.kpi-label {
  color: var(--c-text-3);
  font-size: var(--fs-cap);
  font-weight: 500;
}
.kpi-item b {
  font-size: var(--fs-h3);
  font-weight: 600;
  letter-spacing: -0.01em;
}
.tag {
  margin-left: auto;
}

.add {
  margin-bottom: var(--sp-4);
}
.add .m-field {
  min-width: 0;
  flex: 1 1 140px;
}

.empty {
  font-size: var(--fs-body);
  padding: var(--sp-2) 0;
}

.disclaimer {
  margin-top: var(--sp-6);
  color: var(--c-text-3);
  font-size: var(--fs-cap);
}
</style>
