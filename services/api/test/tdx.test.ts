import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/bootstrap.js';
import { MemorySecretStore } from '../src/secrets/secret-store.js';
import { FakeEngineClient } from './fakes.js';

async function build() {
  const engine = new FakeEngineClient(null);
  const app = await createApp({
    dbPath: ':memory:',
    secretStore: new MemorySecretStore(),
    engineClient: engine,
  });
  await app.init();
  const fastify = app.getHttpAdapter().getInstance();
  await fastify.ready();
  return { app, fastify };
}

test('POST /tdx/validate 代理 engine 校验(ok/outputs/signals;负 REF 不合法)', async () => {
  const { app, fastify } = await build();
  try {
    let r = await fastify.inject({
      method: 'POST',
      url: '/api/v1/tdx/validate',
      payload: { src: '建仓: CROSS(CLOSE, MA(CLOSE,5));' },
    });
    assert.equal(r.statusCode, 201);
    assert.equal(r.json().ok, true);
    assert.ok(r.json().outputs.includes('建仓'));

    // 负 REF(未来函数)→ ok=false
    r = await fastify.inject({
      method: 'POST',
      url: '/api/v1/tdx/validate',
      payload: { src: 'OUT: REF(CLOSE, -1);' },
    });
    assert.equal(r.json().ok, false);
    assert.ok(r.json().errors.length >= 1);

    // src 必填 → 400
    r = await fastify.inject({ method: 'POST', url: '/api/v1/tdx/validate', payload: {} });
    assert.equal(r.statusCode, 400);
  } finally {
    await app.close();
  }
});

test('POST /tdx/scan 代理全市场扫描 + 写统一日志', async () => {
  const { app, fastify } = await build();
  try {
    const r = await fastify.inject({
      method: 'POST',
      url: '/api/v1/tdx/scan',
      payload: { src: '建仓: CROSS(CLOSE, 10);', signal: '建仓' },
    });
    assert.equal(r.statusCode, 201);
    const body = r.json();
    assert.equal(body.scanned, 2);
    assert.equal(body.hits[0].stock_code, '600000.SH');

    const logs = await fastify.inject({ method: 'GET', url: '/api/v1/logs' });
    const msgs = logs.json().map((l: { message: string }) => l.message);
    assert.ok(msgs.some((m: string) => m.includes('公式扫描开始')));
    assert.ok(msgs.some((m: string) => m.includes('公式扫描完成')));
  } finally {
    await app.close();
  }
});
