<script setup lang="ts">
// 公式副图:把公式各「数值输出线」画在共享自适应 Y 轴上(色环区分),布尔信号(CROSS/建仓)
// 画成竖向标记线。与上方 K 线共用同一时间轴(等距、同根数)。纯数据序列,不用盈亏/系统色语义。
import { computed } from 'vue';
import { useMeasure } from '../../composables/useMeasure';

const props = withDefaults(
  defineProps<{
    lines: Record<string, Array<number | boolean | null>>;
    signalOutputs: string[];
    n: number; // 根数(= bars.length),保证与 K 线等距对齐
    height?: number;
  }>(),
  { height: 150 },
);

const PALETTE = ['var(--accent)', 'var(--accent-2)', 'var(--status-ok)', 'var(--benchmark)'];

const { setEl, width } = useMeasure();

const geom = computed(() => {
  const W = width.value;
  const padL = 40,
    padR = 12,
    padT = 10,
    padB = 16;
  const n = props.n;
  if (n < 2) return null;
  const innerW = Math.max(10, W - padL - padR);
  const innerH = props.height - padT - padB;
  const x = (i: number) => padL + (i / (n - 1)) * innerW;

  // 数值线(非布尔)统一坐标
  const numeric: Array<{ name: string; color: string; vals: Array<number | null> }> = [];
  let ci = 0;
  for (const [name, arr] of Object.entries(props.lines)) {
    if (props.signalOutputs.includes(name)) continue;
    numeric.push({
      name,
      color: PALETTE[ci % PALETTE.length],
      vals: arr.map((v) => (typeof v === 'number' ? v : null)),
    });
    ci++;
  }
  const flat = numeric.flatMap((s) => s.vals).filter((v): v is number => v != null);
  let lo = flat.length ? Math.min(...flat) : 0;
  let hi = flat.length ? Math.max(...flat) : 1;
  const pad = (hi - lo) * 0.1 || 1;
  lo -= pad;
  hi += pad;
  const y = (v: number) => padT + (1 - (v - lo) / (hi - lo)) * innerH;
  const path = (vals: Array<number | null>) => {
    let d = '';
    let started = false;
    vals.forEach((v, i) => {
      if (v == null) {
        started = false;
        return;
      }
      d += `${started ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)} `;
      started = true;
    });
    return d.trim();
  };

  const series = numeric.map((s) => ({ name: s.name, color: s.color, d: path(s.vals) }));

  // 布尔信号 → 竖向标记线(取第一个 signalOutput 为主;颜色 status-warn 橙)
  const sigName = props.signalOutputs[0];
  const markers: number[] = [];
  if (sigName) {
    (props.lines[sigName] ?? []).forEach((v, i) => {
      if (v === true) markers.push(x(i));
    });
  }
  const ticks = [0, 0.5, 1].map((t) => {
    const val = lo + t * (hi - lo);
    return { y: y(val), v: val };
  });
  return { W, padL, padR, mainH: props.height - padB, series, markers, ticks, sigName };
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
          :x="geom.padL - 6"
          :y="tk.y + 3"
          text-anchor="end"
          font-size="9"
          fill="var(--axis-text)"
          font-family="var(--font-mono)"
        >
          {{ tk.v.toFixed(1) }}
        </text>
      </g>
      <!-- 信号竖线(CROSS/建仓 触发) -->
      <line
        v-for="(mx, i) in geom.markers"
        :key="'m' + i"
        :x1="mx"
        :x2="mx"
        :y1="10"
        :y2="geom.mainH"
        stroke="var(--status-warn)"
        stroke-width="1"
        stroke-dasharray="2 2"
        stroke-opacity="0.7"
      />
      <!-- 数值输出线 -->
      <path
        v-for="(s, i) in geom.series"
        :key="'s' + i"
        :d="s.d"
        fill="none"
        :stroke="s.color"
        stroke-width="1.5"
      />
    </svg>
    <div v-if="geom" class="sub-legend">
      <span v-for="(s, i) in geom.series" :key="i" class="sl">
        <i :style="{ background: s.color }" />{{ s.name }}
      </span>
      <span v-if="geom.sigName" class="sl"> <i class="sig" />{{ geom.sigName }}(信号) </span>
    </div>
  </div>
</template>

<style scoped>
.sub-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 4px;
  font-size: 10.5px;
  color: var(--text-2);
}
.sl {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.sl i {
  width: 12px;
  height: 2px;
  border-radius: 1px;
  display: inline-block;
}
.sl i.sig {
  height: 9px;
  width: 0;
  border-left: 1.5px dashed var(--status-warn);
  background: transparent;
}
</style>
