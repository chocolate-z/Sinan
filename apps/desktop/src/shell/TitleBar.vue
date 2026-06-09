<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { getAppWindow, isTauri } from '../lib/tauri';
import Icon from './Icon.vue';

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
    /* 非关键 */
  }
});
onBeforeUnmount(() => unlisten?.());
</script>

<template>
  <!-- 自定义标题栏(玻璃)。Win11 窗口控制置于右上;浏览器开发环境隐藏控制按钮。 -->
  <header class="titlebar" data-tauri-drag-region>
    <div class="tb-brand" data-tauri-drag-region>
      <span class="tb-logo"><Icon name="compass" :size="15" /></span>
      <span class="tb-name">司南</span>
      <span class="tb-sub">Sinan</span>
      <span class="tb-ver mono">v2.4.0</span>
    </div>
    <div class="tb-drag" data-tauri-drag-region></div>

    <div v-if="inTauri" class="win-controls">
      <button class="win-btn" title="最小化" aria-label="最小化" @click="minimize">
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          stroke="currentColor"
          stroke-width="1"
          fill="none"
        >
          <line x1="1" y1="5" x2="9" y2="5" />
        </svg>
      </button>
      <button
        class="win-btn"
        :title="maximized ? '还原' : '最大化'"
        :aria-label="maximized ? '还原' : '最大化'"
        @click="toggleMaximize"
      >
        <svg
          v-if="!maximized"
          width="10"
          height="10"
          viewBox="0 0 10 10"
          stroke="currentColor"
          stroke-width="1"
          fill="none"
        >
          <rect x="1.5" y="1.5" width="7" height="7" />
        </svg>
        <svg
          v-else
          width="10"
          height="10"
          viewBox="0 0 10 10"
          stroke="currentColor"
          stroke-width="1"
          fill="none"
        >
          <path d="M2.5 2.5V1.5H8.5V7.5H7.5M1.5 3.5H6.5V8.5H1.5Z" />
        </svg>
      </button>
      <button class="win-btn close" title="关闭" aria-label="关闭" @click="close">
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          stroke="currentColor"
          stroke-width="1"
          fill="none"
        >
          <line x1="1.5" y1="1.5" x2="8.5" y2="8.5" />
          <line x1="8.5" y1="1.5" x2="1.5" y2="8.5" />
        </svg>
      </button>
    </div>
  </header>
</template>

<style scoped>
.titlebar {
  height: var(--titlebar-h);
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-left: 14px;
  background: var(--glass-chrome);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border-bottom: 0.5px solid var(--border);
  user-select: none;
  z-index: 10;
}
.tb-brand {
  display: flex;
  align-items: center;
  gap: 8px;
}
.tb-logo {
  display: inline-flex;
  color: var(--accent);
}
.tb-name {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text-1);
  letter-spacing: 0.01em;
}
.tb-sub {
  font-size: 12px;
  color: var(--text-3);
}
.tb-ver {
  font-size: 10px;
  color: var(--text-3);
  margin-left: 2px;
  padding: 1px 5px;
  border: 0.5px solid var(--border);
  border-radius: 4px;
}
.tb-drag {
  flex: 1;
  align-self: stretch;
}
.win-controls {
  display: flex;
  height: 100%;
}
.win-btn {
  width: 44px;
  height: 100%;
  display: grid;
  place-items: center;
  border: none;
  background: transparent;
  color: var(--text-2);
  cursor: default;
  transition: background 0.1s;
}
.win-btn:hover {
  background: var(--bg-elevated);
  color: var(--text-1);
}
.win-btn.close:hover {
  background: #e34a3f;
  color: #fff;
}
</style>
