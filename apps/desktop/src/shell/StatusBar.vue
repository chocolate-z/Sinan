<script setup lang="ts">
import { useAppStore } from '../stores/app';
import { statusClass } from '../lib/pnl';

const app = useAppStore();
</script>

<template>
  <footer class="statusbar">
    <span :class="app.apiHealth ? statusClass('ok') : statusClass('err')">
      ● api {{ app.apiHealth ? '在线' : '离线' }}
    </span>
    <span :class="app.engineHealth ? statusClass('ok') : statusClass('err')">
      ● engine {{ app.engineHealth ? '在线' : '离线' }}
    </span>
    <span class="spacer" />
    <span class="muted">数据源:{{ app.activeProvider ?? '未配置' }}</span>
    <span class="muted">免责:仅供研究,非投资建议</span>
  </footer>
</template>

<style scoped>
.statusbar {
  display: flex;
  align-items: center;
  gap: var(--sp-4);
  height: 28px;
  padding: 0 var(--sp-4);
  border-top: 1px solid var(--c-border);
  background: var(--c-surface);
  font-size: var(--fs-cap);
}
.spacer {
  flex: 1;
}
.muted {
  color: var(--c-text-3);
}
</style>
