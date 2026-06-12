<script setup lang="ts">
// 在线更新浮层:app 启动后静默检查 GitHub Release,有新版才出现(非 Tauri/离线静默)。
// 用户点「立即更新」→ 下载(进度)→ 验签安装 → relaunch 到新版本。
import { onMounted, ref } from 'vue';
import { checkUpdate, installUpdate, type UpdateInfo } from '../lib/updater';
import Icon from '../shell/Icon.vue';

const info = ref<UpdateInfo | null>(null);
const dismissed = ref(false);
const installing = ref(false);
const pct = ref(0);
const error = ref<string | null>(null);

onMounted(() => {
  // 延迟到启动遮罩之后再查,不和首屏抢资源;失败/无更新静默。
  setTimeout(async () => {
    info.value = await checkUpdate();
  }, 4000);
});

async function doUpdate() {
  installing.value = true;
  error.value = null;
  pct.value = 0;
  try {
    await installUpdate((p) => (pct.value = p));
    // 成功会触发 relaunch,正常走不到这里。
  } catch (e) {
    error.value = String(e);
    installing.value = false;
  }
}
</script>

<template>
  <Transition name="upd">
    <div v-if="info && !dismissed" class="upd">
      <div class="upd-head">
        <span class="upd-ic"><Icon name="db" :size="15" /></span>
        <div class="upd-titles">
          <div class="upd-title">
            发现新版本 <span class="mono">v{{ info.version }}</span>
          </div>
          <div class="upd-sub">司南桌面端有可用更新</div>
        </div>
        <button v-if="!installing" class="upd-x" title="稍后" @click="dismissed = true">
          <Icon name="x" :size="13" />
        </button>
      </div>

      <p v-if="info.notes" class="upd-notes">{{ info.notes }}</p>

      <p v-if="error" class="upd-err"><Icon name="alert" :size="12" /> {{ error }}</p>

      <div v-if="installing" class="upd-prog">
        <div class="upd-bar">
          <div class="upd-fill" :style="{ width: Math.round(pct * 100) + '%' }" />
        </div>
        <span class="upd-pct mono">{{
          pct >= 0.999 ? '安装中…' : Math.round(pct * 100) + '%'
        }}</span>
      </div>
      <div v-else class="upd-actions">
        <button class="btn btn-secondary btn-sm" @click="dismissed = true">稍后</button>
        <button class="btn btn-primary btn-sm" @click="doUpdate">
          <Icon name="db" :size="13" /> 立即更新并重启
        </button>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.upd {
  position: fixed;
  right: 18px;
  bottom: 42px;
  z-index: 200;
  width: 320px;
  padding: 14px;
  border-radius: var(--r-lg);
  background: var(--bg-popover);
  border: 0.5px solid var(--border-strong);
  box-shadow: var(--shadow-pop);
}
.upd-head {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}
.upd-ic {
  flex: none;
  width: 28px;
  height: 28px;
  border-radius: var(--r-sm);
  display: grid;
  place-items: center;
  background: var(--accent-bg);
  color: var(--accent);
}
.upd-titles {
  flex: 1;
  min-width: 0;
}
.upd-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-1);
}
.upd-sub {
  font-size: 11px;
  color: var(--text-3);
  margin-top: 1px;
}
.upd-x {
  flex: none;
  width: 20px;
  height: 20px;
  display: grid;
  place-items: center;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--text-3);
  cursor: pointer;
}
.upd-x:hover {
  background: var(--bg-panel-2);
  color: var(--text-1);
}
.upd-notes {
  margin: 10px 0 0;
  font-size: 11.5px;
  line-height: 1.5;
  color: var(--text-2);
  max-height: 88px;
  overflow: auto;
  white-space: pre-wrap;
}
.upd-err {
  margin: 8px 0 0;
  font-size: 11px;
  color: var(--status-err);
  display: flex;
  align-items: center;
  gap: 4px;
}
.upd-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 14px;
}
.upd-prog {
  display: flex;
  align-items: center;
  gap: 9px;
  margin-top: 14px;
}
.upd-bar {
  flex: 1;
  height: 6px;
  border-radius: var(--r-xs);
  background: var(--bg-input);
  overflow: hidden;
}
.upd-fill {
  height: 100%;
  border-radius: var(--r-xs);
  background: var(--accent-grad);
  transition: width var(--t-fast) var(--ease);
}
.upd-pct {
  font-size: 11px;
  color: var(--text-2);
  min-width: 44px;
  text-align: right;
}
.upd-enter-active,
.upd-leave-active {
  transition:
    opacity var(--t-med) var(--ease),
    transform var(--t-med) var(--ease);
}
.upd-enter-from,
.upd-leave-to {
  opacity: 0;
  transform: translateY(12px);
}
</style>
