import { defineStore } from 'pinia';
import { api } from '../api/client';
import { groupSignals, type SignalRow } from '../lib/signals';

export interface Holding {
  stock_code: string;
  stock_name?: string | null;
  shares: number;
  avg_cost: number;
  current_price?: number | null;
  market_value?: number | null;
  float_pnl?: number | null;
  note?: string | null;
}

interface PnlRow {
  trade_date: string;
  total_assets: number;
  day_pnl: number;
  day_pnl_pct: number;
  benchmark_pct?: number | null;
  excess_pct?: number | null;
  drawdown?: number | null;
}

export interface LiveHolding {
  stock_code: string;
  shares: number;
  price: number | null;
  prev_close: number | null;
  day_pnl: number | null;
}
interface LivePnl {
  day_pnl: number;
  market_value: number;
  degraded: boolean;
  by_holding?: LiveHolding[];
}

interface TradingState {
  date: string;
  signals: SignalRow[];
  modelHoldings: Holding[];
  personalHoldings: Holding[];
  modelPnl: PnlRow[];
  personalPnl: PnlRow[];
  liveModel: LivePnl | null;
  livePersonal: LivePnl | null;
  loading: boolean;
  error: string | null;
}

export const useTradingStore = defineStore('trading', {
  state: (): TradingState => ({
    date: '',
    signals: [],
    modelHoldings: [],
    personalHoldings: [],
    modelPnl: [],
    personalPnl: [],
    liveModel: null,
    livePersonal: null,
    loading: false,
    error: null,
  }),
  getters: {
    activeSignals: (s): SignalRow[] => groupSignals(s.signals).active,
    blockedSignals: (s): SignalRow[] => groupSignals(s.signals).blocked,
    modelPnlLatest: (s): PnlRow | null => s.modelPnl[s.modelPnl.length - 1] ?? null,
    personalPnlLatest: (s): PnlRow | null => s.personalPnl[s.personalPnl.length - 1] ?? null,
  },
  actions: {
    async fetchSignals(date: string) {
      this.date = date;
      this.error = null;
      try {
        this.signals = await api.signals(date);
      } catch (e) {
        this.error = String(e);
        this.signals = [];
      }
    },
    async runPaper(today: string, effectiveDate: string) {
      this.loading = true;
      this.error = null;
      try {
        await api.paperRun({ today, effective_date: effectiveDate });
        await Promise.all([this.fetchSignals(today), this.fetchModel()]);
      } catch (e) {
        this.error = String(e);
      } finally {
        this.loading = false;
      }
    },
    async fetchModel() {
      try {
        [this.modelHoldings, this.modelPnl] = await Promise.all([
          api.modelHoldings(),
          api.pnlDaily('model'),
        ]);
      } catch (e) {
        this.error = String(e);
      }
    },
    async fetchPersonal() {
      try {
        [this.personalHoldings, this.personalPnl] = await Promise.all([
          api.personalHoldings(),
          api.pnlDaily('personal'),
        ]);
      } catch (e) {
        this.error = String(e);
      }
    },
    async addPersonal(input: {
      stock_code: string;
      stock_name?: string;
      shares: number;
      avg_cost?: number;
      price?: number;
      op?: 'set' | 'add' | 'reduce';
      note?: string;
    }) {
      this.personalHoldings = await api.addPersonalHolding(input);
    },
    async removePersonal(code: string) {
      this.personalHoldings = await api.deletePersonalHolding(code);
    },
    /** 实时当日收益(现价 vs 昨收 × 持仓),个人/模型分别。实时源不可用时静默降级。 */
    async fetchLivePnl() {
      try {
        [this.liveModel, this.livePersonal] = await Promise.all([
          api.pnlToday('model'),
          api.pnlToday('personal'),
        ]);
      } catch {
        this.liveModel = null;
        this.livePersonal = null;
      }
    },
  },
});
