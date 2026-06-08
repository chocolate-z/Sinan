import { describe, it, expect } from 'vitest';
import {
  actionClass,
  actionLabel,
  factorEntries,
  groupSignals,
  isBlocked,
  reasonLabel,
  type SignalRow,
} from '../src/lib/signals';

const rows: SignalRow[] = [
  { stock_code: 'A', action: 'buy', score: 2, blocked: 0, reason: 'signal' },
  { stock_code: 'B', action: 'buy', score: 1, blocked: 1, reason: 'rank_out' },
  { stock_code: 'C', action: 'sell', score: -1, blocked: false, reason: 'stop_loss' },
];

describe('signals 展示逻辑', () => {
  it('isBlocked 兼容数字/布尔', () => {
    expect(isBlocked(rows[1])).toBe(true);
    expect(isBlocked(rows[0])).toBe(false);
    expect(isBlocked({ stock_code: 'X', action: 'buy', blocked: true })).toBe(true);
  });

  it('groupSignals 分出生效与被拦截两组', () => {
    const { active, blocked } = groupSignals(rows);
    expect(active.map((s) => s.stock_code)).toEqual(['A', 'C']);
    expect(blocked.map((s) => s.stock_code)).toEqual(['B']);
  });

  it('中文标签', () => {
    expect(actionLabel('buy')).toBe('买入');
    expect(actionLabel('sell')).toBe('卖出');
    expect(reasonLabel('market_filter')).toBe('大盘择时·空仓');
    expect(reasonLabel('rank_out')).toBe('超出持仓上限');
    expect(reasonLabel(null)).toBe('—');
  });

  it('方向用系统色,不用盈亏色', () => {
    expect(actionClass('buy')).toBe('status-info');
    expect(actionClass('sell')).toBe('status-warn');
    expect(actionClass('hold')).toBe('');
    // 绝不返回 pnl-* class
    expect(actionClass('buy').startsWith('pnl-')).toBe(false);
  });

  it('factorEntries 按贡献绝对值降序', () => {
    expect(factorEntries({ ep: 0.2, roe: -0.9, mom20: 0.5 })).toEqual([
      ['roe', -0.9],
      ['mom20', 0.5],
      ['ep', 0.2],
    ]);
    expect(factorEntries(null)).toEqual([]);
  });
});
