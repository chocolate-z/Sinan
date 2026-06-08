<script setup lang="ts">
import { onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useAppStore } from '../../stores/app';
import { useTradingStore } from '../../stores/trading';
import { formatPnl } from '../../lib/pnl';

const app = useAppStore();
const trading = useTradingStore();
const router = useRouter();

onMounted(() => {
  if (app.onboardingDone) {
    trading.fetchModel();
    trading.fetchPersonal();
  }
});
</script>

<template>
  <div>
    <h1>总览</h1>

    <div v-if="!app.onboardingDone" class="guide card">
      <h2>欢迎使用司南</h2>
      <p>全本机量化助手 —— 你的数据、你的 token、你的电脑;我们不碰任何数据。</p>
      <ul>
        <li>① 选择你自己的数据源(Tushare Pro / AkShare 免费)</li>
        <li>② 填入 token(仅加密存本机钥匙串)</li>
        <li>③ 测试连接并建立本地缓存(可断点续传)</li>
      </ul>
      <button class="primary" @click="router.push('/onboarding')">开始配置 →</button>
    </div>

    <template v-else>
      <!-- 当日收益双卡:个人持仓与模型模拟盘完全分开 -->
      <div class="kpis">
        <div class="card kpi">
          <div class="kpi-label">当日收益 · 个人</div>
          <div
            v-if="trading.personalPnlLatest"
            class="kpi-val"
            :class="app.pnlClass(trading.personalPnlLatest.day_pnl)"
          >
            {{ formatPnl(trading.personalPnlLatest.day_pnl) }}
            <span class="kpi-pct"
              >{{ (trading.personalPnlLatest.day_pnl_pct * 100).toFixed(2) }}%</span
            >
          </div>
          <div v-else class="muted">暂无(在「持仓 · 个人」记录持仓)</div>
        </div>
        <div class="card kpi">
          <div class="kpi-label">当日收益 · 模型</div>
          <div
            v-if="trading.modelPnlLatest"
            class="kpi-val"
            :class="app.pnlClass(trading.modelPnlLatest.day_pnl_pct)"
          >
            {{ (trading.modelPnlLatest.day_pnl_pct * 100).toFixed(2) }}%
            <span v-if="trading.modelPnlLatest.excess_pct != null" class="kpi-pct">
              超额 {{ (trading.modelPnlLatest.excess_pct * 100).toFixed(2) }}%
            </span>
          </div>
          <div v-else class="muted">暂无(在「信号」盘后跑一轮)</div>
        </div>
      </div>
      <div class="card">
        <p class="muted">
          数据源 <strong>{{ app.activeProvider }}</strong> · 当日收益来自实时源「现价 vs 昨收」(M1
          起逐日累计); 净值 vs 沪深300 曲线与风控闸状态条将随回测/调度接入。
        </p>
      </div>
    </template>

    <!-- 用 Tailwind 工具类(text-ink-3 映射自设计令牌 --c-text-3)渲染常驻免责声明。 -->
    <p class="mt-6 text-xs text-ink-3">
      司南是研究与纪律辅助工具,不是投资顾问。所有信号/回测/模拟盘仅供研究参考,不构成投资建议。
    </p>
  </div>
</template>

<style scoped>
.card {
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--r-lg);
  padding: var(--sp-5);
  margin-top: var(--sp-4);
}
.primary {
  margin-top: var(--sp-3);
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: var(--r-md);
  padding: var(--sp-2) var(--sp-4);
  cursor: pointer;
}
.muted {
  color: var(--c-text-3);
}
.kpis {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--sp-3);
}
.kpi {
  margin-top: var(--sp-4);
}
.kpi-label {
  color: var(--c-text-3);
  font-size: var(--fs-cap);
}
.kpi-val {
  font-family: var(--font-num);
  font-size: var(--fs-h2);
  font-weight: 600;
  margin-top: var(--sp-1);
}
.kpi-pct {
  font-size: var(--fs-cap);
  margin-left: var(--sp-2);
  color: var(--c-text-3);
}
</style>
