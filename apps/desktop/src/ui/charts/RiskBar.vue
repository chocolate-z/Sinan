<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{ used: number; limit: number; label: string; unit?: string }>(),
  { unit: '%' },
);

const pct = computed(() => Math.min(100, (props.used / props.limit) * 100));
const state = computed(() => (pct.value > 85 ? 'err' : pct.value > 65 ? 'warn' : 'ok'));
</script>

<template>
  <div class="risk-bar">
    <div class="rb-head">
      <span class="rb-label">{{ label }}</span>
      <span class="rb-val mono">
        {{ used }}{{ unit }} <span class="rb-limit">/ {{ limit }}{{ unit }}</span>
      </span>
    </div>
    <div class="rb-track">
      <div class="rb-fill" :style="{ width: pct + '%', background: `var(--status-${state})` }" />
    </div>
  </div>
</template>

<style scoped>
.rb-head {
  display: flex;
  justify-content: space-between;
  margin-bottom: 6px;
}
.rb-label {
  font-size: var(--fs-sub);
  color: var(--text-2);
}
.rb-val {
  font-size: var(--fs-sub);
  color: var(--text-1);
}
.rb-limit {
  color: var(--text-3);
}
.rb-track {
  height: 6px;
  border-radius: 3px;
  background: var(--bg-input);
  overflow: hidden;
}
.rb-fill {
  height: 100%;
  border-radius: 3px;
  transition: width 0.4s var(--ease);
}
</style>
