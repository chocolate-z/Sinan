/** 主题偏好与解析(纯逻辑,便于单测)。偏好 'system' 跟随操作系统浅/深色。 */
export type ThemePref = 'system' | 'light' | 'dark';
export type Theme = 'light' | 'dark';

export const THEME_PREFS: readonly ThemePref[] = ['system', 'light', 'dark'] as const;

/** 偏好 + 系统是否深色 → 实际应用的主题。 */
export function resolveTheme(pref: ThemePref, systemPrefersDark: boolean): Theme {
  if (pref === 'system') return systemPrefersDark ? 'dark' : 'light';
  return pref;
}

const LABELS: Record<ThemePref, string> = { system: '跟随系统', light: '浅色', dark: '深色' };
export function themePrefLabel(p: ThemePref): string {
  return LABELS[p] ?? p;
}

const ICONS: Record<ThemePref, string> = { system: '🖥', light: '☀️', dark: '🌙' };
export function themePrefIcon(p: ThemePref): string {
  return ICONS[p] ?? '🖥';
}
