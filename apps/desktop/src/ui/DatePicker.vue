<script setup lang="ts">
// 日期选择器 —— 仿 Ant Design Vue DatePicker(暗色令牌化)。
// v-model 为 'YYYY-MM-DD' 字符串(与表单/后端口径一致)。
//
// 关键:面板 Teleport 到 <body> 顶层 + fixed 定位(按触发器 rect 计算),
// 根治"弹层被父卡片 overflow / 层叠上下文裁切撕开"的 bug(absolute 挂卡片内会被后续卡片盖住)。
// AntD 结构:头部「« ‹ 年/月 › »」三级快速切换 · 单元格(今天=描边环 / 选中=实心)· 底部「今天」。
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

const props = withDefaults(
  defineProps<{ modelValue?: string; placeholder?: string; min?: string; max?: string }>(),
  { modelValue: '', placeholder: '请选择日期', min: '', max: '' },
);
const emit = defineEmits<{ 'update:modelValue': [string] }>();

const PANEL_W = 280;
const PANEL_H = 318; // 估高(定位翻转用;实际高度由内容决定)

const open = ref(false);
const mode = ref<'date' | 'month' | 'year'>('date');
const trigger = ref<HTMLElement | null>(null);
const panel = ref<HTMLElement | null>(null);
const panelStyle = ref<Record<string, string>>({});

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
const yearPage = ref(Math.floor(viewY.value / 12) * 12);

const MONTHS = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'];
const WEEK = ['一', '二', '三', '四', '五', '六', '日'];

// 整月网格:42 格,含上/下月补位(out=true,淡显但可点,AntD 同款)。
type Cell = { d: number; ymd: string; out: boolean };
const grid = computed<Cell[]>(() => {
  const y = viewY.value;
  const m = viewM.value;
  let startDow = new Date(y, m - 1, 1).getDay(); // 0=周日
  startDow = startDow === 0 ? 6 : startDow - 1; // 周一为首列
  const daysInThis = new Date(y, m, 0).getDate();
  const prevY = m === 1 ? y - 1 : y;
  const prevM = m === 1 ? 12 : m - 1;
  const daysInPrev = new Date(prevY, prevM, 0).getDate();
  const cells: Cell[] = [];
  for (let i = startDow - 1; i >= 0; i--) {
    const d = daysInPrev - i;
    cells.push({ d, ymd: fmt(prevY, prevM, d), out: true });
  }
  for (let d = 1; d <= daysInThis; d++) cells.push({ d, ymd: fmt(y, m, d), out: false });
  const nextY = m === 12 ? y + 1 : y;
  const nextM = m === 12 ? 1 : m + 1;
  let nd = 1;
  while (cells.length < 42) {
    cells.push({ d: nd, ymd: fmt(nextY, nextM, nd), out: true });
    nd++;
  }
  return cells;
});
const yearCells = computed(() => Array.from({ length: 12 }, (_, i) => yearPage.value + i));

// 头部标签文案
const yearLabel = computed(() =>
  mode.value === 'year' ? `${yearPage.value}-${yearPage.value + 11}` : `${viewY.value}年`,
);
const monthLabel = computed(() => `${viewM.value}月`);

// —— 越界判定(min/max,'YYYY-MM-DD' 字典序可比) ——
function dayDisabled(ymd: string): boolean {
  if (props.min && ymd < props.min) return true;
  if (props.max && ymd > props.max) return true;
  return false;
}
function monthDisabled(y: number, m: number): boolean {
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

// —— 选择 ——
function pick(c: Cell) {
  if (dayDisabled(c.ymd)) return;
  emit('update:modelValue', c.ymd);
  open.value = false;
}
function pickMonth(m: number) {
  if (monthDisabled(viewY.value, m)) return;
  viewM.value = m;
  mode.value = 'date';
}
function pickYear(y: number) {
  if (yearDisabled(y)) return;
  viewY.value = y;
  mode.value = 'month';
}
function gotoToday() {
  viewY.value = todayY;
  viewM.value = todayM;
  yearPage.value = Math.floor(todayY / 12) * 12;
  mode.value = 'date';
  emit('update:modelValue', todayYmd);
  open.value = false;
}
function clear(e?: Event) {
  e?.stopPropagation();
  emit('update:modelValue', '');
  open.value = false;
}

// —— 头部导航 ——
function toYearMode() {
  yearPage.value = Math.floor(viewY.value / 12) * 12;
  mode.value = 'year';
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
  if (viewM.value === 1) {
    viewM.value = 12;
    viewY.value--;
  } else viewM.value--;
}
function nextMonth() {
  if (viewM.value === 12) {
    viewM.value = 1;
    viewY.value++;
  } else viewM.value++;
}

// —— 开关 + 定位(Teleport + fixed) ——
function toggle() {
  open.value = !open.value;
}
function syncView() {
  mode.value = 'date';
  if (sel.value) {
    viewY.value = sel.value.y;
    viewM.value = sel.value.m;
  }
  yearPage.value = Math.floor(viewY.value / 12) * 12;
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
    window.removeEventListener('scroll', place, true);
    window.removeEventListener('resize', place);
  }
});

// 点击外部(含 Teleport 出去的面板)/ Esc 关闭
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
  <div class="dp">
    <div
      ref="trigger"
      role="button"
      tabindex="0"
      class="dp-trigger input"
      :class="{ 'is-empty': !modelValue, on: open, 'has-val': !!modelValue }"
      @click="toggle"
      @keydown.enter="toggle"
    >
      <span class="dp-val mono">{{ modelValue || placeholder }}</span>
      <span class="dp-icons">
        <svg class="dp-cal" width="14" height="14" viewBox="0 0 16 16" fill="none">
          <rect
            x="2"
            y="3"
            width="12"
            height="11"
            rx="2"
            stroke="currentColor"
            stroke-width="1.2"
          />
          <path d="M2 6.4h12M5 1.5v2.4M11 1.5v2.4" stroke="currentColor" stroke-width="1.2" />
        </svg>
        <span v-if="modelValue" class="dp-x" role="button" aria-label="清除" @click="clear">
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
      <div v-if="open" ref="panel" class="dp-panel" :style="panelStyle">
        <!-- 头部:« ‹ 年/月 › » -->
        <div class="dp-head">
          <button type="button" class="dp-nav" aria-label="上一年" @click="superPrev">
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
            class="dp-nav"
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

          <div class="dp-labels">
            <button
              type="button"
              class="dp-label"
              :class="{ static: mode === 'year' }"
              :disabled="mode === 'year'"
              @click="toYearMode"
            >
              {{ yearLabel }}
            </button>
            <button v-if="mode === 'date'" type="button" class="dp-label" @click="mode = 'month'">
              {{ monthLabel }}
            </button>
          </div>

          <button
            v-if="mode === 'date'"
            type="button"
            class="dp-nav"
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
          <button type="button" class="dp-nav" aria-label="下一年" @click="superNext">
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

        <!-- 日视图 -->
        <div v-if="mode === 'date'" class="dp-body">
          <div class="dp-week">
            <span v-for="(w, i) in WEEK" :key="w" :class="{ wknd: i >= 5 }">{{ w }}</span>
          </div>
          <div class="dp-days">
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
              <span class="dp-in">{{ c.d }}</span>
            </button>
          </div>
        </div>

        <!-- 月视图 -->
        <div v-else-if="mode === 'month'" class="dp-body">
          <div class="dp-cells">
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
              <span class="dp-in">{{ mn }}月</span>
            </button>
          </div>
        </div>

        <!-- 年视图 -->
        <div v-else class="dp-body">
          <div class="dp-cells">
            <button
              v-for="y in yearCells"
              :key="y"
              type="button"
              class="dp-cell mono"
              :class="{ sel: !!sel && y === sel.y, now: y === todayY, dis: yearDisabled(y) }"
              :disabled="yearDisabled(y)"
              :aria-selected="!!sel && y === sel.y"
              @click="pickYear(y)"
            >
              <span class="dp-in">{{ y }}</span>
            </button>
          </div>
        </div>

        <!-- 底部:今天 -->
        <div class="dp-foot">
          <button type="button" class="dp-today" @click="gotoToday">今天</button>
        </div>
      </div>
    </Teleport>
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
  flex-wrap: nowrap;
  gap: 8px;
  width: 100%;
  /* 三重锁高:height + min/max + box-sizing → 物理上不可能超 30px(根治"被撑成竖排高框")。
     flex:none + align-self:center → 不被 flex/grid 父容器的 align stretch 纵向拉伸。 */
  height: 30px;
  min-height: 30px;
  max-height: 30px;
  box-sizing: border-box;
  flex: none;
  align-self: center;
  line-height: 1;
  overflow: hidden;
  cursor: pointer;
  text-align: left;
  transition:
    border-color var(--t-fast) var(--ease),
    box-shadow var(--t-fast) var(--ease);
}
.dp-trigger.is-empty .dp-val {
  color: var(--text-3);
}
.dp-val {
  /* 占位/值过长在窄列里不换行(换行会顶高内容,曾是撑高元凶之一)。 */
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dp-trigger.on {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-bg);
}
.dp-val {
  font-size: 13px;
}
.dp-icons {
  position: relative;
  width: 14px;
  height: 14px;
  flex: none;
}
.dp-cal {
  position: absolute;
  inset: 0;
  color: var(--text-3);
  transition: opacity var(--t-fast) var(--ease);
}
.dp-trigger.on .dp-cal {
  color: var(--accent);
}
.dp-x {
  position: absolute;
  inset: 0;
  display: none;
  place-items: center;
  color: var(--text-2);
}
.dp-x:hover {
  color: var(--text-1);
}
.dp-trigger.has-val:hover .dp-cal {
  opacity: 0;
}
.dp-trigger.has-val:hover .dp-x {
  display: grid;
}
</style>

<!-- 面板 Teleport 到 body → scoped 选不到,用全局样式(类名带 dp- 前缀防撞)。 -->
<style>
.dp-panel {
  z-index: 1000;
  box-sizing: border-box;
  padding: 8px 12px 4px;
  border-radius: var(--r-lg);
  background: var(--bg-popover);
  border: 0.5px solid var(--border-strong);
  box-shadow: var(--shadow-pop);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  font-family: var(--font-sans);
  animation: dp-in 140ms var(--ease-out);
}
@keyframes dp-in {
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
  .dp-panel {
    animation: dp-fade 120ms linear;
  }
  @keyframes dp-fade {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
}

.dp-head {
  display: flex;
  align-items: center;
  gap: 2px;
  padding-bottom: 8px;
  margin-bottom: 6px;
  border-bottom: 0.5px solid var(--border-faint);
}
.dp-labels {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
}
.dp-label {
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
.dp-label:hover:not(.static) {
  color: var(--accent);
}
.dp-label.static {
  cursor: default;
}
.dp-nav {
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
.dp-nav:hover {
  background: var(--bg-elevated);
  color: var(--text-1);
}

/* 日视图 */
.dp-week {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  margin-bottom: 2px;
}
.dp-week span {
  text-align: center;
  font-size: 11px;
  color: var(--text-3);
  padding: 4px 0;
}
.dp-week span.wknd {
  color: var(--text-2);
}
.dp-days {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
}
.dp-day {
  height: 32px;
  display: grid;
  place-items: center;
  border: none;
  background: transparent;
  cursor: pointer;
}
.dp-day .dp-in {
  display: grid;
  place-items: center;
  min-width: 24px;
  height: 24px;
  padding: 0 2px;
  border-radius: var(--r-sm);
  font-size: 12.5px;
  color: var(--text-1);
  font-variant-numeric: tabular-nums;
  transition:
    background var(--t-fast) var(--ease),
    color var(--t-fast) var(--ease);
}
.dp-day:hover:not(.dis):not(.sel) .dp-in {
  background: var(--bg-elevated);
}
.dp-day.out .dp-in {
  color: var(--text-3);
}
.dp-day.today .dp-in {
  box-shadow: inset 0 0 0 1px var(--accent);
  color: var(--accent);
}
.dp-day.sel .dp-in {
  background: var(--accent);
  color: var(--text-on-accent);
  font-weight: 600;
}
.dp-day.sel.today .dp-in {
  box-shadow: none;
}
.dp-day.dis {
  cursor: not-allowed;
}
.dp-day.dis .dp-in {
  color: var(--text-3);
  opacity: 0.35;
}

/* 月 / 年视图 */
.dp-cells {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 2px;
  padding: 4px 0;
}
.dp-cell {
  height: 44px;
  display: grid;
  place-items: center;
  border: none;
  background: transparent;
  cursor: pointer;
}
.dp-cell .dp-in {
  display: grid;
  place-items: center;
  min-width: 56px;
  height: 28px;
  padding: 0 10px;
  border-radius: var(--r-sm);
  font-size: 12.5px;
  color: var(--text-1);
  transition:
    background var(--t-fast) var(--ease),
    color var(--t-fast) var(--ease);
}
.dp-cell:hover:not(.dis):not(.sel) .dp-in {
  background: var(--bg-elevated);
}
.dp-cell.now .dp-in {
  box-shadow: inset 0 0 0 1px var(--accent);
  color: var(--accent);
}
.dp-cell.sel .dp-in {
  background: var(--accent);
  color: var(--text-on-accent);
  font-weight: 600;
}
.dp-cell.sel.now .dp-in {
  box-shadow: none;
}
.dp-cell.dis {
  cursor: not-allowed;
}
.dp-cell.dis .dp-in {
  color: var(--text-3);
  opacity: 0.35;
}

/* 底部 */
.dp-foot {
  display: flex;
  justify-content: center;
  margin-top: 4px;
  padding: 7px 0 4px;
  border-top: 0.5px solid var(--border-faint);
}
.dp-today {
  border: none;
  background: transparent;
  font-size: 12.5px;
  color: var(--accent);
  cursor: pointer;
  padding: 2px 12px;
  border-radius: var(--r-sm);
  transition: background var(--t-fast) var(--ease);
}
.dp-today:hover {
  background: var(--accent-bg);
}
</style>
