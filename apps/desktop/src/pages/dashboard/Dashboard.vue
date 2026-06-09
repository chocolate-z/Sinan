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
    trading.fetchLivePnl(); // 实时当日收益(现价 vs 昨收)
  }
});
</script>

<template>
  <div class="page">
    <header class="page-head">
      <h1>总览</h1>
      <p class="sub">本机量化助手 · 数据与 token 全程留在你的电脑</p>
    </header>

    <div v-if="!app.onboardingDone" class="m-panel guide">
      <h2>欢迎使用司南</h2>
      <p class="lead">全本机量化助手 —— 你的数据、你的 token、你的电脑;我们不碰任何数据。</p>
      <ol class="steps">
        <li><span class="n">1</span> 选择你自己的数据源(Tushare Pro / AkShare 免费)</li>
        <li><span class="n">2</span> 填入 token(仅加密存本机钥匙串)</li>
        <li><span class="n">3</span> 测试连接并建立本地缓存(可断点续传)</li>
      </ol>
      <button class="m-btn m-btn--primary" @click="router.push('/onboarding')">开始配置 →</button>
    </div>

    <template v-else>
      <!-- 当日收益双卡:个人持仓与模型模拟盘完全分开 -->
      <div class="kpis">
        <div class="m-card kpi">
          <div class="kpi-label">当日收益 · 个人</div>
          <div
            v-if="trading.livePersonal"
            class="kpi-val num"
            :class="app.pnlClass(trading.livePersonal.day_pnl)"
          >
            {{ formatPnl(trading.livePersonal.day_pnl) }}
            <span class="kpi-pct"
              >实时{{ trading.livePersonal.degraded ? ' · 部分缺价' : '' }}</span
            >
          </div>
          <div
            v-else-if="trading.personalPnlLatest"
            class="kpi-val num"
            :class="app.pnlClass(trading.personalPnlLatest.day_pnl)"
          >
            {{ formatPnl(trading.personalPnlLatest.day_pnl) }}
            <span class="kpi-pct"
              >{{ (trading.personalPnlLatest.day_pnl_pct * 100).toFixed(2) }}% · 盘后</span
            >
          </div>
          <div v-else class="kpi-empty">暂无(在「持仓 · 个人」记录持仓)</div>
        </div>
        <div class="m-card kpi">
          <div class="kpi-label">当日收益 · 模型</div>
          <div
            v-if="trading.liveModel"
            class="kpi-val num"
            :class="app.pnlClass(trading.liveModel.day_pnl)"
          >
            {{ formatPnl(trading.liveModel.day_pnl) }}
            <span class="kpi-pct">实时{{ trading.liveModel.degraded ? ' · 部分缺价' : '' }}</span>
          </div>
          <div
            v-else-if="trading.modelPnlLatest"
            class="kpi-val num"
            :class="app.pnlClass(trading.modelPnlLatest.day_pnl_pct)"
          >
            {{ (trading.modelPnlLatest.day_pnl_pct * 100).toFixed(2) }}%
            <span v-if="trading.modelPnlLatest.excess_pct != null" class="kpi-pct">
              超额 {{ (trading.modelPnlLatest.excess_pct * 100).toFixed(2) }}%
            </span>
          </div>
          <div v-else class="kpi-empty">暂无(在「信号」盘后跑一轮)</div>
        </div>
      </div>

      <div class="m-card note">
        <p>
          数据源 <strong>{{ app.activeProvider }}</strong> · 当日收益来自实时源「现价 vs 昨收」(M1
          起逐日累计);净值 vs 沪深300 曲线与风控闸状态条将随回测/调度接入。
        </p>
      </div>
    </template>

    <p class="disclaimer">
      司南是研究与纪律辅助工具,不是投资顾问。所有信号/回测/模拟盘仅供研究参考,不构成投资建议。
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
.guide {
  max-width: 560px;
}
.guide h2 {
  margin: 0 0 var(--sp-2);
}
.guide .lead {
  color: var(--c-text-2);
  margin-bottom: var(--sp-4);
}
.steps {
  list-style: none;
  padding: 0;
  margin: 0 0 var(--sp-5);
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}
.steps li {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  color: var(--c-text);
}
.steps .n {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--accent-weak);
  color: var(--accent);
  font-size: var(--fs-cap);
  font-weight: 600;
  flex: none;
}
.kpis {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--sp-4);
}
.kpi {
  padding: var(--sp-5);
}
.kpi-label {
  color: var(--c-text-3);
  font-size: var(--fs-cap);
  font-weight: 500;
}
.kpi-val {
  font-size: 30px;
  font-weight: 600;
  margin-top: var(--sp-2);
  letter-spacing: -0.02em;
}
.kpi-pct {
  font-size: var(--fs-cap);
  font-weight: 400;
  margin-left: var(--sp-2);
  color: var(--c-text-3);
}
.kpi-empty {
  color: var(--c-text-3);
  margin-top: var(--sp-3);
  font-size: var(--fs-body);
}
.note {
  margin-top: var(--sp-4);
  color: var(--c-text-2);
}
.disclaimer {
  margin-top: var(--sp-6);
  color: var(--c-text-3);
  font-size: var(--fs-cap);
}
</style>
