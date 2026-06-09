<script setup lang="ts">
// 指标 / 因子库(视觉壳)。设计稿 design_source/src/pages/indicators.jsx。
// 因子的 IC 均值 / ICIR / 覆盖度 / 十分位分层回测均需 M3 因子计算管线产出真实数据,
// 此处仅落地页面结构 + 真实因子类别体系 + 诚实空状态,绝不展示模拟数字(红线#3)。
import PageHero from '../../ui/PageHero.vue';
import Icon from '../../shell/Icon.vue';

// 真实因子类别体系(引擎因子库的组织维度,非市场数据)。
const CATEGORIES: { key: string; name: string; desc: string }[] = [
  { key: 'momentum', name: '动量', desc: '价格趋势的延续性(多周期收益)' },
  { key: 'value', name: '价值', desc: '估值偏离(PB / PE / 股息率)' },
  { key: 'quality', name: '质量', desc: '盈利能力与财务稳健(ROE / 毛利)' },
  { key: 'growth', name: '成长', desc: '营收 / 利润增速' },
  { key: 'sentiment', name: '情绪', desc: '市场关注与资金情绪' },
  { key: 'volatility', name: '波动', desc: '风险与波动特征(低波因子)' },
  { key: 'moneyflow', name: '资金流', desc: '主力 / 北向资金动向' },
  { key: 'reversal', name: '反转', desc: '短期超跌反转' },
];
</script>

<template>
  <PageHero
    title="指标 · 因子库"
    sub="多因子模型的原子构建块 · ICIR 加权合成 · M3/M4 接入因子计算管线后展示真实 IC 与十分位分层回测"
  />

  <div class="page-body">
    <!-- 色彩通道说明(静态、诚实) -->
    <div class="ch-legend">
      <span class="ch-tag"
        ><i style="background: var(--text-2)" />IC / ICIR / 覆盖度 = 中性通道</span
      >
      <span class="ch-tag"><i style="background: var(--pnl-up)" />分层收益 = PnL 通道</span>
      <span class="ch-tag"><i style="background: var(--accent)" />启用 / 权重 = Accent 通道</span>
    </div>

    <!-- 因子类别体系(真实分类) -->
    <div class="card">
      <div class="card-head">
        <div>
          <h3 class="card-title">因子类别体系</h3>
          <span class="card-sub"
            >{{ CATEGORIES.length }} 个研究维度 · 每个维度下含多个原子因子</span
          >
        </div>
      </div>
      <div class="card-pad">
        <div class="cat-grid">
          <div v-for="c in CATEGORIES" :key="c.key" class="cat-card">
            <div class="cat-name">{{ c.name }}</div>
            <div class="cat-desc">{{ c.desc }}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- 因子表 + 因子研究详情(结构就位,数据诚实待接入) -->
    <div class="cols">
      <div class="card">
        <div class="card-head">
          <div>
            <h3 class="card-title">因子库</h3>
            <span class="card-sub">IC 均值 / ICIR / 覆盖度 / 权重 / 启用</span>
          </div>
          <span class="badge badge-idle"><span class="dot" />M3 待接入</span>
        </div>
        <table class="dt">
          <thead>
            <tr>
              <th style="width: 150px">因子</th>
              <th>类别</th>
              <th class="num">IC 均值</th>
              <th class="num">ICIR</th>
              <th class="num">覆盖度</th>
              <th class="num">权重</th>
              <th style="width: 56px; text-align: center">启用</th>
            </tr>
          </thead>
          <tbody>
            <tr class="ph-row">
              <td colspan="7">
                <div class="empty">
                  <div class="empty-icon"><Icon name="indicator" :size="20" /></div>
                  <div class="empty-title">因子计算管线待接入</div>
                  <div class="empty-desc">
                    M3 训练里程碑接入后,这里展示每个因子的真实 IC 均值、ICIR、覆盖度、ICIR
                    加权权重与十分位分层收益 —— 绝不展示模拟数据。
                  </div>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="card card-pad detail">
        <div class="detail-head">
          <div>
            <h3 class="card-title">因子研究详情</h3>
            <span class="card-sub">选中某因子查看其研究画像</span>
          </div>
        </div>
        <div class="mini-grid">
          <div v-for="k in ['IC 均值', 'ICIR', '覆盖度', '半衰期']" :key="k" class="mini">
            <div class="mini-k">{{ k }}</div>
            <div class="mini-v mono">—</div>
          </div>
        </div>

        <div class="cap detail-label">IC 时序 · 近 36 月</div>
        <div class="chart-ph">
          <span class="ph-note">中性柱状(正紫负灰)· 待 M3</span>
        </div>

        <div class="cap detail-label">十分位分层回测</div>
        <div class="chart-ph">
          <span class="ph-note">D1–D10 收益(PnL 通道)· 待 M3</span>
        </div>
      </div>
    </div>

    <p class="disclaimer">
      因子研究指标(IC / ICIR / 综合分)属中性通道,非盈亏色;分层收益属 PnL
      通道。所有结果将来自真实样本外计算,样本内外并列、不夸大(红线#3)。
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
.ch-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
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

.cat-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
}
.cat-card {
  background: var(--bg-panel-2);
  border: 0.5px solid var(--border);
  border-radius: var(--r-md);
  padding: 13px 14px;
}
.cat-name {
  font-size: var(--fs-body);
  font-weight: 600;
  color: var(--text-1);
}
.cat-desc {
  font-size: 11.5px;
  color: var(--text-2);
  margin-top: 4px;
  line-height: 1.5;
}

.cols {
  display: grid;
  grid-template-columns: minmax(0, 1.45fr) minmax(0, 1fr);
  gap: 20px;
  align-items: start;
}
.ph-row td {
  height: auto;
  padding: 0;
}
.ph-row:hover {
  background: transparent;
}

.detail-head {
  margin-bottom: 16px;
}
.mini-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  margin-bottom: 18px;
}
.mini {
  background: var(--bg-panel-2);
  border-radius: var(--r-sm);
  padding: 10px 12px;
}
.mini-k {
  font-size: 10.5px;
  color: var(--text-3);
  margin-bottom: 4px;
}
.mini-v {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-1);
}
.detail-label {
  margin-bottom: 8px;
}
.chart-ph {
  height: 72px;
  border: 0.5px dashed var(--border-strong);
  border-radius: var(--r-md);
  display: grid;
  place-items: center;
  margin-bottom: 18px;
  background: var(--bg-input);
}
.detail .chart-ph:last-of-type {
  margin-bottom: 0;
}
.ph-note {
  font-size: var(--fs-cap);
  color: var(--text-3);
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
