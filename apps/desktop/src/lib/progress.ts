// 训练/质检 SSE 进度事件 → 统一进度模型(供 RunningBar 确定式进度条 + ETA)。
// 引擎逐日特征面板 / 逐折 walk-forward / 逐因子 IC 都流式发 {stage, done/total, ...},
// 这里把它们归一成 {label, done, total, phaseSince}。纯函数,便于单测、无副作用。

export interface RunProgress {
  label: string; // 阶段名(特征面板 / Walk-forward 拟合 / 逐因子 IC)
  done: number;
  total: number;
  phaseSince: number; // 本阶段首条事件到达时刻(epoch ms),ETA 用它算本阶段速率
}

const PHASE_FEATURES = '特征面板';
const PHASE_FOLDS = 'Walk-forward 拟合';
const PHASE_FACTORS = '逐因子 IC';

/**
 * 把一条 engine SSE 进度事件并入当前进度。
 * - prev:上一进度(同阶段则保留 phaseSince,使 ETA 按整段速率估;换阶段则以 now 重置)。
 * - now:当前时刻 ms（由调用方注入,便于测试确定性）。
 * 返回新进度;无法识别的事件原样返回 prev(不变)。
 */
export function reduceProgress(prev: RunProgress | null, ev: any, now: number): RunProgress | null {
  if (ev?.stage === 'features' && ev.total > 0) {
    const phaseSince = prev?.label === PHASE_FEATURES ? prev.phaseSince : now;
    return { label: PHASE_FEATURES, done: ev.done ?? 0, total: ev.total, phaseSince };
  }
  if (ev?.stage === 'folds' && ev.n_folds > 0) {
    return { label: PHASE_FOLDS, done: 0, total: ev.n_folds, phaseSince: now };
  }
  if (ev?.stage === 'fold' && ev.n_folds > 0) {
    const phaseSince = prev?.label === PHASE_FOLDS ? prev.phaseSince : now;
    return { label: PHASE_FOLDS, done: (ev.index ?? 0) + 1, total: ev.n_folds, phaseSince };
  }
  if (ev?.stage === 'scoring' && ev.n_factors > 0) {
    return { label: PHASE_FACTORS, done: 0, total: ev.n_factors, phaseSince: now };
  }
  if (ev?.stage === 'factor') {
    const f = prev?.label === PHASE_FACTORS ? prev : null;
    return {
      label: PHASE_FACTORS,
      done: (f?.done ?? 0) + 1,
      total: f?.total ?? 0,
      phaseSince: f?.phaseSince ?? now,
    };
  }
  return prev;
}
