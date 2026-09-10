create table if not exists public.news_digest (
  id bigint primary key check (id = 1),
  items jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.news_digest enable row level security;
