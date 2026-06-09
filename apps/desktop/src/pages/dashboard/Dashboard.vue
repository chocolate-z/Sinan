<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useAppStore } from '../../stores/app';
import { useTradingStore } from '../../stores/trading';
import { formatPnl } from '../../lib/pnl';
import { fmt } from '../../lib/format';
import PageHero from '../../ui/PageHero.vue';
import Icon from '../../shell/Icon.vue';

const app = useAppStore();
const trading = useTradingStore();
const router = useRouter();

onMounted(() => {
  if (app.onboardingDone) {
    trading.fetchModel();
    trading.fetchPersonal();
    trading.fetchLivePnl();
  }
});

function mvSum(holds: Array<{ market_value?: number | null }>): number {
  return holds.reduce((s, h) => s + (h.market_value ?? 0), 0);
}
const personalMV = computed(() => mvSum(trading.personalHoldings));
const modelMV = computed(() => mvSum(trading.modelHoldings));

const personalDay = computed(
  () => trading.livePersonal?.day_pnl ?? trading.personalPnlLatest?.day_pnl ?? null,
);
const modelDay = computed(() => trading.liveModel?.day_pnl ?? null);
const modelDayPct = computed(() => trading.modelPnlLatest?.day_pnl_pct ?? null);
const modelExcess = computed(() => trading.modelPnlLatest?.excess_pct ?? null);

function pct(v: number | null | undefined, dec = 2): string {
  return v == null ? '—' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(dec)}%`;
}
</script>

<template>
  <PageHero
    title="总览"
    :sub="`数据源 ${app.activeProvider ?? '未配置'} · 当日收益来自实时源「现价 vs 昨收」`"
  >
    <template #right>
      <button class="btn btn-secondary btn-sm" @click="router.push('/signals')">
        <Icon name="refresh" :size="14" /> 盘后跑一轮
      </button>
    </template>
  </PageHero>

  <div class="page-body">
    <!-- 首启引导 -->
    <div v-if="!app.onboardingDone" class="card card-pad guide">
      <h2 class="guide-title">欢迎使用司南</h2>
      <p class="guide-lead">全本机量化助手 —— 你的数据、你的 token、你的电脑;我们不碰任何数据。</p>
      <ol class="steps">
        <li><span class="n">1</span> 选择你自己的数据源(Tushare Pro / AkShare 免费)</li>
        <li><span class="n">2</span> 填入 token(仅加密存本机钥匙串)</li>
        <li><span class="n">3</span> 测试连接并建立本地缓存(可断点续传)</li>
      </ol>
      <button class="btn btn-primary" @click="router.push('/onboarding')">开始配置 →</button>
    </div>

    <template v-else>
      <!-- PnL 双卡 -->
      <div class="grid-2">
        <div class="card card-pad stat">
          <div class="stat-top">
            <span class="cap">个人账户 · 当日收益</span>
            <span class="ch-tag"><i style="background: var(--pnl-up)" />PnL</span>
          </div>
          <div class="stat-val mono" :class="app.pnlClass(personalDay ?? 0)">
            {{ personalDay == null ? '—' : '¥' + formatPnl(personalDay) }}
          </div>
          <div class="hairline" />
          <div class="stat-metrics">
            <div class="metric">
              <div class="m-k">持仓市值</div>
              <div class="m-v mono">¥{{ fmt(personalMV, 0) }}</div>
            </div>
            <div class="metric">
              <div class="m-k">实时</div>
              <div class="m-v mono">
                {{ trading.livePersonal?.degraded ? '部分缺价' : '现价×持仓' }}
              </div>
            </div>
          </div>
        </div>

        <div class="card card-pad stat">
          <div class="stat-top">
            <span class="cap">模型模拟盘 · 当日收益</span>
            <span class="ch-tag"><i style="background: var(--pnl-up)" />PnL</span>
          </div>
          <div class="stat-val mono" :class="app.pnlClass(modelDay ?? modelDayPct ?? 0)">
            {{ modelDay != null ? '¥' + formatPnl(modelDay) : pct(modelDayPct) }}
          </div>
          <div class="hairline" />
          <div class="stat-metrics">
            <div class="metric">
              <div class="m-k">持仓市值</div>
              <div class="m-v mono">¥{{ fmt(modelMV, 0) }}</div>
            </div>
            <div class="metric">
              <div class="m-k">当日超额(vs 沪深300)</div>
              <div class="m-v mono" :class="modelExcess != null ? app.pnlClass(modelExcess) : ''">
                {{ pct(modelExcess) }}
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 净值曲线(待接入)+ 今日信号 -->
      <div class="grid-21">
        <div class="card">
          <div class="card-head">
            <div>
              <h3 class="card-title">模型净值 vs 沪深300</h3>
              <span class="card-sub">累计净值 · 含回撤 · 样本外</span>
            </div>
          </div>
          <div class="card-pad">
            <div class="empty">
              <div class="empty-icon"><Icon name="market" :size="20" /></div>
              <div class="empty-title">净值曲线待接入</div>
              <div class="empty-desc">
                到「回测」生成一次样本外净值曲线,或随盘后调度逐日累计后在此展示。
              </div>
              <button class="btn btn-primary btn-sm" @click="router.push('/backtest')">
                去回测 →
              </button>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-head">
            <div>
              <h3 class="card-title">今日信号</h3>
              <span class="card-sub">收盘后由因子模型生成</span>
            </div>
          </div>
          <div class="card-pad">
            <div class="empty">
              <div class="empty-icon"><Icon name="signals" :size="20" /></div>
              <div class="empty-title">今日尚未生成信号</div>
              <div class="empty-desc">到「信号」页盘后跑一轮,产出当日买卖信号与被风控拦截组。</div>
              <button class="btn btn-secondary btn-sm" @click="router.push('/signals')">
                去信号 →
              </button>
            </div>
          </div>
        </div>
      </div>

      <p class="disclaimer">
        司南是研究与纪律辅助工具,不是投资顾问。所有信号/回测/模拟盘仅供研究参考,不构成投资建议。
      </p>
    </template>
  </div>
</template>

<style scoped>
.page-body {
  padding: 28px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.grid-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
}
.grid-21 {
  display: grid;
  grid-template-columns: minmax(0, 2.1fr) minmax(0, 1fr);
  gap: 20px;
}
.stat {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.stat-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.ch-tag {
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
.stat-val {
  font-size: var(--fs-mono-lg);
  font-weight: 600;
  line-height: 1;
  letter-spacing: -0.01em;
}
.stat-metrics {
  display: flex;
  gap: 24px;
}
.m-k {
  font-size: 11px;
  color: var(--text-3);
  margin-bottom: 3px;
  white-space: nowrap;
}
.m-v {
  font-size: 13px;
  color: var(--text-1);
  font-weight: 500;
}
.empty-title {
  font-size: var(--fs-h3);
  font-weight: 600;
  color: var(--text-1);
}
.empty-desc {
  font-size: var(--fs-sub);
  color: var(--text-2);
  max-width: 320px;
  line-height: 1.5;
}
.guide {
  max-width: 560px;
}
.guide-title {
  margin: 0 0 8px;
  font-size: var(--fs-h2);
}
.guide-lead {
  color: var(--text-2);
  margin: 0 0 16px;
}
.steps {
  list-style: none;
  padding: 0;
  margin: 0 0 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.steps li {
  display: flex;
  align-items: center;
  gap: 12px;
  color: var(--text-1);
}
.steps .n {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--accent-bg);
  color: var(--accent);
  font-size: var(--fs-cap);
  font-weight: 600;
  flex: none;
}
.disclaimer {
  margin: 4px 0 0;
  color: var(--text-3);
  font-size: var(--fs-cap);
}
</style>
