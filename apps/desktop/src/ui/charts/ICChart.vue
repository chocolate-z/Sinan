<script setup lang="ts">
// IC 时序柱状(中性通道):正=品牌紫 / 负=中性灰,绕零轴。迁移自设计稿 indicators.jsx ICChart。
import { computed } from 'vue';
import { useMeasure } from '../../composables/useMeasure';

const props = withDefaults(defineProps<{ values: number[]; height?: number }>(), { height: 70 });
const { setEl, width } = useMeasure();

const geom = computed(() => {
  const W = width.value;
  const H = props.height;
  const pad = 4;
  const v = props.values;
  if (v.length < 1 || W < 2) return null;
  const lo = Math.min(...v, -0.02);
  const hi = Math.max(...v, 0.02);
  const x = (i: number) => (i / (v.length - 1 || 1)) * W;
  const y = (val: number) => pad + (1 - (val - lo) / (hi - lo || 1)) * (H - pad * 2);
  const zero = y(0);
  const bw = Math.max(2, (W / v.length) * 0.6);
  return {
    W,
    H,
    zero,
    bars: v.map((val, i) => ({
      x: x(i) - bw / 2,
      y: Math.min(zero, y(val)),
      h: Math.max(1, Math.abs(y(val) - zero)),
      bw,
      pos: val >= 0,
    })),
  };
});
</script>

<template>
  <div :ref="setEl" style="width: 100%">
    <svg v-if="geom" :width="geom.W" :height="geom.H" style="display: block">
      <line x1="0" :x2="geom.W" :y1="geom.zero" :y2="geom.zero" stroke="var(--border-strong)" />
      <rect
        v-for="(b, i) in geom.bars"
        :key="i"
        :x="b.x"
        :y="b.y"
        :width="b.bw"
        :height="b.h"
        :fill="b.pos ? 'var(--accent)' : 'var(--text-3)'"
        opacity="0.8"
        rx="1"
      />
    </svg>
  </div>
</template>
