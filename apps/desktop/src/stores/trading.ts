import { defineStore } from 'pinia';
import { api } from '../api/client';
import { groupSignals, type SignalRow } from '../lib/signals';

interface Holding {
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

interface TradingState {
  date: string;
  signals: SignalRow[];
  modelHoldings: Holding[];
  personalHoldings: Holding[];
  modelPnl: PnlRow[];
  personalPnl: PnlRow[];
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
      avg_cost: number;
      note?: string;
    }) {
      this.personalHoldings = await api.addPersonalHolding(input);
    },
    async removePersonal(code: string) {
      this.personalHoldings = await api.deletePersonalHolding(code);
    },
  },
});
