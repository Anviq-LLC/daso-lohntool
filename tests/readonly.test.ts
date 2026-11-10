import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readOnly } from '../src/worker/auth.ts';

const fake = () => {
  const seen: string[] = [];
  const db = { prepare: (sql: string) => { seen.push(sql); return { bind: () => ({}) }; }, batch: () => 'batch', exec: () => 'exec', dump: () => 'dump' } as unknown as D1Database;
  return { db, seen };
};

test('source databases accept SELECT only', () => {
  const { db, seen } = fake();
  const ro = readOnly(db);
  ro.prepare('SELECT id FROM resources WHERE id = ?');
  ro.prepare('  select 1;');
  assert.equal(seen.length, 2);
  for (const sql of ['DELETE FROM resources', 'INSERT INTO x VALUES (1)', 'UPDATE x SET a = 1', 'DROP TABLE x', 'PRAGMA writable_schema=1', 'SELECT 1; DELETE FROM x', 'WITH a AS (SELECT 1) DELETE FROM x'])
    assert.throws(() => ro.prepare(sql), /schreibgesch/, sql);
  assert.throws(() => ro.batch([]));
  assert.throws(() => ro.exec('DELETE FROM x'));
  assert.equal(seen.length, 2);
});
