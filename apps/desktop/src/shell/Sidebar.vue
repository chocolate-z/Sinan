<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { useAppStore } from '../stores/app';
import { isLocked } from '../lib/guard';
import { THEME_PREFS, themePrefLabel, type ThemePref } from '../lib/theme';
import Icon from './Icon.vue';

const app = useAppStore();
const router = useRouter();

interface Item {
  to: string;
  label: string;
  group: string;
  icon: string;
  needsData?: boolean;
}

const items: Item[] = [
  { to: '/dashboard', label: '总览', group: '监控', icon: 'dashboard' },
  { to: '/market', label: '行情', group: '监控', icon: 'market', needsData: true },
  // 资讯/news 为 v1 后续(M5);v1 不暴露(路由已重定向到总览),避免通用 Locked 桩。
  { to: '/indicators', label: '指标', group: '研究', icon: 'indicator', needsData: true },
  { to: '/formulas', label: '公式', group: '研究', icon: 'indicator', needsData: true },
  { to: '/models', label: '模型', group: '研究', icon: 'model', needsData: true },
  { to: '/backtest', label: '回测', group: '研究', icon: 'backtest', needsData: true },
  { to: '/signals', label: '信号', group: '交易', icon: 'signals', needsData: true },
  { to: '/portfolio', label: '持仓', group: '交易', icon: 'portfolio' },
  { to: '/fund', label: '基金穿透', group: '交易', icon: 'portfolio', needsData: true },
  { to: '/logs', label: '日志', group: '系统', icon: 'logs' },
  { to: '/settings', label: '设置', group: '系统', icon: 'settings' },
  { to: '/help', label: '帮助', group: '系统', icon: 'help' },
];

const groups = computed(() => {
  const g: Record<string, Item[]> = {};
  for (const it of items) (g[it.group] ??= []).push(it);
  return g;
});

function locked(it: Item): boolean {
  return isLocked({ needsData: it.needsData }, app.onboardingDone);
}

const providerName = computed(() => {
  const active = app.providers.find((p) => p.id === app.activeProvider);
  return active ? active.display_name : (app.activeProvider ?? '未配置数据源');
});
const connected = computed(() => Boolean(app.activeProvider));

const themeIcon = computed(() =>
  app.themePref === 'light' ? 'sun' : app.themePref === 'dark' ? 'moon' : 'monitor',
);
function cycleTheme() {
  const i = THEME_PREFS.indexOf(app.themePref);
  app.setThemePref(THEME_PREFS[(i + 1) % THEME_PREFS.length] as ThemePref);
}
function openDatasource() {
  router.push('/settings/datasource');
}
</script>

<template>
  <aside class="sidebar">
    <div class="nav-scroll">
      <div v-for="(list, group) in groups" :key="group" class="nav-group">
        <div class="cap nav-group-label">{{ group }}</div>
        <div class="nav-list">
          <template v-for="it in list" :key="it.to">
            <RouterLink v-if="!locked(it)" :to="it.to" class="nav-item" active-class="active">
              <span class="nav-chip"><Icon :name="it.icon" :size="15" /></span>
              {{ it.label }}
            </RouterLink>
            <span
              v-else
              class="nav-item disabled"
              title="请先在『设置 → 数据源』配置并建立本地缓存"
            >
              <span class="nav-chip"><Icon :name="it.icon" :size="15" /></span>
              {{ it.label }}
            </span>
          </template>
        </div>
      </div>
    </div>

    <!-- footer:数据源卡 + 主题切换 -->
    <div class="nav-footer">
      <button class="src-card" @click="openDatasource">
        <span class="src-ic" :class="connected ? 'on' : 'off'"><Icon name="db" :size="15" /></span>
        <div class="src-body">
          <div class="src-name">{{ providerName }}</div>
          <div class="src-status">
            <span class="src-dot" :class="connected ? 'on' : 'off'" />{{
              connected ? '已连接' : '点击配置数据源'
            }}
          </div>
        </div>
        <span class="src-chev"><Icon name="chevR" :size="14" /></span>
      </button>
      <button
        class="theme-toggle"
        :title="`主题:${themePrefLabel(app.themePref)}`"
        @click="cycleTheme"
      >
        <span class="tt-left"><Icon :name="themeIcon" :size="15" /> 外观主题</span>
        <span class="tt-val mono">{{ themePrefLabel(app.themePref) }}</span>
      </button>
    </div>
  </aside>
</template>

<style scoped>
.sidebar {
  width: var(--nav-w);
  flex: none;
  display: flex;
  flex-direction: column;
  padding: 12px 10px;
  background: var(--glass-chrome);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border-right: 0.5px solid var(--border);
}
.nav-scroll {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 16px;
  overflow: auto;
}
.nav-group-label {
  padding: 0 10px 7px;
}
.nav-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.nav-footer {
  padding-top: 12px;
  margin-top: 4px;
  border-top: 0.5px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 9px;
}
.src-ic {
  width: 23px;
  height: 23px;
  border-radius: 6px;
  display: grid;
  place-items: center;
  flex: none;
}
.src-ic.on {
  background: var(--status-ok-bg);
  color: var(--status-ok);
}
.src-ic.off {
  background: var(--status-idle-bg);
  color: var(--text-3);
}
.src-body {
  flex: 1;
  min-width: 0;
}
.src-name {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--text-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.src-status {
  font-size: 10px;
  color: var(--text-3);
  display: flex;
  align-items: center;
  gap: 4px;
}
.src-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  flex: none;
}
.src-dot.on {
  background: var(--status-ok);
}
.src-dot.off {
  background: var(--status-idle);
}
.src-chev {
  color: var(--text-3);
  display: inline-flex;
}
.theme-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 11px;
  border-radius: var(--r-md);
  background: transparent;
  border: 0.5px solid var(--border);
  cursor: pointer;
  color: var(--text-2);
}
.theme-toggle:hover {
  background: var(--bg-elevated);
}
.tt-left {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  font-size: 12px;
}
.tt-val {
  font-size: 11px;
  color: var(--text-3);
}
</style>
