import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';

// Tauri 期望前端开发服务器固定端口。
export default defineConfig({
  plugins: [vue(), tailwindcss()],
  clearScreen: false,
  // 固定非默认端口(避开 Vite 默认 5173;Tauri devUrl 必须与此一致)。
  // watch 忽略 src-tauri:否则 vite 监视 Rust target/,cargo build 写文件时 EBUSY 崩溃。
  server: {
    port: 9521,
    strictPort: true,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  build: { target: 'es2022', outDir: 'dist', emptyOutDir: true },
  test: {
    environment: 'happy-dom',
    include: ['test/**/*.test.ts'],
  },
});
