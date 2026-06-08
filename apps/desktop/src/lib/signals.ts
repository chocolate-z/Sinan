/** 信号展示纯逻辑(便于单测)。被风控拦截的信号单独成组,教育用户「纪律高于模型」。 */
import type { SignalAction } from '@sinan/shared-contracts';

export interface SignalRow {
  stock_code: string;
  stock_name?: string | null;
  action: SignalAction;
  score?: number | null;
  reason?: string | null;
  blocked?: number | boolean;
  factor_breakdown?: Record<string, number> | null;
  effective_date?: string | null;
}

export function isBlocked(s: SignalRow): boolean {
  return typeof s.blocked === 'number' ? s.blocked !== 0 : Boolean(s.blocked);
}

/** 拆成「生效信号」与「已生成但被拦截」两组。 */
export function groupSignals(signals: SignalRow[]): { active: SignalRow[]; blocked: SignalRow[] } {
  const active: SignalRow[] = [];
  const blocked: SignalRow[] = [];
  for (const s of signals) (isBlocked(s) ? blocked : active).push(s);
  return { active, blocked };
}

const ACTIONS: Record<SignalAction, string> = { buy: '买入', sell: '卖出', hold: '持有' };
export function actionLabel(a: SignalAction): string {
  return ACTIONS[a] ?? a;
}

const REASONS: Record<string, string> = {
  signal: '打分入选',
  stop_loss: '止损',
  take_profit: '止盈',
  rank_out: '超出持仓上限',
  market_filter: '大盘择时·空仓',
  manual: '手动',
};
export function reasonLabel(r?: string | null): string {
  if (!r) return '—';
  return REASONS[r] ?? r;
}

/** 方向 → 状态色 class(系统色,不用盈亏色:买入蓝 / 卖出橙 / 持有灰)。 */
export function actionClass(a: SignalAction): string {
  return a === 'buy' ? 'status-info' : a === 'sell' ? 'status-warn' : '';
}

/** 因子贡献排序(供 FactorScoreBar 展示)。 */
export function factorEntries(fb?: Record<string, number> | null): Array<[string, number]> {
  if (!fb) return [];
  return Object.entries(fb).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
}
