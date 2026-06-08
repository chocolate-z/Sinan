<script setup lang="ts">
import { useRouter } from 'vue-router';
import { useAppStore } from '../../stores/app';

const app = useAppStore();
const router = useRouter();
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

    <div v-else class="card">
      <p>
        已完成引导。数据源:<strong>{{ app.activeProvider }}</strong>
      </p>
      <p class="muted">M1 起此处展示双账当日收益、模型净值 vs 沪深300、今日信号与风控闸状态。</p>
    </div>

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
</style>
