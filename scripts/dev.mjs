#!/usr/bin/env node
/**
 * 一键开发环境(pnpm dev):
 *   1) 编译 shared-contracts + api(桌面壳的 api sidecar 是 node dist/main.js)
 *   2) cargo build 编译 Tauri 桌面壳(增量;Rust 没改则秒过)
 *   3) 起 vite(前端 devUrl,固定 :9521)
 *   4) vite 就绪后起桌面壳 —— 其 supervisor 自动拉起 engine/api 两个 sidecar、弹原生窗口
 * Ctrl+C 一并停止。前端改动 vite HMR 热更新;改 Rust 需重跑本命令。
 * dev 用内存钥匙串(SINAN_SECRET_STORE=memory):免装原生 keyring,但 token 重启不持久。
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const isWin = process.platform === 'win32';
const PY = resolve(ROOT, isWin ? '.venv/Scripts/python.exe' : '.venv/bin/python');
const API_ENTRY = resolve(ROOT, 'services/api/dist/src/main.js');
const EXE = resolve(
  ROOT,
  'apps/desktop/src-tauri/target/debug',
  isWin ? 'sinan-desktop.exe' : 'sinan-desktop',
);
const VITE_PORT = '9521';

function step(label, cmd, args, cwd) {
  console.log(`\n▸ ${label}`);
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: false });
  if (r.status !== 0) {
    console.error(`✗ ${label} 失败(退出码 ${r.status})`);
    process.exit(1);
  }
}

// 1) 契约 + api(契约被前端/后端共同引用,api sidecar 跑编译后的 dist)
step(
  '编译 shared-contracts',
  'node',
  ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json'],
  resolve(ROOT, 'packages/shared-contracts'),
);
step(
  '编译 api',
  'node',
  ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.build.json'],
  resolve(ROOT, 'services/api'),
);

// 2) Tauri 桌面壳(首次较久,之后增量)
step('编译 Tauri 桌面壳(首次较久)', 'cargo', ['build'], resolve(ROOT, 'apps/desktop/src-tauri'));

if (!existsSync(PY)) {
  console.error(`✗ 未找到 venv python: ${PY}`);
  console.error('  请先: python -m venv .venv && .venv 内 pip install -e services/engine[test]');
  process.exit(1);
}

// 3) 起 vite(前端 devUrl)
console.log(`\n▸ 启动 vite(:${VITE_PORT})…`);
const vite = spawn('node', ['node_modules/vite/bin/vite.js', '--port', VITE_PORT], {
  cwd: resolve(ROOT, 'apps/desktop'),
  stdio: 'inherit',
});

// 4) vite 就绪 → 起桌面壳(supervisor 自动管理 engine/api sidecar)
const env = {
  ...process.env,
  SINAN_PYTHON: PY,
  SINAN_NODE: 'node',
  SINAN_API_ENTRY: API_ENTRY,
  SINAN_SECRET_STORE: 'memory',
};
let shell;
let stopped = false;
function stop() {
  if (stopped) return;
  stopped = true;
  try {
    vite.kill();
  } catch {
    /* ignore */
  }
  try {
    shell?.kill();
  } catch {
    /* ignore */
  }
  process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

(async () => {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://localhost:${VITE_PORT}/`);
      if (r.ok) break;
    } catch {
      /* not ready yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  console.log('\n▸ vite 就绪,启动桌面壳(自动管理 engine/api sidecar)…\n');
  shell = spawn(EXE, [], { env, stdio: 'inherit' });
  shell.on('exit', stop);
})();
