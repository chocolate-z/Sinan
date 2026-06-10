<script setup lang="ts">
// 自定义日期选择器(替代原生 <input type="date"> 的浏览器默认日历)。
// v-model 为 'YYYY-MM-DD' 字符串(与表单/后端口径一致)。
// macOS 风:日→月→年三级快速切换 · 玻璃弹层入场动画 · 整月网格(相邻月淡显)·
// 今天用圆点标记(与选中态共存)· accent 选中带辉光 · 设计令牌驱动。
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

const props = withDefaults(
  defineProps<{ modelValue?: string; placeholder?: string; min?: string; max?: string }>(),
  { modelValue: '', placeholder: '选择日期', min: '', max: '' },
);
const emit = defineEmits<{ 'update:modelValue': [string] }>();

const open = ref(false);
const mode = ref<'days' | 'months' | 'years'>('days');
const root = ref<HTMLElement | null>(null);

function parse(s: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m ? { y: +m[1], m: +m[2], d: +m[3] } : null;
}
const pad = (n: number) => String(n).padStart(2, '0');
const fmt = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

const today = new Date();
const todayY = today.getFullYear();
const todayM = today.getMonth() + 1;
const todayYmd = fmt(todayY, todayM, today.getDate());

const sel = computed(() => parse(props.modelValue));
const viewY = ref(sel.value?.y ?? todayY);
const viewM = ref(sel.value?.m ?? todayM); // 1–12
// 年视图:12 年一页,起始年对齐到 ...0(2020–2031)
const yearPage = ref(Math.floor(viewY.value / 12) * 12);

function toggle() {
  open.value = !open.value;
  if (open.value) syncToSelection();
}
function syncToSelection() {
  mode.value = 'days';
  if (sel.value) {
    viewY.value = sel.value.y;
    viewM.value = sel.value.m;
  }
  yearPage.value = Math.floor(viewY.value / 12) * 12;
}

const MONTHS = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'];
const WEEK = ['一', '二', '三', '四', '五', '六', '日'];

// 整月网格:42 格,含上/下月补位(out=true,淡显但可点)
type Cell = { d: number; ymd: string; out: boolean };
const grid = computed<Cell[]>(() => {
  const y = viewY.value;
  const m = viewM.value;
  const first = new Date(y, m - 1, 1);
  let startDow = first.getDay(); // 0=周日
  startDow = startDow === 0 ? 6 : startDow - 1; // 周一为首列
  const daysInThis = new Date(y, m, 0).getDate();
  const prevY = m === 1 ? y - 1 : y;
  const prevM = m === 1 ? 12 : m - 1;
  const daysInPrev = new Date(prevY, prevM, 0).getDate();
  const cells: Cell[] = [];
  // 上月补位
  for (let i = startDow - 1; i >= 0; i--) {
    const d = daysInPrev - i;
    cells.push({ d, ymd: fmt(prevY, prevM, d), out: true });
  }
  // 本月
  for (let d = 1; d <= daysInThis; d++) cells.push({ d, ymd: fmt(y, m, d), out: false });
  // 下月补位至 42
  const nextY = m === 12 ? y + 1 : y;
  const nextM = m === 12 ? 1 : m + 1;
  let nd = 1;
  while (cells.length < 42) {
    cells.push({ d: nd, ymd: fmt(nextY, nextM, nd), out: true });
    nd++;
  }
  return cells;
});

const yearCells = computed(() => {
  const start = yearPage.value;
  return Array.from({ length: 12 }, (_, i) => start + i);
});

// —— 越界判定(min/max,'YYYY-MM-DD' 字典序可比) ——
function dayDisabled(ymd: string): boolean {
  if (props.min && ymd < props.min) return true;
  if (props.max && ymd > props.max) return true;
  return false;
}
function monthDisabled(y: number, m: number): boolean {
  // 整月都越界才禁(月末 < min 或 月初 > max)
  const last = new Date(y, m, 0).getDate();
  if (props.min && fmt(y, m, last) < props.min) return true;
  if (props.max && fmt(y, m, 1) > props.max) return true;
  return false;
}
function yearDisabled(y: number): boolean {
  if (props.min && fmt(y, 12, 31) < props.min) return true;
  if (props.max && fmt(y, 1, 1) > props.max) return true;
  return false;
}

// —— 选择 / 导航 ——
function pick(c: Cell) {
  if (dayDisabled(c.ymd)) return;
  emit('update:modelValue', c.ymd);
  open.value = false;
}
function pickMonth(m: number) {
  if (monthDisabled(viewY.value, m)) return;
  viewM.value = m;
  mode.value = 'days';
}
function pickYear(y: number) {
  if (yearDisabled(y)) return;
  viewY.value = y;
  mode.value = 'months';
}
function titleClick() {
  if (mode.value === 'days') mode.value = 'months';
  else if (mode.value === 'months') {
    yearPage.value = Math.floor(viewY.value / 12) * 12;
    mode.value = 'years';
  }
}
function prev() {
  if (mode.value === 'days') {
    if (viewM.value === 1) {
      viewM.value = 12;
      viewY.value--;
    } else viewM.value--;
  } else if (mode.value === 'months') viewY.value--;
  else yearPage.value -= 12;
}
function next() {
  if (mode.value === 'days') {
    if (viewM.value === 12) {
      viewM.value = 1;
      viewY.value++;
    } else viewM.value++;
  } else if (mode.value === 'months') viewY.value++;
  else yearPage.value += 12;
}
function gotoToday() {
  viewY.value = todayY;
  viewM.value = todayM;
  yearPage.value = Math.floor(todayY / 12) * 12;
  mode.value = 'days';
}
function clear() {
  emit('update:modelValue', '');
  open.value = false;
}

const title = computed(() => {
  if (mode.value === 'days') return `${viewY.value} 年 ${pad(viewM.value)} 月`;
  if (mode.value === 'months') return `${viewY.value} 年`;
  return `${yearPage.value} – ${yearPage.value + 11}`;
});

// 点击外部 / Esc 关闭
function onDocPointer(e: MouseEvent) {
  if (root.value && !root.value.contains(e.target as Node)) open.value = false;
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && open.value) open.value = false;
}
onMounted(() => {
  document.addEventListener('mousedown', onDocPointer);
  document.addEventListener('keydown', onKey);
});
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocPointer);
  document.removeEventListener('keydown', onKey);
});
</script>

<template>
  <div ref="root" class="dp">
    <button
      type="button"
      class="dp-trigger input mono"
      :class="{ empty: !modelValue, on: open }"
      @click="toggle"
    >
      <span>{{ modelValue || placeholder }}</span>
      <svg class="dp-cal" width="14" height="14" viewBox="0 0 16 16" fill="none">
        <rect x="2" y="3" width="12" height="11" rx="2" stroke="currentColor" stroke-width="1.2" />
        <path d="M2 6.4h12M5 1.5v2.4M11 1.5v2.4" stroke="currentColor" stroke-width="1.2" />
      </svg>
    </button>

    <div v-if="open" class="dp-pop">
      <div class="dp-head">
        <button type="button" class="dp-nav" aria-label="上一页" @click="prev">
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
            <path
              d="M9 3 5 7l4 4"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
            />
          </svg>
        </button>
        <button type="button" class="dp-title mono" @click="titleClick">{{ title }}</button>
        <button type="button" class="dp-nav" aria-label="下一页" @click="next">
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
            <path
              d="M5 3l4 4-4 4"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
            />
          </svg>
        </button>
      </div>

      <!-- 日视图 -->
      <div v-if="mode === 'days'" class="dp-body">
        <div class="dp-week">
          <span v-for="(w, i) in WEEK" :key="w" :class="{ wknd: i >= 5 }">{{ w }}</span>
        </div>
        <div class="dp-grid">
          <button
            v-for="(c, i) in grid"
            :key="i"
            type="button"
            class="dp-day"
            :class="{
              out: c.out,
              sel: c.ymd === modelValue,
              today: c.ymd === todayYmd,
              dis: dayDisabled(c.ymd),
            }"
            :disabled="dayDisabled(c.ymd)"
            :aria-label="c.ymd"
            :aria-selected="c.ymd === modelValue"
            :aria-current="c.ymd === todayYmd ? 'date' : undefined"
            @click="pick(c)"
          >
            {{ c.d }}
            <i v-if="c.ymd === todayYmd && c.ymd !== modelValue" class="dp-dot" />
          </button>
        </div>
      </div>

      <!-- 月视图 -->
      <div v-else-if="mode === 'months'" class="dp-body">
        <div class="dp-mgrid">
          <button
            v-for="(mn, i) in MONTHS"
            :key="mn"
            type="button"
            class="dp-cell"
            :class="{
              sel: i + 1 === viewM && !!sel && viewY === sel.y,
              now: i + 1 === todayM && viewY === todayY,
              dis: monthDisabled(viewY, i + 1),
            }"
            :disabled="monthDisabled(viewY, i + 1)"
            :aria-label="`${viewY}年${i + 1}月`"
            :aria-selected="i + 1 === viewM && !!sel && viewY === sel.y"
            @click="pickMonth(i + 1)"
          >
            {{ mn }}月
          </button>
        </div>
      </div>

      <!-- 年视图 -->
      <div v-else class="dp-body">
        <div class="dp-mgrid">
          <button
            v-for="y in yearCells"
            :key="y"
            type="button"
            class="dp-cell mono"
            :class="{
              sel: !!sel && y === sel.y,
              now: y === todayY,
              dis: yearDisabled(y),
            }"
            :disabled="yearDisabled(y)"
            :aria-selected="!!sel && y === sel.y"
            @click="pickYear(y)"
          >
            {{ y }}
          </button>
        </div>
      </div>

      <div class="dp-foot">
        <button type="button" class="dp-act" @click="clear">清除</button>
        <button type="button" class="dp-act accent" @click="gotoToday">今天</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dp {
  position: relative;
}
.dp-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  cursor: pointer;
  text-align: left;
  transition:
    border-color var(--t-fast) var(--ease),
    box-shadow var(--t-fast) var(--ease);
}
.dp-trigger.empty span {
  color: var(--text-3);
}
.dp-trigger.on {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-bg);
}
.dp-trigger.on .dp-cal {
  color: var(--accent);
}
.dp-cal {
  flex: none;
  color: var(--text-3);
  transition: color var(--t-fast) var(--ease);
}

/* 弹层 */
.dp-pop {
  position: absolute;
  z-index: 50;
  top: calc(100% + 7px);
  left: 0;
  width: 272px;
  padding: 12px 12px 10px;
  border-radius: var(--r-lg);
  background: var(--bg-popover);
  border: 0.5px solid var(--border-strong);
  box-shadow: var(--shadow-pop);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  transform-origin: top left;
  animation: dp-in 150ms var(--ease-out);
}
@keyframes dp-in {
  from {
    opacity: 0;
    transform: translateY(-6px) scale(0.97);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}
@keyframes dp-fade {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
/* 减少动态:保留淡入,去掉位移/缩放(避免前庭不适) */
@media (prefers-reduced-motion: reduce) {
  .dp-pop {
    animation: dp-fade 120ms linear;
  }
}

.dp-head {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 8px;
}
.dp-title {
  flex: 1;
  height: 28px;
  border: none;
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--text-1);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background var(--t-fast) var(--ease);
}
.dp-title:hover {
  background: var(--bg-elevated);
  color: var(--accent);
}
.dp-nav {
  width: 28px;
  height: 28px;
  flex: none;
  display: grid;
  place-items: center;
  border: none;
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--text-2);
  cursor: pointer;
  transition:
    background var(--t-fast) var(--ease),
    color var(--t-fast) var(--ease);
}
.dp-nav:hover {
  background: var(--bg-elevated);
  color: var(--text-1);
}

.dp-body {
  min-height: 196px;
}

/* 日视图 */
.dp-week {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  margin-bottom: 5px;
}
.dp-week span {
  text-align: center;
  font-size: 10.5px;
  font-weight: 600;
  color: var(--text-3);
  padding: 2px 0;
}
.dp-week span.wknd {
  color: var(--text-2);
}
.dp-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 2px;
}
.dp-day {
  position: relative;
  aspect-ratio: 1;
  border: none;
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--text-1);
  font-size: 12.5px;
  cursor: pointer;
  font-variant-numeric: tabular-nums;
  transition:
    background var(--t-fast) var(--ease),
    color var(--t-fast) var(--ease),
    transform var(--t-fast) var(--ease);
}
.dp-day:hover:not(.dis):not(.sel) {
  background: var(--bg-elevated);
}
.dp-day.out {
  color: var(--text-3);
  opacity: 0.55;
}
.dp-day.today {
  font-weight: 700;
  color: var(--accent);
}
.dp-dot {
  position: absolute;
  left: 50%;
  bottom: 4px;
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: var(--accent);
  transform: translateX(-50%);
}
.dp-day.sel {
  background: var(--accent-grad);
  color: var(--text-on-accent);
  font-weight: 600;
  box-shadow: var(--accent-glow);
  transform: scale(1.02);
}
.dp-day.sel.out {
  opacity: 1;
}
.dp-day.dis {
  color: var(--text-3);
  opacity: 0.4;
  cursor: not-allowed;
}

/* 月 / 年视图 */
.dp-mgrid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
  padding-top: 6px;
}
.dp-cell {
  height: 44px;
  border: none;
  border-radius: var(--r-md);
  background: var(--bg-elevated);
  color: var(--text-1);
  font-size: 12.5px;
  cursor: pointer;
  transition:
    background var(--t-fast) var(--ease),
    color var(--t-fast) var(--ease);
}
.dp-cell:hover:not(.dis):not(.sel) {
  background: var(--accent-bg);
  color: var(--accent);
}
.dp-cell.now {
  color: var(--accent);
  font-weight: 600;
}
.dp-cell.sel {
  background: var(--accent-grad);
  color: var(--text-on-accent);
  font-weight: 600;
  box-shadow: var(--accent-glow);
}
.dp-cell.dis {
  opacity: 0.4;
  cursor: not-allowed;
}

.dp-foot {
  display: flex;
  justify-content: space-between;
  margin-top: 10px;
  padding-top: 9px;
  border-top: 0.5px solid var(--border-faint);
}
.dp-act {
  border: none;
  background: transparent;
  font-size: 11.5px;
  font-weight: 500;
  color: var(--text-2);
  cursor: pointer;
  padding: 4px 10px;
  border-radius: var(--r-pill);
  transition:
    background var(--t-fast) var(--ease),
    color var(--t-fast) var(--ease);
}
.dp-act:hover {
  background: var(--bg-elevated);
  color: var(--text-1);
}
.dp-act.accent {
  color: var(--accent);
}
.dp-act.accent:hover {
  background: var(--accent-bg);
}
</style>
