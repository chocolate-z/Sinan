<script setup lang="ts">
import { useAppStore } from '../stores/app';

const app = useAppStore();
</script>

<template>
  <footer class="statusbar">
    <div class="sb-left">
      <span class="stat">
        <span class="sb-dot" :class="app.apiHealth ? 'ok' : 'err'" />
        <span>行情 API</span>
        <span class="mono sb-val">{{ app.apiHealth ? '正常' : '离线' }}</span>
      </span>
      <span class="stat">
        <span class="sb-dot" :class="app.engineHealth ? 'ok' : 'idle'" />
        <span>计算引擎</span>
        <span class="mono sb-val">{{ app.engineHealth ? '空闲' : '离线' }}</span>
      </span>
      <span class="stat">
        <span class="sb-dot" :class="app.activeProvider ? 'ok' : 'warn'" />
        <span>数据源</span>
        <span class="mono sb-val">{{ app.activeProvider ?? '未配置' }}</span>
      </span>
    </div>
    <div class="sb-right">
      <span>本工具仅供量化研究与策略验证,不构成任何投资建议</span>
    </div>
  </footer>
</template>

<style scoped>
.statusbar {
  height: var(--statusbar-h);
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 14px;
  background: var(--glass-chrome);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border-top: 0.5px solid var(--border);
  font-size: 11px;
  color: var(--text-3);
  z-index: 10;
}
.sb-left {
  display: flex;
  align-items: center;
  gap: 16px;
}
.stat {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.sb-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex: none;
}
.sb-dot.ok {
  background: var(--status-ok);
}
.sb-dot.warn {
  background: var(--status-warn);
}
.sb-dot.err {
  background: var(--status-err);
}
.sb-dot.idle {
  background: var(--status-idle);
}
.sb-val {
  color: var(--text-2);
}
</style>
