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

/**
 * 拦截信号「拦截规则 / 说明」两列(由真实 reason 派生:规则=短标签,说明=该规则的解释)。
 * 只描述真实风控规则,不伪造实例级数字(红线#3)。被拦截组实际 reason ∈ {rank_out,
 * market_filter}(见 engine runner.run_eod),其余项兜底防御。
 */
const BLOCK_INFO: Record<string, { rule: string; note: string }> = {
  rank_out: {
    rule: '持仓上限',
    note: '综合分达标,但按分数排序超出持仓数上限,未进入买入候选',
  },
  market_filter: {
    rule: '大盘择时',
    note: '大盘指数跌破择时均线,空仓避险 —— 买入信号全部拦截',
  },
  stop_loss: { rule: '止损', note: '触发个股止损线,纪律强制卖出' },
  take_profit: { rule: '止盈', note: '触达个股止盈线,纪律了结' },
};
export function blockRule(reason?: string | null): string {
  if (!reason) return '—';
  return BLOCK_INFO[reason]?.rule ?? reasonLabel(reason);
}
export function blockNote(reason?: string | null): string {
  if (!reason) return '—';
  return BLOCK_INFO[reason]?.note ?? reasonLabel(reason);
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
