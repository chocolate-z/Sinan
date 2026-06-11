<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { useAppStore } from '../stores/app';
import { fmtInt } from '../lib/format';

const app = useAppStore();

// 实时时钟(本机时间,HH:MM:SS,每秒更新)。
const clock = ref('');
let timer: number | undefined;
function tick() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  clock.value = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
onMounted(() => {
  tick();
  timer = window.setInterval(tick, 1000);
});
onBeforeUnmount(() => {
  if (timer) window.clearInterval(timer);
});
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
      <span v-if="app.coverage?.total_rows" class="mono sb-cache">
        缓存 {{ fmtInt(app.coverage.total_rows) }} 条
      </span>
    </div>
    <div class="sb-right">
      <span class="sb-disclaimer">本工具仅供量化研究与策略验证,不构成任何投资建议</span>
      <span class="mono sb-clock">{{ clock }}</span>
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
.sb-cache {
  color: var(--text-3);
}
.sb-right {
  display: flex;
  align-items: center;
  gap: 16px;
}
.sb-clock {
  color: var(--text-3);
}
</style>
