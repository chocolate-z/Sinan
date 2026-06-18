import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/bootstrap.js';
import { MemorySecretStore } from '../src/secrets/secret-store.js';
import { JobBus } from '../src/modules/jobs.js';
import { FakeEngineClient } from './fakes.js';

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
  feature_importance: [
    { feature: 'f_mom20', weight: 0.55 },
    { feature: 'f_roe', weight: 0.25 },
  ],
  fold_metrics: [{ index: 0, n_train: 120, n_test: 60, ic_oos: 0.07 }],
  model: {
    type: 'elasticnet',
    feature_cols: ['f_ep', 'f_bp', 'f_roe', 'f_mom20'],
    coef: [0.01, 0.0, 0.02, 0.05],
    intercept: 0.001,
  },
  degraded: ['north_chg5:380/380 天降级(数据缺失)'],
  oos_clean: true,
  metrics_note: '样本外 IC/ICIR 为逐日 RankIC;夏普/年化为分层口径,非完整回测。',
};

async function build(trainResult: any) {
  const engine = new FakeEngineClient(null, [], null, {}, {}, null, trainResult);
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

test('POST /models/train 落库,GET 列表/详情含样本内外 IC + 系数模型 + 诚实标注', async () => {
  const { app, fastify } = await build(TRAIN);
  try {
    let r = await fastify.inject({
      method: 'POST',
      url: '/api/v1/models/train',
      payload: { train_start: '2023-01-01', train_end: '2024-06-30', label_horizon: 5, purge: 5 },
    });
    assert.equal(r.statusCode, 201);
    const created = r.json();
    assert.ok(created.id);
    assert.equal(created.ic_oos, 0.064);
    assert.equal(created.model.type, 'elasticnet');

    // 列表(轻量:样本内外 IC 摘要 + 状态)
    r = await fastify.inject({ method: 'GET', url: '/api/v1/models' });
    const list = r.json();
    assert.equal(list.length, 1);
    assert.equal(list[0].status, 'draft');
    assert.equal(list[0].ic_is, 0.11);
    assert.equal(list[0].ic_oos, 0.064);
    assert.equal(list[0].oos_clean, true);

    // 详情(含系数模型 + 因子重要度 + 诚实口径标注 + 降级)
    r = await fastify.inject({ method: 'GET', url: `/api/v1/models/${created.id}` });
    const got = r.json();
    assert.equal(got.feature_importance[0].feature, 'f_mom20');
    assert.equal(got.model.coef.length, 4);
    assert.match(got.metrics_note, /分层口径/);
    assert.equal(got.degraded.length, 1);
    assert.equal(got.icir_oos, 0.42);

    // 可观测性:训练写入统一日志(开始 + 完成)
    r = await fastify.inject({ method: 'GET', url: '/api/v1/logs' });
    const msgs = r.json().map((l: { message: string }) => l.message);
    assert.ok(msgs.some((m: string) => m.includes('模型训练开始')));
    assert.ok(msgs.some((m: string) => m.includes('模型训练完成')));
  } finally {
    await app.close();
  }
});

test('POST /models/:id/activate 置为 running', async () => {
  const { app, fastify } = await build(TRAIN);
  try {
    const created = (
      await fastify.inject({
        method: 'POST',
        url: '/api/v1/models/train',
        payload: { train_start: '2023-01-01', train_end: '2024-06-30' },
      })
    ).json();
    const r = await fastify.inject({
      method: 'POST',
      url: `/api/v1/models/${created.id}/activate`,
    });
    assert.equal(r.statusCode, 201);
    assert.equal(r.json().status, 'running');
    // 列表里该版本为 running
    const list = (await fastify.inject({ method: 'GET', url: '/api/v1/models' })).json();
    assert.equal(list[0].status, 'running');
  } finally {
    await app.close();
  }
});

test('DELETE /models/:id 删版本;删生产模型清掉策略 active 引用;不存在 → 404', async () => {
  const { app, fastify } = await build(TRAIN);
  try {
    const created = (
      await fastify.inject({
        method: 'POST',
        url: '/api/v1/models/train',
        payload: { train_start: '2023-01-01', train_end: '2024-06-30' },
      })
    ).json();
    // 先激活成生产模型,再删 —— 应顺手清掉策略 active 引用,不留悬挂
    await fastify.inject({ method: 'POST', url: `/api/v1/models/${created.id}/activate` });
    const del = await fastify.inject({ method: 'DELETE', url: `/api/v1/models/${created.id}` });
    assert.equal(del.statusCode, 200);
    assert.equal(del.json().ok, true);
    // 版本库清空
    const list = (await fastify.inject({ method: 'GET', url: '/api/v1/models' })).json();
    assert.equal(list.length, 0);
    // 再删一次 → 404
    const again = await fastify.inject({ method: 'DELETE', url: `/api/v1/models/${created.id}` });
    assert.equal(again.statusCode, 404);
  } finally {
    await app.close();
  }
});

test('POST /models/train 必填校验 400', async () => {
  const { app, fastify } = await build(TRAIN);
  try {
    const r = await fastify.inject({ method: 'POST', url: '/api/v1/models/train', payload: {} });
    assert.equal(r.statusCode, 400);
  } finally {
    await app.close();
  }
});

test('engine 守卫违反(purge<label_horizon) → api 转发 422', async () => {
  const { app, fastify } = await build({
    __error: { status: 422, detail: 'purge=1 必须 >= label_horizon=5' },
  });
  try {
    const r = await fastify.inject({
      method: 'POST',
      url: '/api/v1/models/train',
      payload: { train_start: '2023-01-01', train_end: '2024-06-30', label_horizon: 5, purge: 1 },
    });
    assert.equal(r.statusCode, 422);
  } finally {
    await app.close();
  }
});

test('GET /models/:id 不存在 → 404', async () => {
  const { app, fastify } = await build(TRAIN);
  try {
    const r = await fastify.inject({ method: 'GET', url: '/api/v1/models/nope' });
    assert.equal(r.statusCode, 404);
  } finally {
    await app.close();
  }
});

test('训练把 engine 流式进度按 progress_id 广播到 JobBus(确定式进度条 + ETA 数据源)', async () => {
  const { app, fastify } = await build(TRAIN);
  try {
    const bus = app.get(JobBus);
    const pid = 'prog-train-1';
    const got: any[] = [];
    const sub = bus.observable(pid).subscribe((ev) => got.push(ev));
    const r = await fastify.inject({
      method: 'POST',
      url: '/api/v1/models/train',
      payload: { train_start: '2023-01-01', train_end: '2024-06-30', progress_id: pid },
    });
    sub.unsubscribe();
    assert.equal(r.statusCode, 201);
    // 特征面板 done/total 是进度条 + ETA 的真实数据源
    assert.ok(
      got.some((e) => e.stage === 'features' && e.total > 0),
      '应按 progress_id 广播特征面板进度事件',
    );
  } finally {
    await app.close();
  }
});

test('激活模型后 paper/run 下发模型系数(模型出信号);无激活模型时下发 null', async () => {
  const { app, fastify, engine } = await build(TRAIN);
  try {
    // 无激活模型:paper/run 下发 model=null(退回等权因子)
    await fastify.inject({
      method: 'POST',
      url: '/api/v1/paper/run',
      payload: { today: '2024-07-01', effective_date: '2024-07-02' },
    });
    assert.equal(engine.lastPaperReq?.model, null);

    // 训练 + 激活 → paper/run 下发激活模型的系数
    const created = (
      await fastify.inject({
        method: 'POST',
        url: '/api/v1/models/train',
        payload: { train_start: '2023-01-01', train_end: '2024-06-30' },
      })
    ).json();
    await fastify.inject({ method: 'POST', url: `/api/v1/models/${created.id}/activate` });
    await fastify.inject({
      method: 'POST',
      url: '/api/v1/paper/run',
      payload: { today: '2024-07-03', effective_date: '2024-07-04' },
    });
    assert.deepEqual(engine.lastPaperReq?.model, TRAIN.model);
  } finally {
    await app.close();
  }
});

test('无激活模型时 paper/run 下发启用的自定义因子(进等权选股)', async () => {
  const { app, fastify, engine } = await build(TRAIN);
  try {
    // 保存一个自定义因子(fake validate: 不含 __ → ok)
    await fastify.inject({
      method: 'POST',
      url: '/api/v1/custom-factors',
      payload: { name: 'cf1', expr: 'close / delay(close, 10) - 1' },
    });
    // 无激活模型 → paper/run:model 为 null,custom 含 cf1
    await fastify.inject({
      method: 'POST',
      url: '/api/v1/paper/run',
      payload: { today: '2024-07-01', effective_date: '2024-07-02' },
    });
    assert.equal(engine.lastPaperReq?.model, null);
    const custom = (engine.lastPaperReq?.custom ?? []) as Array<{ name: string }>;
    assert.ok(custom.some((c) => c.name === 'cf1'));
  } finally {
    await app.close();
  }
});
