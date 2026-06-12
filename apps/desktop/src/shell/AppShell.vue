<script setup lang="ts">
import Sidebar from './Sidebar.vue';
import StatusBar from './StatusBar.vue';
import UpdateBanner from '../ui/UpdateBanner.vue';
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
    <UpdateBanner />
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
  /* 定高=可滚区高度(.body 由 flex:1 得定高)→ 让需要「内部滚动、不撑整页」的页面(如日志)
     用 flex:1 占满剩余高度并在卡内滚动;普通页内容超高时溢出由 .body(overflow:auto)照常滚动。 */
  height: 100%;
  display: flex;
  flex-direction: column;
}
</style>
