-- Additive migration: existing workspace/report payloads are preserved.
alter table public.workspace_state add column if not exists audit_context jsonb;
alter table public.weekly_report_state add column if not exists audit_context jsonb;

create table if not exists public.work_records (
  id uuid primary key default gen_random_uuid(),
  team_id text not null,
  entity_type text not null,
  entity_id text not null,
  title text not null,
  action text not null,
  actor jsonb not null default '{}'::jsonb,
  recorded_at timestamptz not null default clock_timestamp(),
  task_ids text[] not null default '{}',
  before_data jsonb,
  data jsonb,
  search_text text not null default ''
);
create index if not exists work_records_team_time on public.work_records(team_id, recorded_at desc, id);
create index if not exists work_records_entity on public.work_records(team_id, entity_type, entity_id);
create index if not exists work_records_tasks on public.work_records using gin(task_ids);
create table if not exists public.report_archive (
  owner_id text not null, report_id text not null, payload jsonb not null,
  archived_at timestamptz not null default clock_timestamp(), primary key(owner_id, report_id)
);
create table if not exists public.work_decisions (
  team_id text not null, id text not null, version integer not null,
  payload jsonb not null, audit_context jsonb, updated_at timestamptz not null default now(),
  primary key(team_id, id)
);
create table if not exists public.meeting_records (
  id text primary key, meeting_date date not null, payload jsonb not null,
  actor jsonb not null, note text not null default '', recorded_at timestamptz not null default clock_timestamp()
);
alter table public.meeting_records enable row level security;
revoke all on public.meeting_records from anon, authenticated;
grant select, insert on public.meeting_records to service_role;
revoke update, delete on public.meeting_records from service_role;
alter table public.work_records enable row level security;
alter table public.report_archive enable row level security;
alter table public.work_decisions enable row level security;
revoke all on public.work_records, public.report_archive, public.work_decisions from anon, authenticated;
grant select, insert on public.work_records, public.report_archive to service_role;
revoke update, delete on public.work_records, public.report_archive from service_role;
grant select on public.work_decisions to service_role;

create or replace function public.capture_work_records() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare section text; entity text; team text; entry record; ctx jsonb; action_name text; tids text[];
begin
  ctx := case when tg_op = 'INSERT' or new.audit_context is distinct from old.audit_context then coalesce(new.audit_context, '{}') else '{}'::jsonb end;
  if tg_table_name = 'workspace_state' then
    team := new.team_id;
    if team is null then return new; end if;
    foreach section in array array['tasks','notes','routines'] loop
      entity := case section when 'tasks' then 'task' when 'notes' then 'note' else 'routine' end;
      for entry in
        select coalesce(a->>'id', b->>'id') as id, a as next_data, b as previous_data
        from jsonb_array_elements(coalesce(new.payload->section, '[]')) a
        full join jsonb_array_elements(case when tg_op = 'INSERT' then '[]'::jsonb else coalesce(old.payload->section, '[]') end) b on a->>'id' = b->>'id'
        where a is distinct from b
      loop
        insert into work_records(team_id, entity_type, entity_id, title, action, actor, task_ids, before_data, data, search_text)
        values (team, entity, entry.id, coalesce(entry.next_data->>'title', entry.previous_data->>'title', entry.next_data->>'label', entry.previous_data->>'label', entity),
          case when entry.previous_data is null then '생성' when entry.next_data is null then '삭제' else '변경' end,
          ctx, case when entity = 'task' then array[entry.id] else '{}' end, entry.previous_data, entry.next_data,
          coalesce(entry.next_data::text, entry.previous_data::text, ''));
      end loop;
    end loop;
  elsif tg_table_name = 'weekly_report_state' then
    team := case when new.owner_id = '__team__' then 'park' when new.owner_id like 'team:%' then substring(new.owner_id from 6) else null end;
    if team is null then return new; end if;
    for entry in
      select coalesce(a->>'id', b->>'id') as id, a as next_data, b as previous_data
      from jsonb_array_elements(coalesce(new.payload->'reports', '[]')) a
      full join jsonb_array_elements(case when tg_op = 'INSERT' then '[]'::jsonb else coalesce(old.payload->'reports', '[]') end) b on a->>'id' = b->>'id'
      where a is distinct from b
    loop
      if entry.previous_data->>'status' = 'final' and entry.next_data is not null then
        raise exception 'Final report is immutable';
      end if;
      if entry.next_data->>'status' = 'final' then
        insert into report_archive(owner_id, report_id, payload) values(new.owner_id, entry.id, entry.next_data) on conflict do nothing;
        if exists(select 1 from report_archive where owner_id = new.owner_id and report_id = entry.id and payload is distinct from entry.next_data) then raise exception 'Archived report ID already exists'; end if;
      end if;
      if entry.next_data is null and entry.previous_data->>'status' = 'final' then
        insert into report_archive(owner_id, report_id, payload) values(new.owner_id, entry.id, entry.previous_data) on conflict do nothing;
      end if;
      select coalesce(array_agg(distinct v), '{}') into tids from (
        select x->>'taskId' v from jsonb_array_elements(coalesce(coalesce(entry.next_data, entry.previous_data)->'rows','[]')) x
        union select x->>'taskId' from jsonb_array_elements(coalesce(coalesce(entry.next_data, entry.previous_data)->'agendas','[]')) x
      ) refs where v is not null;
      action_name := case when entry.next_data is null then '장기 보관' else coalesce(ctx->>'action', '보고 저장') end;
      insert into work_records(team_id, entity_type, entity_id, title, action, actor, task_ids, data, search_text)
      values(team, 'report', entry.id, coalesce(entry.next_data#>>'{config,title}', entry.previous_data#>>'{config,title}', '보고서'), action_name, ctx, tids, coalesce(entry.next_data, entry.previous_data), coalesce(entry.next_data::text, entry.previous_data::text, ''));
    end loop;
    foreach section in array array['statistics','jejuArrivals'] loop
      for entry in
        select coalesce(a->>'date',b->>'date') id,a next_data,b previous_data
        from jsonb_array_elements(coalesce(new.payload->section,'[]')) a
        full join jsonb_array_elements(case when tg_op = 'INSERT' then '[]'::jsonb else coalesce(old.payload->section,'[]') end) b on a->>'date'=b->>'date'
        where a is distinct from b
      loop
        insert into work_records(team_id,entity_type,entity_id,title,action,actor,before_data,data,search_text)
        values(team,'statistic',section||':'||entry.id,section||' '||entry.id,'자료 변경',ctx,entry.previous_data,entry.next_data,coalesce(entry.next_data::text,''));
      end loop;
    end loop;
  elsif tg_table_name = 'work_decisions' then
    select coalesce(array_agg(value), '{}') into tids from jsonb_array_elements_text(coalesce(new.payload->'taskIds','[]'));
    insert into work_records(team_id,entity_type,entity_id,title,action,actor,task_ids,before_data,data,search_text)
    values(new.team_id,'decision',new.id,coalesce(new.payload->>'title','결정'),coalesce(ctx->>'action','결정 기록'),ctx,tids,case when tg_op='UPDATE' then old.payload else null end,new.payload,new.payload::text);
  end if;
  return new;
end $$;
drop trigger if exists capture_workspace_records on public.workspace_state;
create trigger capture_workspace_records after insert or update on public.workspace_state for each row execute function public.capture_work_records();
drop trigger if exists capture_report_records on public.weekly_report_state;
create trigger capture_report_records after insert or update on public.weekly_report_state for each row execute function public.capture_work_records();
drop trigger if exists capture_decision_records on public.work_decisions;
create trigger capture_decision_records after insert or update on public.work_decisions for each row execute function public.capture_work_records();

-- Historical finals retain their original content; missing approval information is not invented.
insert into public.report_archive(owner_id, report_id, payload)
select owner_id, report->>'id', report from public.weekly_report_state,
  lateral jsonb_array_elements(coalesce(payload->'reports','[]')) report
where report->>'status' = 'final' and (owner_id='__team__' or owner_id like 'team:%')
on conflict do nothing;

create or replace function public.save_work_decision(p_team text,p_id text,p_version integer,p_data jsonb,p_actor jsonb,p_task jsonb default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare current_row work_decisions; ws workspace_state; result work_decisions; tid text;
begin
  select * into current_row from work_decisions where team_id=p_team and id=p_id for update;
  if found then
    if current_row.audit_context->>'requestId'=p_actor->>'requestId' then return to_jsonb(current_row); end if;
    if current_row.version<>p_version then raise exception 'decision conflict' using errcode='PT409'; end if;
  elsif p_version<>0 then raise exception 'decision missing' using errcode='PT409'; end if;
  select * into ws from workspace_state where team_id=p_team for update;
  if not found then raise exception 'workspace missing'; end if;
  if p_task is not null and not exists(select 1 from jsonb_array_elements(ws.payload->'tasks') t where t->>'id'=p_task->>'id') then
    update workspace_state set payload=jsonb_set(payload,'{tasks}',coalesce(payload->'tasks','[]')||jsonb_build_array(p_task)),updated_at=clock_timestamp(),audit_context=p_actor where team_id=p_team;
    ws.payload:=jsonb_set(ws.payload,'{tasks}',coalesce(ws.payload->'tasks','[]')||jsonb_build_array(p_task));
  end if;
  for tid in select jsonb_array_elements_text(coalesce(p_data->'taskIds','[]')) loop
    if not exists(select 1 from jsonb_array_elements(ws.payload->'tasks') t where t->>'id'=tid) then raise exception 'linked task missing'; end if;
  end loop;
  insert into work_decisions(team_id,id,version,payload,audit_context) values(p_team,p_id,1,p_data,p_actor)
  on conflict(team_id,id) do update set version=work_decisions.version+1,payload=excluded.payload,audit_context=excluded.audit_context,updated_at=clock_timestamp()
  where work_decisions.version=p_version returning * into result;
  if result.id is null then raise exception 'decision conflict' using errcode='PT409'; end if;
  return to_jsonb(result);
end $$;
revoke all on function public.capture_work_records() from public,anon,authenticated;
revoke all on function public.save_work_decision(text,text,integer,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.save_work_decision(text,text,integer,jsonb,jsonb,jsonb) to service_role;
