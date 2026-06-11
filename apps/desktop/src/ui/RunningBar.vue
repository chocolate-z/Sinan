<script setup lang="ts">
// 长任务运行提示:不定式进度条 + 诚实「已运行 mm:ss」(真实经过时间,不伪造百分比)。
// 真实进度 % / ETA 需后端在 walk-forward / 逐日循环里流式发进度(jobs+SSE,如建缓存),留作后端跟进。
import { computed, onBeforeUnmount, ref, watch } from 'vue';

// since:任务真实开始时间(epoch ms,来自 store,跨导航留存)。传了就用它算已用时 ——
// 这样切走再切回(组件重挂)也接着真实计时,而非每次重置为 0。未传则回退到本地开始时间。
const props = withDefaults(defineProps<{ active: boolean; label?: string; since?: number }>(), {
  label: '运行中',
  since: 0,
});

const now = ref(Date.now());
let localStart = 0;
let timer: number | undefined;

function stop() {
  if (timer) window.clearInterval(timer);
  timer = undefined;
}

watch(
  () => props.active,
  (a) => {
    if (a) {
      localStart = Date.now();
      now.value = Date.now();
      stop();
      timer = window.setInterval(() => {
        now.value = Date.now();
      }, 1000);
    } else {
      stop();
    }
  },
  { immediate: true },
);
onBeforeUnmount(stop);

const elapsed = computed(() => {
  const start = props.since && props.since > 0 ? props.since : localStart;
  return Math.max(0, Math.floor((now.value - start) / 1000));
});
const elapsedText = computed(() => {
  const s = elapsed.value;
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return m > 0 ? `${m} 分 ${String(ss).padStart(2, '0')} 秒` : `${ss} 秒`;
});
</script>

<template>
  <div v-if="active" class="running-bar" role="status" aria-live="polite">
    <div class="rb-track"><div class="rb-indet" /></div>
    <span class="rb-label mono">{{ label }} · 已运行 {{ elapsedText }}</span>
  </div>
</template>

<style scoped>
.running-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 14px;
}
.rb-track {
  position: relative;
  flex: 1;
  height: 6px;
  border-radius: var(--r-xs);
  background: var(--bg-input);
  overflow: hidden;
}
.rb-indet {
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
  width: 38%;
  border-radius: var(--r-xs);
  background: var(--accent-grad);
  animation: rb-slide 1.15s var(--ease) infinite;
}
@keyframes rb-slide {
  0% {
    left: -40%;
  }
  100% {
    left: 100%;
  }
}
@media (prefers-reduced-motion: reduce) {
  .rb-indet {
    animation: rb-pulse 1.4s ease-in-out infinite;
    left: 0;
    width: 100%;
    transform-origin: left;
  }
  @keyframes rb-pulse {
    0%,
    100% {
      opacity: 0.4;
    }
    50% {
      opacity: 0.9;
    }
  }
}
.rb-label {
  flex: none;
  font-size: var(--fs-cap);
  color: var(--text-2);
}
</style>
