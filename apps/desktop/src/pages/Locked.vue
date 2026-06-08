<script setup lang="ts">
import { useRouter } from 'vue-router';
const router = useRouter();
</script>

<template>
  <div class="empty">
    <div class="icon">🔒</div>
    <h2>需要先配置数据源并建立本地缓存</h2>
    <p>
      司南随包零数据。请先在「设置 → 数据源」配置你自己的数据源(Tushare/AkShare)并建立本地缓存。
    </p>
    <p class="muted">你的数据与 token 全程留在本机,司南不收集、不上传。</p>
    <button class="primary" @click="router.push('/settings/datasource')">去配置数据源 →</button>
  </div>
</template>

<style scoped>
.empty {
  max-width: 520px;
  margin: 10vh auto;
  text-align: center;
}
.icon {
  font-size: 40px;
}
.muted {
  color: var(--c-text-3);
}
.primary {
  margin-top: var(--sp-4);
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: var(--r-md);
  padding: var(--sp-2) var(--sp-4);
  cursor: pointer;
}
</style>
