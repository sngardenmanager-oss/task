-- 매월 백업 기록(마지막 백업 시각 등)을 담는 설정 저장소와, 용량 경고용 크기 조회 뷰.
-- 브라우저는 직접 읽지 않고 서버(service role)만 접근합니다.
create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.app_settings enable row level security;
revoke all on public.app_settings from anon, authenticated;

-- 한 번에 주고받는 크기(요청 한도 4.5MB)를 미리 경고하기 위해, 본문을 내려받지 않고 크기만 조회합니다.
create or replace view public.storage_sizes
with (security_invoker = true) as
  select 'workspace'::text as kind, team_id as key, octet_length(payload::text) as bytes
  from public.workspace_state
  where team_id is not null
  union all
  select 'report'::text as kind, owner_id as key, octet_length(payload::text) as bytes
  from public.weekly_report_state;
revoke all on public.storage_sizes from anon, authenticated;
