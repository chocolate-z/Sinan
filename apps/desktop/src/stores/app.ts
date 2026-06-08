import { defineStore } from 'pinia';
import { api } from '../api/client';
import { pnlClass } from '../lib/pnl';

interface ProviderInfo {
  id: string;
  display_name: string;
  caps: Record<string, boolean>;
  needs_token: boolean;
  status: string;
}

interface AppState {
  onboardingDone: boolean;
  step: string;
  theme: 'light' | 'dark';
  pnlInvert: boolean;
  apiHealth: boolean;
  engineHealth: boolean;
  providers: ProviderInfo[];
  activeProvider: string | null;
  ready: boolean;
}

export const useAppStore = defineStore('app', {
  state: (): AppState => ({
    onboardingDone: false,
    step: 'welcome',
    theme: 'light',
    pnlInvert: false,
    apiHealth: false,
    engineHealth: false,
    providers: [],
    activeProvider: null,
    ready: false,
  }),
  getters: {
    // 盈亏着色统一出口(全局唯一)。
    pnlClass: () => (v: number) => pnlClass(v),
  },
  actions: {
    setTheme(t: 'light' | 'dark') {
      this.theme = t;
      document.documentElement.dataset.theme = t;
    },
    setPnlInvert(v: boolean) {
      this.pnlInvert = v;
      document.documentElement.dataset.pnlInvert = String(v);
    },
    async refreshHealth() {
      try {
        const h = await api.health();
        this.apiHealth = Boolean(h.db_ok);
        this.engineHealth = Boolean(h.engine_ok);
      } catch {
        this.apiHealth = false;
        this.engineHealth = false;
      }
    },
    async refreshOnboarding() {
      try {
        const s = await api.onboardingState();
        this.onboardingDone = Boolean(s.done);
        this.step = s.step ?? 'welcome';
        this.activeProvider = s.active_provider ?? null;
      } catch {
        /* api 未就绪 */
      }
    },
    async refreshProviders() {
      try {
        this.providers = await api.providers();
      } catch {
        this.providers = [];
      }
    },
    async bootstrap() {
      await this.refreshHealth();
      await Promise.all([this.refreshOnboarding(), this.refreshProviders()]);
      this.ready = true;
    },
  },
});
