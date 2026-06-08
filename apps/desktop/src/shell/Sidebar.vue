<script setup lang="ts">
import { computed } from 'vue';
import { useAppStore } from '../stores/app';
import { isLocked } from '../lib/guard';

const app = useAppStore();

interface Item {
  to: string;
  label: string;
  group: string;
  needsData?: boolean;
}

const items: Item[] = [
  { to: '/dashboard', label: '总览', group: '监控' },
  { to: '/market', label: '行情', group: '监控', needsData: true },
  { to: '/news', label: '资讯', group: '监控', needsData: true },
  { to: '/indicators', label: '指标', group: '研究', needsData: true },
  { to: '/models', label: '模型', group: '研究', needsData: true },
  { to: '/backtest', label: '回测', group: '研究', needsData: true },
  { to: '/signals', label: '信号', group: '交易', needsData: true },
  { to: '/portfolio', label: '持仓', group: '交易' },
  { to: '/logs', label: '日志', group: '系统' },
  { to: '/settings', label: '设置', group: '系统' },
];

const groups = computed(() => {
  const g: Record<string, Item[]> = {};
  for (const it of items) (g[it.group] ??= []).push(it);
  return g;
});

function locked(it: Item): boolean {
  return isLocked({ needsData: it.needsData }, app.onboardingDone);
}
</script>

<template>
  <nav class="sidebar">
    <div class="brand">司南 <span class="sub">Sinan</span></div>
    <template v-for="(list, group) in groups" :key="group">
      <div class="group-label">{{ group }}</div>
      <template v-for="it in list" :key="it.to">
        <RouterLink v-if="!locked(it)" :to="it.to" class="item" active-class="active">
          {{ it.label }}
        </RouterLink>
        <span v-else class="item locked" title="请先在『设置 → 数据源』配置并建立本地缓存">
          {{ it.label }} <span class="lock">🔒</span>
        </span>
      </template>
    </template>
  </nav>
</template>

<style scoped lang="scss">
.sidebar {
  width: 200px;
  background: var(--c-surface);
  border-right: 1px solid var(--c-border);
  padding: var(--sp-3);
  overflow: auto;
}

.brand {
  font-size: var(--fs-h3);
  font-weight: 600;
  padding: var(--sp-2) var(--sp-2) var(--sp-4);

  .sub {
    color: var(--c-text-3);
    font-size: var(--fs-cap);
  }
}

.group-label {
  color: var(--c-text-3);
  font-size: var(--fs-cap);
  margin: var(--sp-3) var(--sp-2) var(--sp-1);
}

.item {
  display: flex;
  justify-content: space-between;
  padding: var(--sp-2);
  border-radius: var(--r-md);
  color: var(--c-text-2);
  text-decoration: none;
  cursor: pointer;

  &.active {
    background: var(--accent-weak);
    color: var(--accent);
  }

  &.locked {
    color: var(--c-text-3);
    cursor: not-allowed;
  }
}

.lock {
  font-size: var(--fs-cap);
}
</style>
