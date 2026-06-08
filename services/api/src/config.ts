/** api 配置:打包默认(config.defaults.json)< 环境变量。机密绝不进此体系。 */
import { readFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirnameLocal = dirname(fileURLToPath(import.meta.url));

function findDefaults(): Record<string, any> {
  const env = process.env.SINAN_CONFIG_DEFAULTS;
  const candidates = [
    env,
    // dist/src/config.js -> 仓库根上溯
    ...Array.from(ancestors(__dirnameLocal), (d) => join(d, 'config.defaults.json')),
  ].filter(Boolean) as string[];
  for (const c of candidates) {
    if (existsSync(c)) return JSON.parse(readFileSync(c, 'utf-8'));
  }
  return {};
}

function* ancestors(start: string): Generator<string> {
  let cur = resolve(start);
  while (true) {
    yield cur;
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
}

const defaults = findDefaults();

export function dataDir(): string {
  if (process.env.SINAN_DATA_DIR) return process.env.SINAN_DATA_DIR;
  if (process.platform === 'win32') {
    return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'Sinan');
  }
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'Sinan');
  }
  return join(homedir(), '.local', 'share', 'sinan');
}

export function sqlitePath(): string {
  return process.env.SINAN_SQLITE_PATH ?? join(dataDir(), 'sinan.db');
}

export function apiPort(): number {
  return Number(process.env.SINAN_API_PORT ?? defaults?.ports?.api ?? 59914);
}

export function enginePort(): number {
  return Number(process.env.SINAN_ENGINE_PORT ?? defaults?.ports?.engine ?? 59915);
}

export function engineBaseUrl(): string {
  return process.env.SINAN_ENGINE_URL ?? `http://127.0.0.1:${enginePort()}`;
}

/** api→engine 内部调用 token(X-Sinan-Internal);Tauri 下发会话随机 token。 */
export function internalToken(): string | undefined {
  return process.env.SINAN_IPC_TOKEN;
}

export function configDefaults(): Record<string, any> {
  return defaults;
}

export function rateLimitFor(provider: string): {
  per_min: number;
  concurrency?: number;
} {
  return defaults?.rate_limit_defaults?.[provider] ?? { per_min: 120 };
}

/** 内置数据源静态声明(写入 providers 表的种子)。 */
export const PROVIDER_SEED = [
  {
    id: 'tushare',
    display_name: 'Tushare Pro',
    needs_token: true,
    priority: 10,
  },
  {
    id: 'akshare',
    display_name: 'AkShare(免费)',
    needs_token: false,
    priority: 20,
  },
  {
    id: 'realtime_sina',
    display_name: '实时(新浪)',
    needs_token: false,
    priority: 30,
  },
  {
    id: 'realtime_tencent',
    display_name: '实时(腾讯)',
    needs_token: false,
    priority: 31,
  },
];
