<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { useAppStore } from '../stores/app';
import { themePrefIcon, themePrefLabel, THEME_PREFS, type ThemePref } from '../lib/theme';

const app = useAppStore();
const route = useRoute();
const title = computed(() => (route.meta?.title as string) ?? '');

const providerLabel = computed(() => {
  const active = app.providers.find((p) => p.id === app.activeProvider);
  if (active) return active.display_name;
  return app.activeProvider ?? '未配置';
});

function cycleTheme() {
  const i = THEME_PREFS.indexOf(app.themePref);
  app.setThemePref(THEME_PREFS[(i + 1) % THEME_PREFS.length] as ThemePref);
}
</script>

<template>
  <header class="topbar m-vibrancy">
    <div class="crumb">{{ title }}</div>
    <div class="right">
      <span class="m-badge" :class="app.activeProvider ? 'status-ok' : 'status-err'">
        {{ providerLabel }}
      </span>
      <button
        class="m-btn m-btn--ghost m-btn--sm theme-btn"
        :title="`主题:${themePrefLabel(app.themePref)}(点按切换)`"
        @click="cycleTheme"
      >
        {{ themePrefIcon(app.themePref) }}
      </button>
    </div>
  </header>
</template>

<style scoped>
.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 52px;
  padding: 0 var(--sp-5);
  border-bottom: 1px solid var(--c-hairline);
  background: var(--c-titlebar);
  position: sticky;
  top: 0;
  z-index: 5;
}
.crumb {
  font-size: var(--fs-sub);
  font-weight: 600;
  letter-spacing: 0.01em;
}
.right {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
}
.theme-btn {
  width: 30px;
  padding: 0;
  height: 28px;
  font-size: 14px;
}
</style>
