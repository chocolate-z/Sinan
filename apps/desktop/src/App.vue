<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import AppShell from './shell/AppShell.vue';
import TitleBar from './shell/TitleBar.vue';

const route = useRoute();

// onboarding 等全屏页不套外壳;但自定义标题栏全局常驻(无系统装饰时,窗口拖拽/控制都靠它)。
const noShell = computed(() => route.meta?.noShell === true);
</script>

<template>
  <div class="app-root">
    <TitleBar />
    <div class="app-below">
      <div v-if="noShell" class="fullscreen">
        <RouterView />
      </div>
      <AppShell v-else>
        <RouterView />
      </AppShell>
    </div>
  </div>
</template>

<style scoped>
.app-root {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.app-below {
  flex: 1;
  min-height: 0;
}
.fullscreen {
  height: 100%;
  overflow: auto;
}
</style>
