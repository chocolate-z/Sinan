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

test('指纹持久但密钥库丢 token(dev 内存钥匙串重启)→ info 诚实报未配置,不与「连接异常」自相矛盾', () => {
  const { cs, store, repo } = svc();
  cs.put('tushare', TOKEN);
  assert.equal(cs.info('tushare').configured, true);

  // 模拟 api 重启:内存钥匙串丢了 token,但 DB 指纹行仍持久存在。
  store.delete('tushare/token');
  assert.equal(repo.credentialInfo('tushare').configured, true); // DB 单看指纹仍记「已配置」
  assert.equal(cs.getToken('tushare'), null); // 实际取不到 token

  // 交叉校验后:info 诚实报未配置 → 引导页提示重输,不再「已配置·无需重输」却测试失败。
  const info = cs.info('tushare');
  assert.equal(info.configured, false);
  assert.equal(info.fingerprint, null);
});
