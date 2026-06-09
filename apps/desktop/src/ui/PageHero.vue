<script setup lang="ts">
// 苹果式页内大标题(随内容流动,无独立顶栏)。迁移自设计稿 ui.jsx PageHero。
defineProps<{ title: string; sub?: string }>();
</script>

<template>
  <div class="page-hero">
    <div class="ph-left">
      <h1 class="ph-title">{{ title }}</h1>
      <p v-if="sub" class="ph-sub">{{ sub }}</p>
    </div>
    <div class="ph-right"><slot name="right" /></div>
  </div>
</template>

<style scoped>
.page-hero {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  padding: 34px 28px 0;
}
.ph-title {
  margin: 0;
  font-size: var(--fs-display);
  font-weight: 700;
  letter-spacing: -0.025em;
  color: var(--text-1);
}
.ph-sub {
  margin: 8px 0 0;
  font-size: var(--fs-body);
  color: var(--text-2);
}
.ph-right {
  display: flex;
  align-items: center;
  gap: 10px;
  padding-bottom: 3px;
}
</style>
