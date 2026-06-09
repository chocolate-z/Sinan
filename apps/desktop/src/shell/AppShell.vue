<script setup lang="ts">
import Sidebar from './Sidebar.vue';
import StatusBar from './StatusBar.vue';
</script>

<template>
  <div class="shell">
    <Sidebar />
    <main class="main">
      <section class="body main-aurora">
        <div class="body-inner">
          <slot />
        </div>
      </section>
      <StatusBar />
    </main>
  </div>
</template>

<style scoped>
.shell {
  display: flex;
  height: 100%;
  background: var(--bg-base);
}
.main {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}
.body {
  flex: 1;
  overflow: auto;
}
.body-inner {
  min-height: 100%;
}
</style>
