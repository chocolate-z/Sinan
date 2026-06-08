<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import AppShell from './shell/AppShell.vue';

const route = useRoute();

// onboarding 等全屏页不套外壳。
const noShell = computed(() => route.meta?.noShell === true);
</script>

<template>
  <div v-if="noShell" class="fullscreen">
    <RouterView />
  </div>
  <AppShell v-else>
    <RouterView />
  </AppShell>
</template>

<style scoped>
.fullscreen {
  height: 100%;
}
</style>
