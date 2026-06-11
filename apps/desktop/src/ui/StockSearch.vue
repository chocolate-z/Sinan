<script setup lang="ts">
// 股票搜索补全 —— 输入代码或名称,防抖查 api.searchStocks → 下拉选择。
// 无数据源/未联网 → 诚实空(不报错);选中 emit {code,name}。
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { api } from '../api/client';

withDefaults(defineProps<{ placeholder?: string }>(), {
  placeholder: '代码或名称,如 600519 / 茅台',
});
const emit = defineEmits<{ select: [{ code: string; name: string }] }>();

const root = ref<HTMLElement | null>(null);
const q = ref('');
const results = ref<{ code: string; name: string }[]>([]);
const loading = ref(false);
const openList = ref(false);
let timer: ReturnType<typeof setTimeout> | undefined;

function onInput() {
  openList.value = true;
  if (timer) clearTimeout(timer);
  const term = q.value.trim();
  if (!term) {
    results.value = [];
    loading.value = false;
    return;
  }
  loading.value = true;
  timer = setTimeout(async () => {
    try {
      results.value = (await api.searchStocks(term, 30)).stocks;
    } catch {
      results.value = [];
    } finally {
      loading.value = false;
    }
  }, 250);
}
function choose(s: { code: string; name: string }) {
  emit('select', s);
  q.value = `${s.name} · ${s.code}`;
  openList.value = false;
}
function onDocPointer(e: MouseEvent) {
  if (root.value && !root.value.contains(e.target as Node)) openList.value = false;
}
onMounted(() => document.addEventListener('mousedown', onDocPointer));
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocPointer);
  if (timer) clearTimeout(timer);
});

defineExpose({
  reset() {
    q.value = '';
    results.value = [];
    openList.value = false;
  },
});
</script>

<template>
  <div ref="root" class="ss">
    <input
      v-model="q"
      class="input mono ss-input"
      :placeholder="placeholder"
      @input="onInput"
      @focus="openList = true"
    />
    <div v-if="openList && q.trim()" class="ss-list">
      <div v-if="loading" class="ss-hint">搜索中…</div>
      <template v-else>
        <button v-for="s in results" :key="s.code" type="button" class="ss-item" @click="choose(s)">
          <span class="ss-name">{{ s.name }}</span>
          <span class="ss-code mono">{{ s.code }}</span>
        </button>
        <div v-if="!results.length" class="ss-hint">无匹配(需已配置数据源并联网)</div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.ss {
  position: relative;
}
.ss-input {
  width: 100%;
}
.ss-list {
  position: absolute;
  z-index: 10;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  max-height: 240px;
  overflow-y: auto;
  padding: 4px;
  border-radius: var(--r-md);
  background: var(--bg-popover);
  border: 0.5px solid var(--border-strong);
  box-shadow: var(--shadow-pop);
}
.ss-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  padding: 7px 10px;
  border: none;
  border-radius: var(--r-sm);
  background: transparent;
  cursor: pointer;
  text-align: left;
}
.ss-item:hover {
  background: var(--accent-bg);
}
.ss-name {
  font-size: 13px;
  color: var(--text-1);
}
.ss-code {
  font-size: 11.5px;
  color: var(--text-3);
}
.ss-hint {
  padding: 10px;
  text-align: center;
  font-size: 12px;
  color: var(--text-3);
}
</style>
