create table public.investigation_attempts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  investigation_id uuid not null,
  attempt_key text not null check (char_length(btrim(attempt_key)) between 1 and 200),
  attempt_number integer not null check (attempt_number > 0),
  previous_attempt_id uuid,
  condition_snapshot jsonb not null check (jsonb_typeof(condition_snapshot) = 'object'),
  outcome text not null check (outcome in ('failed', 'completed')),
  summary text not null check (char_length(btrim(summary)) between 1 and 4000),
  retry_explanation text check (retry_explanation is null or char_length(btrim(retry_explanation)) between 1 and 2000),
  changed_conditions jsonb not null check (
    case when jsonb_typeof(changed_conditions) = 'array' then jsonb_array_length(changed_conditions) between 0 and 20 else false end
  ),
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 160),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key (workspace_id, investigation_id)
    references public.investigations(workspace_id, id) on delete cascade,
  foreign key (workspace_id, previous_attempt_id)
    references public.investigation_attempts(workspace_id, id) on delete cascade,
  unique (workspace_id, id),
  unique (workspace_id, investigation_id, attempt_key, attempt_number),
  unique (workspace_id, investigation_id, idempotency_key)
);

create index investigation_attempts_order_idx
  on public.investigation_attempts (workspace_id, investigation_id, attempt_key, attempt_number desc);

alter table public.investigation_attempts enable row level security;
revoke all on public.investigation_attempts from public, anon, authenticated;
grant select on public.investigation_attempts to authenticated;

create policy "workspace members can read investigation attempts"
  on public.investigation_attempts for select to authenticated
  using (exists (
    select 1 from public.workspace_memberships m
    where m.workspace_id = investigation_attempts.workspace_id and m.user_id = (select auth.uid())
  ));

create trigger project_investigation_attempts
  after insert or delete on public.investigation_attempts
  for each row execute function public.enqueue_graph_projection();

create function public.record_investigation_attempt(
  p_investigation_id uuid,
  p_attempt_key text,
  p_condition_snapshot jsonb,
  p_outcome text,
  p_summary text,
  p_retry_explanation text,
  p_changed_conditions jsonb,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  workspace_value uuid;
  previous_row public.investigation_attempts%rowtype;
  existing_row public.investigation_attempts%rowtype;
  attempt_row public.investigation_attempts%rowtype;
  next_number integer;
begin
  if caller_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_attempt_key is null or char_length(btrim(p_attempt_key)) not between 1 and 200
    or p_condition_snapshot is null or jsonb_typeof(p_condition_snapshot) <> 'object'
    or octet_length(p_condition_snapshot::text) > 12000
    or p_outcome is null or p_outcome not in ('failed', 'completed')
    or p_summary is null or char_length(btrim(p_summary)) not between 1 and 4000
    or p_changed_conditions is null or jsonb_typeof(p_changed_conditions) <> 'array'
    or jsonb_array_length(p_changed_conditions) > 20
    or octet_length(p_changed_conditions::text) > 8000
    or p_idempotency_key is null or char_length(p_idempotency_key) not between 1 and 160
    or (p_retry_explanation is not null and char_length(btrim(p_retry_explanation)) not between 1 and 2000) then
    raise exception 'attempt input is invalid' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_changed_conditions) e(value)
    where jsonb_typeof(e.value) <> 'object'
      or jsonb_typeof(e.value -> 'description') is distinct from 'string'
      or char_length(btrim(e.value ->> 'description')) not between 1 and 500
      or jsonb_typeof(e.value -> 'sourceId') is distinct from 'string'
      or char_length(btrim(e.value ->> 'sourceId')) not between 1 and 300
      or jsonb_typeof(e.value -> 'version') is distinct from 'string'
      or char_length(btrim(e.value ->> 'version')) not between 1 and 200
  ) then
    raise exception 'changed condition evidence is invalid' using errcode = '22023';
  end if;

  select i.workspace_id into workspace_value
  from public.investigations i
  join public.workspace_memberships m on m.workspace_id = i.workspace_id and m.user_id = caller_id
  where i.id = p_investigation_id
  for update of i, m;
  if workspace_value is null then
    raise exception 'investigation not found' using errcode = 'P0002';
  end if;

  select a.* into existing_row from public.investigation_attempts a
  where a.workspace_id = workspace_value and a.investigation_id = p_investigation_id
    and a.idempotency_key = p_idempotency_key;
  if found then
    if existing_row.attempt_key <> btrim(p_attempt_key)
      or existing_row.condition_snapshot <> p_condition_snapshot
      or existing_row.outcome <> p_outcome or existing_row.summary <> btrim(p_summary)
      or existing_row.retry_explanation is distinct from nullif(btrim(p_retry_explanation), '')
      or existing_row.changed_conditions <> p_changed_conditions then
      raise exception 'idempotency key was already used with different attempt data' using errcode = '23505';
    end if;
    return jsonb_build_object('attempt', to_jsonb(existing_row), 'duplicate', true);
  end if;

  select a.* into previous_row from public.investigation_attempts a
  where a.workspace_id = workspace_value and a.investigation_id = p_investigation_id
    and a.attempt_key = btrim(p_attempt_key)
  order by a.attempt_number desc limit 1;
  if found and previous_row.outcome = 'failed' then
    if previous_row.condition_snapshot = p_condition_snapshot then
      raise exception 'a failed attempt cannot be repeated without changed conditions' using errcode = '40001';
    end if;
    if p_retry_explanation is null or char_length(btrim(p_retry_explanation)) = 0
      or jsonb_array_length(p_changed_conditions) = 0 then
      raise exception 'changed conditions and supporting evidence are required after a failure' using errcode = '22023';
    end if;
  elsif p_retry_explanation is not null or jsonb_array_length(p_changed_conditions) > 0 then
    raise exception 'retry explanation is only valid after a previous failure' using errcode = '22023';
  end if;

  select coalesce(max(a.attempt_number), 0) + 1 into next_number
  from public.investigation_attempts a
  where a.workspace_id = workspace_value and a.investigation_id = p_investigation_id
    and a.attempt_key = btrim(p_attempt_key);
  insert into public.investigation_attempts (
    workspace_id, investigation_id, attempt_key, attempt_number, previous_attempt_id,
    condition_snapshot, outcome, summary, retry_explanation, changed_conditions,
    idempotency_key, created_by
  ) values (
    workspace_value, p_investigation_id, btrim(p_attempt_key), next_number,
    (select a.id from public.investigation_attempts a
      where a.workspace_id = workspace_value and a.investigation_id = p_investigation_id
        and a.attempt_key = btrim(p_attempt_key)
      order by a.attempt_number desc limit 1),
    p_condition_snapshot, p_outcome, btrim(p_summary), nullif(btrim(p_retry_explanation), ''),
    p_changed_conditions, p_idempotency_key, caller_id
  ) returning * into attempt_row;

  insert into public.investigation_events (
    workspace_id, investigation_id, actor_id, event_type, idempotency_key, payload
  ) values (
    workspace_value, p_investigation_id, caller_id, 'attempt', 'attempt:' || attempt_row.id::text,
    jsonb_build_object('attempt_id', attempt_row.id, 'attempt_key', attempt_row.attempt_key,
      'attempt_number', attempt_row.attempt_number, 'outcome', attempt_row.outcome,
      'previous_attempt_id', attempt_row.previous_attempt_id)
  );
  return jsonb_build_object('attempt', to_jsonb(attempt_row), 'duplicate', false);
end;
$$;

revoke all on function public.record_investigation_attempt(uuid, text, jsonb, text, text, text, jsonb, text) from public, anon;
grant execute on function public.record_investigation_attempt(uuid, text, jsonb, text, text, text, jsonb, text) to authenticated;
