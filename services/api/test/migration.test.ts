import test from 'node:test';
import assert from 'node:assert/strict';
import { Db } from '../src/db/sqlite.js';
import { migrate } from '../src/db/migrator.js';
import { Repository } from '../src/db/repository.js';
import * as config from '../src/config.js';

test('migration applies, idempotent, seeds providers', () => {
  const db = new Db(':memory:');
  const n = migrate(db);
  assert.ok(n >= 1);

  const tables = db
    .all<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table'")
    .map((r) => r.name);
  for (const t of ['settings', 'providers', 'credentials', 'data_jobs', 'data_coverage', 'logs']) {
    assert.ok(tables.includes(t), `missing table ${t}`);
  }

  // 幂等:再次迁移不应用任何文件
  assert.equal(migrate(db), 0);

  const repo = new Repository(db);
  repo.seedProviders(config.PROVIDER_SEED);
  assert.equal(repo.providersList().length, 4);
});

test('credentials table has no plaintext token column (red line #4)', () => {
  const db = new Db(':memory:');
  migrate(db);
  const cols = db.all<{ name: string }>('PRAGMA table_info(credentials)').map((r) => r.name);
  for (const forbidden of ['token', 'secret', 'password', 'plaintext', 'api_key', 'apikey']) {
    assert.ok(!cols.includes(forbidden), `forbidden column ${forbidden}`);
  }
  for (const required of ['key_ref', 'keyring_ref', 'cipher', 'nonce', 'tag', 'fingerprint']) {
    assert.ok(cols.includes(required), `missing column ${required}`);
  }
});
