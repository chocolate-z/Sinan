import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/bootstrap.js';
import { MemorySecretStore } from '../src/secrets/secret-store.js';
import { FakeEngineClient } from './fakes.js';

const PAPER_RESULT = {
  trade_date: '2024-01-25',
  effective_date: '2024-01-26',
  market_open: true,
  coverage: 1.0,
  degraded: [],
  benchmark_pct: 0.002,
  signals: [
    {
      stock_code: '600519.SH',
      action: 'buy',
      score: 1.5,
      reason: 'signal',
      blocked: false,
      factor_breakdown: { ep: 0.5, roe: 0.9 },
    },
    {
      stock_code: '000001.SZ',
      action: 'buy',
      score: 1.2,
      reason: 'rank_out',
      blocked: true,
      factor_breakdown: {},
    },
  ],
  trades: [
    {
      code: '600519.SH',
      side: 'buy',
      shares: 100,
      price: 20,
      amount: 2000,
      commission: 5,
      stamp_tax: 0,
      transfer_fee: 0.02,
      impact: 1,
      reason: 'signal',
      trade_date: '2024-01-26',
    },
  ],
  positions: [
    {
      code: '600519.SH',
      shares: 100,
      avg_cost: 20.06,
      open_date: '2024-01-26',
      last_buy_date: '2024-01-26',
    },
  ],
  account: { cash: 997994, market_value: 2000, nav: 999994, daily_return: -0.000006, drawdown: 0 },
};

async function build(paperResult: any = PAPER_RESULT) {
  const app = await createApp({
    dbPath: ':memory:',
    secretStore: new MemorySecretStore(),
    engineClient: new FakeEngineClient(null, [], paperResult),
  });
  await app.init();
  const fastify = app.getHttpAdapter().getInstance();
  await fastify.ready();
  return { app, fastify };
}

test('paper/run persists signals(+blocked)/trades/model holdings/daily_pnl and queryable', async () => {
  const { app, fastify } = await build();
  try {
    let r = await fastify.inject({
      method: 'POST',
      url: '/api/v1/paper/run',
      payload: { today: '2024-01-25', effective_date: '2024-01-26' },
    });
    assert.equal(r.statusCode, 201);

    // 信号(含被拦截组)
    r = await fastify.inject({ method: 'GET', url: '/api/v1/signals?date=2024-01-25' });
    const sigs = r.json();
    assert.equal(sigs.length, 2);
    assert.equal(sigs.filter((s: any) => s.blocked).length, 1);
    const buy = sigs.find((s: any) => s.stock_code === '600519.SH');
    assert.deepEqual(buy.factor_breakdown, { ep: 0.5, roe: 0.9 });

    // 模型持仓
    r = await fastify.inject({ method: 'GET', url: '/api/v1/portfolios/model/holdings' });
    assert.equal(r.json().length, 1);
    assert.equal(r.json()[0].stock_code, '600519.SH');

    // 成交(含成本明细)
    r = await fastify.inject({ method: 'GET', url: '/api/v1/trades?portfolio=model' });
    assert.equal(r.json().length, 1);
    assert.equal(r.json()[0].commission, 5);

    // 当日收益(模型)
    r = await fastify.inject({ method: 'GET', url: '/api/v1/pnl/daily?portfolio=model' });
    assert.equal(r.json().length, 1);
    assert.equal(r.json()[0].trade_date, '2024-01-25');
    assert.equal(r.json()[0].benchmark_pct, 0.002);
  } finally {
    await app.close();
  }
});

test('signals/generate persists signals only (no trades), and personal holdings CRUD separate', async () => {
  const { app, fastify } = await build();
  try {
    let r = await fastify.inject({
      method: 'POST',
      url: '/api/v1/signals/generate',
      payload: { today: '2024-01-25', effective_date: '2024-01-26' },
    });
    assert.equal(r.statusCode, 201);
    assert.equal(r.json().signals.length, 2);
    // 未撮合 → 模型无成交
    r = await fastify.inject({ method: 'GET', url: '/api/v1/trades?portfolio=model' });
    assert.equal(r.json().length, 0);

    // 个人持仓(手动,与模型物理分账)
    r = await fastify.inject({
      method: 'POST',
      url: '/api/v1/portfolios/personal/holdings',
      payload: { stock_code: '000333.SZ', stock_name: '美的集团', shares: 200, avg_cost: 50 },
    });
    assert.equal(r.statusCode, 201);
    assert.equal(r.json().length, 1);

    r = await fastify.inject({ method: 'GET', url: '/api/v1/portfolios/personal/holdings' });
    assert.equal(r.json()[0].stock_code, '000333.SZ');

    r = await fastify.inject({
      method: 'DELETE',
      url: '/api/v1/portfolios/personal/holdings/000333.SZ',
    });
    assert.equal(r.json().length, 0);
  } finally {
    await app.close();
  }
});

test('个人持仓 加/减仓:移动加权成本 + 减到 0 清仓 + 入参校验', async () => {
  const { app, fastify } = await build();
  try {
    const post = (payload: any) =>
      fastify.inject({ method: 'POST', url: '/api/v1/portfolios/personal/holdings', payload });
    const first = async () =>
      (
        await fastify.inject({ method: 'GET', url: '/api/v1/portfolios/personal/holdings' })
      ).json()[0];

    // 建仓 100 @ 10
    await post({
      stock_code: '600519.SH',
      stock_name: '贵州茅台',
      shares: 100,
      price: 10,
      op: 'add',
    });
    let h = await first();
    assert.equal(h.shares, 100);
    assert.equal(h.avg_cost, 10);

    // 加仓 100 @ 20 → 移动加权均价 (100×10 + 100×20)/200 = 15
    await post({ stock_code: '600519.SH', shares: 100, price: 20, op: 'add' });
    h = await first();
    assert.equal(h.shares, 200);
    assert.equal(h.avg_cost, 15);

    // 减仓 50 → 150 股,均价不变(15)
    await post({ stock_code: '600519.SH', shares: 50, price: 18, op: 'reduce' });
    h = await first();
    assert.equal(h.shares, 150);
    assert.equal(h.avg_cost, 15);

    // 减仓 150(≥剩余)→ 清仓删除
    const r = await post({ stock_code: '600519.SH', shares: 150, op: 'reduce' });
    assert.equal(r.json().length, 0);

    // 校验:非法 op / shares≤0 / 加仓缺价 → 400
    assert.equal((await post({ stock_code: 'X', shares: 1, price: 1, op: 'x' })).statusCode, 400);
    assert.equal((await post({ stock_code: 'X', shares: 0, price: 1, op: 'add' })).statusCode, 400);
    assert.equal((await post({ stock_code: 'X', shares: 1, op: 'add' })).statusCode, 400);
  } finally {
    await app.close();
  }
});

test('bad portfolio / missing dates rejected', async () => {
  const { app, fastify } = await build();
  try {
    let r = await fastify.inject({ method: 'GET', url: '/api/v1/trades?portfolio=bogus' });
    assert.equal(r.statusCode, 400);
    r = await fastify.inject({ method: 'POST', url: '/api/v1/paper/run', payload: {} });
    assert.equal(r.statusCode, 400);
  } finally {
    await app.close();
  }
});

test('pnl/today 实时当日收益 = Σ 持仓 × (现价 − 昨收)', async () => {
  const engine = new FakeEngineClient(null, [], PAPER_RESULT, {
    '600519.SH': { price: 21, prev_close: 20 },
  });
  const app = await createApp({
    dbPath: ':memory:',
    secretStore: new MemorySecretStore(),
    engineClient: engine,
  });
  await app.init();
  const fastify = app.getHttpAdapter().getInstance();
  await fastify.ready();
  try {
    // 先跑一轮建立模型持仓(600519.SH 100 股)
    await fastify.inject({
      method: 'POST',
      url: '/api/v1/paper/run',
      payload: { today: '2024-01-25', effective_date: '2024-01-26' },
    });
    const r = await fastify.inject({ method: 'GET', url: '/api/v1/pnl/today?portfolio=model' });
    assert.equal(r.statusCode, 200);
    const body = r.json();
    assert.equal(body.day_pnl, 100); // 100 × (21 − 20)
    assert.equal(body.market_value, 2100); // 100 × 21
    assert.equal(body.degraded, false);
  } finally {
    await app.close();
  }
});
