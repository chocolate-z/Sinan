<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { getAppWindow, isTauri } from '../lib/tauri';
import { useAppStore } from '../stores/app';
import { themePrefIcon, themePrefLabel, THEME_PREFS, type ThemePref } from '../lib/theme';

const app = useAppStore();

const providerLabel = computed(() => {
  const active = app.providers.find((p) => p.id === app.activeProvider);
  return active ? active.display_name : (app.activeProvider ?? '未配置');
});

function cycleTheme() {
  const i = THEME_PREFS.indexOf(app.themePref);
  app.setThemePref(THEME_PREFS[(i + 1) % THEME_PREFS.length] as ThemePref);
}

const inTauri = isTauri();
const maximized = ref(false);
let unlisten: (() => void) | undefined;

async function minimize() {
  (await getAppWindow())?.minimize();
}
async function toggleMaximize() {
  const w = await getAppWindow();
  if (!w) return;
  await w.toggleMaximize();
  maximized.value = await w.isMaximized();
}
async function close() {
  (await getAppWindow())?.close();
}

onMounted(async () => {
  if (!inTauri) return;
  const w = await getAppWindow();
  if (!w) return;
  try {
    maximized.value = await w.isMaximized();
    unlisten = await w.onResized(async () => {
      maximized.value = await w.isMaximized();
    });
  } catch {
    /* 非关键:状态图标退化为「最大化」即可 */
  }
});
onBeforeUnmount(() => unlisten?.());
</script>

<template>
  <!-- 自定义标题栏(配 tauri decorations:false)。窗口控制按钮按 Win11 习惯置于右上角。
       浏览器开发环境(非 Tauri)隐藏控制按钮,用浏览器原生标题栏。 -->
  <header class="titlebar" data-tauri-drag-region>
    <div class="tb-brand" data-tauri-drag-region>
      <span class="tb-logo">🧭</span>
      <span class="tb-name">司南</span>
      <span class="tb-sub">Sinan</span>
    </div>
    <div class="tb-drag" data-tauri-drag-region></div>

    <!-- 状态 + 主题切换(原顶栏功能并入标题栏右侧) -->
    <div class="tb-right">
      <span class="m-badge tb-prov" :class="app.activeProvider ? 'status-ok' : 'status-err'">
        {{ providerLabel }}
      </span>
      <button
        class="tb-theme"
        :title="`主题:${themePrefLabel(app.themePref)}(点按切换)`"
        @click="cycleTheme"
      >
        {{ themePrefIcon(app.themePref) }}
      </button>
    </div>

    <div v-if="inTauri" class="win-controls">
      <button class="win-btn" title="最小化" aria-label="最小化" @click="minimize">
        <svg width="11" height="11" viewBox="0 0 11 11" aria-hidden="true">
          <path d="M1 5.5 H10" stroke="currentColor" stroke-width="1" fill="none" />
        </svg>
      </button>
      <button
        class="win-btn"
        :title="maximized ? '还原' : '最大化'"
        :aria-label="maximized ? '还原' : '最大化'"
        @click="toggleMaximize"
      >
        <svg v-if="!maximized" width="11" height="11" viewBox="0 0 11 11" aria-hidden="true">
          <rect
            x="1"
            y="1"
            width="9"
            height="9"
            rx="0.5"
            stroke="currentColor"
            stroke-width="1"
            fill="none"
          />
        </svg>
        <svg v-else width="11" height="11" viewBox="0 0 11 11" aria-hidden="true">
          <path
            d="M3 3 V1.5 H9.5 V8 H8 M1.5 3.5 H8 V9.5 H1.5 Z"
            stroke="currentColor"
            stroke-width="1"
            fill="none"
          />
        </svg>
      </button>
      <button class="win-btn close" title="关闭" aria-label="关闭" @click="close">
        <svg width="11" height="11" viewBox="0 0 11 11" aria-hidden="true">
          <path d="M1 1 L10 10 M10 1 L1 10" stroke="currentColor" stroke-width="1" fill="none" />
        </svg>
      </button>
    </div>
  </header>
</template>

<style scoped>
.titlebar {
  display: flex;
  align-items: stretch;
  height: 34px;
  flex: none;
  background: var(--c-titlebar);
  border-bottom: 1px solid var(--c-hairline);
  backdrop-filter: var(--blur-thin);
  -webkit-backdrop-filter: var(--blur-thin);
  user-select: none;
}
.tb-brand {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 var(--sp-3);
}
.tb-logo {
  font-size: 14px;
  line-height: 1;
}
.tb-name {
  font-size: var(--fs-cap);
  font-weight: 700;
  letter-spacing: 0.01em;
}
.tb-sub {
  font-size: 10px;
  font-weight: 500;
  color: var(--c-text-3);
  letter-spacing: 0.04em;
}
.tb-drag {
  flex: 1;
}
.tb-right {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: 0 var(--sp-3);
  flex: none;
}
.tb-prov {
  font-size: 11px;
}
.tb-theme {
  border: none;
  background: transparent;
  color: var(--c-text-2);
  font-size: 13px;
  line-height: 1;
  padding: 3px 6px;
  border-radius: var(--r-sm);
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease);
}
.tb-theme:hover {
  background: var(--c-surface-2);
  color: var(--c-text);
}
.win-controls {
  display: flex;
  flex: none;
}
.win-btn {
  width: 46px;
  height: 100%;
  display: grid;
  place-items: center;
  border: none;
  background: transparent;
  color: var(--c-text-2);
  cursor: default;
  transition:
    background var(--dur-fast) var(--ease),
    color var(--dur-fast) var(--ease);
}
.win-btn:hover {
  background: var(--c-surface-2);
  color: var(--c-text);
}
.win-btn:active {
  background: var(--c-border);
}
.win-btn.close:hover {
  background: #c42b1c;
  color: #fff;
}
.win-btn.close:active {
  background: #b02418;
  color: #fff;
}
</style>
