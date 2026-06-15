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

test('保存的公式 CRUD:保存前校验、列表/更新/删除;非法/缺名拒绝', async () => {
  const { app, fastify } = await build();
  try {
    // 合法公式(fake validate: 非负 REF → ok)→ 保存
    let r = await fastify.inject({
      method: 'POST',
      url: '/api/v1/tdx/formulas',
      payload: { name: '我的建仓', src: '建仓: CROSS(CLOSE, MA(CLOSE,5));', signal: '建仓' },
    });
    assert.equal(r.statusCode, 201);
    const id = r.json().id;
    assert.ok(id);

    // 列表
    r = await fastify.inject({ method: 'GET', url: '/api/v1/tdx/formulas' });
    assert.equal(r.json().length, 1);
    assert.equal(r.json()[0].name, '我的建仓');

    // 非法公式(fake: 含负 REF → ok=false)→ 400,不落库
    r = await fastify.inject({
      method: 'POST',
      url: '/api/v1/tdx/formulas',
      payload: { name: 'bad', src: 'X: REF(CLOSE, -1);' },
    });
    assert.equal(r.statusCode, 400);

    // 缺名 → 400
    r = await fastify.inject({
      method: 'POST',
      url: '/api/v1/tdx/formulas',
      payload: { src: '建仓: CROSS(CLOSE, 10);' },
    });
    assert.equal(r.statusCode, 400);

    // 更新
    r = await fastify.inject({
      method: 'PUT',
      url: `/api/v1/tdx/formulas/${id}`,
      payload: { name: '改名了' },
    });
    assert.equal(r.statusCode, 200);
    r = await fastify.inject({ method: 'GET', url: '/api/v1/tdx/formulas' });
    assert.equal(r.json()[0].name, '改名了');

    // 删除 + 删不存在 404
    r = await fastify.inject({ method: 'DELETE', url: `/api/v1/tdx/formulas/${id}` });
    assert.equal(r.statusCode, 200);
    r = await fastify.inject({ method: 'DELETE', url: '/api/v1/tdx/formulas/nope' });
    assert.equal(r.statusCode, 404);
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
