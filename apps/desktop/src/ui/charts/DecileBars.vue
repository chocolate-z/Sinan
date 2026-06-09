<script setup lang="ts">
// 十分位分层收益柱状(PnL 通道:正=红涨 / 负=绿跌,随反转开关)。迁移自设计稿 indicators.jsx DecileBars。
import { computed } from 'vue';
import { useMeasure } from '../../composables/useMeasure';

const props = withDefaults(defineProps<{ values: number[]; height?: number }>(), { height: 84 });
const { setEl, width } = useMeasure();

const geom = computed(() => {
  const W = width.value;
  const H = props.height;
  const pad = 2;
  const v = props.values;
  if (v.length < 1 || W < 2) return null;
  const mx = Math.max(...v.map((x) => Math.abs(x)), 1e-9);
  const zero = H / 2;
  const bw = Math.max(6, (W / v.length) * 0.66);
  const x = (i: number) => (i + 0.5) * (W / v.length);
  return {
    W,
    H,
    zero,
    bars: v.map((val, i) => {
      const h = (Math.abs(val) / mx) * (H / 2 - pad);
      return {
        x: x(i) - bw / 2,
        y: val >= 0 ? zero - h : zero,
        h,
        bw,
        pos: val >= 0,
        lx: x(i),
        label: `D${i + 1}`,
      };
    }),
  };
});
</script>

<template>
  <div :ref="setEl" style="width: 100%">
    <svg
      v-if="geom"
      :width="geom.W"
      :height="geom.H + 16"
      style="display: block; overflow: visible"
    >
      <line x1="0" :x2="geom.W" :y1="geom.zero" :y2="geom.zero" stroke="var(--border-strong)" />
      <g v-for="(b, i) in geom.bars" :key="i">
        <rect
          :x="b.x"
          :y="b.y"
          :width="b.bw"
          :height="b.h"
          :fill="b.pos ? 'var(--pnl-up)' : 'var(--pnl-down)'"
          rx="1.5"
        />
        <text
          :x="b.lx"
          :y="geom.H + 12"
          text-anchor="middle"
          font-size="9"
          fill="var(--axis-text)"
          font-family="var(--font-mono)"
        >
          {{ b.label }}
        </text>
      </g>
    </svg>
  </div>
</template>
