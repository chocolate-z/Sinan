/**
 * 盈亏色与系统色的唯一出口。红线:两组 class 永不交叉。
 * 盈亏 class 只用于金额/涨跌/收益;系统 class 只用于任务/健康/连接。
 */
export type PnlClass = 'pnl-up' | 'pnl-down' | 'pnl-flat';
export type StatusTone = 'ok' | 'warn' | 'err' | 'info';
export type StatusClass = 'status-ok' | 'status-warn' | 'status-err' | 'status-info';

export const PNL_CLASSES: readonly PnlClass[] = ['pnl-up', 'pnl-down', 'pnl-flat'] as const;
export const STATUS_CLASSES: readonly StatusClass[] = [
  'status-ok',
  'status-warn',
  'status-err',
  'status-info',
] as const;

/** 数值 → 盈亏 class(受 data-pnl-invert 的 CSS 变量切换影响,逻辑层不变)。 */
export function pnlClass(v: number): PnlClass {
  if (v > 0) return 'pnl-up';
  if (v < 0) return 'pnl-down';
  return 'pnl-flat';
}

/** 系统语义 → 系统 class。成功是主蓝(status-ok),绝不复用盈亏绿。 */
export function statusClass(tone: StatusTone): StatusClass {
  return `status-${tone}` as StatusClass;
}

/** 带符号千分位格式化(盈亏数字)。 */
export function formatPnl(v: number, precision = 2): string {
  const sign = v > 0 ? '+' : '';
  return (
    sign +
    v.toLocaleString('zh-CN', {
      minimumFractionDigits: precision,
      maximumFractionDigits: precision,
    })
  );
}
