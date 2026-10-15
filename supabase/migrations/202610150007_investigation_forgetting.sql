create table public.investigation_forget_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  investigation_id uuid not null,
  requested_by uuid not null references auth.users(id) on delete restrict,
  status text not null default 'pending' check (status in ('pending', 'complete')),
  outbox_barrier_id bigint not null default 0,
  cleanup_cursor_id bigint not null default 0,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (workspace_id, investigation_id, requested_by),
  check ((status = 'complete') = (completed_at is not null))
);

alter table public.graph_projection_outbox add column investigation_id uuid;
update public.graph_projection_outbox
set investigation_id = nullif(payload ->> 'investigation_id', '')::uuid
where payload ? 'investigation_id';
update public.graph_projection_outbox o set investigation_id = i.id
from public.investigations i
where o.entity_type = 'investigations' and o.entity_id = i.id::text and o.investigation_id is null;
create index graph_projection_outbox_forget_idx
  on public.graph_projection_outbox (workspace_id, investigation_id, id)
  where investigation_id is not null;

alter table public.investigation_task_handoffs add column investigation_id uuid;
update public.investigation_task_handoffs h set investigation_id = t.investigation_id
from public.investigation_tasks t where t.id = h.task_id;
alter table public.investigation_task_handoffs alter column investigation_id set not null;
alter table public.investigation_task_handoffs
  add constraint investigation_task_handoffs_investigation_fk
  foreign key (workspace_id, investigation_id)
  references public.investigations(workspace_id, id) on delete cascade;

create function public.set_task_handoff_investigation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select t.investigation_id into new.investigation_id
  from public.investigation_tasks t
  where t.id = new.task_id and t.workspace_id = new.workspace_id;
  if not found then
    raise exception 'task not found' using errcode = 'P0002';
  end if;
  return new;
end;
$$;

create trigger set_task_handoff_investigation
  before insert on public.investigation_task_handoffs
  for each row execute function public.set_task_handoff_investigation();
revoke all on function public.set_task_handoff_investigation() from public, anon, authenticated;

create or replace function public.enqueue_graph_projection()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  row_data jsonb;
  version_value integer;
  workspace_value uuid;
  investigation_value uuid;
  entity_value text;
  entity_kind text := tg_table_name;
begin
  if tg_op = 'DELETE' then
    row_data := to_jsonb(old);
    version_value := coalesce((row_data ->> 'version')::integer, 1) + 1;
    workspace_value := (row_data ->> 'workspace_id')::uuid;
    entity_value := coalesce(row_data ->> 'id', '');
    if entity_kind = 'investigations' then
      investigation_value := entity_value::uuid;
    elsif row_data ? 'investigation_id' then
      investigation_value := (row_data ->> 'investigation_id')::uuid;
    elsif entity_kind = 'investigation_task_handoffs' then
      investigation_value := (row_data ->> 'investigation_id')::uuid;
    end if;
    row_data := '{}'::jsonb;
    if entity_kind = 'investigation_events' then version_value := 2; end if;
  else
    row_data := to_jsonb(new);
    version_value := coalesce((row_data ->> 'version')::integer, 1);
    workspace_value := (row_data ->> 'workspace_id')::uuid;
    entity_value := coalesce(row_data ->> 'id', '');
  end if;
  if entity_kind = 'investigations' then
    investigation_value := entity_value::uuid;
  elsif row_data ? 'investigation_id' then
    investigation_value := (row_data ->> 'investigation_id')::uuid;
  elsif entity_kind = 'investigation_task_handoffs' then
    investigation_value := (row_data ->> 'investigation_id')::uuid;
  end if;
  insert into public.graph_projection_outbox (workspace_id, investigation_id, entity_type, entity_id, entity_version, operation, payload)
  values (workspace_value, investigation_value, entity_kind, entity_value, version_value,
    case when tg_op = 'DELETE' then 'delete' else 'upsert' end, row_data)
  on conflict (workspace_id, entity_type, entity_id, entity_version) do nothing;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

alter table public.investigation_forget_requests enable row level security;
revoke all on public.investigation_forget_requests from public, anon, authenticated;
grant select on public.investigation_forget_requests to authenticated;

create policy "requesters and workspace admins can check forgetting"
  on public.investigation_forget_requests for select to authenticated
  using (
    requested_by = (select auth.uid())
    or exists (
      select 1 from public.workspace_memberships m
      where m.workspace_id = investigation_forget_requests.workspace_id
        and m.user_id = (select auth.uid()) and m.role in ('owner', 'admin')
    )
  );

create function public.forget_investigation(p_workspace_id uuid, p_investigation_id uuid)
returns public.investigation_forget_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  request_row public.investigation_forget_requests%rowtype;
begin
  if caller_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  perform 1 from public.workspace_memberships m
  where m.workspace_id = p_workspace_id and m.user_id = caller_id and m.role in ('owner', 'admin')
  for update;
  if not found then
    raise exception 'workspace administrator required' using errcode = '42501';
  end if;

  select r.* into request_row from public.investigation_forget_requests r
  where r.workspace_id = p_workspace_id and r.investigation_id = p_investigation_id and r.requested_by = caller_id
  for update;
  if found then return request_row; end if;

  perform 1 from public.investigations i
  where i.workspace_id = p_workspace_id and i.id = p_investigation_id
  for update;
  if not found then
    raise exception 'investigation not found' using errcode = 'P0002';
  end if;

  insert into public.investigation_forget_requests (workspace_id, investigation_id, requested_by)
  values (p_workspace_id, p_investigation_id, caller_id)
  returning * into request_row;

  update public.action_proposals
  set status = 'stale'
  where workspace_id = p_workspace_id and investigation_id = p_investigation_id
    and status in ('proposed', 'approved');

  delete from public.investigations where workspace_id = p_workspace_id and id = p_investigation_id;

  update public.investigation_forget_requests
  set outbox_barrier_id = coalesce((
    select max(o.id) from public.graph_projection_outbox o where o.workspace_id = p_workspace_id
  ), 0)
  where id = request_row.id
  returning * into request_row;
  return request_row;
end;
$$;

create function public.list_ready_investigation_forgets()
returns table (request_id uuid, workspace_id uuid, investigation_id uuid, outbox_barrier_id bigint, cleanup_cursor_id bigint)
language sql
security definer
set search_path = ''
as $$
  select r.id, r.workspace_id, r.investigation_id, r.outbox_barrier_id, r.cleanup_cursor_id
  from public.investigation_forget_requests r
  where r.status = 'pending'
    and not exists (
      select 1 from public.graph_projection_outbox o
      where o.workspace_id = r.workspace_id and o.investigation_id = r.investigation_id
        and o.id <= r.outbox_barrier_id and o.processed_at is null
    );
$$;

create function public.list_investigation_forget_delete_targets(p_request_id uuid, p_after_id bigint, p_limit integer default 100)
returns table (event_id bigint, entity_type text, entity_id text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_row public.investigation_forget_requests%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_after_id is null or p_after_id < 0 or p_limit is null or p_limit not between 1 and 100 then
    raise exception 'forget target page is invalid' using errcode = '22023';
  end if;
  select r.* into request_row from public.investigation_forget_requests r
  where r.id = p_request_id and r.status = 'pending';
  if not found then return; end if;
  return query
    select latest.id, latest.entity_type, latest.entity_id
    from (
      select distinct on (o.entity_type, o.entity_id) o.id, o.entity_type, o.entity_id, o.operation
      from public.graph_projection_outbox o
      where o.workspace_id = request_row.workspace_id and o.investigation_id = request_row.investigation_id
        and o.id <= request_row.outbox_barrier_id and o.processed_at is not null
      order by o.entity_type, o.entity_id, o.entity_version desc
    ) latest
    where latest.operation = 'delete' and latest.id > p_after_id
    order by latest.id limit p_limit;
end;
$$;

create function public.advance_investigation_forget_cleanup(p_request_id uuid, p_cursor_id bigint)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_row public.investigation_forget_requests%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  select r.* into request_row from public.investigation_forget_requests r
  where r.id = p_request_id and r.status = 'pending' for update;
  if not found or p_cursor_id is null or p_cursor_id < request_row.cleanup_cursor_id
    or p_cursor_id > request_row.outbox_barrier_id then return false; end if;
  update public.investigation_forget_requests set cleanup_cursor_id = p_cursor_id where id = p_request_id;
  return true;
end;
$$;

create function public.complete_investigation_forget(p_request_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_row public.investigation_forget_requests%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  select r.* into request_row from public.investigation_forget_requests r
  where r.id = p_request_id for update;
  if not found then return false; end if;
  if exists (
    select 1 from public.graph_projection_outbox o
    where o.workspace_id = request_row.workspace_id and o.investigation_id = request_row.investigation_id
      and o.id <= request_row.outbox_barrier_id and o.processed_at is null
  ) then return false; end if;
  if exists (
    select 1 from (
      select distinct on (o.entity_type, o.entity_id) o.id, o.operation
      from public.graph_projection_outbox o
      where o.workspace_id = request_row.workspace_id and o.investigation_id = request_row.investigation_id
        and o.id <= request_row.outbox_barrier_id and o.processed_at is not null
      order by o.entity_type, o.entity_id, o.entity_version desc
    ) latest where latest.operation = 'delete' and latest.id > request_row.cleanup_cursor_id
  ) then return false; end if;
  delete from public.graph_projection_outbox o
  where o.workspace_id = request_row.workspace_id and o.investigation_id = request_row.investigation_id;
  update public.investigation_forget_requests
  set status = 'complete', completed_at = now()
  where id = p_request_id and status = 'pending';
  return found;
end;
$$;

revoke all on function public.forget_investigation(uuid, uuid) from public, anon;
grant execute on function public.forget_investigation(uuid, uuid) to authenticated;
revoke all on function public.list_ready_investigation_forgets() from public, anon, authenticated;
grant execute on function public.list_ready_investigation_forgets() to service_role;
revoke all on function public.list_investigation_forget_delete_targets(uuid, bigint, integer) from public, anon, authenticated;
grant execute on function public.list_investigation_forget_delete_targets(uuid, bigint, integer) to service_role;
revoke all on function public.advance_investigation_forget_cleanup(uuid, bigint) from public, anon, authenticated;
grant execute on function public.advance_investigation_forget_cleanup(uuid, bigint) to service_role;
revoke all on function public.complete_investigation_forget(uuid) from public, anon, authenticated;
grant execute on function public.complete_investigation_forget(uuid) to service_role;
