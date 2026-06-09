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
  <div class="page">
    <header class="page-head">
      <h1>日志</h1>
      <p class="sub">运行记录 · 任务/调度/连接的系统事件</p>
    </header>

    <div class="m-toolbar bar">
      <span class="spacer" />
      <button class="m-btn m-btn--secondary m-btn--sm" @click="load">刷新</button>
    </div>

    <p v-if="error" class="m-card err-card status-err">{{ error }}</p>

    <div v-if="logs.length" class="m-card logs-card">
      <table class="m-table">
        <thead>
          <tr>
            <th class="col-ts">时间</th>
            <th class="col-level">级别</th>
            <th class="col-source">来源</th>
            <th>消息</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="l in logs" :key="l.id">
            <td class="col-ts num ts">{{ l.ts }}</td>
            <td class="col-level">
              <span
                class="m-badge"
                :class="
                  l.level === 'error'
                    ? 'status-err'
                    : l.level === 'warn'
                      ? 'status-warn'
                      : 'status-info'
                "
              >
                {{ l.level }}
              </span>
            </td>
            <td class="col-source num src">{{ l.source }}</td>
            <td class="msg">{{ l.message }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-else-if="!error" class="m-card empty">
      <p class="m-muted">暂无日志。</p>
    </div>
  </div>
</template>

<style scoped>
.page-head {
  margin-bottom: var(--sp-4);
}
.page-head .sub {
  color: var(--c-text-3);
  font-size: var(--fs-cap);
  margin-top: 2px;
}
.bar {
  margin-bottom: var(--sp-4);
}
.spacer {
  flex: 1;
}
.err-card {
  margin-bottom: var(--sp-4);
  font-size: var(--fs-cap);
}
.logs-card {
  padding: var(--sp-2) 0;
}
.col-ts {
  width: 168px;
  white-space: nowrap;
}
.col-level {
  width: 92px;
}
.col-source {
  width: 132px;
  white-space: nowrap;
}
.ts,
.src {
  color: var(--c-text-3);
  font-size: var(--fs-cap);
}
.msg {
  color: var(--c-text);
}
.empty {
  text-align: center;
  padding: var(--sp-6) var(--sp-4);
}
</style>
