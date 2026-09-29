// 팀별 작업공간 분리 마이그레이션(0004_teams.sql)을 운영 DB에 적용합니다.
// 1) 적용 전에 workspace_state, weekly_report_state 전체를 outputs/backup-*.json 으로 내려받고
// 2) 한 트랜잭션 안에서 SQL을 실행한 뒤 결과를 검증해, 하나라도 어긋나면 되돌립니다.
// 실행: node --env-file=.env.local scripts/migrate-teams.mjs
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

  const backup = {
    takenAt: new Date().toISOString(),
    workspace_state: (await client.query('select * from public.workspace_state')).rows,
    weekly_report_state: (await client.query('select * from public.weekly_report_state')).rows,
  };
  await fs.mkdir(new URL('../outputs/', import.meta.url), { recursive: true });
  const backupFile = new URL(
    `../outputs/backup-before-teams-${backup.takenAt.replace(/[:.]/g, '-')}.json`,
    import.meta.url,
  );
  await fs.writeFile(backupFile, JSON.stringify(backup));
  console.log(
    `Backup saved: ${decodeURIComponent(backupFile.pathname)} (workspace rows ${backup.workspace_state.length}, report rows ${backup.weekly_report_state.length})`,
  );

  await client.query('BEGIN');
  await client.query(
    await fs.readFile(
      new URL('../supabase/migrations/0004_teams.sql', import.meta.url),
      'utf8',
    ),
  );

  const park = await client.query(
    "select count(*)::int as n from public.workspace_state where team_id = 'park' and id = 1",
  );
  if (park.rows[0].n !== 1) throw new Error('파크사업팀 작업공간 연결 확인 실패');
  const members = await client.query(
    `select count(distinct lower(m->>'email'))::int as n
     from public.workspace_state s, jsonb_array_elements(s.payload->'members') m
     where s.team_id = 'park' and coalesce(m->>'email','') <> ''`,
  );
  const memberships = await client.query(
    "select count(*)::int as n, count(*) filter (where active)::int as active from public.team_memberships where team_id = 'park'",
  );
  if (memberships.rows[0].n !== members.rows[0].n)
    throw new Error(
      `소속 복사 확인 실패: 멤버 ${members.rows[0].n}명, 소속 ${memberships.rows[0].n}건`,
    );
  const rls = await client.query(
    "select relname, relrowsecurity from pg_class where oid in ('public.teams'::regclass, 'public.team_memberships'::regclass)",
  );
  if (rls.rows.some((row) => row.relrowsecurity !== true))
    throw new Error('RLS verification failed');

  await client.query('COMMIT');
  console.log(
    `Teams migration applied. 파크사업팀 소속 ${memberships.rows[0].n}명(활성 ${memberships.rows[0].active}명); RLS enabled.`,
  );
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  console.error('Migration failed:', error.code ?? '', error.message);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
