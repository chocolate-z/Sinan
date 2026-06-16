<script setup lang="ts">
// 长任务运行提示。两种形态:
// ① 不定式(默认):无后端进度时,滚动条 + 诚实「已运行 mm:ss」(真实经过时间,不伪造百分比)。
// ② 确定式:传了 progress(后端 SSE 流式发的真实 done/total)→ 实心进度条 + 真实百分比 +
//    预计剩余时间(ETA = 本阶段已用时 / 已完成 × 剩余,线性外推,标「约」不谎报)。
// 训练/质检的特征面板逐日循环走确定式;短的折/因子阶段也按各自 done/total 显示。
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import type { RunProgress } from '../lib/progress';

// progress:后端真实进度(done/total + 本阶段开始时刻 phaseSince,用于 ETA)。null=不定式。

// since:任务真实开始时间(epoch ms,来自 store,跨导航留存)。传了就用它算已用时 ——
// 这样切走再切回(组件重挂)也接着真实计时,而非每次重置为 0。未传则回退到本地开始时间。
const props = withDefaults(
  defineProps<{ active: boolean; label?: string; since?: number; progress?: RunProgress | null }>(),
  { label: '运行中', since: 0, progress: null },
);

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

function fmtDur(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return m > 0 ? `${m} 分 ${String(ss).padStart(2, '0')} 秒` : `${ss} 秒`;
}

const elapsed = computed(() => {
  const start = props.since && props.since > 0 ? props.since : localStart;
  return Math.max(0, Math.floor((now.value - start) / 1000));
});
const elapsedText = computed(() => fmtDur(elapsed.value));

// ── 确定式(有真实 done/total)──────────────────────────────────────────────────
const determinate = computed(() => !!props.progress && props.progress.total > 0);
const pct = computed(() => {
  const p = props.progress;
  if (!p || p.total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((p.done / p.total) * 100)));
});
// ETA:本阶段速率 = done / 本阶段已用秒;剩余秒 = (total-done)/速率。done<=0 或已满则不显示(无从估计)。
const etaText = computed(() => {
  const p = props.progress;
  if (!p || p.done <= 0 || p.done >= p.total) return '';
  const phaseElapsedSec = Math.max(0.001, (now.value - p.phaseSince) / 1000);
  const rate = p.done / phaseElapsedSec;
  if (!Number.isFinite(rate) || rate <= 0) return '';
  return fmtDur((p.total - p.done) / rate);
});
</script>

<template>
  <div v-if="active" class="running-bar" role="status" aria-live="polite">
    <div class="rb-track">
      <div v-if="determinate" class="rb-fill" :style="{ width: pct + '%' }" />
      <div v-else class="rb-indet" />
    </div>
    <span v-if="determinate" class="rb-label mono">
      {{ progress!.label }} {{ pct }}%<template v-if="etaText"> · 约剩 {{ etaText }}</template> ·
      已运行 {{ elapsedText }}
    </span>
    <span v-else class="rb-label mono">{{ label }} · 已运行 {{ elapsedText }}</span>
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
/* 确定式实心条:宽度 = 真实百分比,平滑过渡到下一进度。 */
.rb-fill {
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
  border-radius: var(--r-xs);
  background: var(--accent-grad);
  transition: width 0.4s var(--ease);
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
  .rb-fill {
    transition: none;
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
