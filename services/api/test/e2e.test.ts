import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/bootstrap.js';
import { MemorySecretStore } from '../src/secrets/secret-store.js';
import { FakeEngineClient } from './fakes.js';

const TOKEN = 'SECRET-TOKEN-DO-NOT-LEAK-abc123';

async function build() {
  const engine = new FakeEngineClient(
    {
      status: 'ok',
      caps: { DAILY_OHLCV: true, NORTHBOUND: true },
      rate_limit: { per_min: 500 },
      degraded: [],
    },
    [{ progress: 1, done_count: 1, total: 1, status: 'done' }],
  );
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

test('CORS 预检放行 PUT/DELETE/PATCH(否则保存 token/设主源/清凭据跨域被拒)', async () => {
  const { app, fastify } = await build();
  try {
    const r = await fastify.inject({
      method: 'OPTIONS',
      url: '/api/v1/providers/active',
      headers: {
        origin: 'http://localhost:5914',
        'access-control-request-method': 'PUT',
        'access-control-request-headers': 'content-type,x-sinan-token',
      },
    });
    const allow = String(r.headers['access-control-allow-methods'] ?? '').toUpperCase();
    assert.ok(allow.includes('PUT'), `allow-methods 应含 PUT,实际:${allow}`);
    assert.ok(allow.includes('DELETE'), `allow-methods 应含 DELETE,实际:${allow}`);
    const allowH = String(r.headers['access-control-allow-headers'] ?? '').toLowerCase();
    assert.ok(allowH.includes('x-sinan-token'), `allow-headers 应含 x-sinan-token,实际:${allowH}`);
  } finally {
    await app.close();
  }
});

test('onboarding state machine + providers + credential red-line + provider test', async () => {
  const { app, fastify } = await build();
  try {
    let r = await fastify.inject({ method: 'GET', url: '/api/v1/onboarding/state' });
    assert.equal(r.statusCode, 200);
    assert.equal(r.json().done, false);
    assert.equal(r.json().step, 'welcome');

    r = await fastify.inject({ method: 'GET', url: '/api/v1/providers' });
    assert.equal(r.statusCode, 200);
    assert.equal(r.json().length, 4);

    // 写凭据:响应绝不含明文
    r = await fastify.inject({
      method: 'PUT',
      url: '/api/v1/providers/tushare/credential',
      payload: { token: TOKEN },
    });
    assert.equal(r.statusCode, 200);
    assert.ok(!r.body.includes(TOKEN), 'PUT response must not echo token');
    assert.ok(r.json().fingerprint);

    // 读凭据:configured + fingerprint,无 token
    r = await fastify.inject({ method: 'GET', url: '/api/v1/providers/tushare/credential' });
    assert.equal(r.json().configured, true);
    assert.ok(!r.body.includes(TOKEN));

    // 连通测试:经 fake engine,能力矩阵返回
    r = await fastify.inject({ method: 'POST', url: '/api/v1/providers/tushare/test' });
    assert.equal(r.statusCode, 201);
    assert.equal(r.json().status, 'ok');
    assert.equal(r.json().caps.NORTHBOUND, true);

    // provider 状态被更新
    r = await fastify.inject({ method: 'GET', url: '/api/v1/providers' });
    const tushare = r.json().find((p: any) => p.id === 'tushare');
    assert.equal(tushare.status, 'ok');

    // 完成引导
    r = await fastify.inject({ method: 'POST', url: '/api/v1/onboarding/complete' });
    assert.equal(r.statusCode, 201);
    assert.equal(r.json().done, true);
  } finally {
    await app.close();
  }
});

test('stocks/search: 无 token 诚实空;配置后按名/代码命中,响应不漏明文', async () => {
  const { app, fastify } = await build();
  try {
    let r = await fastify.inject({
      method: 'GET',
      url: `/api/v1/stocks/search?q=${encodeURIComponent('茅台')}`,
    });
    assert.equal(r.statusCode, 200);
    assert.deepEqual(r.json().stocks, []);

    await fastify.inject({
      method: 'PUT',
      url: '/api/v1/providers/tushare/credential',
      payload: { token: TOKEN },
    });

    r = await fastify.inject({
      method: 'GET',
      url: `/api/v1/stocks/search?q=${encodeURIComponent('茅台')}`,
    });
    assert.equal(r.statusCode, 200);
    assert.deepEqual(
      r.json().stocks.map((s: { code: string }) => s.code),
      ['600519.SH'],
    );
    r = await fastify.inject({ method: 'GET', url: '/api/v1/stocks/search?q=000858' });
    assert.deepEqual(
      r.json().stocks.map((s: { code: string }) => s.code),
      ['000858.SZ'],
    );
    assert.ok(!r.body.includes(TOKEN));
  } finally {
    await app.close();
  }
});

test('health reports db ok; create cache_build job', async () => {
  const { app, fastify } = await build();
  try {
    let r = await fastify.inject({ method: 'GET', url: '/api/v1/health' });
    assert.equal(r.statusCode, 200);
    assert.equal(r.json().db_ok, true);

    r = await fastify.inject({
      method: 'POST',
      url: '/api/v1/jobs',
      payload: {
        type: 'cache_build',
        trigger: 'onboarding',
        params: { universe: { codes: ['600519.SH'] }, datasets: ['price'] },
      },
    });
    assert.equal(r.statusCode, 201);
    assert.ok(r.json().id);

    r = await fastify.inject({ method: 'GET', url: '/api/v1/jobs' });
    assert.ok(r.json().length >= 1);
  } finally {
    await app.close();
  }
});
