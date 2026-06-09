<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../../api/client';
import PageHero from '../../ui/PageHero.vue';
import Icon from '../../shell/Icon.vue';

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

// 日志级别 → 系统状态徽章(红线#1:级别属系统状态通道,绝不用盈亏色)。
// badge-ok(发光蓝)只留给真正「成功/正常」事件,普通 info/debug 用 badge-idle(中性灰、无发光)避免噪音。
function levelBadge(level: string): string {
  if (level === 'error') return 'badge-err';
  if (level === 'warn') return 'badge-warn';
  if (level === 'success' || level === 'ok') return 'badge-ok';
  return 'badge-idle';
}
</script>

<template>
  <PageHero title="日志" sub="运行记录 · 任务/调度/连接的系统事件">
    <template #right>
      <button class="btn btn-secondary btn-sm" @click="load">
        <Icon name="refresh" :size="14" /> 刷新
      </button>
    </template>
  </PageHero>

  <div class="page-body">
    <!-- 加载/请求失败:诚实错误态 -->
    <div v-if="error" class="card">
      <div class="empty">
        <div class="empty-icon"><Icon name="alert" :size="20" /></div>
        <div class="empty-title">无法加载日志</div>
        <div class="empty-desc mono">{{ error }}</div>
        <button class="btn btn-secondary btn-sm" @click="load">
          <Icon name="refresh" :size="14" /> 重试
        </button>
      </div>
    </div>

    <!-- 日志表 -->
    <div v-else-if="logs.length" class="card">
      <div class="card-head">
        <div>
          <h3 class="card-title">系统事件</h3>
          <span class="card-sub">最近 {{ logs.length }} 条 · 时间倒序</span>
        </div>
      </div>
      <div class="dt-wrap">
        <table class="dt dt-compact">
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
              <td class="col-ts ts mono">{{ l.ts }}</td>
              <td class="col-level">
                <span class="badge" :class="levelBadge(l.level)">
                  <span class="dot" />{{ l.level }}
                </span>
              </td>
              <td class="col-source src mono">{{ l.source || '—' }}</td>
              <td class="msg">{{ l.message }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- 空态:诚实占位 -->
    <div v-else class="card">
      <div class="empty">
        <div class="empty-icon"><Icon name="logs" :size="20" /></div>
        <div class="empty-title">暂无日志</div>
        <div class="empty-desc">
          运行任务、调度或连接数据源后,系统事件会逐条记录在此。
        </div>
        <button class="btn btn-secondary btn-sm" @click="load">
          <Icon name="refresh" :size="14" /> 刷新
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page-body {
  padding: 28px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.dt-wrap {
  overflow: auto;
}
.col-ts {
  width: 168px;
  white-space: nowrap;
}
.col-level {
  width: 96px;
}
.col-source {
  width: 136px;
  white-space: nowrap;
}
.ts,
.src {
  color: var(--text-3);
  font-size: var(--fs-cap);
}
.msg {
  color: var(--text-1);
  white-space: normal;
}
.empty-title {
  font-size: var(--fs-h3);
  font-weight: 600;
  color: var(--text-1);
}
.empty-desc {
  font-size: var(--fs-sub);
  color: var(--text-2);
  max-width: 360px;
  line-height: 1.5;
  word-break: break-word;
}
</style>
