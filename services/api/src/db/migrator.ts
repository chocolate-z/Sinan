/** 迁移器:按版本号顺序应用 migrations/*.sql,记入 schema_migrations,幂等。 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from './sqlite.js';

const __dirnameLocal = dirname(fileURLToPath(import.meta.url));

function* ancestors(start: string): Generator<string> {
  let cur = resolve(start);
  while (true) {
    yield cur;
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
}

export function migrationsDir(): string {
  if (process.env.SINAN_MIGRATIONS_DIR) return process.env.SINAN_MIGRATIONS_DIR;
  for (const a of ancestors(__dirnameLocal)) {
    const candidate = join(a, 'services', 'api', 'src', 'db', 'migrations');
    if (existsSync(join(candidate, '0001_init.sql'))) return candidate;
  }
  throw new Error('找不到 migrations 目录;请设置 SINAN_MIGRATIONS_DIR');
}

export function migrate(db: Db, dir = migrationsDir()): number {
  db.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)`,
  );
  const applied = new Set(
    db.all<{ version: number }>('SELECT version FROM schema_migrations').map((r) => r.version),
  );
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  let count = 0;
  for (const file of files) {
    const version = Number(file.split('_')[0]);
    if (Number.isNaN(version)) continue;
    if (applied.has(version)) continue;
    const sql = readFileSync(join(dir, file), 'utf-8');
    db.tx(() => {
      db.exec(sql);
      db.run(
        'INSERT INTO schema_migrations(version,name,applied_at) VALUES (?,?,?)',
        version,
        file,
        new Date().toISOString(),
      );
    });
    count += 1;
  }
  return count;
}
