// 指标页状态 store:质检表单/报告/选中因子 + DSL 编辑器(表达式/名称/权重/校验/已存列表),
// 全部留存,切菜单再回原样恢复;长质检的 run() 由 store 拥有 → 离开页面不中断、报告照常回填。
import { defineStore } from 'pinia';
import { api, ApiError } from '../api/client';

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
    error: null,
    expr: 'zscore(-pe_ttm) + rank(roe)',
    factorName: '',
    factorWeight: 1,
    validating: false,
    saving: false,
    saveError: null,
    validation: null,
    customList: [],
  }),
  actions: {
    async loadCustom() {
      try {
        this.customList = await api.customFactors();
      } catch {
        this.customList = [];
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
      this.error = null;
      try {
        this.report = await api.indicatorsQuality({ ...this.form });
        this.selectedName = this.report?.factors?.[0]?.name ?? null;
      } catch (e) {
        this.error = detailStr(e);
        this.report = null;
      } finally {
        this.loading = false;
      }
    },
  },
});
