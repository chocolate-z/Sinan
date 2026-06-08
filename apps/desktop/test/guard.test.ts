import { describe, it, expect } from 'vitest';
import { isLocked, resolveGuard } from '../src/lib/guard';

describe('路由锁定守卫', () => {
  it('未完成 onboarding 时,需数据页被锁定', () => {
    expect(isLocked({ needsData: true }, false)).toBe(true);
    expect(isLocked({ needsData: true }, true)).toBe(false);
    expect(isLocked({ needsData: false }, false)).toBe(false);
    expect(isLocked({}, false)).toBe(false);
  });

  it('锁定时重定向到数据源设置页', () => {
    expect(resolveGuard('/market', { needsData: true }, false)).toBe('/settings/datasource');
  });

  it('已完成 onboarding 放行', () => {
    expect(resolveGuard('/market', { needsData: true }, true)).toBeNull();
  });

  it('不需要数据的页面始终放行(如个人持仓/日志/设置)', () => {
    expect(resolveGuard('/portfolio', {}, false)).toBeNull();
    expect(resolveGuard('/logs', {}, false)).toBeNull();
    expect(resolveGuard('/settings/datasource', {}, false)).toBeNull();
  });
});
