// 완료 업무 보관함(0008_task_archive.sql)을 운영 DB에 만듭니다. 기존 데이터는 건드리지 않습니다.
// 실행: node --env-file=.env.local scripts/migrate-task-archive.mjs
import fs from 'node:fs/promises';
import pg from '../.reports-tools/node_modules/pg/lib/index.js';

const connectionString =
  process.env.POSTGRES_URL_NON_POOLING ?? process.env.POSTGRES_URL;
if (!connectionString) throw new Error('Postgres connection is not configured');
const url = new URL(connectionString);
for (const key of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey'])
  url.searchParams.delete(key);
const ca = await fs.readFile(
  new URL('../.reports-tools/prod-ca-2021.crt', import.meta.url),
  'utf8',
);
const client = new pg.Client({
  connectionString: url.toString(),
  ssl: { ca, rejectUnauthorized: true },
  connectionTimeoutMillis: 15000,
});
try {
  await client.connect();
  await client.query('BEGIN');
  await client.query(
    await fs.readFile(
      new URL('../supabase/migrations/0008_task_archive.sql', import.meta.url),
      'utf8',
    ),
  );
  const rls = await client.query(
    "select relrowsecurity from pg_class where oid='public.task_archive'::regclass",
  );
  if (rls.rows[0]?.relrowsecurity !== true) throw new Error('RLS verification failed');
  const count = await client.query('select count(*)::int as n from public.task_archive');
  await client.query('COMMIT');
  console.log(`Task archive created; RLS enabled. Archived tasks: ${count.rows[0].n}`);
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  console.error('Migration failed:', error.code ?? '', error.message);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
