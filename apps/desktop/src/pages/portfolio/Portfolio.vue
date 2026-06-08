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
  <div>
    <h1>持仓</h1>
    <div class="seg">
      <button :class="{ on: tab === 'personal' }" @click="tab = 'personal'">个人持仓</button>
      <button :class="{ on: tab === 'model' }" @click="tab = 'model'">模型模拟盘</button>
    </div>

    <!-- 个人(手动维护)-->
    <section v-if="tab === 'personal'">
      <div class="card kpi">
        <div>
          持仓数 <b>{{ trading.personalHoldings.length }}</b>
        </div>
        <div v-if="trading.personalPnlLatest">
          当日盈亏
          <b :class="app.pnlClass(trading.personalPnlLatest.day_pnl)">
            {{ formatPnl(trading.personalPnlLatest.day_pnl) }}
            ({{ (trading.personalPnlLatest.day_pnl_pct * 100).toFixed(2) }}%)
          </b>
        </div>
      </div>

      <div class="card">
        <div class="add">
          <input v-model="form.stock_code" placeholder="代码 如 600519.SH" />
          <input v-model="form.stock_name" placeholder="名称(选填)" />
          <input v-model.number="form.shares" type="number" placeholder="数量" />
          <input v-model.number="form.avg_cost" type="number" placeholder="成本价" />
          <button class="primary" @click="addPersonal">+ 建仓/加仓</button>
        </div>
        <table v-if="trading.personalHoldings.length" class="tbl num">
          <thead>
            <tr>
              <th>代码</th>
              <th>名称</th>
              <th>数量</th>
              <th>成本价</th>
              <th>市值</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="h in trading.personalHoldings" :key="h.stock_code">
              <td>{{ h.stock_code }}</td>
              <td>{{ h.stock_name ?? '—' }}</td>
              <td>{{ h.shares }}</td>
              <td>{{ h.avg_cost?.toFixed(2) }}</td>
              <td>{{ h.market_value?.toFixed(2) ?? '—' }}</td>
              <td>
                <button class="ghost" @click="trading.removePersonal(h.stock_code)">删除</button>
              </td>
            </tr>
          </tbody>
        </table>
        <p v-else class="muted">记录你的真实持仓以跟踪当日收益(不会自动下单,数据仅存本机)。</p>
      </div>
    </section>

    <!-- 模型(自动只读)-->
    <section v-else>
      <div class="card kpi">
        <div v-if="trading.modelPnlLatest">
          模拟净值 <b>{{ trading.modelPnlLatest.total_assets?.toFixed(0) }}</b>
        </div>
        <div v-if="trading.modelPnlLatest">
          当日
          <b :class="app.pnlClass(trading.modelPnlLatest.day_pnl_pct)">
            {{ (trading.modelPnlLatest.day_pnl_pct * 100).toFixed(2) }}%
          </b>
        </div>
        <div v-if="trading.modelPnlLatest?.excess_pct != null">
          超额
          <b :class="app.pnlClass(trading.modelPnlLatest.excess_pct)">
            {{ (trading.modelPnlLatest.excess_pct * 100).toFixed(2) }}%
          </b>
        </div>
        <div class="tag">纸面前向验证,非真实交易</div>
      </div>
      <div class="card">
        <table v-if="trading.modelHoldings.length" class="tbl num">
          <thead>
            <tr>
              <th>代码</th>
              <th>数量</th>
              <th>成本价</th>
              <th>进场日</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="h in trading.modelHoldings" :key="h.stock_code">
              <td>{{ h.stock_code }}</td>
              <td>{{ h.shares }}</td>
              <td>{{ h.avg_cost?.toFixed(2) }}</td>
              <td>{{ (h as any).buy_date ?? '—' }}</td>
            </tr>
          </tbody>
        </table>
        <p v-else class="muted">启用某模型并盘后跑一轮后,这里出现自动持仓。</p>
      </div>
    </section>

    <p class="mt-6 text-xs text-ink-3">
      个人与模型两套账本完全独立;仅供研究,非投资建议;模拟盘不进行任何自动真实下单。
    </p>
  </div>
</template>

<style scoped>
.seg {
  display: inline-flex;
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  overflow: hidden;
  margin: var(--sp-3) 0;
}
.seg button {
  background: var(--c-surface);
  border: none;
  padding: var(--sp-2) var(--sp-4);
  cursor: pointer;
  color: var(--c-text-2);
}
.seg button.on {
  background: var(--accent-weak);
  color: var(--accent);
}
.card {
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--r-lg);
  padding: var(--sp-4);
  margin-bottom: var(--sp-3);
}
.kpi {
  display: flex;
  gap: var(--sp-5);
  align-items: center;
  flex-wrap: wrap;
}
.kpi b {
  font-family: var(--font-num);
  margin-left: var(--sp-1);
}
.tag {
  margin-left: auto;
  color: var(--c-text-3);
  font-size: var(--fs-cap);
}
.add {
  display: flex;
  gap: var(--sp-2);
  flex-wrap: wrap;
  margin-bottom: var(--sp-3);
}
.add input {
  padding: var(--sp-1) var(--sp-2);
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
}
.tbl {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--fs-cap);
}
.tbl th,
.tbl td {
  text-align: left;
  padding: var(--sp-1) var(--sp-2);
  border-bottom: 1px solid var(--c-border);
}
.primary {
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: var(--r-md);
  padding: var(--sp-1) var(--sp-3);
  cursor: pointer;
}
.ghost {
  background: none;
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  padding: 0 var(--sp-2);
  cursor: pointer;
}
.muted {
  color: var(--c-text-3);
}
</style>
