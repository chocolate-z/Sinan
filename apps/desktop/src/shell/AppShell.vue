<script setup lang="ts">
import Sidebar from './Sidebar.vue';
import StatusBar from './StatusBar.vue';
</script>

<template>
  <div class="shell">
    <Sidebar />
    <main class="main">
      <section class="body">
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
  background: var(--c-bg);
}
.main {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  background: var(--c-bg);
}
.body {
  flex: 1;
  overflow: auto;
}
.body-inner {
  max-width: 1180px;
  margin: 0 auto;
  padding: var(--sp-5) var(--sp-5) var(--sp-6);
}
</style>
