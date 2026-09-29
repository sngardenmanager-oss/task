-- 전사 공통 일정: 마스터가 등록하고, 대상 팀(비어 있으면 모든 팀) 캘린더에 읽기 전용으로 보입니다.
-- 브라우저는 직접 읽지 않고 서버(service role)만 접근합니다.
create table if not exists public.company_events (
  id text primary key,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.company_events enable row level security;
revoke all on public.company_events from anon, authenticated;
