import test from 'node:test';
import assert from 'node:assert/strict';
import { Db } from '../src/db/sqlite.js';
import { migrate } from '../src/db/migrator.js';
import { Repository } from '../src/db/repository.js';
import { LogBus } from '../src/bus/log-bus.js';

test('logInsert persists and emits to LogBus (drives /logs/stream SSE)', () => {
  const db = new Db(':memory:');
  migrate(db);
  const bus = new LogBus();
  const repo = new Repository(db, bus);

  const received: any[] = [];
  bus.observable().subscribe((e) => received.push(e));

  repo.logInsert({ level: 'warn', source: 'engine', message: '降级:northbound 不可用' });

  // 实时推送
  assert.equal(received.length, 1);
  assert.equal(received[0].level, 'warn');
  assert.equal(received[0].message, '降级:northbound 不可用');
  assert.ok(received[0].id && received[0].ts);
  // 同时落库
  assert.equal(repo.logsList().length, 1);
});

test('Repository works without a LogBus (bus optional)', () => {
  const db = new Db(':memory:');
  migrate(db);
  const repo = new Repository(db);
  repo.logInsert({ level: 'info', message: 'no bus attached' });
  assert.equal(repo.logsList().length, 1);
});
