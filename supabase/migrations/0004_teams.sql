-- 팀별 작업공간 분리.
-- 지금의 workspace_state(id = 1) 한 행을 '파크사업팀' 공간으로 옮기고, 팀마다 행을 하나씩 둡니다.
-- 브라우저는 이 테이블들을 직접 읽지 않고 서버(service role)만 접근합니다.

create table if not exists public.teams (
  id text primary key,
  name text not null,
  color text not null default '#2f6b4f',
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
alter table public.teams enable row level security;
revoke all on public.teams from anon, authenticated;

-- 누가 어느 팀에 들어갈 수 있는지의 기준입니다. 역할의 기준은 각 팀 작업공간의 members입니다.
create table if not exists public.team_memberships (
  team_id text not null references public.teams(id) on delete cascade,
  email text not null check (email = lower(email)),
  member_id text not null,
  role text not null check (role in ('admin', 'member', 'commenter')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (team_id, email)
);
-- 마스터가 아닌 사람은 한 번에 한 팀에만 소속됩니다.
create unique index if not exists team_memberships_one_active_team
  on public.team_memberships (email) where active;
alter table public.team_memberships enable row level security;
revoke all on public.team_memberships from anon, authenticated;

-- workspace_state: id = 1 제약을 풀고 팀별 행으로.
do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select con.conname
    from pg_constraint con
    where con.conrelid = 'public.workspace_state'::regclass and con.contype = 'c'
  loop
    execute format('alter table public.workspace_state drop constraint %I', constraint_name);
  end loop;
end $$;

create sequence if not exists public.workspace_state_id_seq start with 2;
alter table public.workspace_state alter column id set default nextval('public.workspace_state_id_seq');
alter table public.workspace_state add column if not exists team_id text references public.teams(id) on delete cascade;
create unique index if not exists workspace_state_team_id_key on public.workspace_state (team_id);

-- 기존 데이터를 파크사업팀으로 이전.
insert into public.teams (id, name, color, sort_order)
values ('park', '파크사업팀', '#2f6b4f', 0)
on conflict (id) do nothing;

update public.workspace_state set team_id = 'park' where id = 1 and team_id is null;

insert into public.team_memberships (team_id, email, member_id, role, active)
select distinct on (lower(member ->> 'email'))
  'park',
  lower(member ->> 'email'),
  member ->> 'id',
  member ->> 'role',
  coalesce((member ->> 'active')::boolean, true)
from public.workspace_state state,
  jsonb_array_elements(state.payload -> 'members') member
where state.team_id = 'park'
  and coalesce(member ->> 'email', '') <> ''
  and member ->> 'role' in ('admin', 'member', 'commenter')
order by lower(member ->> 'email'), coalesce((member ->> 'active')::boolean, true) desc
on conflict (team_id, email) do nothing;

-- 주간보고서: 파크사업팀은 기존 '__team__' 행을 그대로 쓰고, 새 팀은 'team:<팀 id>' 행을 씁니다.
-- weekly_report_state.owner_id는 text라 구조 변경은 필요 없습니다.
