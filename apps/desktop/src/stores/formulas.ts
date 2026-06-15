// 通达信/同花顺公式(检测扫描)页 store:公式文本 + 校验/扫描态,全部留存于 store(切菜单不丢)。
// 扫描可耗十余秒,run 由 store 拥有 → 离开页面也不中断、结果照常回填。
import { defineStore } from 'pinia';
import { api } from '../api/client';

export interface TdxValidate {
  ok: boolean;
  errors: string[];
  outputs: string[];
  signals: string[];
}
export interface TdxHit {
  stock_code: string;
  date: string;
  value: unknown;
}
export interface TdxScan {
  asof: string | null;
  signal: string;
  outputs: string[];
  scanned: number;
  hits: TdxHit[];
}

// 示例公式 = 用户给的「建仓/拉升」摆动指标(进页面即可直接校验/扫描,降低上手门槛)。
const SAMPLE = `N:=5;
VAR1:4*SMA((CLOSE-LLV(LOW,N))/(HHV(HIGH,N)-LLV(LOW,N))*100,5,1)-3*SMA(SMA((CLOSE-LLV(LOW,N))/(HHV(HIGH,N)-LLV(LOW,N))*100,5,1),3.2,1);
VAR2:8;
准备拉升: IF(CROSS(VAR1,VAR2),80,0);
压住庄家: IF(VAR1<=8,25,0);
DRAWTEXT(CROSS(VAR1,VAR2),80,'建仓');
建仓区: IF((EMA((CLOSE-LLV(LOW,27))/(HHV(HIGH,34)-LLV(LOW,27))*4,4)*25<10),80,100);`;

export interface SavedFormula {
  id: string;
  name: string;
  src: string;
  signal: string | null;
  created_at: string;
  updated_at: string;
}

interface State {
  src: string;
  validating: boolean;
  validateRes: TdxValidate | null;
  signal: string; // 选定信号列
  scanning: boolean;
  startedAt: number;
  scanRes: TdxScan | null;
  error: string | null;
  // 保存的公式库
  saved: SavedFormula[];
  currentId: string | null; // 当前加载的已保存公式(null=未保存草稿)
  name: string; // 保存名
  saving: boolean;
  // 点击命中股票 → 单股 K 线 + 公式副图
  selStock: string | null;
  evalRes: any | null;
  loadingEval: boolean;
}

export const useFormulasStore = defineStore('formulas', {
  state: (): State => ({
    src: SAMPLE,
    validating: false,
    validateRes: null,
    signal: '',
    scanning: false,
    startedAt: 0,
    scanRes: null,
    error: null,
    saved: [],
    currentId: null,
    name: '',
    saving: false,
    selStock: null,
    evalRes: null,
    loadingEval: false,
  }),
  getters: {
    canScan(s): boolean {
      return !!s.src.trim() && !s.scanning && (s.validateRes?.ok ?? true);
    },
  },
  actions: {
    resetSample() {
      this.src = SAMPLE;
    },
    async validate() {
      if (!this.src.trim()) return;
      this.validating = true;
      this.error = null;
      try {
        const r = (await api.tdxValidate(this.src)) as TdxValidate;
        this.validateRes = r;
        // 默认信号:沿用旧选择(若仍有效)否则取第一个
        if (r.ok) {
          if (!r.signals.includes(this.signal)) this.signal = r.signals[0] ?? '';
        }
      } catch (e: any) {
        this.error = String(e?.detail ?? e);
        this.validateRes = null;
      } finally {
        this.validating = false;
      }
    },
    async loadSaved() {
      try {
        this.saved = (await api.tdxFormulasList()) as SavedFormula[];
      } catch {
        /* 列表失败不阻断 */
      }
    },
    loadFormula(f: SavedFormula) {
      this.src = f.src;
      this.signal = f.signal ?? '';
      this.name = f.name;
      this.currentId = f.id;
      this.validateRes = null;
      this.scanRes = null;
    },
    newDraft() {
      this.currentId = null;
      this.name = '';
    },
    /** 保存:有 currentId 则更新,否则按 name 新建(后端保存前会再校验一次)。 */
    async save() {
      const nm = this.name.trim();
      if (!nm || !this.src.trim() || this.saving) return;
      this.saving = true;
      this.error = null;
      try {
        if (this.currentId) {
          await api.tdxFormulaUpdate(this.currentId, {
            name: nm,
            src: this.src,
            signal: this.signal || null,
          });
        } else {
          const r = await api.tdxFormulaCreate({
            name: nm,
            src: this.src,
            signal: this.signal || null,
          });
          this.currentId = r?.id ?? null;
        }
        await this.loadSaved();
      } catch (e: any) {
        const d = e?.detail;
        this.error = d && typeof d === 'object' && d.message ? d.message : String(d ?? e);
      } finally {
        this.saving = false;
      }
    },
    async deleteFormula(id: string) {
      try {
        await api.tdxFormulaDelete(id);
        if (this.currentId === id) this.newDraft();
        await this.loadSaved();
      } catch (e: any) {
        this.error = String(e?.detail ?? e);
      }
    },
    /** 点命中股票 → 单股求值(K 线 + 公式各输出线,供副图叠加)。 */
    async pickStock(code: string) {
      this.selStock = code;
      this.loadingEval = true;
      this.evalRes = null;
      try {
        this.evalRes = await api.tdxEvaluate({ code, src: this.src });
      } catch (e: any) {
        this.error = String(e?.detail ?? e);
      } finally {
        this.loadingEval = false;
      }
    },
    closeStock() {
      this.selStock = null;
      this.evalRes = null;
    },
    async scan() {
      if (!this.src.trim() || this.scanning) return;
      this.scanning = true;
      this.startedAt = Date.now();
      this.error = null;
      try {
        const body: { src: string; signal?: string } = { src: this.src };
        if (this.signal) body.signal = this.signal;
        this.scanRes = (await api.tdxScan(body)) as TdxScan;
        if (this.scanRes?.signal) this.signal = this.scanRes.signal;
      } catch (e: any) {
        const d = e?.detail;
        this.error = d && typeof d === 'object' && d.message ? d.message : String(d ?? e);
        this.scanRes = null;
      } finally {
        this.scanning = false;
      }
    },
  },
});
