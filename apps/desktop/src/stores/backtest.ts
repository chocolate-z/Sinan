// 回测页状态 store:表单 + 运行态 + 结果 + 历史/模型列表 + 选中日,全部留存于 store,
// 切菜单再切回原样恢复;长回测的 run() 由 store 拥有 → 离开页面也不中断、结果照常回填。
import { defineStore } from 'pinia';
import { api } from '../api/client';

export type Scoring = 'auto' | 'model' | 'custom' | 'equal_weight';

export interface BacktestForm {
  train_end: string;
  backtest_start: string;
  backtest_end: string;
  purge: number;
  benchmark: string;
  scoring: Scoring;
  model_id: string;
}

interface BacktestState {
  form: BacktestForm;
  running: boolean;
  startedAt: number; // 本次回测开始的 epoch ms(跨导航留存,供 RunningBar 真实计时)
  error: string | null;
  result: any | null;
  history: any[];
  models: any[];
  selectedDay: any | null;
}

export const useBacktestStore = defineStore('backtest', {
  state: (): BacktestState => ({
    form: {
      train_end: '',
      backtest_start: '',
      backtest_end: '',
      purge: 5,
      benchmark: '000300.SH',
      scoring: 'auto',
      model_id: '',
    },
    running: false,
    startedAt: 0,
    error: null,
    result: null,
    history: [],
    models: [],
    selectedDay: null,
  }),
  getters: {
    needsTrainEnd: (s): boolean => s.form.scoring === 'equal_weight' || s.form.scoring === 'custom',
    canRun(s): boolean {
      return (
        !!s.form.backtest_start &&
        !!s.form.backtest_end &&
        (!this.needsTrainEnd || !!s.form.train_end) &&
        !s.running
      );
    },
  },
  actions: {
    async loadHistory() {
      try {
        this.history = await api.backtests();
      } catch {
        /* 列表失败不阻断 */
      }
    },
    async loadModels() {
      try {
        this.models = await api.models();
      } catch {
        /* 无模型不阻断 */
      }
    },
    async run() {
      if (!this.canRun) return;
      const f = this.form;
      this.running = true;
      this.startedAt = Date.now();
      this.error = null;
      try {
        const body: Record<string, unknown> = {
          train_end: f.train_end || undefined,
          backtest_start: f.backtest_start,
          backtest_end: f.backtest_end,
          purge: f.purge,
          benchmark: f.benchmark,
          scoring: f.scoring,
        };
        // 仅「模型」口径且指定了具体版本时下发 model_id(空=用激活模型)。
        if (f.scoring === 'model' && f.model_id) body.model_id = f.model_id;
        this.result = await api.createBacktest(body);
        await this.loadHistory();
      } catch (e: any) {
        const d = e?.detail;
        this.error = d && typeof d === 'object' && d.message ? d.message : String(d ?? e);
        this.result = null;
      } finally {
        this.running = false;
      }
    },
    async loadOne(id: string) {
      this.error = null;
      try {
        this.result = await api.backtest(id);
      } catch (e) {
        this.error = String(e);
      }
    },
    selectDay(r: any) {
      this.selectedDay = this.selectedDay?.date === r.date ? null : r;
    },
  },
});
