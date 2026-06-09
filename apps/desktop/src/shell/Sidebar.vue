<script setup lang="ts">
import { computed } from 'vue';
import { useAppStore } from '../stores/app';
import { isLocked } from '../lib/guard';

const app = useAppStore();

interface Item {
  to: string;
  label: string;
  group: string;
  icon: string;
  needsData?: boolean;
}

const items: Item[] = [
  { to: '/dashboard', label: '总览', group: '监控', icon: '◎' },
  { to: '/market', label: '行情', group: '监控', icon: '📈', needsData: true },
  { to: '/news', label: '资讯', group: '监控', icon: '📰', needsData: true },
  { to: '/indicators', label: '指标', group: '研究', icon: '𝑓', needsData: true },
  { to: '/models', label: '模型', group: '研究', icon: '◐', needsData: true },
  { to: '/backtest', label: '回测', group: '研究', icon: '⟳', needsData: true },
  { to: '/signals', label: '信号', group: '交易', icon: '◈', needsData: true },
  { to: '/portfolio', label: '持仓', group: '交易', icon: '▤' },
  { to: '/logs', label: '日志', group: '系统', icon: '≣' },
  { to: '/settings', label: '设置', group: '系统', icon: '⚙' },
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
  <nav class="sidebar m-vibrancy">
    <div class="brand">
      <span class="logo">🧭</span>
      <span class="name">司南</span>
      <span class="sub">Sinan</span>
    </div>
    <template v-for="(list, group) in groups" :key="group">
      <div class="group-label">{{ group }}</div>
      <template v-for="it in list" :key="it.to">
        <RouterLink v-if="!locked(it)" :to="it.to" class="item" active-class="active">
          <span class="ic">{{ it.icon }}</span>
          <span class="label">{{ it.label }}</span>
        </RouterLink>
        <span v-else class="item locked" title="请先在『设置 → 数据源』配置并建立本地缓存">
          <span class="ic">{{ it.icon }}</span>
          <span class="label">{{ it.label }}</span>
          <span class="lock">🔒</span>
        </span>
      </template>
    </template>
  </nav>
</template>

<style scoped lang="scss">
.sidebar {
  width: 216px;
  flex: none;
  background: var(--c-sidebar);
  border-right: 1px solid var(--c-hairline);
  padding: var(--sp-3) var(--sp-2) var(--sp-4);
  overflow: auto;
}

.brand {
  display: flex;
  align-items: baseline;
  gap: 6px;
  padding: var(--sp-2) var(--sp-3) var(--sp-5);

  .logo {
    font-size: 18px;
  }
  .name {
    font-size: var(--fs-sub);
    font-weight: 700;
    letter-spacing: 0.01em;
  }
  .sub {
    color: var(--c-text-3);
    font-size: 11px;
    font-weight: 500;
    letter-spacing: 0.04em;
  }
}

.group-label {
  color: var(--c-text-3);
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin: var(--sp-4) var(--sp-3) var(--sp-1);
}

.item {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: 7px var(--sp-3);
  margin-bottom: 1px;
  border-radius: var(--r-md);
  color: var(--c-text);
  text-decoration: none;
  font-size: var(--fs-body);
  font-weight: 450;
  cursor: pointer;
  transition:
    background var(--dur-fast) var(--ease),
    color var(--dur-fast) var(--ease);

  .ic {
    width: 18px;
    text-align: center;
    font-size: 13px;
    color: var(--c-text-2);
    flex: none;
  }
  .label {
    flex: 1;
  }

  &:hover {
    background: var(--c-surface-2);
  }

  &.active {
    background: var(--accent);
    color: var(--accent-contrast);
    box-shadow: var(--shadow-1);

    .ic {
      color: var(--accent-contrast);
    }
  }

  &.locked {
    color: var(--c-text-3);
    cursor: not-allowed;

    &:hover {
      background: transparent;
    }
    .ic {
      color: var(--c-text-3);
      opacity: 0.6;
    }
  }
}

.lock {
  font-size: 11px;
}
</style>
