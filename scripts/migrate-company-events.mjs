// 전사 공통 일정 저장소(0005_company_events.sql)를 운영 DB에 만듭니다. 기존 데이터는 건드리지 않습니다.
// 실행: node --env-file=.env.local scripts/migrate-company-events.mjs
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
      new URL('../supabase/migrations/0005_company_events.sql', import.meta.url),
      'utf8',
    ),
  );
  const check = await client.query(
    "select relrowsecurity from pg_class where oid='public.company_events'::regclass",
  );
  if (check.rows[0]?.relrowsecurity !== true)
    throw new Error('RLS verification failed');
  await client.query('COMMIT');
  console.log('Company events storage created; RLS enabled.');
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  console.error('Migration failed:', error.code ?? '', error.message);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
