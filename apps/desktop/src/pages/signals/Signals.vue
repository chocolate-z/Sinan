<script setup lang="ts">
import { ref } from 'vue';
import { useTradingStore } from '../../stores/trading';
import { actionClass, actionLabel, factorEntries, reasonLabel } from '../../lib/signals';

const trading = useTradingStore();
const today = ref('');
const effective = ref('');

async function run() {
  if (!today.value || !effective.value) return;
  await trading.runPaper(today.value, effective.value);
}

function load() {
  if (today.value) trading.fetchSignals(today.value);
}
</script>

<template>
  <div>
    <h1>信号</h1>

    <div class="bar card">
      <label>信号日 T <input v-model="today" type="date" /></label>
      <label>生效日 T+1 <input v-model="effective" type="date" /></label>
      <button class="primary" :disabled="!today || !effective || trading.loading" @click="run">
        {{ trading.loading ? '运行中…' : '盘后跑一轮(出信号 + 模拟撮合)' }}
      </button>
      <button class="ghost" :disabled="!today" @click="load">查看该日信号</button>
    </div>

    <p v-if="trading.error" class="status-err">{{ trading.error }}</p>

    <!-- 生效信号 -->
    <div class="card">
      <h3>
        生效信号 <span class="muted">({{ trading.activeSignals.length }})</span>
      </h3>
      <table v-if="trading.activeSignals.length" class="tbl num">
        <thead>
          <tr>
            <th>代码</th>
            <th>方向</th>
            <th>综合分</th>
            <th>因子贡献</th>
            <th>原因</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in trading.activeSignals" :key="s.stock_code">
            <td>{{ s.stock_code }}</td>
            <td :class="actionClass(s.action)">{{ actionLabel(s.action) }}</td>
            <td>{{ s.score?.toFixed(3) ?? '—' }}</td>
            <td>
              <span
                v-for="[f, v] in factorEntries(s.factor_breakdown).slice(0, 4)"
                :key="f"
                class="chip"
              >
                {{ f }} {{ v >= 0 ? '+' : '' }}{{ v.toFixed(2) }}
              </span>
            </td>
            <td class="muted">{{ reasonLabel(s.reason) }}</td>
          </tr>
        </tbody>
      </table>
      <p v-else class="muted">暂无生效信号。选信号日并「盘后跑一轮」生成。</p>
    </div>

    <!-- 被风控拦截组 -->
    <div v-if="trading.blockedSignals.length" class="card">
      <h3 class="status-warn">
        已生成但被拦截 <span class="muted">({{ trading.blockedSignals.length }})</span>
      </h3>
      <p class="muted">这些标的打分入选,但被风控闸拦下 —— 纪律高于模型。</p>
      <table class="tbl num">
        <thead>
          <tr>
            <th>代码</th>
            <th>方向</th>
            <th>综合分</th>
            <th>拦截原因</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in trading.blockedSignals" :key="s.stock_code">
            <td>{{ s.stock_code }}</td>
            <td>{{ actionLabel(s.action) }}</td>
            <td>{{ s.score?.toFixed(3) ?? '—' }}</td>
            <td class="status-warn">{{ reasonLabel(s.reason) }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <p class="mt-6 text-xs text-ink-3">
      仅供研究参考,非投资建议;模拟盘为纸面前向验证,不构成真实交易、不进行任何自动真实下单。
    </p>
  </div>
</template>

<style scoped>
.card {
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--r-lg);
  padding: var(--sp-4);
  margin-bottom: var(--sp-3);
}
.bar {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  flex-wrap: wrap;
}
.bar label {
  display: flex;
  gap: var(--sp-1);
  align-items: center;
  font-size: var(--fs-cap);
  color: var(--c-text-2);
}
.bar input {
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
.chip {
  display: inline-block;
  background: var(--c-surface-2);
  border-radius: var(--r-sm);
  padding: 0 var(--sp-1);
  margin-right: var(--sp-1);
}
.primary {
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: var(--r-md);
  padding: var(--sp-2) var(--sp-4);
  cursor: pointer;
}
.primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.ghost {
  background: none;
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  padding: var(--sp-2) var(--sp-3);
  cursor: pointer;
}
.muted {
  color: var(--c-text-3);
}
</style>
