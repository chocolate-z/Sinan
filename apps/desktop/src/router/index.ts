import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router';
import { resolveGuard } from '../lib/guard';
import { useAppStore } from '../stores/app';

const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/dashboard' },
  {
    path: '/onboarding',
    name: 'onboarding',
    component: () => import('../pages/onboarding/OnboardingWizard.vue'),
    meta: { noShell: true },
  },
  {
    path: '/dashboard',
    component: () => import('../pages/dashboard/Dashboard.vue'),
    meta: { title: '总览' },
  },
  {
    path: '/market',
    component: () => import('../pages/Locked.vue'),
    meta: { title: '行情', needsData: true },
  },
  {
    path: '/news',
    component: () => import('../pages/Locked.vue'),
    meta: { title: '资讯', needsData: true },
  },
  {
    path: '/indicators',
    component: () => import('../pages/Locked.vue'),
    meta: { title: '指标', needsData: true },
  },
  {
    path: '/models',
    component: () => import('../pages/Locked.vue'),
    meta: { title: '模型', needsData: true },
  },
  {
    path: '/signals',
    component: () => import('../pages/signals/Signals.vue'),
    meta: { title: '信号', needsData: true },
  },
  {
    path: '/portfolio',
    component: () => import('../pages/portfolio/Portfolio.vue'),
    meta: { title: '持仓' },
  },
  {
    path: '/backtest',
    component: () => import('../pages/Locked.vue'),
    meta: { title: '回测', needsData: true },
  },
  { path: '/logs', component: () => import('../pages/logs/Logs.vue'), meta: { title: '日志' } },
  {
    path: '/settings/:tab?',
    component: () => import('../pages/settings/Settings.vue'),
    meta: { title: '设置' },
  },
];

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
});

router.beforeEach((to) => {
  const app = useAppStore();
  // 首启未完成 → 强制 onboarding(onboarding 页本身放行)。
  if (!app.onboardingDone && to.path !== '/onboarding' && to.meta?.noShell !== true) {
    if (to.path === '/dashboard') return true; // 总览可见引导卡
    if (to.path === '/logs') return true;
    if (to.path.startsWith('/settings')) return true;
  }
  const target = resolveGuard(to.path, to.meta as any, app.onboardingDone);
  return target ? target : true;
});
