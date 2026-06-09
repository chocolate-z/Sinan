import { defineStore } from 'pinia';
import { api } from '../api/client';
import { pnlClass } from '../lib/pnl';
import { resolveTheme, type Theme, type ThemePref } from '../lib/theme';

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
  themePref: ThemePref;
  systemDark: boolean;
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
    themePref: 'dark',
    systemDark: false,
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
    // 偏好(可为 system)解析为实际应用的浅/深色。
    theme: (s): Theme => resolveTheme(s.themePref, s.systemDark),
  },
  actions: {
    /** 应用当前解析后的主题到 <html data-theme>。 */
    applyTheme() {
      document.documentElement.dataset.theme = this.theme;
    },
    setThemePref(p: ThemePref) {
      this.themePref = p;
      this.applyTheme();
    },
    /** 系统浅/深色变化(main.ts 经 matchMedia 监听)。 */
    setSystemDark(v: boolean) {
      this.systemDark = v;
      this.applyTheme();
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
