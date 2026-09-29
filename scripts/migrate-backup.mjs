// 매월 백업 기록 저장소와 용량 조회 뷰(0006_backup_and_sizes.sql)를 운영 DB에 만듭니다. 기존 데이터는 건드리지 않습니다.
// 실행: node --env-file=.env.local scripts/migrate-backup.mjs
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
      new URL('../supabase/migrations/0006_backup_and_sizes.sql', import.meta.url),
      'utf8',
    ),
  );
  const rls = await client.query(
    "select relrowsecurity from pg_class where oid='public.app_settings'::regclass",
  );
  if (rls.rows[0]?.relrowsecurity !== true) throw new Error('RLS verification failed');
  const sizes = await client.query(
    'select kind, key, bytes from public.storage_sizes order by kind, key',
  );
  await client.query('COMMIT');
  console.log('Backup storage created; RLS enabled.');
  for (const row of sizes.rows)
    console.log(`  ${row.kind} ${row.key}: ${(Number(row.bytes) / 1_000_000).toFixed(2)}MB`);
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  console.error('Migration failed:', error.code ?? '', error.message);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
