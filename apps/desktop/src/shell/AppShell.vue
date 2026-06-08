<script setup lang="ts">
import Sidebar from './Sidebar.vue';
import TopBar from './TopBar.vue';
import StatusBar from './StatusBar.vue';
</script>

<template>
  <div class="shell">
    <Sidebar />
    <main class="main">
      <TopBar />
      <section class="body">
        <slot />
      </section>
      <StatusBar />
    </main>
  </div>
</template>

<style scoped>
.shell {
  display: flex;
  height: 100%;
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
  padding: var(--sp-5);
}
</style>
