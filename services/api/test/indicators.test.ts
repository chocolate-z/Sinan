import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/bootstrap.js';
import { MemorySecretStore } from '../src/secrets/secret-store.js';
import { FakeEngineClient } from './fakes.js';

async function build(qualityResult: any) {
  const app = await createApp({
    dbPath: ':memory:',
    secretStore: new MemorySecretStore(),
    engineClient: new FakeEngineClient(null, [], null, {}, {}, null, null, qualityResult),
  });
  await app.init();
  const fastify = app.getHttpAdapter().getInstance();
  await fastify.ready();
  return { app, fastify };
}

test('GET /indicators/quality 代理 engine 因子质检(真实 IC/分层)', async () => {
  const { app, fastify } = await build(null);
  try {
    const r = await fastify.inject({
      method: 'GET',
      url: '/api/v1/indicators/quality?start=2023-01-01&end=2024-06-30&n_deciles=10',
    });
    assert.equal(r.statusCode, 200);
    const body = r.json();
    const mom = body.factors.find((f: any) => f.name === 'mom20');
    assert.equal(mom.ic_mean, 0.061);
    assert.equal(mom.deciles.length, 3);
    assert.ok(body.degraded.length >= 1);
  } finally {
    await app.close();
  }
});

test('GET /indicators/quality 缺 start/end → 400', async () => {
  const { app, fastify } = await build(null);
  try {
    const r = await fastify.inject({
      method: 'GET',
      url: '/api/v1/indicators/quality?start=2023-01-01',
    });
    assert.equal(r.statusCode, 400);
  } finally {
    await app.close();
  }
});

test('engine 400(无缓存/区间过短)→ api 转发 400', async () => {
  const { app, fastify } = await build({ __error: { status: 400, detail: '本地无行情缓存' } });
  try {
    const r = await fastify.inject({
      method: 'GET',
      url: '/api/v1/indicators/quality?start=2023-01-01&end=2024-06-30',
    });
    assert.equal(r.statusCode, 400);
  } finally {
    await app.close();
  }
});
