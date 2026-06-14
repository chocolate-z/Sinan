<script setup lang="ts">
// 模型 vs 等权基线净值对比:两条策略线(accent 通道两色)+ 基准(中性灰虚线)。
// 三条线各自归一化到起点=1,统一坐标。纯数据序列,不用盈亏色/系统色(三通道解耦)。
import { computed } from 'vue';
import { useMeasure } from '../../composables/useMeasure';

const props = withDefaults(
  defineProps<{
    model: number[]; // 已归一化(起点=1)
    equal: number[]; // 已归一化
    bench?: number[]; // 已归一化(可空)
    height?: number;
  }>(),
  { height: 240, bench: () => [] },
);

const { setEl, width } = useMeasure();

const geom = computed(() => {
  const W = width.value;
  const padL = 48,
    padR = 16,
    padT = 14,
    padB = 22;
  const n = props.model.length;
  if (n < 2 || props.equal.length !== n) return null;
  const innerW = Math.max(10, W - padL - padR);
  const hasBench = props.bench.length === n;
  const all = props.model.concat(props.equal, hasBench ? props.bench : []);
  let lo = Math.min(...all);
  let hi = Math.max(...all);
  const pad = (hi - lo) * 0.12 || 0.01;
  lo -= pad;
  hi += pad;
  const x = (i: number) => padL + (i / (n - 1)) * innerW;
  const y = (v: number) => padT + (1 - (v - lo) / (hi - lo)) * (props.height - padT - padB);
  const path = (arr: number[]) =>
    arr.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const ticks = Array.from({ length: 5 }, (_, i) => {
    const t = lo + (i / 4) * (hi - lo);
    return { t, y: y(t) };
  });
  return {
    W,
    padL,
    padR,
    ticks,
    modelLine: path(props.model),
    equalLine: path(props.equal),
    benchLine: hasBench ? path(props.bench) : '',
    hasBench,
  };
});
</script>

<template>
  <div :ref="setEl" style="width: 100%">
    <svg v-if="geom" :width="geom.W" :height="height" style="display: block; overflow: visible">
      <g v-for="(tk, i) in geom.ticks" :key="i">
        <line
          :x1="geom.padL"
          :x2="geom.W - geom.padR"
          :y1="tk.y"
          :y2="tk.y"
          stroke="var(--grid-line)"
        />
        <text
          :x="geom.padL - 8"
          :y="tk.y + 3.5"
          text-anchor="end"
          font-size="10"
          fill="var(--axis-text)"
          font-family="var(--font-mono)"
        >
          {{ tk.t.toFixed(2) }}
        </text>
      </g>
      <path
        v-if="geom.hasBench"
        :d="geom.benchLine"
        fill="none"
        stroke="var(--benchmark)"
        stroke-width="1.2"
        stroke-dasharray="2 3"
        stroke-opacity="0.8"
      />
      <path
        :d="geom.equalLine"
        fill="none"
        stroke="var(--accent-2)"
        stroke-width="1.7"
        stroke-dasharray="5 3"
        stroke-opacity="0.92"
      />
      <path :d="geom.modelLine" fill="none" stroke="var(--accent)" stroke-width="2.2" />
    </svg>
  </div>
</template>
