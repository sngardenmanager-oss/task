-- 완료한 지 6개월이 지난 업무를 월 백업 때 팀 작업공간에서 옮겨 두는 보관함입니다.
-- 추가만 하는 마이그레이션이라 기존 업무·보고서 데이터는 건드리지 않습니다. 브라우저는 직접 읽지 않고 서버(service role)만 접근합니다.
create table if not exists public.task_archive (
  team_id text not null,
  task_id text not null,
  payload jsonb not null,
  completed_at timestamptz,
  archived_at timestamptz not null default clock_timestamp(),
  search_text text not null default '',
  primary key (team_id, task_id)
);
create index if not exists task_archive_team_time on public.task_archive(team_id, completed_at desc, task_id);
alter table public.task_archive enable row level security;
revoke all on public.task_archive from anon, authenticated;
grant select, insert on public.task_archive to service_role;
revoke update, delete on public.task_archive from service_role;
