import test from 'node:test';
import assert from 'node:assert/strict';
import { Db } from '../src/db/sqlite.js';
import { migrate } from '../src/db/migrator.js';
import { Repository } from '../src/db/repository.js';
import { MemorySecretStore } from '../src/secrets/secret-store.js';
import { CredentialService } from '../src/secrets/credential.service.js';
import { JobBus, JobsService } from '../src/modules/jobs.js';
import { FakeEngineClient } from './fakes.js';

test('runCacheBuild relays progress, writes coverage, logs degradation, completes', async () => {
  const db = new Db(':memory:');
  migrate(db);
  const repo = new Repository(db);
  const cs = new CredentialService(repo, new MemorySecretStore());
  const bus = new JobBus();
  const events = [
    { progress: 0.5, done_count: 1, total: 2, status: 'running', stage: 'fetching' },
    {
      progress: 1.0,
      done_count: 2,
      total: 2,
      status: 'done',
      coverage: [
        {
          stock_code: '600519.SH',
          dataset: 'price',
          provider: 'tushare',
          first_date: '2024-01-02',
          last_date: '2024-01-05',
          rows: 4,
        },
      ],
      degraded: ['northbound: 无可用源'],
    },
  ];
  const svc = new JobsService(repo, cs, bus, new FakeEngineClient(null, events));

  const job = repo.jobCreate({ type: 'cache_build', trigger: 'onboarding' });
  const received: any[] = [];
  bus.observable(job.id).subscribe((e) => received.push(e));

  await svc.runCacheBuild(job.id, {});

  const final = repo.jobToInfo(repo.jobGet(job.id)!);
  assert.equal(final.status, 'done');
  assert.equal(final.done_count, 2);
  assert.equal(final.progress, 1);

  const cov = repo.coverageSummary();
  assert.equal(cov.stock_count, 1);
  assert.equal(cov.total_rows, 4);

  // 降级被记入日志(永不静默)。
  assert.ok(repo.logsList().some((l) => String(l.message).includes('northbound')));
  // SSE 总线收到事件
  assert.ok(received.length >= 2);
});

test('cancel sets canceled status', () => {
  const db = new Db(':memory:');
  migrate(db);
  const repo = new Repository(db);
  const cs = new CredentialService(repo, new MemorySecretStore());
  const svc = new JobsService(repo, cs, new JobBus(), new FakeEngineClient(null, []));
  const job = repo.jobCreate({ type: 'cache_build', trigger: 'manual' });
  const out = svc.patch(job.id, 'cancel');
  assert.equal(out.status, 'canceled');
});
