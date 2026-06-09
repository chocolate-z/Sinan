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
  <div class="page">
    <header class="page-head">
      <h1>信号</h1>
      <p class="sub">盘后打分出信号 · 模拟撮合;纪律高于模型</p>
    </header>

    <!-- 运行工具条 -->
    <div class="m-card runner">
      <div class="m-toolbar">
        <label class="field-group">
          <span class="field-label">信号日 T</span>
          <input v-model="today" class="m-field" type="date" />
        </label>
        <label class="field-group">
          <span class="field-label">生效日 T+1</span>
          <input v-model="effective" class="m-field" type="date" />
        </label>
        <span class="spacer" />
        <button
          class="m-btn m-btn--primary"
          :disabled="!today || !effective || trading.loading"
          @click="run"
        >
          {{ trading.loading ? '运行中…' : '盘后跑一轮(出信号 + 模拟撮合)' }}
        </button>
        <button class="m-btn m-btn--ghost" :disabled="!today" @click="load">查看该日信号</button>
      </div>
      <p v-if="trading.error" class="status-err run-err">{{ trading.error }}</p>
    </div>

    <!-- 生效信号 -->
    <div class="m-card sec">
      <div class="sec-head">
        <h3>生效信号</h3>
        <span class="m-chip">{{ trading.activeSignals.length }}</span>
      </div>
      <table v-if="trading.activeSignals.length" class="m-table">
        <thead>
          <tr>
            <th>代码</th>
            <th>方向</th>
            <th class="r">综合分</th>
            <th>因子贡献</th>
            <th>原因</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in trading.activeSignals" :key="s.stock_code">
            <td class="num">{{ s.stock_code }}</td>
            <td>
              <span class="m-badge" :class="actionClass(s.action)">{{
                actionLabel(s.action)
              }}</span>
            </td>
            <td class="num r">{{ s.score?.toFixed(3) ?? '—' }}</td>
            <td>
              <span
                v-for="[f, v] in factorEntries(s.factor_breakdown).slice(0, 4)"
                :key="f"
                class="m-chip factor"
              >
                {{ f }} <span class="num">{{ v >= 0 ? '+' : '' }}{{ v.toFixed(2) }}</span>
              </span>
            </td>
            <td class="m-muted">{{ reasonLabel(s.reason) }}</td>
          </tr>
        </tbody>
      </table>
      <p v-else class="m-muted empty">暂无生效信号。选信号日并「盘后跑一轮」生成。</p>
    </div>

    <!-- 被风控拦截组 -->
    <div v-if="trading.blockedSignals.length" class="m-card sec">
      <div class="sec-head">
        <h3 class="status-warn">已生成但被拦截</h3>
        <span class="m-chip">{{ trading.blockedSignals.length }}</span>
      </div>
      <p class="m-muted note">这些标的打分入选,但被风控闸拦下 —— 纪律高于模型。</p>
      <table class="m-table">
        <thead>
          <tr>
            <th>代码</th>
            <th>方向</th>
            <th class="r">综合分</th>
            <th>拦截原因</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in trading.blockedSignals" :key="s.stock_code">
            <td class="num">{{ s.stock_code }}</td>
            <td>
              <span class="m-badge" :class="actionClass(s.action)">{{
                actionLabel(s.action)
              }}</span>
            </td>
            <td class="num r">{{ s.score?.toFixed(3) ?? '—' }}</td>
            <td class="status-warn">{{ reasonLabel(s.reason) }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <p class="disclaimer">
      仅供研究参考,非投资建议;模拟盘为纸面前向验证,不构成真实交易、不进行任何自动真实下单。
    </p>
  </div>
</template>

<style scoped>
.page-head {
  margin-bottom: var(--sp-5);
}
.page-head .sub {
  color: var(--c-text-3);
  font-size: var(--fs-cap);
  margin-top: 2px;
}

/* 卡片间距 */
.runner,
.sec {
  margin-bottom: var(--sp-3);
}

/* 运行工具条 */
.field-group {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}
.field-label {
  font-size: var(--fs-cap);
  color: var(--c-text-2);
  white-space: nowrap;
}
.spacer {
  flex: 1;
}
.run-err {
  margin: var(--sp-3) 0 0;
  font-size: var(--fs-cap);
}

/* 分区标题 */
.sec-head {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  margin-bottom: var(--sp-3);
}
.sec-head h3 {
  margin: 0;
  font-size: var(--fs-h3);
}
.note {
  margin: 0 0 var(--sp-3);
  font-size: var(--fs-cap);
}
.empty {
  margin: 0;
  font-size: var(--fs-body);
}

/* 因子贡献 chip */
.factor {
  margin-right: var(--sp-1);
}

/* 方向徽章随 actionClass 的系统色着色;持有(无 class)走中性 */
.m-badge {
  color: var(--c-text-2);
}
</style>
