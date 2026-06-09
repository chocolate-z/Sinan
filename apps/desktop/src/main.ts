import { createApp } from 'vue';
import { createPinia } from 'pinia';
import './styles/tailwind.css';
import './design/tokens.css';
import './design/pnl.css';
import './design/materials.css';
import './styles/app.scss';
import App from './App.vue';
import { router } from './router';
import { initRuntime } from './api/client';
import { useAppStore } from './stores/app';

async function bootstrap() {
  await initRuntime(); // 解析 Tauri 下发的端口/会话 token
  const app = createApp(App);
  app.use(createPinia());
  app.use(router);
  app.mount('#app');

  const store = useAppStore();
  // 主题三态:跟随系统时监听操作系统浅/深色切换。
  const mql = window.matchMedia('(prefers-color-scheme: dark)');
  store.setSystemDark(mql.matches);
  mql.addEventListener('change', (e) => store.setSystemDark(e.matches));
  store.setThemePref(store.themePref);
  store.setPnlInvert(store.pnlInvert);
  await store.bootstrap();
}

void bootstrap();
