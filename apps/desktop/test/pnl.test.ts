import { describe, it, expect } from 'vitest';
import { PNL_CLASSES, STATUS_CLASSES, pnlClass, statusClass, formatPnl } from '../src/lib/pnl';

describe('盈亏色与系统色严格解耦(红线)', () => {
  it('两组 class 名集合不相交', () => {
    const pnl = new Set<string>(PNL_CLASSES);
    const status = new Set<string>(STATUS_CLASSES);
    for (const c of status) expect(pnl.has(c)).toBe(false);
    for (const c of pnl) expect(status.has(c)).toBe(false);
  });

  it('pnlClass 只产出 pnl-* 前缀', () => {
    for (const v of [-3, -0.0001, 0, 0.0001, 5]) {
      expect(pnlClass(v).startsWith('pnl-')).toBe(true);
      expect((STATUS_CLASSES as readonly string[]).includes(pnlClass(v))).toBe(false);
    }
  });

  it('statusClass 只产出 status-* 前缀,成功不复用盈亏绿', () => {
    for (const t of ['ok', 'warn', 'err', 'info'] as const) {
      expect(statusClass(t).startsWith('status-')).toBe(true);
      expect((PNL_CLASSES as readonly string[]).includes(statusClass(t))).toBe(false);
    }
    // 成功语义映射到主蓝 status-ok,绝不是 pnl-down(下跌绿)。
    expect(statusClass('ok')).toBe('status-ok');
  });

  it('pnlClass 方向正确', () => {
    expect(pnlClass(1)).toBe('pnl-up');
    expect(pnlClass(-1)).toBe('pnl-down');
    expect(pnlClass(0)).toBe('pnl-flat');
  });

  it('formatPnl 带符号', () => {
    expect(formatPnl(1.5)).toBe('+1.50');
    expect(formatPnl(-2)).toBe('-2.00');
  });
});
