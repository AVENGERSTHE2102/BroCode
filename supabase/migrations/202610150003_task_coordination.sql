create table public.investigation_tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  investigation_id uuid not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 160),
  status text not null default 'open' check (status in ('open', 'claimed', 'completed', 'cancelled')),
  owner_id uuid references auth.users(id) on delete restrict,
  lease_expires_at timestamptz,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (workspace_id, investigation_id)
    references public.investigations(workspace_id, id) on delete cascade,
  unique (workspace_id, id),
  unique (workspace_id, investigation_id, idempotency_key),
  check (
    (status = 'claimed' and owner_id is not null and lease_expires_at is not null)
    or (status <> 'claimed' and lease_expires_at is null)
  )
);

create index investigation_tasks_claim_idx on public.investigation_tasks (workspace_id, investigation_id, status, lease_expires_at);

create table public.investigation_task_handoffs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  task_id uuid not null references public.investigation_tasks(id) on delete cascade,
  from_user_id uuid not null references auth.users(id) on delete restrict,
  to_user_id uuid not null references auth.users(id) on delete restrict,
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 160),
  status text not null default 'pending' check (status in ('pending', 'acknowledged', 'expired')),
  version integer not null default 1 check (version > 0),
  requested_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  foreign key (workspace_id, task_id)
    references public.investigation_tasks(workspace_id, id) on delete cascade,
  unique (workspace_id, task_id, idempotency_key),
  check ((status = 'acknowledged') = (acknowledged_at is not null)),
  check (from_user_id <> to_user_id)
);

create index investigation_task_handoffs_pending_idx on public.investigation_task_handoffs (workspace_id, task_id, to_user_id, requested_at desc) where status = 'pending';

create table public.graph_projection_outbox (
  id bigint generated always as identity primary key,
  workspace_id uuid not null,
  entity_type text not null,
  entity_id text not null,
  entity_version integer not null check (entity_version > 0),
  operation text not null check (operation in ('upsert', 'delete')),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  attempts integer not null default 0 check (attempts >= 0),
  available_at timestamptz not null default now(),
  lease_owner uuid,
  lease_expires_at timestamptz,
  processed_at timestamptz,
  dead_lettered_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  unique (workspace_id, entity_type, entity_id, entity_version),
  check ((lease_owner is null) = (lease_expires_at is null))
);

create index graph_projection_outbox_pending_idx on public.graph_projection_outbox (available_at, id)
  where processed_at is null and dead_lettered_at is null;
alter table public.graph_projection_outbox enable row level security;
revoke all on public.graph_projection_outbox from public, anon, authenticated, service_role;

create table public.graph_projection_worker_lock (
  singleton boolean primary key default true check (singleton),
  lease_owner uuid,
  lease_expires_at timestamptz,
  check ((lease_owner is null) = (lease_expires_at is null))
);
insert into public.graph_projection_worker_lock (singleton) values (true);
alter table public.graph_projection_worker_lock enable row level security;
revoke all on public.graph_projection_worker_lock from public, anon, authenticated, service_role;

create function public.lease_graph_projection_worker(p_worker_id uuid, p_lease_seconds integer default 120)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_worker_id is null or p_lease_seconds not between 60 and 300 then
    raise exception 'worker lease is invalid' using errcode = '22023';
  end if;
  update public.graph_projection_worker_lock
  set lease_owner = p_worker_id, lease_expires_at = now() + (p_lease_seconds * interval '1 second')
  where singleton and (lease_expires_at is null or lease_expires_at <= now() or lease_owner = p_worker_id);
  return found;
end;
$$;

create function public.release_graph_projection_worker(p_worker_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  update public.graph_projection_worker_lock
  set lease_owner = null, lease_expires_at = null
  where singleton and lease_owner = p_worker_id;
  return found;
end;
$$;

create function public.enqueue_graph_projection()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  row_data jsonb;
  version_value integer;
  workspace_value uuid;
  entity_value text;
  entity_kind text := tg_table_name;
begin
  if tg_op = 'DELETE' then
    row_data := to_jsonb(old);
    version_value := coalesce((row_data ->> 'version')::integer, 1) + 1;
    workspace_value := (row_data ->> 'workspace_id')::uuid;
    entity_value := coalesce(row_data ->> 'id', '');
    row_data := '{}'::jsonb;
    if entity_kind = 'investigation_events' then version_value := 2; end if;
  else
    row_data := to_jsonb(new);
    version_value := coalesce((row_data ->> 'version')::integer, 1);
    workspace_value := (row_data ->> 'workspace_id')::uuid;
    entity_value := coalesce(row_data ->> 'id', '');
  end if;
  insert into public.graph_projection_outbox (workspace_id, entity_type, entity_id, entity_version, operation, payload)
  values (workspace_value, entity_kind, entity_value, version_value,
    case when tg_op = 'DELETE' then 'delete' else 'upsert' end, row_data)
  on conflict (workspace_id, entity_type, entity_id, entity_version) do nothing;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger project_investigations after insert or update or delete on public.investigations
  for each row execute function public.enqueue_graph_projection();
create trigger project_investigation_events after insert or delete on public.investigation_events
  for each row execute function public.enqueue_graph_projection();
create trigger project_investigation_tasks after insert or update or delete on public.investigation_tasks
  for each row execute function public.enqueue_graph_projection();
create trigger project_task_handoffs after insert or update or delete on public.investigation_task_handoffs
  for each row execute function public.enqueue_graph_projection();
revoke all on function public.enqueue_graph_projection() from public, anon, authenticated;

create function public.lease_graph_projection_events(p_worker_id uuid, p_limit integer default 50, p_lease_seconds integer default 60)
returns setof public.graph_projection_outbox
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_worker_id is null or p_limit not between 1 and 100 or p_lease_seconds not between 30 and 600 then
    raise exception 'lease parameters are invalid' using errcode = '22023';
  end if;
  if not exists (select 1 from public.graph_projection_worker_lock l where l.singleton and l.lease_owner = p_worker_id and l.lease_expires_at > now()) then
    raise exception 'worker lease is required' using errcode = '42501';
  end if;
  return query
  with batch as (
    select o.id from public.graph_projection_outbox o
    where o.processed_at is null and o.dead_lettered_at is null and o.available_at <= now()
      and (o.lease_expires_at is null or o.lease_expires_at <= now())
      and not exists (
        select 1 from public.graph_projection_outbox prior
        where prior.workspace_id = o.workspace_id and prior.entity_type = o.entity_type
          and prior.entity_id = o.entity_id and prior.id < o.id
          and prior.processed_at is null and prior.dead_lettered_at is null
      )
    order by o.id for update skip locked limit p_limit
  )
  update public.graph_projection_outbox o
  set lease_owner = p_worker_id, lease_expires_at = now() + (p_lease_seconds * interval '1 second'),
      attempts = o.attempts + 1
  from batch b where o.id = b.id
  returning o.*;
end;
$$;

create function public.complete_graph_projection_event(p_event_id bigint, p_worker_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  update public.graph_projection_outbox
  set processed_at = now(), lease_owner = null, lease_expires_at = null, last_error = null, payload = '{}'::jsonb
  where id = p_event_id and lease_owner = p_worker_id and processed_at is null;
  return found;
end;
$$;

create function public.retry_graph_projection_event(p_event_id bigint, p_worker_id uuid, p_error text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  update public.graph_projection_outbox
  set dead_lettered_at = case when attempts >= 8 then now() else null end,
      available_at = case when attempts >= 8 then available_at else now() + (
        least(900, (15 * power(2::numeric, least(attempts, 5)))::integer + ((id + attempts) % 17)::integer) * interval '1 second'
      ) end,
      lease_owner = null, lease_expires_at = null,
      last_error = left(coalesce(p_error, 'projection failed'), 1000)
  where id = p_event_id and lease_owner = p_worker_id and processed_at is null;
  return found;
end;
$$;

create function public.replay_graph_projection_event(p_event_id bigint)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  update public.graph_projection_outbox
  set dead_lettered_at = null, processed_at = null, attempts = 0, available_at = now(), last_error = null
  where id = p_event_id and dead_lettered_at is not null;
  return found;
end;
$$;

create function public.graph_projection_queue_health()
returns table (pending_count bigint, dead_count bigint, oldest_pending_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  return query select
    count(*) filter (where processed_at is null and dead_lettered_at is null),
    count(*) filter (where dead_lettered_at is not null),
    min(created_at) filter (where processed_at is null and dead_lettered_at is null)
  from public.graph_projection_outbox;
end;
$$;

alter table public.investigation_tasks enable row level security;
alter table public.investigation_task_handoffs enable row level security;
revoke all on public.investigation_tasks, public.investigation_task_handoffs from anon, authenticated;
grant select on public.investigation_tasks, public.investigation_task_handoffs to authenticated;

create policy "workspace members can read investigation tasks"
  on public.investigation_tasks for select to authenticated
  using (exists (
    select 1 from public.workspace_memberships m
    where m.workspace_id = investigation_tasks.workspace_id and m.user_id = (select auth.uid())
  ));

create policy "workspace members can read task handoffs"
  on public.investigation_task_handoffs for select to authenticated
  using (exists (
    select 1 from public.workspace_memberships m
    where m.workspace_id = investigation_task_handoffs.workspace_id and m.user_id = (select auth.uid())
  ));

create function public.create_investigation_task(
  p_investigation_id uuid,
  p_title text,
  p_details jsonb,
  p_idempotency_key text
)
returns setof public.investigation_tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  task_workspace_id uuid;
  result public.investigation_tasks;
begin
  if caller_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_title is null or char_length(btrim(p_title)) not between 1 and 200
     or p_idempotency_key is null or char_length(p_idempotency_key) not between 1 and 160
     or p_details is null or jsonb_typeof(p_details) <> 'object' then
    raise exception 'task input is invalid' using errcode = '22023';
  end if;

  select i.workspace_id into task_workspace_id
  from public.investigations i
  join public.workspace_memberships m on m.workspace_id = i.workspace_id and m.user_id = caller_id
  where i.id = p_investigation_id;
  if task_workspace_id is null then
    raise exception 'investigation not found' using errcode = 'P0002';
  end if;

  insert into public.investigation_tasks (workspace_id, investigation_id, created_by, title, details, idempotency_key)
  values (task_workspace_id, p_investigation_id, caller_id, btrim(p_title), p_details, p_idempotency_key)
  on conflict (workspace_id, investigation_id, idempotency_key) do nothing;

  select t.* into result from public.investigation_tasks t
  where t.workspace_id = task_workspace_id and t.investigation_id = p_investigation_id and t.idempotency_key = p_idempotency_key;
  if result.title <> btrim(p_title) or result.details <> p_details then
    raise exception 'idempotency key was already used with different task data' using errcode = '23505';
  end if;
  return next result;
end;
$$;

create function public.claim_investigation_task(p_task_id uuid, p_lease_seconds integer default 300)
returns setof public.investigation_tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
begin
  if caller_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_lease_seconds is null or p_lease_seconds not between 30 and 1800 then
    raise exception 'lease must be between 30 and 1800 seconds' using errcode = '22023';
  end if;
  return query
  update public.investigation_tasks t
  set status = 'claimed', owner_id = caller_id,
      lease_expires_at = now() + (p_lease_seconds * interval '1 second'),
      version = t.version + 1, updated_at = now()
  where t.id = p_task_id
    and exists (select 1 from public.workspace_memberships m where m.workspace_id = t.workspace_id and m.user_id = caller_id)
    and (t.status = 'open' or (t.status = 'claimed' and t.lease_expires_at <= now()))
  returning t.*;
  if found then
    update public.investigation_task_handoffs h
    set status = 'expired', version = h.version + 1
    where h.task_id = p_task_id and h.status = 'pending';
  else
    return query select t.* from public.investigation_tasks t
    where t.id = p_task_id and t.status = 'claimed' and t.owner_id = caller_id and t.lease_expires_at > now()
      and exists (select 1 from public.workspace_memberships m where m.workspace_id = t.workspace_id and m.user_id = caller_id);
  end if;
end;
$$;

create function public.request_investigation_task_handoff(
  p_task_id uuid,
  p_to_user_id uuid,
  p_idempotency_key text
)
returns setof public.investigation_task_handoffs
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  task_row public.investigation_tasks;
  result public.investigation_task_handoffs;
begin
  if caller_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 1 and 160 then
    raise exception 'idempotency key is invalid' using errcode = '22023';
  end if;

  select t.* into task_row from public.investigation_tasks t where t.id = p_task_id for update;
  if not found or not exists (
    select 1 from public.workspace_memberships m where m.workspace_id = task_row.workspace_id and m.user_id = caller_id
  ) then
    raise exception 'task not found' using errcode = '42501';
  end if;
  if p_to_user_id = caller_id or not exists (
    select 1 from public.workspace_memberships m where m.workspace_id = task_row.workspace_id and m.user_id = p_to_user_id
  ) then
    raise exception 'handoff recipient must be another workspace member' using errcode = '22023';
  end if;

  select h.* into result from public.investigation_task_handoffs h
  where h.workspace_id = task_row.workspace_id and h.task_id = task_row.id and h.idempotency_key = p_idempotency_key
  for update;
  if found then
    if result.from_user_id <> caller_id or result.to_user_id <> p_to_user_id then
      raise exception 'idempotency key was already used with different handoff data' using errcode = '23505';
    end if;
    return next result;
    return;
  end if;
  if task_row.status <> 'claimed' or task_row.owner_id <> caller_id or task_row.lease_expires_at <= now() then
    raise exception 'an active task claim is required' using errcode = '42501';
  end if;

  insert into public.investigation_task_handoffs (workspace_id, task_id, from_user_id, to_user_id, idempotency_key)
  values (task_row.workspace_id, task_row.id, caller_id, p_to_user_id, p_idempotency_key)
  on conflict (workspace_id, task_id, idempotency_key) do nothing;
  select h.* into result from public.investigation_task_handoffs h
  where h.workspace_id = task_row.workspace_id and h.task_id = task_row.id and h.idempotency_key = p_idempotency_key;
  return next result;
end;
$$;

create function public.acknowledge_investigation_task_handoff(p_task_id uuid, p_lease_seconds integer default 300)
returns setof public.investigation_tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  handoff public.investigation_task_handoffs;
  task_row public.investigation_tasks;
begin
  if caller_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_lease_seconds is null or p_lease_seconds not between 30 and 1800 then
    raise exception 'lease must be between 30 and 1800 seconds' using errcode = '22023';
  end if;

  select t.* into task_row from public.investigation_tasks t where t.id = p_task_id for update;
  if not found or not exists (
    select 1 from public.workspace_memberships m where m.workspace_id = task_row.workspace_id and m.user_id = caller_id
  ) then return; end if;
  select h.* into handoff from public.investigation_task_handoffs h
  where h.task_id = p_task_id and h.to_user_id = caller_id and h.status = 'pending'
  order by h.requested_at desc limit 1 for update;
  if not found then
    select h.* into handoff from public.investigation_task_handoffs h
    where h.task_id = p_task_id and h.to_user_id = caller_id and h.status = 'acknowledged'
    order by h.acknowledged_at desc limit 1 for update;
    if found then return next task_row; end if;
    return;
  end if;

  if not found or task_row.status <> 'claimed' or task_row.owner_id <> handoff.from_user_id or task_row.lease_expires_at <= now() then
    update public.investigation_task_handoffs set status = 'expired', version = version + 1 where id = handoff.id;
    return;
  end if;

  update public.investigation_tasks t
  set owner_id = caller_id, lease_expires_at = now() + (p_lease_seconds * interval '1 second'),
      version = t.version + 1, updated_at = now()
  where t.id = p_task_id returning t.* into task_row;
  update public.investigation_task_handoffs set status = 'acknowledged', acknowledged_at = now(), version = version + 1 where id = handoff.id;
  return next task_row;
end;
$$;

create function public.complete_investigation_task(p_task_id uuid)
returns setof public.investigation_tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
begin
  if caller_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  return query
  update public.investigation_tasks t
  set status = 'completed', lease_expires_at = null, version = t.version + 1, updated_at = now()
  where t.id = p_task_id and t.status = 'claimed' and t.owner_id = caller_id and t.lease_expires_at > now()
    and exists (select 1 from public.workspace_memberships m where m.workspace_id = t.workspace_id and m.user_id = caller_id)
  returning t.*;
  if not found then
    return query select t.* from public.investigation_tasks t
    where t.id = p_task_id and t.status = 'completed' and t.owner_id = caller_id
      and exists (select 1 from public.workspace_memberships m where m.workspace_id = t.workspace_id and m.user_id = caller_id);
  end if;
end;
$$;

revoke all on function public.create_investigation_task(uuid, text, jsonb, text) from public, anon;
revoke all on function public.claim_investigation_task(uuid, integer) from public, anon;
revoke all on function public.request_investigation_task_handoff(uuid, uuid, text) from public, anon;
revoke all on function public.acknowledge_investigation_task_handoff(uuid, integer) from public, anon;
revoke all on function public.complete_investigation_task(uuid) from public, anon;
grant execute on function public.create_investigation_task(uuid, text, jsonb, text) to authenticated;
grant execute on function public.claim_investigation_task(uuid, integer) to authenticated;
grant execute on function public.request_investigation_task_handoff(uuid, uuid, text) to authenticated;
grant execute on function public.acknowledge_investigation_task_handoff(uuid, integer) to authenticated;
grant execute on function public.complete_investigation_task(uuid) to authenticated;

revoke all on function public.lease_graph_projection_events(uuid, integer, integer) from public, anon, authenticated;
revoke all on function public.complete_graph_projection_event(bigint, uuid) from public, anon, authenticated;
revoke all on function public.retry_graph_projection_event(bigint, uuid, text) from public, anon, authenticated;
revoke all on function public.replay_graph_projection_event(bigint) from public, anon, authenticated;
revoke all on function public.graph_projection_queue_health() from public, anon, authenticated;
revoke all on function public.lease_graph_projection_worker(uuid, integer) from public, anon, authenticated;
revoke all on function public.release_graph_projection_worker(uuid) from public, anon, authenticated;
grant execute on function public.lease_graph_projection_worker(uuid, integer) to service_role;
grant execute on function public.release_graph_projection_worker(uuid) to service_role;
grant execute on function public.lease_graph_projection_events(uuid, integer, integer) to service_role;
grant execute on function public.complete_graph_projection_event(bigint, uuid) to service_role;
grant execute on function public.retry_graph_projection_event(bigint, uuid, text) to service_role;
grant execute on function public.replay_graph_projection_event(bigint) to service_role;
grant execute on function public.graph_projection_queue_health() to service_role;
