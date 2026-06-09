<script setup lang="ts">
import { useAppStore } from '../stores/app';
import { statusClass } from '../lib/pnl';

const app = useAppStore();
</script>

<template>
  <footer class="statusbar m-vibrancy">
    <span class="m-badge" :class="app.apiHealth ? statusClass('ok') : statusClass('err')">
      api {{ app.apiHealth ? '在线' : '离线' }}
    </span>
    <span class="m-badge" :class="app.engineHealth ? statusClass('ok') : statusClass('err')">
      engine {{ app.engineHealth ? '在线' : '离线' }}
    </span>
    <span class="spacer" />
    <span class="muted">数据源:{{ app.activeProvider ?? '未配置' }}</span>
    <span class="dot">·</span>
    <span class="muted">仅供研究,非投资建议</span>
  </footer>
</template>

<style scoped>
.statusbar {
  display: flex;
  align-items: center;
  gap: var(--sp-4);
  height: 28px;
  padding: 0 var(--sp-5);
  border-top: 1px solid var(--c-hairline);
  background: var(--c-titlebar);
  font-size: var(--fs-cap);
}
.spacer {
  flex: 1;
}
.muted {
  color: var(--c-text-3);
}
.dot {
  color: var(--c-text-3);
}
</style>
