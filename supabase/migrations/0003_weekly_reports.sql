-- Reports have a separate versioned store; workspace updates never overwrite them.
create table if not exists public.weekly_report_state (
  owner_id text primary key,
  version bigint not null default 1,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.weekly_report_state enable row level security;
-- Only authenticated application server requests use the service role.
revoke all on public.weekly_report_state from anon, authenticated;
