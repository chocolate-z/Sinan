<script setup lang="ts">
import { computed } from 'vue';
import { useMeasure } from '../../composables/useMeasure';

interface Marker {
  i: number;
  t: 'buy' | 'sell';
}
const props = withDefaults(
  defineProps<{
    model: number[];
    bench?: number[];
    dd?: number[];
    height?: number;
    markers?: Marker[];
    showBench?: boolean;
    showDD?: boolean;
  }>(),
  { height: 240, markers: () => [], showBench: true, showDD: true, bench: () => [], dd: () => [] },
);

const { setEl, width } = useMeasure();

const geom = computed(() => {
  const W = width.value;
  const padL = 48,
    padR = 16,
    padT = 14,
    padB = 22;
  const model = props.model;
  const n = model.length;
  if (n < 2) return null;
  const showDD = props.showDD && props.dd.length === n;
  const ddH = showDD ? 56 : 0;
  const mainH = props.height - ddH - (showDD ? 10 : 0);
  const innerW = Math.max(10, W - padL - padR);
  const showBench = props.showBench && props.bench.length === n;
  const all = showBench ? model.concat(props.bench) : model;
  let lo = Math.min(...all);
  let hi = Math.max(...all);
  const pad = (hi - lo) * 0.12 || 0.01;
  lo -= pad;
  hi += pad;
  const x = (i: number) => padL + (i / (n - 1)) * innerW;
  const y = (v: number) => padT + (1 - (v - lo) / (hi - lo)) * (mainH - padT - padB);
  const path = (arr: number[]) =>
    arr.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const area = (arr: number[]) =>
    path(arr) + ` L${x(n - 1)} ${mainH - padB} L${padL} ${mainH - padB} Z`;
  const ticks = Array.from({ length: 5 }, (_, i) => {
    const t = lo + (i / 4) * (hi - lo);
    return { t, y: y(t) };
  });
  let ddPath = '';
  let ddArea = '';
  let ddLoVal = 0;
  let ddLoY = 0;
  if (showDD) {
    const ddLo = Math.min(...props.dd, -1);
    const ddy = (v: number) => mainH + 10 + (v / ddLo) * (ddH - 16) + 2;
    ddPath = props.dd
      .map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${ddy(v).toFixed(1)}`)
      .join(' ');
    ddArea =
      `M${padL} ${mainH + 12} ` +
      props.dd.map((v, i) => `L${x(i).toFixed(1)} ${ddy(v).toFixed(1)}`).join(' ') +
      ` L${x(n - 1)} ${mainH + 12} Z`;
    ddLoVal = ddLo;
    ddLoY = ddy(ddLo);
  }
  const mk = props.markers
    .filter((m) => m.i >= 0 && m.i < n)
    .map((m) => ({
      x: x(m.i),
      y: y(model[m.i]),
      t: m.t,
      d: m.t === 'buy' ? 'M0,-9 L5,0 L-5,0 Z' : 'M0,9 L5,0 L-5,0 Z',
    }));
  return {
    W,
    padL,
    padR,
    mainH,
    modelArea: area(model),
    modelLine: path(model),
    benchLine: showBench ? path(props.bench) : '',
    showBench,
    ticks,
    showDD,
    ddPath,
    ddArea,
    ddLoVal,
    ddLoY,
    mk,
  };
});
</script>

<template>
  <div :ref="setEl" style="width: 100%">
    <svg v-if="geom" :width="geom.W" :height="height" style="display: block; overflow: visible">
      <defs>
        <linearGradient id="eqfill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.16" />
          <stop offset="100%" stop-color="var(--accent)" stop-opacity="0" />
        </linearGradient>
      </defs>
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
      <path :d="geom.modelArea" fill="url(#eqfill)" />
      <path
        v-if="geom.showBench"
        :d="geom.benchLine"
        fill="none"
        stroke="var(--benchmark)"
        stroke-width="1.3"
        stroke-dasharray="3 3"
      />
      <path :d="geom.modelLine" fill="none" stroke="var(--accent)" stroke-width="1.8" />
      <g v-for="(m, i) in geom.mk" :key="'m' + i" :transform="`translate(${m.x},${m.y})`">
        <path
          :d="m.d"
          :fill="m.t === 'buy' ? 'var(--status-ok)' : 'var(--status-warn)'"
          stroke="var(--bg-panel)"
          stroke-width="1"
        />
      </g>
      <g v-if="geom.showDD">
        <text
          :x="geom.padL"
          :y="geom.mainH + 8"
          font-size="9.5"
          fill="var(--axis-text)"
          class="cap"
        >
          回撤 DRAWDOWN
        </text>
        <path :d="geom.ddArea" fill="var(--dd-fill)" />
        <path
          :d="geom.ddPath"
          fill="none"
          stroke="var(--status-err)"
          stroke-width="1.2"
          stroke-opacity="0.7"
        />
        <text
          :x="geom.padL - 8"
          :y="geom.ddLoY + 3"
          text-anchor="end"
          font-size="9.5"
          fill="var(--axis-text)"
          font-family="var(--font-mono)"
        >
          {{ geom.ddLoVal.toFixed(1) }}%
        </text>
      </g>
    </svg>
  </div>
</template>
