<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { useAppStore } from '../stores/app';

const app = useAppStore();
const route = useRoute();
const title = computed(() => (route.meta?.title as string) ?? '');

const providerLabel = computed(() => {
  const active = app.providers.find((p) => p.id === app.activeProvider);
  if (active) return active.display_name;
  return app.activeProvider ?? '未配置';
});

function toggleTheme() {
  app.setTheme(app.theme === 'light' ? 'dark' : 'light');
}
</script>

<template>
  <header class="topbar">
    <div class="crumb">{{ title }}</div>
    <div class="right">
      <span class="badge" :class="app.activeProvider ? 'status-ok' : 'status-err'">
        ● {{ providerLabel }}
      </span>
      <button class="ghost" @click="toggleTheme">{{ app.theme === 'light' ? '🌙' : '☀️' }}</button>
    </div>
  </header>
</template>

<style scoped>
.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 48px;
  padding: 0 var(--sp-4);
  border-bottom: 1px solid var(--c-border);
  background: var(--c-surface);
}
.crumb {
  font-weight: 500;
}
.right {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
}
.badge {
  font-size: var(--fs-cap);
}
.ghost {
  background: none;
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  padding: var(--sp-1) var(--sp-2);
  cursor: pointer;
}
</style>
