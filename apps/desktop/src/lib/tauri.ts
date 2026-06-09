/** Tauri 环境探测与窗口句柄(浏览器开发环境优雅降级:非 Tauri 一律返回 null/false)。
 * 自定义标题栏(decorations:false)用它驱动 Win11 风窗口控制(最小化/最大化/关闭)。 */

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** 当前窗口句柄;非 Tauri(浏览器)或加载失败 → null。动态 import 避免浏览器报错。 */
export async function getAppWindow() {
  if (!isTauri()) return null;
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    return getCurrentWindow();
  } catch {
    return null;
  }
}
