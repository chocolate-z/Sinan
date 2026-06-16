import { describe, it, expect } from 'vitest';
import { reduceProgress, type RunProgress } from '../src/lib/progress';

describe('reduceProgress', () => {
  it('features 事件 → 特征面板进度,首条事件设 phaseSince,同阶段后续保留 phaseSince', () => {
    const t0 = 1000;
    const a = reduceProgress(
      null,
      { stage: 'features', done: 5, total: 100, date: '2024-01-05' },
      t0,
    );
    expect(a).toEqual({ label: '特征面板', done: 5, total: 100, phaseSince: t0 });
    // 同阶段后续事件:done 推进,phaseSince 不变(ETA 才能按整段速率估)。
    const b = reduceProgress(a, { stage: 'features', done: 40, total: 100 }, t0 + 9000);
    expect(b).toEqual({ label: '特征面板', done: 40, total: 100, phaseSince: t0 });
  });

  it('features → folds 换阶段:phaseSince 重置为 now,total=n_folds', () => {
    const feat: RunProgress = { label: '特征面板', done: 100, total: 100, phaseSince: 1000 };
    const f = reduceProgress(feat, { stage: 'folds', n_folds: 6 }, 50000);
    expect(f).toEqual({ label: 'Walk-forward 拟合', done: 0, total: 6, phaseSince: 50000 });
  });

  it('fold 事件:done=index+1,保留本阶段 phaseSince', () => {
    const folds: RunProgress = { label: 'Walk-forward 拟合', done: 0, total: 6, phaseSince: 50000 };
    const f = reduceProgress(folds, { stage: 'fold', index: 2, n_folds: 6 }, 52000);
    expect(f).toEqual({ label: 'Walk-forward 拟合', done: 3, total: 6, phaseSince: 50000 });
  });

  it('scoring → factor:total 来自 scoring 的 n_factors,factor 事件逐条累加 done', () => {
    const s = reduceProgress(null, { stage: 'scoring', n_factors: 5 }, 60000);
    expect(s).toEqual({ label: '逐因子 IC', done: 0, total: 5, phaseSince: 60000 });
    const f1 = reduceProgress(s, { stage: 'factor', name: 'ep' }, 60100);
    expect(f1).toEqual({ label: '逐因子 IC', done: 1, total: 5, phaseSince: 60000 });
    const f2 = reduceProgress(f1, { stage: 'factor', name: 'bp' }, 60200);
    expect(f2).toEqual({ label: '逐因子 IC', done: 2, total: 5, phaseSince: 60000 });
  });

  it('total<=0 的 features / 未知事件 / null:不产生假进度', () => {
    expect(reduceProgress(null, { stage: 'features', done: 0, total: 0 }, 1)).toBeNull();
    const prev: RunProgress = { label: '特征面板', done: 5, total: 100, phaseSince: 1 };
    expect(reduceProgress(prev, { stage: 'whatever' }, 2)).toBe(prev); // 未知事件原样返回
    expect(reduceProgress(prev, null, 3)).toBe(prev);
  });
});
