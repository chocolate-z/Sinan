/** 在线更新封装:检查 GitHub Release 签名清单 → 下载/验签/安装 → relaunch。
 * 非 Tauri 环境(浏览器 dev)或网络不可达 → 静默降级(返回 null / 抛错由调用方兜底)。 */
import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

export interface UpdateInfo {
  version: string;
  notes: string;
  date?: string;
}

// 缓存上次 check 到的 Update 句柄,供后续 download/install 复用(避免二次网络往返)。
let pending: Update | null = null;

/** 检查更新。无更新 / 非 Tauri / 不可达 → null(静默)。 */
export async function checkUpdate(): Promise<UpdateInfo | null> {
  try {
    const u = await check();
    if (!u) {
      pending = null;
      return null;
    }
    pending = u;
    return { version: u.version, notes: u.body ?? '', date: u.date };
  } catch {
    pending = null;
    return null; // 浏览器 dev / 离线 / endpoint 不可达 → 不打扰
  }
}

/** 下载并安装上次 checkUpdate 找到的更新;onProgress(0..1);完成后 relaunch 重启到新版本。 */
export async function installUpdate(onProgress?: (pct: number) => void): Promise<void> {
  if (!pending) throw new Error('无可安装的更新(请先检查更新)');
  let total = 0;
  let got = 0;
  await pending.downloadAndInstall((e) => {
    if (e.event === 'Started') {
      total = e.data.contentLength ?? 0;
    } else if (e.event === 'Progress') {
      got += e.data.chunkLength;
      if (total > 0) onProgress?.(Math.min(got / total, 0.999));
    } else if (e.event === 'Finished') {
      onProgress?.(1);
    }
  });
  await relaunch();
}
