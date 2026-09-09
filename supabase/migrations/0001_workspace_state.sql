create table if not exists public.workspace_state (
  id bigint primary key check (id = 1),
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.workspace_state enable row level security;
