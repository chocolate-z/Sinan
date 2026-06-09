import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/bootstrap.js';
import { MemorySecretStore } from '../src/secrets/secret-store.js';
import { FakeEngineClient } from './fakes.js';

const RESULT = {
  backtest_start: '2024-02-01',
  backtest_end: '2024-03-01',
  train_end: '2024-01-10',
  purge: 5,
  benchmark: '000300.SH',
  initial_cash: 1_000_000,
  n_days: 20,
  n_trades: 5,
  total_cost: 123.45,
  cost_included: true,
  nav_curve: [
    { date: '2024-02-01', nav: 1_000_000, benchmark: 1_000_000 },
    { date: '2024-02-02', nav: 1_001_000, benchmark: 1_000_500 },
  ],
  metrics: { annual_return: 0.12, excess_return: 0.03, information_ratio: 0.6, max_drawdown: 0.08 },
  degraded: [],
};

async function build(engine: FakeEngineClient) {
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

test('POST /backtests 落库,GET 列表/详情可查(含 nav_curve + metrics)', async () => {
  const { app, fastify } = await build(new FakeEngineClient(null, [], null, {}, {}, RESULT));
  try {
    let r = await fastify.inject({
      method: 'POST',
      url: '/api/v1/backtests',
      payload: {
        backtest_start: '2024-02-01',
        backtest_end: '2024-03-01',
        train_end: '2024-01-10',
      },
    });
    assert.equal(r.statusCode, 201);
    const created = r.json();
    assert.ok(created.id);
    assert.equal(created.cost_included, true);
    assert.equal(created.metrics.information_ratio, 0.6);

    // 列表(轻量,不含 nav_curve)
    r = await fastify.inject({ method: 'GET', url: '/api/v1/backtests' });
    assert.equal(r.json().length, 1);
    assert.equal(r.json()[0].n_days, 20);
    assert.equal(r.json()[0].cost_included, true);

    // 详情(含 nav_curve)
    r = await fastify.inject({ method: 'GET', url: `/api/v1/backtests/${created.id}` });
    const got = r.json();
    assert.equal(got.nav_curve.length, 2);
    assert.equal(got.metrics.excess_return, 0.03);
    assert.equal(got.benchmark, '000300.SH');
  } finally {
    await app.close();
  }
});

test('POST /backtests 必填校验 400', async () => {
  const { app, fastify } = await build(new FakeEngineClient(null, [], null, {}, {}, RESULT));
  try {
    const r = await fastify.inject({ method: 'POST', url: '/api/v1/backtests', payload: {} });
    assert.equal(r.statusCode, 400);
  } finally {
    await app.close();
  }
});

test('engine 守卫违反 → api 转发 422(非诚实样本外被拒,不静默)', async () => {
  const engine = new FakeEngineClient(
    null,
    [],
    null,
    {},
    {},
    {
      __error: { status: 422, detail: 'backtest_start 必须晚于 train_end + purge' },
    },
  );
  const { app, fastify } = await build(engine);
  try {
    const r = await fastify.inject({
      method: 'POST',
      url: '/api/v1/backtests',
      payload: {
        backtest_start: '2024-01-11',
        backtest_end: '2024-02-01',
        train_end: '2024-01-10',
      },
    });
    assert.equal(r.statusCode, 422);
  } finally {
    await app.close();
  }
});

test('GET /backtests/:id 不存在 → 404', async () => {
  const { app, fastify } = await build(new FakeEngineClient(null, [], null, {}, {}, RESULT));
  try {
    const r = await fastify.inject({ method: 'GET', url: '/api/v1/backtests/nope' });
    assert.equal(r.statusCode, 404);
  } finally {
    await app.close();
  }
});
