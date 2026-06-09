<script setup lang="ts">
import { useRouter } from 'vue-router';
const router = useRouter();
</script>

<template>
  <div class="page locked">
    <div class="m-panel empty">
      <div class="icon" aria-hidden="true">🔒</div>
      <h2>需要先配置数据源并建立本地缓存</h2>
      <p class="lead">
        司南随包零数据。请先在「设置 → 数据源」配置你自己的数据源(Tushare/AkShare)并建立本地缓存。
      </p>
      <p class="muted">你的数据与 token 全程留在本机,司南不收集、不上传。</p>
      <button class="m-btn m-btn--primary cta" @click="router.push('/settings/datasource')">
        去配置数据源 →
      </button>
    </div>
  </div>
</template>

<style scoped>
.locked {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 70vh;
}
.empty {
  max-width: 460px;
  width: 100%;
  text-align: center;
  padding: var(--sp-7) var(--sp-6);
}
.icon {
  font-size: 34px;
  line-height: 1;
  opacity: 0.85;
  margin-bottom: var(--sp-4);
}
.empty h2 {
  margin: 0 0 var(--sp-3);
  font-size: var(--fs-h2);
  font-weight: 600;
  letter-spacing: -0.01em;
}
.lead {
  color: var(--c-text-2);
  margin: 0 0 var(--sp-3);
}
.muted {
  color: var(--c-text-3);
  font-size: var(--fs-cap);
  margin: 0;
}
.cta {
  margin-top: var(--sp-5);
}
</style>
