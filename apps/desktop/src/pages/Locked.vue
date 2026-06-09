<script setup lang="ts">
import { useRouter } from 'vue-router';
import Icon from '../shell/Icon.vue';
const router = useRouter();
</script>

<template>
  <div class="locked">
    <div class="empty">
      <div class="empty-icon"><Icon name="lock" :size="20" /></div>
      <div class="empty-title">需要先配置数据源并建立本地缓存</div>
      <div class="empty-desc">
        司南随包零数据。请先在「设置 → 数据源」配置你自己的数据源(Tushare / AkShare)并建立本地缓存。
      </div>
      <div class="empty-note">你的数据与 token 全程留在本机,司南不收集、不上传。</div>
      <button class="btn btn-primary" @click="router.push('/settings/datasource')">
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
  padding: 28px;
}
.empty {
  max-width: 440px;
}
.empty-title {
  font-size: var(--fs-h3);
  font-weight: 600;
  color: var(--text-1);
}
.empty-desc {
  font-size: var(--fs-sub);
  color: var(--text-2);
  max-width: 360px;
  line-height: 1.5;
}
.empty-note {
  font-size: var(--fs-cap);
  color: var(--text-3);
}
.empty .btn-primary {
  margin-top: 6px;
}
</style>
