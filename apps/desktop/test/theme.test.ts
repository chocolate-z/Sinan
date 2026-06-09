import { describe, it, expect } from 'vitest';
import { resolveTheme, themePrefIcon, themePrefLabel, THEME_PREFS } from '../src/lib/theme';

describe('resolveTheme 主题解析', () => {
  it('system 跟随系统浅/深', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });
  it('显式 light/dark 忽略系统', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });
  it('三态偏好顺序与中文标签/图标', () => {
    expect(THEME_PREFS).toEqual(['system', 'light', 'dark']);
    expect(themePrefLabel('system')).toBe('跟随系统');
    expect(themePrefLabel('dark')).toBe('深色');
    expect(themePrefIcon('light')).toBe('☀️');
  });
});
