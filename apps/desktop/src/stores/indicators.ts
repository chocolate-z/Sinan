// 指标页状态 store:质检表单/报告/选中因子 + DSL 编辑器(表达式/名称/权重/校验/已存列表),
// 全部留存,切菜单再回原样恢复;长质检的 run() 由 store 拥有 → 离开页面不中断、报告照常回填。
import { defineStore } from 'pinia';
import { api, ApiError, subscribeJob } from '../api/client';
import { reduceProgress, type RunProgress } from '../lib/progress';
import { icirWeightPlan } from '../lib/factorWeights';

export interface QualityForm {
  start: string;
  end: string;
  label_horizon: number;
}

interface IndicatorsState {
  form: QualityForm;
  report: any | null;
  selectedName: string | null;
  loading: boolean;
  startedAt: number; // 质检开始 epoch ms(跨导航留存,供 RunningBar 真实计时)
  progress: RunProgress | null; // 质检实时进度(SSE 真实 done/total,驱动确定式进度条 + ETA)
  error: string | null;
  // 自定义因子 DSL 编辑器
  expr: string;
  factorName: string;
  factorWeight: number;
  validating: boolean;
  saving: boolean;
  saveError: string | null;
  validation: any | null;
  customList: any[];
  builtinList: any[]; // 内置因子(GET /factors:元数据 + 启用/权重),与自定义并到因子库表
  // 自动挖因子(公式搜索:训练集选 → 样本外报)
  mineForm: {
    train_start: string;
    train_end: string;
    oos_start: string;
    oos_end: string;
    top_k: number;
  };
  mineResult: any | null;
  mining: boolean;
  mineError: string | null;
  mineProgress: RunProgress | null;
  mineStartedAt: number;
}

function detailStr(e: unknown): string {
  const d = e instanceof ApiError ? e.detail : e;
  return d && typeof d === 'object' ? JSON.stringify(d) : String(d ?? e);
}

export const useIndicatorsStore = defineStore('indicators', {
  state: (): IndicatorsState => ({
    form: { start: '', end: '', label_horizon: 5 },
    report: null,
    selectedName: null,
    loading: false,
    startedAt: 0,
    progress: null,
    error: null,
    expr: 'zscore(-pe_ttm) + rank(roe)',
    factorName: '',
    factorWeight: 1,
    validating: false,
    saving: false,
    saveError: null,
    validation: null,
    customList: [],
    builtinList: [],
    mineForm: { train_start: '', train_end: '', oos_start: '', oos_end: '', top_k: 10 },
    mineResult: null,
    mining: false,
    mineError: null,
    mineProgress: null,
    mineStartedAt: 0,
  }),
  actions: {
    async loadCustom() {
      try {
        this.customList = await api.customFactors();
      } catch {
        this.customList = [];
      }
    },
    async loadFactors() {
      try {
        const r = await api.factors();
        this.builtinList = r?.factors ?? [];
      } catch {
        this.builtinList = [];
      }
    },
    // 内置因子的启用/调权(PUT /factors/:name),失败回滚到服务端真值。
    async updateBuiltin(name: string, patch: { weight?: number; enabled?: boolean }) {
      this.saveError = null;
      try {
        await api.updateFactor(name, patch);
      } catch (e) {
        this.saveError = detailStr(e);
      } finally {
        await this.loadFactors();
      }
    },
    // 按 ICIR 自动定权:用刚跑的质检报告里每个因子的 ICIR 定权重(w = max(ICIR,0),归一到均值 1.0)。
    // 质检面板已 ×direction(反向因子取负),所以正 ICIR = 真有稳定预测力;ICIR≤0 → 权重 0(不硬凑)。
    // ⚠ 这是据「质检区间」历史 IC 定的权,不是样本外 —— 拿去回测重叠区间会偏乐观,UI 须如实提醒。
    async autoWeightByICIR(): Promise<{ ok: boolean; applied: number; note?: string }> {
      const plan = icirWeightPlan(this.builtinList, this.customList, this.report?.factors);
      if (!plan.ok) return { ok: false, applied: 0, note: plan.note };
      this.saveError = null;
      try {
        for (const t of plan.targets) {
          if (t.kind === 'builtin') await api.updateFactor(t.name, { weight: t.weight });
          else await api.updateCustomFactor(t.id!, { weight: t.weight });
        }
      } catch (e) {
        this.saveError = detailStr(e);
        return { ok: false, applied: 0, note: detailStr(e) };
      } finally {
        await this.loadFactors();
        await this.loadCustom();
      }
      return { ok: true, applied: plan.targets.length };
    },
    // 自动挖因子:候选公式训练集选 top-K → 样本外如实报 IC。进度走同 quality 的 SSE 广播通道。
    async mine() {
      const f = this.mineForm;
      if (!f.train_start || !f.train_end || !f.oos_start || !f.oos_end) return;
      this.mining = true;
      this.mineStartedAt = Date.now();
      this.mineProgress = null;
      this.mineError = null;
      const progressId = crypto.randomUUID();
      let unsub: (() => void) | null = null;
      try {
        unsub = subscribeJob(progressId, (ev) => {
          this.mineProgress = reduceProgress(this.mineProgress, ev, Date.now());
        });
        this.mineResult = await api.mineFactors({ ...f, progress_id: progressId });
      } catch (e) {
        this.mineError = detailStr(e);
        this.mineResult = null;
      } finally {
        if (unsub) unsub();
        this.mineProgress = null;
        this.mining = false;
      }
    },
    // 把挖出来的候选存成自定义因子(复用现成 createCustomFactor → 进因子库表,可启用/调权/质检)。
    async saveMined(c: {
      name: string;
      expr: string;
      group?: string;
    }): Promise<{ ok: boolean; note?: string }> {
      try {
        await api.createCustomFactor({ name: c.name, expr: c.expr, group: c.group });
        await this.loadCustom();
        return { ok: true };
      } catch (e) {
        return { ok: false, note: detailStr(e) };
      }
    },
    async validateExpr() {
      if (!this.expr.trim()) return;
      this.validating = true;
      this.saveError = null;
      try {
        this.validation = await api.validateIndicator(this.expr);
      } catch (e) {
        this.validation = { ok: false, errors: [detailStr(e)], fields: [], functions: [] };
      } finally {
        this.validating = false;
      }
    },
    async saveFactor() {
      if (!this.factorName.trim() || !this.validation?.ok) return;
      this.saving = true;
      this.saveError = null;
      try {
        await api.createCustomFactor({
          name: this.factorName.trim(),
          expr: this.expr,
          weight: this.factorWeight,
        });
        this.factorName = '';
        this.factorWeight = 1;
        await this.loadCustom();
      } catch (e) {
        this.saveError = detailStr(e);
      } finally {
        this.saving = false;
      }
    },
    async updateFactor(id: string, patch: { weight?: number; enabled?: boolean }) {
      this.saveError = null;
      try {
        await api.updateCustomFactor(id, patch);
        await this.loadCustom();
      } catch (e) {
        this.saveError = detailStr(e);
        await this.loadCustom(); // 失败回滚显示到服务端真值
      }
    },
    async delFactor(id: string) {
      try {
        await api.deleteCustomFactor(id);
        await this.loadCustom();
      } catch {
        /* 删除失败忽略 */
      }
    },
    async run() {
      if (!this.form.start || !this.form.end) return;
      this.loading = true;
      this.startedAt = Date.now();
      this.progress = null;
      this.error = null;
      // 进度通道:前端生成 id,订阅 SSE,随 query 下发给 api → api 把 engine 流式进度按此 id 广播回来。
      const progressId = crypto.randomUUID();
      let unsub: (() => void) | null = null;
      try {
        unsub = subscribeJob(progressId, (ev) => {
          this.progress = reduceProgress(this.progress, ev, Date.now());
        });
        this.report = await api.indicatorsQuality({ ...this.form, progress_id: progressId });
        this.selectedName = this.report?.factors?.[0]?.name ?? null;
      } catch (e) {
        this.error = detailStr(e);
        this.report = null;
      } finally {
        if (unsub) unsub();
        this.progress = null;
        this.loading = false;
      }
    },
  },
});
