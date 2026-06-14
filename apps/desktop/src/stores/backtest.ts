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
  // 模型 vs 等权基线对比:同窗口同成本各跑一次,留存于 store(切菜单不丢)。
  comparing: boolean;
  comparison: { model: any; equal: any } | null;
  compareError: string | null;
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
    comparing: false,
    comparison: null,
    compareError: null,
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
    // 对比口径要解析出一个模型版本:表单选定的 model_id,或回退到激活模型。
    compareModelId(s): string {
      return s.form.model_id || s.models.find((m) => m.status === 'active')?.id || '';
    },
    canCompare(s): boolean {
      return (
        !!s.form.backtest_start &&
        !!s.form.backtest_end &&
        !!this.compareModelId && // 必须有可用模型,否则对比无意义
        !s.running &&
        !s.comparing
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
    /** 模型 vs 等权基线对比:同窗口同成本各跑一次 → 回答「模型有没有用」。
     *  公平性关键:先跑模型(api 会把 train_end 抬到模型训练截止=真实样本外),
     *  再用「模型回测的生效 train_end」跑等权,确保两者样本外窗口完全一致(红线#2/#3)。 */
    async compare() {
      if (!this.canCompare) return;
      const f = this.form;
      const modelId = this.compareModelId;
      this.comparing = true;
      this.startedAt = Date.now();
      this.compareError = null;
      this.comparison = null;
      try {
        const modelRes = await api.createBacktest({
          backtest_start: f.backtest_start,
          backtest_end: f.backtest_end,
          train_end: f.train_end || undefined,
          purge: f.purge,
          benchmark: f.benchmark,
          scoring: 'model',
          model_id: modelId,
        });
        // 等权基线复用模型回测的生效训练截止 → 两者样本外窗口一致,唯一变量是打分口径。
        const equalRes = await api.createBacktest({
          backtest_start: f.backtest_start,
          backtest_end: f.backtest_end,
          train_end: modelRes.train_end,
          purge: f.purge,
          benchmark: f.benchmark,
          scoring: 'equal_weight',
        });
        this.comparison = { model: modelRes, equal: equalRes };
        await this.loadHistory();
      } catch (e: any) {
        const d = e?.detail;
        this.compareError = d && typeof d === 'object' && d.message ? d.message : String(d ?? e);
        this.comparison = null;
      } finally {
        this.comparing = false;
      }
    },
    clearComparison() {
      this.comparison = null;
      this.compareError = null;
    },
    selectDay(r: any) {
      this.selectedDay = this.selectedDay?.date === r.date ? null : r;
    },
  },
});
