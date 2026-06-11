// 模型页状态 store:训练表单 + 表单展开态 + 版本列表 + 选中/详情 + 训练态/错误,全部留存,
// 切菜单再回原样恢复;长训练的 train() 由 store 拥有 → 离开页面不中断、结果照常回填。
import { defineStore } from 'pinia';
import { api } from '../api/client';

export interface TrainForm {
  train_start: string;
  train_end: string;
  label_horizon: number;
  purge: number;
  train_span: number;
  test_span: number;
}

interface ModelsState {
  form: TrainForm;
  showForm: boolean;
  models: any[];
  selectedId: string | null;
  detail: any | null;
  training: boolean;
  startedAt: number; // 训练开始 epoch ms(跨导航留存,供 RunningBar 真实计时)
  error: string | null;
}

export const useModelsStore = defineStore('models', {
  state: (): ModelsState => ({
    form: {
      train_start: '',
      train_end: '',
      label_horizon: 5,
      purge: 5,
      train_span: 252,
      test_span: 63,
    },
    showForm: false,
    models: [],
    selectedId: null,
    detail: null,
    training: false,
    startedAt: 0,
    error: null,
  }),
  actions: {
    async fetchModels() {
      try {
        this.models = await api.models();
        if (!this.selectedId && this.models.length) await this.selectModel(this.models[0].id);
      } catch {
        this.models = [];
      }
    },
    async selectModel(id: string) {
      this.selectedId = id;
      this.detail = null;
      try {
        this.detail = await api.model(id);
      } catch {
        this.detail = null;
      }
    },
    async train() {
      const f = this.form;
      if (!f.train_start || !f.train_end) return;
      this.training = true;
      this.startedAt = Date.now();
      this.error = null;
      try {
        const created = await api.trainModel({ ...f });
        this.showForm = false;
        await this.fetchModels();
        if (created?.id) await this.selectModel(created.id);
      } catch (e: any) {
        const d = e?.detail;
        this.error = d && typeof d === 'object' ? JSON.stringify(d) : String(d ?? e);
      } finally {
        this.training = false;
      }
    },
    async activate(id: string, ev: Event) {
      ev.stopPropagation();
      try {
        await api.activateModel(id);
        await this.fetchModels();
        if (this.selectedId) await this.selectModel(this.selectedId);
      } catch (e) {
        this.error = String(e);
      }
    },
  },
});
