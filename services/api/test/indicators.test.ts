import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/bootstrap.js';
import { MemorySecretStore } from '../src/secrets/secret-store.js';
import { FakeEngineClient } from './fakes.js';

async function build(qualityResult: any) {
  const engine = new FakeEngineClient(null, [], null, {}, {}, null, null, qualityResult);
  const app = await createApp({
    dbPath: ':memory:',
    secretStore: new MemorySecretStore(),
    engineClient: engine,
  });
  await app.init();
  const fastify = app.getHttpAdapter().getInstance();
  await fastify.ready();
  return { app, fastify, engine };
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

test('自定义因子 CRUD:创建前经沙箱校验,落库/列表/删除;非法表达式拒绝', async () => {
  const { app, fastify } = await build(null);
  try {
    // 合法表达式(fake validate: 不含 __ → ok)→ 落库
    let r = await fastify.inject({
      method: 'POST',
      url: '/api/v1/custom-factors',
      payload: { name: 'my_mom', expr: 'close / delay(close, 20) - 1' },
    });
    assert.equal(r.statusCode, 201);
    const created = r.json();
    assert.ok(created.id);

    // 列表
    r = await fastify.inject({ method: 'GET', url: '/api/v1/custom-factors' });
    const list = r.json();
    assert.equal(list.length, 1);
    assert.equal(list[0].name, 'my_mom');
    assert.equal(list[0].enabled, true);

    // 非法表达式(含 __ → fake validate ok=false)→ 400,绝不落库
    r = await fastify.inject({
      method: 'POST',
      url: '/api/v1/custom-factors',
      payload: { name: 'evil', expr: "__import__('os')" },
    });
    assert.equal(r.statusCode, 400);

    // name/expr 必填 → 400
    r = await fastify.inject({
      method: 'POST',
      url: '/api/v1/custom-factors',
      payload: { name: 'x' },
    });
    assert.equal(r.statusCode, 400);

    // 删除
    r = await fastify.inject({ method: 'DELETE', url: `/api/v1/custom-factors/${created.id}` });
    assert.equal(r.statusCode, 200);
    r = await fastify.inject({ method: 'GET', url: '/api/v1/custom-factors' });
    assert.equal(r.json().length, 0);
    // 删除不存在 → 404
    r = await fastify.inject({ method: 'DELETE', url: '/api/v1/custom-factors/nope' });
    assert.equal(r.statusCode, 404);
  } finally {
    await app.close();
  }
});

test('自定义因子权重:创建带 weight、更新权重/启用、非法 400、下发引擎(实盘/回测口径)带 weight', async () => {
  const { app, fastify, engine } = await build(null);
  try {
    // 创建带 weight
    let r = await fastify.inject({
      method: 'POST',
      url: '/api/v1/custom-factors',
      payload: { name: 'wf', expr: 'close / delay(close, 5) - 1', weight: 2.5 },
    });
    assert.equal(r.statusCode, 201);
    const id = r.json().id;
    assert.equal(r.json().weight, 2.5);

    // 列表含 weight
    r = await fastify.inject({ method: 'GET', url: '/api/v1/custom-factors' });
    assert.equal(r.json()[0].weight, 2.5);

    // 更新权重
    r = await fastify.inject({
      method: 'PUT',
      url: `/api/v1/custom-factors/${id}`,
      payload: { weight: 0.5 },
    });
    assert.equal(r.statusCode, 200);
    r = await fastify.inject({ method: 'GET', url: '/api/v1/custom-factors' });
    assert.equal(r.json()[0].weight, 0.5);

    // 下发引擎:paper/run 的 custom 带 weight(权重贯穿实盘选股口径)
    await fastify.inject({
      method: 'POST',
      url: '/api/v1/paper/run',
      payload: { today: '2024-07-01', effective_date: '2024-07-02' },
    });
    const sent = (engine.lastPaperReq?.custom ?? []) as Array<{ name: string; weight?: number }>;
    const wf = sent.find((c) => c.name === 'wf');
    assert.equal(wf?.weight, 0.5);

    // 禁用 → 不再下发
    r = await fastify.inject({
      method: 'PUT',
      url: `/api/v1/custom-factors/${id}`,
      payload: { enabled: false },
    });
    assert.equal(r.statusCode, 200);
    await fastify.inject({
      method: 'POST',
      url: '/api/v1/paper/run',
      payload: { today: '2024-07-03', effective_date: '2024-07-04' },
    });
    const sent2 = (engine.lastPaperReq?.custom ?? []) as Array<{ name: string }>;
    assert.ok(!sent2.some((c) => c.name === 'wf'));

    // 非法 weight(负)→ 400,绝不落库
    r = await fastify.inject({
      method: 'POST',
      url: '/api/v1/custom-factors',
      payload: { name: 'bad', expr: 'close', weight: -1 },
    });
    assert.equal(r.statusCode, 400);
    // 更新非法 weight → 400
    r = await fastify.inject({
      method: 'PUT',
      url: `/api/v1/custom-factors/${id}`,
      payload: { weight: 'x' },
    });
    assert.equal(r.statusCode, 400);
    // 更新不存在 → 404
    r = await fastify.inject({
      method: 'PUT',
      url: '/api/v1/custom-factors/nope',
      payload: { weight: 1 },
    });
    assert.equal(r.statusCode, 404);
  } finally {
    await app.close();
  }
});

test('POST /indicators/validate 代理 DSL 校验(ok / errors / fields / functions)', async () => {
  const { app, fastify } = await build(null);
  try {
    let r = await fastify.inject({
      method: 'POST',
      url: '/api/v1/indicators/validate',
      payload: { expr: 'zscore(-pe_ttm) + rank(roe)' },
    });
    assert.equal(r.statusCode, 201);
    let body = r.json();
    assert.equal(body.ok, true);
    assert.ok(body.functions.includes('zscore'));

    // 不安全表达式 → ok=false + errors
    r = await fastify.inject({
      method: 'POST',
      url: '/api/v1/indicators/validate',
      payload: { expr: "__import__('os')" },
    });
    body = r.json();
    assert.equal(body.ok, false);
    assert.ok(body.errors.length >= 1);

    // expr 必填 → 400
    r = await fastify.inject({ method: 'POST', url: '/api/v1/indicators/validate', payload: {} });
    assert.equal(r.statusCode, 400);
  } finally {
    await app.close();
  }
});
