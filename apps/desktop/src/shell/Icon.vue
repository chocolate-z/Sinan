<script setup lang="ts">
import { ICONS } from './icons';

withDefaults(defineProps<{ name: string; size?: number }>(), { size: 16 });
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.7"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <component :is="el[0]" v-for="(el, i) in ICONS[name] ?? []" :key="i" v-bind="el[1]" />
  </svg>
</template>
