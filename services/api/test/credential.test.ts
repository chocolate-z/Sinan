import test from 'node:test';
import assert from 'node:assert/strict';
import { Db } from '../src/db/sqlite.js';
import { migrate } from '../src/db/migrator.js';
import { Repository } from '../src/db/repository.js';
import { MemorySecretStore } from '../src/secrets/secret-store.js';
import { CredentialService } from '../src/secrets/credential.service.js';

const TOKEN = 'SECRET-TOKEN-DO-NOT-LEAK-9f8e7d';

function svc() {
  const db = new Db(':memory:');
  migrate(db);
  const repo = new Repository(db);
  const store = new MemorySecretStore();
  return { db, repo, store, cs: new CredentialService(repo, store) };
}

test('put stores in keychain, DB never holds plaintext, returns fingerprint only', () => {
  const { db, cs } = svc();
  const res = cs.put('tushare', TOKEN);
  assert.equal(res.configured, true);
  assert.equal(res.fingerprint.length, 8);

  // 红线:DB 行中绝无明文 token。
  const row = db.get('SELECT * FROM credentials WHERE provider=?', 'tushare');
  assert.ok(!JSON.stringify(row).includes(TOKEN));

  // info 永不含 token。
  const info = cs.info('tushare');
  assert.equal(info.configured, true);
  assert.ok(!JSON.stringify(info).includes(TOKEN));
});

test('token retrievable only via internal getToken (keychain)', () => {
  const { cs, store } = svc();
  cs.put('tushare', TOKEN);
  assert.equal(cs.getToken('tushare'), TOKEN);
  // 钥匙串条目名约定
  assert.equal(store.get('tushare/token'), TOKEN);
});

test('delete clears keychain and DB', () => {
  const { cs } = svc();
  cs.put('tushare', TOKEN);
  cs.delete('tushare');
  assert.equal(cs.info('tushare').configured, false);
  assert.equal(cs.getToken('tushare'), null);
});

test('fingerprint stable for same token', () => {
  const { cs } = svc();
  const a = cs.put('tushare', TOKEN).fingerprint;
  const b = cs.put('tushare', TOKEN).fingerprint;
  assert.equal(a, b);
});
