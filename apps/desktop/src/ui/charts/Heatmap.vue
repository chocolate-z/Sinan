<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  years: Array<number | string>;
  data: Array<Array<number | null>>; // [yearIndex][monthIndex] = 月收益(%) 或 null
}>();

const MONTHS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];
const MAX_ABS = 5;

function cell(v: number | null): { bg: string; fg: string; text: string } {
  if (v == null) return { bg: 'var(--bg-panel-2)', fg: 'var(--text-3)', text: '' };
  const inv =
    typeof document !== 'undefined' &&
    document.documentElement.getAttribute('data-pnl-invert') === 'true';
  const pos = v > 0;
  const intensity = Math.min(1, Math.abs(v) / MAX_ABS);
  const up = '227,93,91';
  const down = '52,178,126';
  const rgb = pos !== inv ? up : down;
  return {
    bg: `rgba(${rgb}, ${0.12 + intensity * 0.55})`,
    fg: Math.abs(v) > 2.5 ? '#fff' : 'var(--text-1)',
    text: (v > 0 ? '+' : '') + v.toFixed(1),
  };
}

const rows = computed(() =>
  props.years.map((yr, yi) => ({
    yr,
    cells: (props.data[yi] ?? []).map((v) => ({ v, ...cell(v) })),
  })),
);
</script>

<template>
  <div class="heatmap">
    <div class="hm-corner" />
    <div v-for="m in MONTHS" :key="m" class="hm-month mono">{{ m }}月</div>
    <template v-for="row in rows" :key="row.yr">
      <div class="hm-year mono">{{ row.yr }}</div>
      <div
        v-for="(c, mi) in row.cells"
        :key="mi"
        class="hm-cell mono"
        :style="{ background: c.bg, color: c.fg }"
        :title="c.v == null ? '' : c.v + '%'"
      >
        {{ c.text }}
      </div>
    </template>
  </div>
</template>

<style scoped>
.heatmap {
  display: grid;
  grid-template-columns: 38px repeat(12, 1fr);
  gap: 3px;
}
.hm-month {
  text-align: center;
  font-size: 10px;
  color: var(--text-3);
}
.hm-year {
  display: flex;
  align-items: center;
  font-size: 10px;
  color: var(--text-2);
}
.hm-cell {
  height: 28px;
  border-radius: 4px;
  display: grid;
  place-items: center;
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}
</style>
