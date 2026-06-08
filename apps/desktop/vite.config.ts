import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';

// Tauri 期望前端开发服务器固定端口。
export default defineConfig({
  plugins: [vue(), tailwindcss()],
  clearScreen: false,
  // 固定非默认端口(避开 Vite 默认 5173;Tauri devUrl 必须与此一致)。
  server: { port: 5914, strictPort: true },
  build: { target: 'es2022', outDir: 'dist', emptyOutDir: true },
  test: {
    environment: 'happy-dom',
    include: ['test/**/*.test.ts'],
  },
});
