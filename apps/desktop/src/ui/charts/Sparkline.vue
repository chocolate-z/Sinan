<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{ values: number[]; width?: number; height?: number; color?: string }>(),
  { width: 92, height: 26, color: 'var(--text-2)' },
);

const d = computed(() => {
  const v = props.values;
  if (v.length < 2) return '';
  const lo = Math.min(...v);
  const hi = Math.max(...v);
  const x = (i: number) => (i / (v.length - 1)) * props.width;
  const y = (val: number) => props.height - 2 - ((val - lo) / (hi - lo || 1)) * (props.height - 4);
  return v.map((val, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(val).toFixed(1)}`).join(' ');
});
</script>

<template>
  <svg :width="width" :height="height" style="display: block">
    <path :d="d" fill="none" :stroke="color" stroke-width="1.3" />
  </svg>
</template>
