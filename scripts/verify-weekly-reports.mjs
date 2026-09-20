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
  const id = '__report_verify_' + crypto.randomUUID();
  const payload = {
    reports: [],
    tracks: [],
    statistics: [],
    imports: [],
    archiveLinks: {},
  };
  await client.query(
    'insert into public.weekly_report_state(owner_id,version,payload) values($1,1,$2)',
    [id, payload],
  );
  const first = await client.query(
    'update public.weekly_report_state set version=2 where owner_id=$1 and version=1 returning version',
    [id],
  );
  const stale = await client.query(
    'update public.weekly_report_state set version=3 where owner_id=$1 and version=1 returning version',
    [id],
  );
  if (first.rowCount !== 1 || stale.rowCount !== 0)
    throw new Error('Version conflict check failed');
  const rights = await client.query(
    "select has_table_privilege('anon','public.weekly_report_state','SELECT') as anon, has_table_privilege('authenticated','public.weekly_report_state','SELECT') as member",
  );
  if (rights.rows[0].anon || rights.rows[0].member)
    throw new Error('Direct access was not restricted');
  await client.query('ROLLBACK');
  console.log(
    'PASS: persistence, optimistic locking, restricted direct access; test data rolled back.',
  );
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  console.error('Verification failed:', error.code ?? error.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
