<script setup lang="ts">
import { computed } from 'vue';
import { useMeasure } from '../../composables/useMeasure';

export interface Bar {
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}
const props = withDefaults(defineProps<{ data: Bar[]; height?: number; ma?: number[] }>(), {
  height: 320,
  ma: () => [5, 20],
});

const MA_COLORS: Record<number, string> = {
  5: '#e0b34a',
  10: '#5aa9e6',
  20: '#b07ce0',
  60: '#6bbf8a',
};

const { setEl, width } = useMeasure();

const geom = computed(() => {
  const W = width.value;
  const padL = 8,
    padR = 52,
    padT = 8,
    padB = 4;
  const volH = 52,
    gap = 8;
  const priceH = props.height - volH - gap - padB;
  const innerW = Math.max(10, W - padL - padR);
  const data = props.data;
  const n = data.length;
  if (!n) return null;
  const cw = Math.max(2, (innerW / n) * 0.62);
  const hi = Math.max(...data.map((d) => d.h));
  const lo = Math.min(...data.map((d) => d.l));
  const pad = (hi - lo) * 0.06 || 0.01;
  const ph = hi + pad;
  const pl = lo - pad;
  const x = (i: number) => padL + (i + 0.5) * (innerW / n);
  const y = (v: number) => padT + (1 - (v - pl) / (ph - pl)) * (priceH - padT);
  const vMax = Math.max(...data.map((d) => d.v), 1);
  const vy = (v: number) => priceH + gap + (1 - v / vMax) * volH;

  const maPath = (period: number) => {
    const pts = data.map((_, i) => {
      if (i < period - 1) return null;
      let s = 0;
      for (let k = 0; k < period; k++) s += data[i - k].c;
      return s / period;
    });
    return pts
      .map((v, i) =>
        v == null ? '' : `${pts[i - 1] == null ? 'M' : 'L'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`,
      )
      .join(' ');
  };

  const ticks = Array.from({ length: 5 }, (_, i) => {
    const t = pl + (i / 4) * (ph - pl);
    return { t, y: y(t) };
  });
  const candles = data.map((d, i) => {
    const up = d.c >= d.o;
    return {
      up,
      x: x(i),
      hY: y(d.h),
      lY: y(d.l),
      bodyY: Math.min(y(d.o), y(d.c)),
      bodyH: Math.max(1, Math.abs(y(d.o) - y(d.c))),
      bodyX: x(i) - cw / 2,
      cw,
      volY: vy(d.v),
      volH: priceH + gap + volH - vy(d.v),
    };
  });
  const maLines = props.ma.map((p) => ({
    p,
    d: maPath(p),
    color: MA_COLORS[p] ?? 'var(--text-2)',
  }));
  return { W, padR, ticks, candles, maLines };
});
</script>

<template>
  <div :ref="setEl" style="width: 100%">
    <svg v-if="geom" :width="geom.W" :height="height" style="display: block; overflow: visible">
      <g v-for="(tk, i) in geom.ticks" :key="i">
        <line :x1="8" :x2="geom.W - geom.padR" :y1="tk.y" :y2="tk.y" stroke="var(--grid-line)" />
        <text
          :x="geom.W - geom.padR + 6"
          :y="tk.y + 3.5"
          font-size="10"
          fill="var(--axis-text)"
          font-family="var(--font-mono)"
        >
          {{ tk.t.toFixed(2) }}
        </text>
      </g>
      <path
        v-for="ml in geom.maLines"
        :key="ml.p"
        :d="ml.d"
        fill="none"
        :stroke="ml.color"
        stroke-width="1.1"
        opacity="0.9"
      />
      <g v-for="(c, i) in geom.candles" :key="i">
        <line
          :x1="c.x"
          :x2="c.x"
          :y1="c.hY"
          :y2="c.lY"
          :stroke="c.up ? 'var(--pnl-up)' : 'var(--pnl-down)'"
          stroke-width="1"
        />
        <rect
          :x="c.bodyX"
          :y="c.bodyY"
          :width="c.cw"
          :height="c.bodyH"
          :fill="c.up ? 'var(--pnl-up)' : 'var(--pnl-down)'"
        />
        <rect
          :x="c.bodyX"
          :y="c.volY"
          :width="c.cw"
          :height="c.volH"
          :fill="c.up ? 'var(--pnl-up)' : 'var(--pnl-down)'"
          opacity="0.4"
        />
      </g>
    </svg>
  </div>
</template>
