<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../../api/client';

interface LogRow {
  id: string;
  ts: string;
  level: string;
  source?: string;
  message: string;
}

const logs = ref<LogRow[]>([]);
const error = ref<string | null>(null);

async function load() {
  try {
    logs.value = await api.logs();
    error.value = null;
  } catch (e) {
    error.value = String(e);
  }
}

onMounted(load);
</script>

<template>
  <div>
    <h1>日志</h1>
    <button class="ghost" @click="load">刷新</button>
    <p v-if="error" class="status-err">{{ error }}</p>
    <table v-if="logs.length" class="logtable num">
      <thead>
        <tr><th>时间</th><th>级别</th><th>来源</th><th>消息</th></tr>
      </thead>
      <tbody>
        <tr v-for="l in logs" :key="l.id">
          <td>{{ l.ts }}</td>
          <td>{{ l.level }}</td>
          <td>{{ l.source }}</td>
          <td>{{ l.message }}</td>
        </tr>
      </tbody>
    </table>
    <p v-else class="muted">暂无日志。</p>
  </div>
</template>

<style scoped>
.ghost {
  background: none;
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  padding: var(--sp-1) var(--sp-3);
  cursor: pointer;
  margin-bottom: var(--sp-3);
}
.logtable {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--fs-cap);
}
.logtable th,
.logtable td {
  text-align: left;
  padding: var(--sp-1) var(--sp-2);
  border-bottom: 1px solid var(--c-border);
}
.muted {
  color: var(--c-text-3);
}
</style>
