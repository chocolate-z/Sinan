<script setup lang="ts">
// 日期范围选择器 —— 仿 Ant Design Vue RangePicker(暗色令牌化)。
// v-model 为 [start, end] 两个 'YYYY-MM-DD' 字符串。
//
// 单框「开始 → 结束」+ 双月面板 + 区间高亮 + 悬停预览 + 年/月级联快速跳转。
// 面板 Teleport 到 <body>(fixed 定位),不被父卡片 overflow/层叠裁切。
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

const props = withDefaults(
  defineProps<{
    modelValue?: [string, string];
    placeholderStart?: string;
    placeholderEnd?: string;
    min?: string;
    max?: string;
  }>(),
  {
    modelValue: () => ['', ''],
    placeholderStart: '开始日期',
    placeholderEnd: '结束日期',
    min: '',
    max: '',
  },
);
const emit = defineEmits<{ 'update:modelValue': [[string, string]] }>();

const PANEL_W = 580;
const PANEL_H = 330;

const open = ref(false);
const mode = ref<'date' | 'month' | 'year'>('date');
const trigger = ref<HTMLElement | null>(null);
const panel = ref<HTMLElement | null>(null);
const panelStyle = ref<Record<string, string>>({});

const parse = (s: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m ? { y: +m[1], m: +m[2], d: +m[3] } : null;
};
const pad = (n: number) => String(n).padStart(2, '0');
const fmt = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

const today = new Date();
const todayY = today.getFullYear();
const todayM = today.getMonth() + 1;
const todayYmd = fmt(todayY, todayM, today.getDate());

// 内部选择状态(仅完成时 emit;关闭不完整选择则回滚到 modelValue)。
const range = ref<[string, string]>([props.modelValue?.[0] || '', props.modelValue?.[1] || '']);
const anchor = ref('');
const selecting = ref(false);
const hoverYmd = ref('');

const viewY = ref(todayY);
const viewM = ref(todayM);
const yearPage = ref(Math.floor(todayY / 12) * 12);

function resetFromModel() {
  range.value = [props.modelValue?.[0] || '', props.modelValue?.[1] || ''];
  selecting.value = false;
  hoverYmd.value = '';
}
function syncView() {
  resetFromModel();
  const s = parse(range.value[0]);
  if (s) {
    viewY.value = s.y;
    viewM.value = s.m;
  }
  mode.value = 'date';
  yearPage.value = Math.floor(viewY.value / 12) * 12;
}

const MONTHS = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'];
const WEEK = ['一', '二', '三', '四', '五', '六', '日'];

function addMonth(y: number, m: number, delta: number) {
  const t = (y * 12 + (m - 1) + delta) % 12;
  return { y: Math.floor((y * 12 + (m - 1) + delta) / 12), m: (((t % 12) + 12) % 12) + 1 };
}

type Cell = { d: number; ymd: string; out: boolean };
function monthGrid(y: number, m: number): Cell[] {
  let sd = new Date(y, m - 1, 1).getDay();
  sd = sd === 0 ? 6 : sd - 1;
  const dThis = new Date(y, m, 0).getDate();
  const p = addMonth(y, m, -1);
  const dPrev = new Date(p.y, p.m, 0).getDate();
  const cells: Cell[] = [];
  for (let i = sd - 1; i >= 0; i--)
    cells.push({ d: dPrev - i, ymd: fmt(p.y, p.m, dPrev - i), out: true });
  for (let d = 1; d <= dThis; d++) cells.push({ d, ymd: fmt(y, m, d), out: false });
  const n = addMonth(y, m, 1);
  let nd = 1;
  while (cells.length < 42) {
    cells.push({ d: nd, ymd: fmt(n.y, n.m, nd), out: true });
    nd++;
  }
  return cells;
}

const leftGrid = computed(() => monthGrid(viewY.value, viewM.value));
const rightMonth = computed(() => addMonth(viewY.value, viewM.value, 1));
const rightGrid = computed(() => monthGrid(rightMonth.value.y, rightMonth.value.m));
const yearCells = computed(() => Array.from({ length: 12 }, (_, i) => yearPage.value + i));
const yearLabel = computed(() =>
  mode.value === 'year' ? `${yearPage.value}-${yearPage.value + 11}` : `${viewY.value}年`,
);

// 有效区间(含悬停预览):选择中用 anchor↔hover,否则用已选 range。
const effStart = computed(() => {
  if (selecting.value) {
    const h = hoverYmd.value || anchor.value;
    return anchor.value <= h ? anchor.value : h;
  }
  return range.value[0];
});
const effEnd = computed(() => {
  if (selecting.value) {
    const h = hoverYmd.value || anchor.value;
    return anchor.value <= h ? h : anchor.value;
  }
  return range.value[1];
});

function dayDisabled(ymd: string) {
  if (props.min && ymd < props.min) return true;
  if (props.max && ymd > props.max) return true;
  return false;
}
function dayCls(c: Cell) {
  const s = effStart.value;
  const e = effEnd.value;
  const isStart = !!s && c.ymd === s;
  const isEnd = !!e && c.ymd === e;
  return {
    out: c.out,
    today: c.ymd === todayYmd,
    dis: dayDisabled(c.ymd),
    start: isStart,
    end: isEnd,
    'in-range': !!s && !!e && s !== e && c.ymd > s && c.ymd < e,
  };
}

function pick(c: Cell) {
  if (dayDisabled(c.ymd)) return;
  if (!selecting.value) {
    anchor.value = c.ymd;
    range.value = [c.ymd, ''];
    hoverYmd.value = c.ymd;
    selecting.value = true;
  } else {
    const a = anchor.value;
    const b = c.ymd;
    const s = a <= b ? a : b;
    const e = a <= b ? b : a;
    range.value = [s, e];
    selecting.value = false;
    hoverYmd.value = '';
    emit('update:modelValue', [s, e]);
    open.value = false;
  }
}
function onHover(c: Cell) {
  if (selecting.value && !dayDisabled(c.ymd)) hoverYmd.value = c.ymd;
}
function clear(e?: Event) {
  e?.stopPropagation();
  range.value = ['', ''];
  selecting.value = false;
  emit('update:modelValue', ['', '']);
  open.value = false;
}

// —— 头部导航(date 模式移动左月,右月恒=左月+1)——
function toYearMode() {
  yearPage.value = Math.floor(viewY.value / 12) * 12;
  mode.value = 'year';
}
function pickMonth(m: number) {
  viewM.value = m;
  mode.value = 'date';
}
function pickYear(y: number) {
  viewY.value = y;
  mode.value = 'month';
}
function superPrev() {
  if (mode.value === 'year') yearPage.value -= 12;
  else viewY.value--;
}
function superNext() {
  if (mode.value === 'year') yearPage.value += 12;
  else viewY.value++;
}
function prevMonth() {
  const r = addMonth(viewY.value, viewM.value, -1);
  viewY.value = r.y;
  viewM.value = r.m;
}
function nextMonth() {
  const r = addMonth(viewY.value, viewM.value, 1);
  viewY.value = r.y;
  viewM.value = r.m;
}

function toggle() {
  open.value = !open.value;
}
function place() {
  const t = trigger.value?.getBoundingClientRect();
  if (!t) return;
  const margin = 8;
  let left = Math.min(t.left, window.innerWidth - PANEL_W - margin);
  left = Math.max(margin, left);
  let top = t.bottom + 6;
  if (top + PANEL_H > window.innerHeight && t.top - PANEL_H - 6 > 0) top = t.top - PANEL_H - 6;
  panelStyle.value = {
    position: 'fixed',
    top: `${Math.round(top)}px`,
    left: `${Math.round(left)}px`,
    width: `${PANEL_W}px`,
  };
}

watch(open, (v) => {
  if (v) {
    syncView();
    nextTick(place);
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
  } else {
    if (selecting.value) resetFromModel(); // 仅丢弃「未完成」选择;已完成的保留显示
    selecting.value = false;
    hoverYmd.value = '';
    window.removeEventListener('scroll', place, true);
    window.removeEventListener('resize', place);
  }
});

// 父级更新 modelValue(如完成选择后回写)→ 关闭态同步触发器显示。
watch(
  () => props.modelValue,
  (v) => {
    if (!open.value) range.value = [v?.[0] || '', v?.[1] || ''];
  },
  { deep: true },
);

function onDocPointer(e: MouseEvent) {
  if (!open.value) return;
  const t = e.target as Node;
  if (trigger.value?.contains(t)) return;
  if (panel.value?.contains(t)) return;
  open.value = false;
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && open.value) open.value = false;
}
onMounted(() => {
  resetFromModel();
  document.addEventListener('mousedown', onDocPointer);
  document.addEventListener('keydown', onKey);
});
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocPointer);
  document.removeEventListener('keydown', onKey);
  window.removeEventListener('scroll', place, true);
  window.removeEventListener('resize', place);
});
</script>

<template>
  <div
    ref="trigger"
    class="rp-trigger input"
    :class="{ on: open, 'has-val': !!(range[0] || range[1]) }"
    role="button"
    tabindex="0"
    @click="toggle"
    @keydown.enter="toggle"
  >
    <span class="rp-seg mono" :class="{ empty: !range[0], active: open && !selecting }">{{
      range[0] || placeholderStart
    }}</span>
    <span class="rp-arrow">→</span>
    <span class="rp-seg mono" :class="{ empty: !range[1], active: open && selecting }">{{
      range[1] || placeholderEnd
    }}</span>
    <span class="rp-icons">
      <svg class="rp-cal" width="14" height="14" viewBox="0 0 16 16" fill="none">
        <rect x="2" y="3" width="12" height="11" rx="2" stroke="currentColor" stroke-width="1.2" />
        <path d="M2 6.4h12M5 1.5v2.4M11 1.5v2.4" stroke="currentColor" stroke-width="1.2" />
      </svg>
      <span v-if="range[0] || range[1]" class="rp-x" role="button" aria-label="清除" @click="clear">
        <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
          <circle cx="7" cy="7" r="6" fill="currentColor" opacity="0.18" />
          <path
            d="M5 5l4 4M9 5l-4 4"
            stroke="currentColor"
            stroke-width="1.3"
            stroke-linecap="round"
          />
        </svg>
      </span>
    </span>
  </div>

  <Teleport to="body">
    <div v-if="open" ref="panel" class="rp-panel" :style="panelStyle">
      <div class="rp-head">
        <button type="button" class="rp-nav" aria-label="上一年" @click="superPrev">
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
            <path
              d="M7.5 3 4 7l3.5 4M11 3 7.5 7l3.5 4"
              stroke="currentColor"
              stroke-width="1.4"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </button>
        <button
          v-if="mode === 'date'"
          type="button"
          class="rp-nav"
          aria-label="上一月"
          @click="prevMonth"
        >
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
            <path
              d="M9 3 5 7l4 4"
              stroke="currentColor"
              stroke-width="1.4"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </button>
        <div class="rp-labels">
          <template v-if="mode === 'date'">
            <button type="button" class="rp-label" @click="toYearMode">{{ viewY }}年</button>
            <button type="button" class="rp-label" @click="mode = 'month'">{{ viewM }}月</button>
            <span class="rp-spacer" />
            <span class="rp-label static">{{ rightMonth.y }}年 {{ rightMonth.m }}月</span>
          </template>
          <button
            v-else
            type="button"
            class="rp-label"
            :class="{ static: mode === 'year' }"
            :disabled="mode === 'year'"
            @click="toYearMode"
          >
            {{ yearLabel }}
          </button>
        </div>
        <button
          v-if="mode === 'date'"
          type="button"
          class="rp-nav"
          aria-label="下一月"
          @click="nextMonth"
        >
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
            <path
              d="M5 3l4 4-4 4"
              stroke="currentColor"
              stroke-width="1.4"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </button>
        <button type="button" class="rp-nav" aria-label="下一年" @click="superNext">
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
            <path
              d="M6.5 3 10 7l-3.5 4M3 3l3.5 4L3 11"
              stroke="currentColor"
              stroke-width="1.4"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </button>
      </div>

      <!-- 双月日视图 -->
      <div v-if="mode === 'date'" class="rp-body two">
        <div v-for="(g, gi) in [leftGrid, rightGrid]" :key="gi" class="rp-month">
          <div class="rp-week">
            <span v-for="(w, i) in WEEK" :key="w" :class="{ wknd: i >= 5 }">{{ w }}</span>
          </div>
          <div class="rp-grid">
            <button
              v-for="(c, i) in g"
              :key="i"
              type="button"
              class="rp-day"
              :class="dayCls(c)"
              :disabled="dayDisabled(c.ymd)"
              :aria-label="c.ymd"
              @click="pick(c)"
              @mouseenter="onHover(c)"
            >
              <span class="rp-in">{{ c.d }}</span>
            </button>
          </div>
        </div>
      </div>

      <!-- 月视图 -->
      <div v-else-if="mode === 'month'" class="rp-body">
        <div class="rp-cells">
          <button
            v-for="(mn, i) in MONTHS"
            :key="mn"
            type="button"
            class="rp-cell"
            :class="{ now: i + 1 === todayM && viewY === todayY }"
            @click="pickMonth(i + 1)"
          >
            <span class="rp-in">{{ mn }}月</span>
          </button>
        </div>
      </div>

      <!-- 年视图 -->
      <div v-else class="rp-body">
        <div class="rp-cells">
          <button
            v-for="y in yearCells"
            :key="y"
            type="button"
            class="rp-cell mono"
            :class="{ now: y === todayY }"
            @click="pickYear(y)"
          >
            <span class="rp-in">{{ y }}</span>
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.rp-trigger {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
  cursor: pointer;
  transition:
    border-color var(--t-fast) var(--ease),
    box-shadow var(--t-fast) var(--ease);
}
.rp-trigger.on {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-bg);
}
.rp-seg {
  flex: 1;
  font-size: 13px;
  text-align: center;
  padding: 1px 4px;
  border-radius: var(--r-xs);
}
.rp-seg.empty {
  color: var(--text-3);
}
.rp-seg.active {
  background: var(--accent-bg);
}
.rp-arrow {
  flex: none;
  color: var(--text-3);
  font-size: 12px;
}
.rp-icons {
  position: relative;
  width: 14px;
  height: 14px;
  flex: none;
  margin-left: 2px;
}
.rp-cal {
  position: absolute;
  inset: 0;
  color: var(--text-3);
  transition: opacity var(--t-fast) var(--ease);
}
.rp-trigger.on .rp-cal {
  color: var(--accent);
}
.rp-x {
  position: absolute;
  inset: 0;
  display: none;
  place-items: center;
  color: var(--text-2);
}
.rp-x:hover {
  color: var(--text-1);
}
.rp-trigger.has-val:hover .rp-cal {
  opacity: 0;
}
.rp-trigger.has-val:hover .rp-x {
  display: grid;
}
</style>

<style>
.rp-panel {
  z-index: 1000;
  box-sizing: border-box;
  padding: 8px 12px 10px;
  border-radius: var(--r-lg);
  background: var(--bg-popover);
  border: 0.5px solid var(--border-strong);
  box-shadow: var(--shadow-pop);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  font-family: var(--font-sans);
  animation: rp-in 140ms var(--ease-out);
}
@keyframes rp-in {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
@media (prefers-reduced-motion: reduce) {
  .rp-panel {
    animation: none;
  }
}

.rp-head {
  display: flex;
  align-items: center;
  gap: 2px;
  padding-bottom: 8px;
  margin-bottom: 6px;
  border-bottom: 0.5px solid var(--border-faint);
}
.rp-labels {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
}
.rp-spacer {
  width: 56px;
}
.rp-label {
  height: 26px;
  padding: 0 6px;
  border: none;
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--text-1);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: color var(--t-fast) var(--ease);
}
.rp-label:hover:not(.static) {
  color: var(--accent);
}
.rp-label.static {
  cursor: default;
}
.rp-nav {
  width: 26px;
  height: 26px;
  flex: none;
  display: grid;
  place-items: center;
  border: none;
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--text-3);
  cursor: pointer;
  transition:
    background var(--t-fast) var(--ease),
    color var(--t-fast) var(--ease);
}
.rp-nav:hover {
  background: var(--bg-elevated);
  color: var(--text-1);
}

.rp-body.two {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
.rp-week {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  margin-bottom: 2px;
}
.rp-week span {
  text-align: center;
  font-size: 11px;
  color: var(--text-3);
  padding: 4px 0;
}
.rp-week span.wknd {
  color: var(--text-2);
}
.rp-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
}
.rp-day {
  height: 32px;
  display: grid;
  place-items: center;
  border: none;
  background: transparent;
  cursor: pointer;
  padding: 0;
}
.rp-day .rp-in {
  display: grid;
  place-items: center;
  width: 26px;
  height: 24px;
  border-radius: var(--r-sm);
  font-size: 12.5px;
  color: var(--text-1);
  font-variant-numeric: tabular-nums;
  transition:
    background var(--t-fast) var(--ease),
    color var(--t-fast) var(--ease);
}
.rp-day:hover:not(.dis):not(.start):not(.end) .rp-in {
  background: var(--bg-elevated);
}
/* 区间连续浅带:in-range + 两端都铺 accent-bg,两端做半圆角衔接 */
.rp-day.in-range,
.rp-day.start,
.rp-day.end {
  background: var(--accent-bg);
}
.rp-day.start {
  border-top-left-radius: var(--r-sm);
  border-bottom-left-radius: var(--r-sm);
}
.rp-day.end {
  border-top-right-radius: var(--r-sm);
  border-bottom-right-radius: var(--r-sm);
}
.rp-day.start.end {
  border-radius: var(--r-sm);
}
.rp-day.start .rp-in,
.rp-day.end .rp-in {
  background: var(--accent);
  color: var(--text-on-accent);
  font-weight: 600;
}
.rp-day.today .rp-in {
  box-shadow: inset 0 0 0 1px var(--accent);
  color: var(--accent);
}
.rp-day.start.today .rp-in,
.rp-day.end.today .rp-in {
  box-shadow: none;
}
.rp-day.out .rp-in {
  color: var(--text-3);
}
.rp-day.dis {
  cursor: not-allowed;
}
.rp-day.dis .rp-in {
  color: var(--text-3);
  opacity: 0.35;
}

.rp-cells {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 4px;
  padding: 6px 0;
  max-width: 280px;
  margin: 0 auto;
}
.rp-cell {
  height: 44px;
  display: grid;
  place-items: center;
  border: none;
  background: transparent;
  cursor: pointer;
}
.rp-cell .rp-in {
  display: grid;
  place-items: center;
  min-width: 56px;
  height: 28px;
  padding: 0 10px;
  border-radius: var(--r-sm);
  font-size: 12.5px;
  color: var(--text-1);
  transition: background var(--t-fast) var(--ease);
}
.rp-cell:hover .rp-in {
  background: var(--bg-elevated);
}
.rp-cell.now .rp-in {
  box-shadow: inset 0 0 0 1px var(--accent);
  color: var(--accent);
}
</style>
