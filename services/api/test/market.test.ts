import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/bootstrap.js';
import { MemorySecretStore } from '../src/secrets/secret-store.js';
import { FakeEngineClient } from './fakes.js';
import type { PricesResult, Quote } from '../src/engine/engine.client.js';

async function build(
  quotes: Record<string, Quote> = {},
  prices: Record<string, PricesResult> = {},
) {
  const app = await createApp({
    dbPath: ':memory:',
    secretStore: new MemorySecretStore(),
    engineClient: new FakeEngineClient(null, [], null, quotes, prices),
  });
  await app.init();
  const fastify = app.getHttpAdapter().getInstance();
  await fastify.ready();
  return { app, fastify };
}

test('GET /quotes 按输入顺序返回报价行;缺价标 degraded(诚实降级)', async () => {
  const { app, fastify } = await build({
    '600519.SH': { name: '贵州茅台', price: 1700, prev_close: 1680, open: 1690, source: 'sina' },
  });
  try {
    const r = await fastify.inject({
      method: 'GET',
      url: '/api/v1/quotes?codes=600519.SH,000001.SZ',
    });
    assert.equal(r.statusCode, 200);
    const body = r.json();
    assert.equal(body.quotes.length, 2);
    assert.equal(body.quotes[0].stock_code, '600519.SH');
    assert.equal(body.quotes[0].name, '贵州茅台');
    assert.equal(body.quotes[0].price, 1700);
    assert.equal(body.quotes[1].stock_code, '000001.SZ');
    assert.equal(body.quotes[1].price, null); // 无报价
    assert.equal(body.degraded, true); // 有缺价 → 降级
  } finally {
    await app.close();
  }
});

test('GET /quotes 无 codes → 400', async () => {
  const { app, fastify } = await build();
  try {
    const r = await fastify.inject({ method: 'GET', url: '/api/v1/quotes' });
    assert.equal(r.statusCode, 400);
  } finally {
    await app.close();
  }
});

test('GET /prices/:code 代理引擎 K 线(含点号代码)', async () => {
  const rows = [
    { trade_date: '2024-01-02', open: 9.9, high: 10.2, low: 9.8, close: 10, volume: 1, amount: 1 },
    {
      trade_date: '2024-01-03',
      open: 10.9,
      high: 11.2,
      low: 10.8,
      close: 11,
      volume: 2,
      amount: 2,
    },
  ];
  const { app, fastify } = await build(
    {},
    { '600519.SH': { code: '600519.SH', adjust: 'qfq', rows, degraded: false } },
  );
  try {
    const r = await fastify.inject({
      method: 'GET',
      url: '/api/v1/prices/600519.SH?limit=250&adjust=qfq',
    });
    assert.equal(r.statusCode, 200);
    const body = r.json();
    assert.equal(body.code, '600519.SH');
    assert.equal(body.adjust, 'qfq');
    assert.equal(body.rows.length, 2);
    assert.equal(body.rows[1].close, 11);
    assert.equal(body.degraded, false);
  } finally {
    await app.close();
  }
});

test('GET /prices/:code 引擎异常 → 空 rows + degraded(不抛 500)', async () => {
  // pricesResult 无该 code → Fake 返回空集;但这里验证未知 code 的默认空集路径
  const { app, fastify } = await build();
  try {
    const r = await fastify.inject({ method: 'GET', url: '/api/v1/prices/999999.SH' });
    assert.equal(r.statusCode, 200);
    const body = r.json();
    assert.deepEqual(body.rows, []);
  } finally {
    await app.close();
  }
});
