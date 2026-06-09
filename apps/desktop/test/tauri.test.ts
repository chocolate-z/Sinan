import { describe, it, expect } from 'vitest';
import { getAppWindow, isTauri } from '../src/lib/tauri';

describe('tauri 环境探测(浏览器/测试环境降级)', () => {
  it('非 Tauri 环境 isTauri 为 false', () => {
    expect(isTauri()).toBe(false);
  });
  it('非 Tauri 环境 getAppWindow 返回 null 且不抛', async () => {
    await expect(getAppWindow()).resolves.toBeNull();
  });
});
