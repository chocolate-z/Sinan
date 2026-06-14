/** 会话 token 守卫单测(红线#4/#6:外部进程不可驱动 api)。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { IpcTokenGuard } from '../src/secrets/ipc-token.guard.js';

function ctx(headers: Record<string, unknown>, url = '/api/foo') {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers, url }) }),
  } as unknown as Parameters<IpcTokenGuard['canActivate']>[0];
}

test('未设 SINAN_IPC_TOKEN(dev/测试)→ 放行', () => {
  delete process.env.SINAN_IPC_TOKEN;
  assert.equal(new IpcTokenGuard().canActivate(ctx({})), true);
});

test('已设 token:缺头 → 401', () => {
  process.env.SINAN_IPC_TOKEN = 'sess-secret';
  try {
    assert.throws(() => new IpcTokenGuard().canActivate(ctx({})), /token/);
  } finally {
    delete process.env.SINAN_IPC_TOKEN;
  }
});

test('已设 token:头匹配 → 放行', () => {
  process.env.SINAN_IPC_TOKEN = 'sess-secret';
  try {
    assert.equal(new IpcTokenGuard().canActivate(ctx({ 'x-sinan-token': 'sess-secret' })), true);
  } finally {
    delete process.env.SINAN_IPC_TOKEN;
  }
});

test('已设 token:头不匹配 → 401', () => {
  process.env.SINAN_IPC_TOKEN = 'sess-secret';
  try {
    assert.throws(() => new IpcTokenGuard().canActivate(ctx({ 'x-sinan-token': 'wrong' })), /token/);
  } finally {
    delete process.env.SINAN_IPC_TOKEN;
  }
});

test('已设 token:SSE(Accept: text/event-stream)→ 豁免(EventSource 带不了头)', () => {
  process.env.SINAN_IPC_TOKEN = 'sess-secret';
  try {
    assert.equal(
      new IpcTokenGuard().canActivate(ctx({ accept: 'text/event-stream' })),
      true,
    );
  } finally {
    delete process.env.SINAN_IPC_TOKEN;
  }
});

test('已设 token:/health → 豁免', () => {
  process.env.SINAN_IPC_TOKEN = 'sess-secret';
  try {
    assert.equal(new IpcTokenGuard().canActivate(ctx({}, '/api/health')), true);
  } finally {
    delete process.env.SINAN_IPC_TOKEN;
  }
});
