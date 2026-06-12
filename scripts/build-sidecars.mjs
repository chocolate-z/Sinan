#!/usr/bin/env node
/**
 * 把两个 sidecar 打成「可分发产物」,落到 apps/desktop/src-tauri/sidecars/(tauri resources 引用)。
 * 跑法:node scripts/build-sidecars.mjs   ⚠️ 先停 `pnpm dev`(engine dist 在重写时不能被占用)。
 *
 * 产出:
 *   src-tauri/sidecars/engine/sinan-engine.exe (+ 同目录 PyInstaller one-dir 依赖)
 *   src-tauri/sidecars/api/node.exe            (随包 Node 运行时,目标机无需装 Node)
 *   src-tauri/sidecars/api/api-bundle.cjs      (esbuild 把 NestJS 打成单 CJS)
 *   src-tauri/sidecars/api/node_modules/@napi-rs/keyring  (native 钥匙串,生产存 token)
 *
 * 决策:api 不走 SEA(嵌 blob 后找 native keyring 不稳),走「随包 node.exe + bundle.cjs」:
 *   supervisor 生产态以 api_dev(node, bundle) 启动,require('@napi-rs/keyring') 走标准 Node 解析
 *   (bundle 同目录 node_modules)。engine 走 PyInstaller one-dir(多进程子进程秒起,见 sinan-engine.spec)。
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const isWin = process.platform === 'win32';
const r = (...p) => resolve(ROOT, ...p);
// PY 可被 SINAN_PYTHON 覆盖(CI 用 setup-python 的 `python`;本地用 .venv)。
const PY = process.env.SINAN_PYTHON || r(isWin ? '.venv/Scripts/python.exe' : '.venv/bin/python');
const SIDECARS = r('apps/desktop/src-tauri/sidecars');

function run(label, cmd, args, cwd) {
  console.log(`\n▸ ${label}`);
  execFileSync(cmd, args, { cwd, stdio: 'inherit' });
}

// NestJS 惰性 require 的可选功能包(本 api 不用:express/微服务/websocket/静态资源/class-validator)
// + native keyring → 全部 external(运行时不触发)。
const EXTERNALS = [
  '@napi-rs/keyring',
  '@fastify/static',
  '@fastify/view',
  '@nestjs/microservices',
  '@nestjs/microservices/microservices-module',
  '@nestjs/platform-express',
  '@nestjs/websockets/socket-module',
  'class-transformer',
  'class-validator',
];

// ── 1) 契约 + api 编译 ────────────────────────────────────────────────────
run(
  '编译 shared-contracts',
  'node',
  ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json'],
  r('packages/shared-contracts'),
);
run(
  '编译 api',
  'node',
  ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.build.json'],
  r('services/api'),
);

// ── 2) esbuild 把 api 打成单 CJS ──────────────────────────────────────────
rmSync(SIDECARS, { recursive: true, force: true });
mkdirSync(r('apps/desktop/src-tauri/sidecars/api/node_modules/@napi-rs'), { recursive: true });
console.log('\n▸ esbuild 打包 api → 单 CJS');
esbuild.buildSync({
  entryPoints: [r('services/api/dist/src/main.js')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  outfile: resolve(SIDECARS, 'api/api-bundle.cjs'),
  keepNames: true,
  define: { 'import.meta.url': 'importMetaUrl' },
  banner: { js: "const importMetaUrl=require('url').pathToFileURL(__filename).href;" },
  external: EXTERNALS,
});

// ── 3) 随包 node.exe + native keyring(供 bundle 同目录解析)────────────────
console.log('\n▸ 随包 node 运行时 + @napi-rs/keyring');
cpSync(process.execPath, resolve(SIDECARS, 'api', isWin ? 'node.exe' : 'node'));
const apiRequire = createRequire(r('services/api/package.json'));
const keyringDir = dirname(apiRequire.resolve('@napi-rs/keyring/package.json'));
cpSync(keyringDir, resolve(SIDECARS, 'api/node_modules/@napi-rs/keyring'), {
  recursive: true,
  dereference: true,
});
// ⚠️ @napi-rs 的 native .node 在独立平台子包(keyring/index.js fallback require('@napi-rs/keyring-win32-x64-msvc'))。
// 只拷主包会漏 .node → 生产 require 崩。这里从 keyring 包视角解析并补拷平台子包(Windows x64)。
const keyringRequire = createRequire(resolve(keyringDir, 'index.js'));
const PLATFORM_PKG = '@napi-rs/keyring-win32-x64-msvc';
const platDir = dirname(keyringRequire.resolve(`${PLATFORM_PKG}/package.json`));
cpSync(platDir, resolve(SIDECARS, `api/node_modules/${PLATFORM_PKG}`), {
  recursive: true,
  dereference: true,
});

// ── 4) 引擎 PyInstaller one-dir ───────────────────────────────────────────
if (!existsSync(PY)) {
  console.error(
    `✗ 未找到 venv python: ${PY}(先建 venv + pip install -e services/engine 与 pyinstaller)`,
  );
  process.exit(1);
}
run(
  'PyInstaller 冻结 engine(较久)',
  PY,
  [
    '-m',
    'PyInstaller',
    'sinan-engine.spec',
    '--noconfirm',
    '--distpath',
    'dist',
    '--workpath',
    'build',
  ],
  r('services/engine'),
);
console.log('\n▸ 拷贝 engine one-dir → sidecars/engine');
cpSync(r('services/engine/dist/sinan-engine'), resolve(SIDECARS, 'engine'), { recursive: true });

console.log(`\n✅ sidecars 就绪:${SIDECARS}`);
console.log(
  '   下一步:tauri.conf.json 配 bundle.resources 指向 sidecars/,壳生产态定位,然后 tauri build。',
);
