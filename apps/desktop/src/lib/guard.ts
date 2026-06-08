/** 路由锁定逻辑(纯函数,便于单测)。未完成 onboarding 时,需数据源的页面锁定。 */

export interface GuardMeta {
  needsData?: boolean;
  noShell?: boolean;
}

/** 未完成 onboarding 且路由需要数据 → 是否锁定。 */
export function isLocked(meta: GuardMeta, onboardingDone: boolean): boolean {
  return Boolean(meta.needsData) && !onboardingDone;
}

/**
 * 返回应重定向到的目标路径,或 null(放行)。
 * - 首启(未完成)访问需数据页 → 去数据源设置页。
 */
export function resolveGuard(
  _path: string,
  meta: GuardMeta,
  onboardingDone: boolean,
): string | null {
  if (isLocked(meta, onboardingDone)) return '/settings/datasource';
  return null;
}
