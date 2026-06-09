<script setup lang="ts">
// 策略 / 模型(视觉壳)。设计稿 design_source/src/pages/strategy.jsx。
// 模型版本与样本外 IC/夏普/年化需 M3 训练里程碑产出 → 诚实空状态(红线#3)。
// 流水线为真实系统架构;股票池规则/风控/成本为打包默认基线(真值,来自 config.defaults.json,
// 单一真相源在仓库根 config.defaults.json;此处为只读展示,随模型可调)。
import PageHero from '../../ui/PageHero.vue';
import Icon from '../../shell/Icon.vue';

const PIPELINE: { icon: string; k: string; d: string }[] = [
  { icon: 'db', k: '数据落库', d: 'PIT 取数 · 防未来函数' },
  { icon: 'indicator', k: '因子计算', d: '横截面标准化 · 中性化' },
  { icon: 'signals', k: '合成打分', d: 'ICIR 加权合成' },
  { icon: 'shield', k: '风控过滤', d: '阈值 / 流动性 / 择时' },
  { icon: 'portfolio', k: '组合构建', d: 'Top-N 等权 · T+1' },
];

// —— 打包默认基线(对应 config.defaults.json 的 risk_defaults / split_defaults / cost_defaults)——
const POOL_RULES: { k: string; v: string }[] = [
  { k: '持仓数量', v: 'Top 5 · 等权' },
  { k: '单票上限', v: '20%' },
  { k: '买入阈值', v: '综合分 ≥ 0.65' },
  { k: '卖出阈值', v: '综合分 ≤ 0.35' },
  { k: '最短持有', v: '10 交易日' },
  { k: '卖出冷却', v: '5 交易日' },
  { k: '流动性过滤', v: '60 日均额 ≥ 2 亿' },
  { k: '大盘择时', v: 'MA20 之上' },
  { k: '信号滞后', v: '1 日(防未来函数)' },
];
const RISK_RULES: { k: string; v: string }[] = [
  { k: '个股止损', v: '−12%' },
  { k: '个股止盈', v: '+30%' },
  { k: '组合止损', v: '−12%' },
];
const BT_RULES: { k: string; v: string }[] = [
  { k: 'Purge(切分隔离)', v: '5 交易日' },
  { k: 'Embargo(切分禁区)', v: '6 交易日' },
  { k: '印花税(仅卖出)', v: '0.05%' },
  { k: '佣金', v: '万 2.5 · 最低 5 元' },
  { k: '冲击 / 滑点', v: '5 bps' },
];
</script>

<template>
  <PageHero
    title="策略 · 模型"
    sub="多因子选股模型的流水线、股票池与纪律化风控 · 下列为打包默认基线(随模型可调)"
  />

  <div class="page-body">
    <!-- 模型版本(诚实空:尚无已训练模型) -->
    <div class="card">
      <div class="card-head">
        <div>
          <h3 class="card-title">模型版本</h3>
          <span class="card-sub">样本外 IC / 夏普 / 年化 · 模型版本库</span>
        </div>
        <span class="badge badge-idle"><span class="dot" />M3 待接入</span>
      </div>
      <div class="card-pad">
        <div class="empty">
          <div class="empty-icon"><Icon name="model" :size="20" /></div>
          <div class="empty-title">尚无已训练模型</div>
          <div class="empty-desc">
            M3 训练里程碑接入后,这里展示各模型版本(运行中 / 已归档 / 验证中)及其真实样本外
            IC、夏普、年化 —— 样本内外并列、不夸大(红线#3)。
          </div>
        </div>
      </div>
    </div>

    <!-- 模型流水线(真实系统架构) -->
    <div class="card card-pad">
      <div class="pl-head">
        <h3 class="card-title">模型流水线</h3>
        <span class="card-sub">每个交易日收盘后自动执行</span>
      </div>
      <div class="pipeline">
        <template v-for="(s, i) in PIPELINE" :key="s.k">
          <div class="pl-step">
            <div class="pl-ic"><Icon :name="s.icon" :size="18" /></div>
            <div class="pl-k">{{ s.k }}</div>
            <div class="pl-d">{{ s.d }}</div>
          </div>
          <div v-if="i < PIPELINE.length - 1" class="pl-arrow">
            <Icon name="chevR" :size="16" />
          </div>
        </template>
      </div>
    </div>

    <!-- 规则 / 风控 / 口径(真实默认基线) -->
    <div class="cols">
      <div class="card">
        <div class="card-head">
          <div>
            <h3 class="card-title">股票池与规则</h3>
            <span class="card-sub">纪律化选股约束</span>
          </div>
        </div>
        <div class="rules">
          <div v-for="r in POOL_RULES" :key="r.k" class="rule">
            <span class="rule-k">{{ r.k }}</span>
            <span class="rule-v mono">{{ r.v }}</span>
          </div>
        </div>
      </div>

      <div class="right-col">
        <div class="card">
          <div class="card-head">
            <div>
              <h3 class="card-title">风控约束</h3>
              <span class="card-sub">组合级 · 与回测一致</span>
            </div>
            <span class="badge badge-ok"><span class="dot" />已启用</span>
          </div>
          <div class="rules">
            <div v-for="r in RISK_RULES" :key="r.k" class="rule">
              <span class="rule-k">{{ r.k }}</span>
              <span class="rule-v mono">{{ r.v }}</span>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-head">
            <div>
              <h3 class="card-title">回测口径与成本</h3>
              <span class="card-sub">诚实样本外 · 含成本</span>
            </div>
          </div>
          <div class="rules">
            <div v-for="r in BT_RULES" :key="r.k" class="rule">
              <span class="rule-k">{{ r.k }}</span>
              <span class="rule-v mono">{{ r.v }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <p class="disclaimer">
      上列参数为打包默认基线(单一真相源:config.defaults.json),随模型与你的偏好可调。模型与回测结果一律样本外口径,不构成投资建议(红线#2/#3)。
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

/* ── 流水线 ──────────────────────────────────────────────── */
.pl-head {
  margin-bottom: 18px;
}
.pipeline {
  display: flex;
  align-items: stretch;
}
.pl-step {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 10px;
  padding: 4px 8px;
}
.pl-ic {
  width: 40px;
  height: 40px;
  border-radius: var(--r-md);
  display: grid;
  place-items: center;
  background: var(--accent-bg);
  color: var(--accent);
  border: 0.5px solid var(--border);
}
.pl-k {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text-1);
}
.pl-d {
  font-size: 10.5px;
  color: var(--text-3);
  line-height: 1.45;
}
.pl-arrow {
  display: flex;
  align-items: flex-start;
  padding-top: 14px;
  color: var(--text-3);
  flex: none;
}

/* ── 规则行 ──────────────────────────────────────────────── */
.cols {
  display: grid;
  grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr);
  gap: 20px;
  align-items: start;
}
.right-col {
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.rules {
  padding: 6px 22px 14px;
}
.rule {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 10px 0;
  border-bottom: 0.5px solid var(--border-faint);
}
.rule:last-child {
  border-bottom: none;
}
.rule-k {
  font-size: 12.5px;
  color: var(--text-2);
}
.rule-v {
  font-size: 12.5px;
  color: var(--text-1);
  text-align: right;
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
