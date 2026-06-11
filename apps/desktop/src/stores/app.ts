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

interface Coverage {
  stock_count?: number;
  total_rows?: number;
  first_date?: string | null;
  last_date?: string | null;
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
  coverage: Coverage | null;
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
    coverage: null,
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
    /** 本地缓存覆盖(只读展示:状态栏「缓存 N 条」、设置页覆盖)。无缓存时为 null,诚实留空。 */
    async refreshCoverage() {
      try {
        this.coverage = (await api.coverage()) as Coverage;
      } catch {
        this.coverage = null;
      }
    },
    async bootstrap() {
      await this.refreshHealth();
      await Promise.all([
        this.refreshOnboarding(),
        this.refreshProviders(),
        this.refreshCoverage(),
      ]);
      this.ready = true;
    },
  },
});
