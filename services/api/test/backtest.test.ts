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
    {
      date: '2024-02-01',
      nav: 1_000_000,
      cash: 1_000_000,
      holding_value: 0,
      benchmark: 1_000_000,
      day_return: 0,
      drawdown: 0,
      positions: [],
    },
    {
      date: '2024-02-02',
      nav: 1_001_000,
      cash: 600_000,
      holding_value: 401_000,
      benchmark: 1_000_500,
      day_return: 0.001,
      drawdown: 0,
      positions: [{ code: '600519.SH', shares: 100, avg_cost: 4000, value: 401_000 }],
    },
  ],
  trades: [
    {
      trade_date: '2024-02-02',
      code: '600519.SH',
      side: 'buy',
      shares: 100,
      price: 4000,
      amount: 400_000,
      fee_total: 100,
      reason: 'signal',
    },
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
  return { app, fastify, engine };
}

// 训练结果(含模型系数 + 训练截止),供「回测用模型」用例训练/激活模型。
const TRAIN = {
  model_type: 'elasticnet',
  train_start: '2023-01-01',
  train_end: '2024-06-30',
  label_horizon: 5,
  purge: 5,
  embargo: 0,
  n_folds: 4,
  n_samples: 480,
  feature_cols: ['f_ep', 'f_bp', 'f_roe', 'f_mom20'],
  ic_is: 0.11,
  ic_oos: 0.064,
  icir_is: 0.85,
  icir_oos: 0.42,
  layered_sharpe_oos: 0.73,
  layered_annual_return_oos: 0.058,
  top_quantile: 0.2,
  feature_importance: [{ feature: 'f_mom20', weight: 0.55 }],
  fold_metrics: [{ index: 0, n_train: 120, n_test: 60, ic_oos: 0.07 }],
  model: {
    type: 'elasticnet',
    feature_cols: ['f_ep', 'f_bp', 'f_roe', 'f_mom20'],
    coef: [0.01, 0.0, 0.02, 0.05],
    intercept: 0.001,
  },
  degraded: [],
  oos_clean: true,
  metrics_note: '分层口径,非完整回测。',
};

/** engine 同时具备训练(TRAIN)与回测回显(backtestResult=null → 按 req 回显 scoring/train_end)。 */
function buildWithTrain() {
  return build(new FakeEngineClient(null, [], null, {}, {}, null, TRAIN));
}

async function trainAndActivate(fastify: any): Promise<string> {
  const created = (
    await fastify.inject({
      method: 'POST',
      url: '/api/v1/models/train',
      payload: { train_start: '2023-01-01', train_end: '2024-06-30' },
    })
  ).json();
  await fastify.inject({ method: 'POST', url: `/api/v1/models/${created.id}/activate` });
  return created.id;
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

    // 详情(含 nav_curve 逐日明细 + 逐笔成交,可回溯)
    r = await fastify.inject({ method: 'GET', url: `/api/v1/backtests/${created.id}` });
    const got = r.json();
    assert.equal(got.nav_curve.length, 2);
    assert.equal(got.metrics.excess_return, 0.03);
    assert.equal(got.benchmark, '000300.SH');
    // 逐笔成交(买卖点)落库可回溯
    assert.equal(got.trades.length, 1);
    assert.equal(got.trades[0].side, 'buy');
    assert.equal(got.trades[0].code, '600519.SH');
    // 逐日明细:资产拆解 + 持仓快照
    assert.equal(got.nav_curve[1].cash, 600_000);
    assert.equal(got.nav_curve[1].positions[0].code, '600519.SH');
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

// ── 口径与实盘一致:回测用激活模型 / 指定版本 / 自定义因子 / 等权;红线#2 诚实 train_end ─────
test('回测 auto:有激活模型则下发模型系数,train_end 抬到不早于模型训练截止(红线#2)', async () => {
  const { app, fastify, engine } = await buildWithTrain();
  try {
    const modelId = await trainAndActivate(fastify);
    const r = await fastify.inject({
      method: 'POST',
      url: '/api/v1/backtests',
      payload: {
        backtest_start: '2024-08-01',
        backtest_end: '2024-09-01',
        train_end: '2024-05-01', // 故意早于模型训练截止 2024-06-30
      },
    });
    assert.equal(r.statusCode, 201);
    const created = r.json();
    assert.deepEqual(engine.lastBacktestReq?.model, TRAIN.model); // 下发激活模型系数
    assert.equal(engine.lastBacktestReq?.train_end, '2024-06-30'); // 抬升:绝不踩进训练窗口
    assert.equal(created.scoring, 'model');
    assert.equal(created.model_id, modelId); // 出处可溯源
    assert.equal(created.train_end, '2024-06-30');
  } finally {
    await app.close();
  }
});

test('回测 auto:用户 train_end 晚于模型训练截止时取更保守的用户值(max)', async () => {
  const { app, fastify, engine } = await buildWithTrain();
  try {
    await trainAndActivate(fastify);
    await fastify.inject({
      method: 'POST',
      url: '/api/v1/backtests',
      payload: {
        backtest_start: '2024-10-01',
        backtest_end: '2024-11-01',
        train_end: '2024-09-01',
      },
    });
    assert.equal(engine.lastBacktestReq?.train_end, '2024-09-01'); // max(模型 2024-06-30, 用户 2024-09-01)
  } finally {
    await app.close();
  }
});

test('回测 model_id:可回测未激活的模型版本(先回测再激活),train_end derive 自该模型', async () => {
  const { app, fastify, engine } = await buildWithTrain();
  try {
    const created = (
      await fastify.inject({
        method: 'POST',
        url: '/api/v1/models/train',
        payload: { train_start: '2023-01-01', train_end: '2024-06-30' },
      })
    ).json(); // draft,未激活
    const r = await fastify.inject({
      method: 'POST',
      url: '/api/v1/backtests',
      payload: { backtest_start: '2024-08-01', backtest_end: '2024-09-01', model_id: created.id }, // 不给 train_end
    });
    assert.equal(r.statusCode, 201);
    assert.deepEqual(engine.lastBacktestReq?.model, TRAIN.model);
    assert.equal(engine.lastBacktestReq?.train_end, '2024-06-30'); // derive 自模型训练截止
    assert.equal(r.json().scoring, 'model');
    assert.equal(r.json().model_id, created.id);
  } finally {
    await app.close();
  }
});

test('回测 auto:无激活模型则下发启用的自定义因子(scoring=custom)', async () => {
  const { app, fastify, engine } = await buildWithTrain();
  try {
    await fastify.inject({
      method: 'POST',
      url: '/api/v1/custom-factors',
      payload: { name: 'cf1', expr: 'close / delay(close, 10) - 1' },
    });
    const r = await fastify.inject({
      method: 'POST',
      url: '/api/v1/backtests',
      payload: {
        backtest_start: '2024-08-01',
        backtest_end: '2024-09-01',
        train_end: '2024-05-01',
      },
    });
    assert.equal(r.statusCode, 201);
    assert.equal(engine.lastBacktestReq?.model ?? null, null);
    const custom = (engine.lastBacktestReq?.custom ?? []) as Array<{ name: string }>;
    assert.ok(custom.some((c) => c.name === 'cf1'));
    assert.equal(r.json().scoring, 'custom');
    assert.equal(r.json().model_id, null);
    assert.equal(engine.lastBacktestReq?.train_end, '2024-05-01'); // 无模型 → 用户值原样
  } finally {
    await app.close();
  }
});

test('回测 scoring=equal_weight:即便有激活模型也强制纯等权基线(A/B 对照)', async () => {
  const { app, fastify, engine } = await buildWithTrain();
  try {
    await trainAndActivate(fastify);
    await fastify.inject({
      method: 'POST',
      url: '/api/v1/custom-factors',
      payload: { name: 'cf1', expr: 'close / delay(close, 10) - 1' },
    });
    const r = await fastify.inject({
      method: 'POST',
      url: '/api/v1/backtests',
      payload: {
        backtest_start: '2024-08-01',
        backtest_end: '2024-09-01',
        train_end: '2024-05-01',
        scoring: 'equal_weight',
      },
    });
    assert.equal(r.statusCode, 201);
    assert.equal(engine.lastBacktestReq?.model ?? null, null); // 不下发模型
    assert.equal(engine.lastBacktestReq?.custom ?? null, null); // 也不下发自定义因子
    assert.equal(r.json().scoring, 'equal_weight');
    assert.equal(r.json().model_id, null);
  } finally {
    await app.close();
  }
});

test('回测 scoring=model 但无激活模型 → 400', async () => {
  const { app, fastify } = await buildWithTrain();
  try {
    const r = await fastify.inject({
      method: 'POST',
      url: '/api/v1/backtests',
      payload: {
        backtest_start: '2024-08-01',
        backtest_end: '2024-09-01',
        train_end: '2024-05-01',
        scoring: 'model',
      },
    });
    assert.equal(r.statusCode, 400);
  } finally {
    await app.close();
  }
});

test('回测 model_id 不存在 → 404', async () => {
  const { app, fastify } = await buildWithTrain();
  try {
    const r = await fastify.inject({
      method: 'POST',
      url: '/api/v1/backtests',
      payload: { backtest_start: '2024-08-01', backtest_end: '2024-09-01', model_id: 'nope' },
    });
    assert.equal(r.statusCode, 404);
  } finally {
    await app.close();
  }
});

test('回测 无模型且缺 train_end → 400(需声明样本外边界)', async () => {
  const { app, fastify } = await buildWithTrain();
  try {
    const r = await fastify.inject({
      method: 'POST',
      url: '/api/v1/backtests',
      payload: { backtest_start: '2024-08-01', backtest_end: '2024-09-01' },
    });
    assert.equal(r.statusCode, 400);
  } finally {
    await app.close();
  }
});

test('回测 scoring 非法值 → 400', async () => {
  const { app, fastify } = await buildWithTrain();
  try {
    const r = await fastify.inject({
      method: 'POST',
      url: '/api/v1/backtests',
      payload: {
        backtest_start: '2024-08-01',
        backtest_end: '2024-09-01',
        train_end: '2024-05-01',
        scoring: 'bogus',
      },
    });
    assert.equal(r.statusCode, 400);
  } finally {
    await app.close();
  }
});

test('回测 非 ISO 日期 → 400(红线#2 纵深:守卫的字典序==日期序依赖规范格式)', async () => {
  const { app, fastify } = await buildWithTrain();
  try {
    // train_end 缺 leading zero('2024-6-30')会让 train_end 抬升的字符串比较失真 → 入口即拒。
    let r = await fastify.inject({
      method: 'POST',
      url: '/api/v1/backtests',
      payload: { backtest_start: '2024-08-01', backtest_end: '2024-09-01', train_end: '2024-6-30' },
    });
    assert.equal(r.statusCode, 400);
    // backtest_start 非 ISO(YYYYMMDD)同样拒。
    r = await fastify.inject({
      method: 'POST',
      url: '/api/v1/backtests',
      payload: { backtest_start: '20240801', backtest_end: '2024-09-01', train_end: '2024-05-01' },
    });
    assert.equal(r.statusCode, 400);
  } finally {
    await app.close();
  }
});
