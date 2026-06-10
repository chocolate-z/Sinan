<script setup lang="ts">
// 自定义日期选择器(替代原生 <input type="date"> 的浏览器默认日历)。
// v-model 为 'YYYY-MM-DD' 字符串(与表单/后端口径一致);玻璃弹层 + accent 选中,设计令牌风。
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

const props = withDefaults(
  defineProps<{ modelValue?: string; placeholder?: string; min?: string; max?: string }>(),
  { modelValue: '', placeholder: '选择日期', min: '', max: '' },
);
const emit = defineEmits<{ 'update:modelValue': [string] }>();

const open = ref(false);
const root = ref<HTMLElement | null>(null);

function parse(s: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m ? { y: +m[1], m: +m[2], d: +m[3] } : null;
}
const pad = (n: number) => String(n).padStart(2, '0');
const fmt = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

const today = new Date();
const todayYmd = fmt(today.getFullYear(), today.getMonth() + 1, today.getDate());
const sel = computed(() => parse(props.modelValue));
const viewY = ref(sel.value?.y ?? today.getFullYear());
const viewM = ref(sel.value?.m ?? today.getMonth() + 1); // 1–12

function toggle() {
  open.value = !open.value;
  if (open.value && sel.value) {
    viewY.value = sel.value.y;
    viewM.value = sel.value.m;
  }
}

const WEEK = ['一', '二', '三', '四', '五', '六', '日'];
const grid = computed(() => {
  const first = new Date(viewY.value, viewM.value - 1, 1);
  let startDow = first.getDay(); // 0=周日
  startDow = startDow === 0 ? 6 : startDow - 1; // 以周一为首列
  const days = new Date(viewY.value, viewM.value, 0).getDate();
  const cells: Array<{ d: number; ymd: string } | null> = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= days; d++) cells.push({ d, ymd: fmt(viewY.value, viewM.value, d) });
  while (cells.length < 42) cells.push(null);
  return cells;
});

function disabled(ymd: string): boolean {
  if (props.min && ymd < props.min) return true;
  if (props.max && ymd > props.max) return true;
  return false;
}
function pick(ymd: string) {
  if (disabled(ymd)) return;
  emit('update:modelValue', ymd);
  open.value = false;
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
function gotoToday() {
  viewY.value = today.getFullYear();
  viewM.value = today.getMonth() + 1;
}
function clear() {
  emit('update:modelValue', '');
  open.value = false;
}

function onDocPointer(e: MouseEvent) {
  if (root.value && !root.value.contains(e.target as Node)) open.value = false;
}
onMounted(() => document.addEventListener('mousedown', onDocPointer));
onBeforeUnmount(() => document.removeEventListener('mousedown', onDocPointer));
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
        <rect
          x="2"
          y="3"
          width="12"
          height="11"
          rx="1.5"
          stroke="currentColor"
          stroke-width="1.2"
        />
        <path d="M2 6h12M5 1.5v2M11 1.5v2" stroke="currentColor" stroke-width="1.2" />
      </svg>
    </button>

    <div v-if="open" class="dp-pop">
      <div class="dp-head">
        <button type="button" class="dp-nav" aria-label="上个月" @click="prevMonth">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path
              d="M9 3 5 7l4 4"
              stroke="currentColor"
              stroke-width="1.4"
              stroke-linecap="round"
            />
          </svg>
        </button>
        <span class="dp-ym mono">{{ viewY }} 年 {{ pad(viewM) }} 月</span>
        <button type="button" class="dp-nav" aria-label="下个月" @click="nextMonth">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path
              d="M5 3l4 4-4 4"
              stroke="currentColor"
              stroke-width="1.4"
              stroke-linecap="round"
            />
          </svg>
        </button>
      </div>
      <div class="dp-week">
        <span v-for="w in WEEK" :key="w">{{ w }}</span>
      </div>
      <div class="dp-grid">
        <template v-for="(c, i) in grid" :key="i">
          <button
            v-if="c"
            type="button"
            class="dp-day"
            :class="{ sel: c.ymd === modelValue, today: c.ymd === todayYmd, dis: disabled(c.ymd) }"
            :disabled="disabled(c.ymd)"
            @click="pick(c.ymd)"
          >
            {{ c.d }}
          </button>
          <span v-else class="dp-blank" />
        </template>
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
}
.dp-trigger.empty span {
  color: var(--text-3);
}
.dp-trigger.on {
  border-color: var(--accent);
}
.dp-cal {
  flex: none;
  color: var(--text-3);
}

/* 弹层 */
.dp-pop {
  position: absolute;
  z-index: 50;
  top: calc(100% + 6px);
  left: 0;
  width: 264px;
  padding: 12px;
  border-radius: var(--r-md);
  background: var(--bg-elevated, var(--bg-base));
  border: 0.5px solid var(--border);
  box-shadow: var(--shadow-pop, 0 8px 28px rgba(0, 0, 0, 0.4));
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
}
.dp-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.dp-ym {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-1);
}
.dp-nav {
  width: 26px;
  height: 26px;
  display: grid;
  place-items: center;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--text-2);
  cursor: pointer;
}
.dp-nav:hover {
  background: var(--bg-base);
  color: var(--text-1);
}
.dp-week {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 2px;
  margin-bottom: 4px;
}
.dp-week span {
  text-align: center;
  font-size: 10.5px;
  color: var(--text-3);
  padding: 2px 0;
}
.dp-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 2px;
}
.dp-day {
  aspect-ratio: 1;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--text-1);
  font-size: 12px;
  cursor: pointer;
  font-variant-numeric: tabular-nums;
  transition:
    background 0.12s var(--ease),
    color 0.12s var(--ease);
}
.dp-day:hover:not(.dis) {
  background: var(--bg-base);
}
.dp-day.today {
  color: var(--accent);
  font-weight: 600;
}
.dp-day.sel {
  background: var(--accent);
  color: #fff;
  font-weight: 600;
}
.dp-day.dis {
  color: var(--text-3);
  opacity: 0.4;
  cursor: not-allowed;
}
.dp-blank {
  aspect-ratio: 1;
}
.dp-foot {
  display: flex;
  justify-content: space-between;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 0.5px solid var(--border-faint);
}
.dp-act {
  border: none;
  background: transparent;
  font-size: 11.5px;
  color: var(--text-2);
  cursor: pointer;
  padding: 3px 6px;
  border-radius: 5px;
}
.dp-act:hover {
  background: var(--bg-base);
}
.dp-act.accent {
  color: var(--accent);
}
</style>
