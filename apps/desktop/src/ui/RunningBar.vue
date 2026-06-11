<script setup lang="ts">
// 长任务运行提示:不定式进度条 + 诚实「已运行 mm:ss」(真实经过时间,不伪造百分比)。
// 真实进度 % / ETA 需后端在 walk-forward / 逐日循环里流式发进度(jobs+SSE,如建缓存),留作后端跟进。
import { computed, onBeforeUnmount, ref, watch } from 'vue';

const props = withDefaults(defineProps<{ active: boolean; label?: string }>(), {
  label: '运行中',
});

const elapsed = ref(0);
let startedAt = 0;
let timer: number | undefined;

function stop() {
  if (timer) window.clearInterval(timer);
  timer = undefined;
}

watch(
  () => props.active,
  (a) => {
    if (a) {
      startedAt = Date.now();
      elapsed.value = 0;
      stop();
      timer = window.setInterval(() => {
        elapsed.value = Math.floor((Date.now() - startedAt) / 1000);
      }, 1000);
    } else {
      stop();
    }
  },
  { immediate: true },
);
onBeforeUnmount(stop);

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
