<script setup lang="ts">
// 通用弹窗 —— Teleport 到 <body> 顶层遮罩 + 居中卡片(暗色令牌)。
// 点遮罩/Esc/× 关闭;具名插槽 #default 内容,#footer 底部按钮。
import { onBeforeUnmount, onMounted } from 'vue';

const props = withDefaults(defineProps<{ modelValue: boolean; title?: string; width?: number }>(), {
  title: '',
  width: 440,
});
const emit = defineEmits<{ 'update:modelValue': [boolean] }>();

function close() {
  emit('update:modelValue', false);
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && props.modelValue) close();
}
onMounted(() => document.addEventListener('keydown', onKey));
onBeforeUnmount(() => document.removeEventListener('keydown', onKey));
</script>

<template>
  <Teleport to="body">
    <div v-if="modelValue" class="m-overlay" @mousedown.self="close">
      <div class="m-card" :style="{ width: width + 'px' }" role="dialog" aria-modal="true">
        <div class="m-head">
          <h3 class="m-title">{{ title }}</h3>
          <button type="button" class="m-close" aria-label="关闭" @click="close">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path
                d="M3 3l8 8M11 3l-8 8"
                stroke="currentColor"
                stroke-width="1.4"
                stroke-linecap="round"
              />
            </svg>
          </button>
        </div>
        <div class="m-body"><slot /></div>
        <div v-if="$slots.footer" class="m-foot"><slot name="footer" /></div>
      </div>
    </div>
  </Teleport>
</template>

<style>
.m-overlay {
  position: fixed;
  inset: 0;
  z-index: 2000;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(2px);
  -webkit-backdrop-filter: blur(2px);
  animation: m-fade 120ms var(--ease-out);
}
@keyframes m-fade {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
.m-card {
  max-width: calc(100vw - 48px);
  box-sizing: border-box;
  background: var(--bg-panel);
  border: 0.5px solid var(--border-strong);
  border-radius: var(--r-lg);
  box-shadow: var(--shadow-pop);
  font-family: var(--font-sans);
  animation: m-pop 150ms var(--ease-out);
}
@keyframes m-pop {
  from {
    opacity: 0;
    transform: translateY(-6px) scale(0.98);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}
@media (prefers-reduced-motion: reduce) {
  .m-overlay,
  .m-card {
    animation: none;
  }
}
.m-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 18px 12px;
  border-bottom: 0.5px solid var(--border-faint);
}
.m-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--text-1);
}
.m-close {
  width: 26px;
  height: 26px;
  flex: none;
  display: grid;
  place-items: center;
  border: none;
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--text-3);
  cursor: pointer;
  transition:
    background var(--t-fast) var(--ease),
    color var(--t-fast) var(--ease);
}
.m-close:hover {
  background: var(--bg-elevated);
  color: var(--text-1);
}
.m-body {
  padding: 16px 18px;
}
.m-foot {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 12px 18px 16px;
  border-top: 0.5px solid var(--border-faint);
}
</style>
