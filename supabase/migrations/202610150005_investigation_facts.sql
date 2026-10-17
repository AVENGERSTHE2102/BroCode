create table public.investigation_facts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  investigation_id uuid not null,
  fact_key text not null check (char_length(btrim(fact_key)) between 1 and 200),
  value jsonb not null,
  provenance jsonb not null check (
    case when jsonb_typeof(provenance) = 'array' then jsonb_array_length(provenance) between 1 and 20 else false end
  ),
  version integer not null check (version > 0),
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (workspace_id, investigation_id)
    references public.investigations(workspace_id, id) on delete cascade,
  unique (workspace_id, investigation_id, fact_key),
  unique (workspace_id, id)
);

create table public.investigation_fact_versions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  investigation_id uuid not null,
  fact_id uuid not null,
  fact_key text not null,
  version integer not null check (version > 0),
  value jsonb not null,
  provenance jsonb not null check (
    case when jsonb_typeof(provenance) = 'array' then jsonb_array_length(provenance) between 1 and 20 else false end
  ),
  changed_by uuid not null references auth.users(id) on delete restrict,
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 160),
  created_at timestamptz not null default now(),
  foreign key (workspace_id, investigation_id)
    references public.investigations(workspace_id, id) on delete cascade,
  foreign key (workspace_id, fact_id)
    references public.investigation_facts(workspace_id, id) on delete cascade,
  unique (workspace_id, fact_id, version),
  unique (workspace_id, investigation_id, fact_key, idempotency_key)
);

create index investigation_facts_lookup_idx
  on public.investigation_facts (workspace_id, investigation_id, fact_key);
create index investigation_fact_versions_history_idx
  on public.investigation_fact_versions (workspace_id, investigation_id, fact_key, version desc);

alter table public.investigation_facts enable row level security;
alter table public.investigation_fact_versions enable row level security;
revoke all on public.investigation_facts, public.investigation_fact_versions from public, anon, authenticated;
grant select on public.investigation_facts, public.investigation_fact_versions to authenticated;

create policy "workspace members can read current investigation facts"
  on public.investigation_facts for select to authenticated
  using (exists (
    select 1 from public.workspace_memberships m
    where m.workspace_id = investigation_facts.workspace_id and m.user_id = (select auth.uid())
  ));

create policy "workspace members can read investigation fact history"
  on public.investigation_fact_versions for select to authenticated
  using (exists (
    select 1 from public.workspace_memberships m
    where m.workspace_id = investigation_fact_versions.workspace_id and m.user_id = (select auth.uid())
  ));

create trigger project_investigation_facts
  after insert or update or delete on public.investigation_facts
  for each row execute function public.enqueue_graph_projection();
create trigger project_investigation_fact_versions
  after insert or delete on public.investigation_fact_versions
  for each row execute function public.enqueue_graph_projection();

create function public.set_investigation_fact(
  p_investigation_id uuid,
  p_fact_key text,
  p_value jsonb,
  p_provenance jsonb,
  p_expected_version integer,
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
  fact_row public.investigation_facts%rowtype;
  revision_row public.investigation_fact_versions%rowtype;
  inserted_fact_id uuid;
  created_new boolean;
  next_version integer;
begin
  if caller_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_fact_key is null or char_length(btrim(p_fact_key)) not between 1 and 200
    or p_value is null or octet_length(p_value::text) > 16000
    or p_provenance is null or jsonb_typeof(p_provenance) <> 'array'
    or not (jsonb_array_length(p_provenance) between 1 and 20)
    or octet_length(p_provenance::text) > 8000
    or p_expected_version is null or p_expected_version < 0
    or p_idempotency_key is null or char_length(p_idempotency_key) not between 1 and 160 then
    raise exception 'fact input is invalid' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_provenance) e(value)
    where jsonb_typeof(e.value) <> 'object'
      or jsonb_typeof(e.value -> 'sourceId') is distinct from 'string'
      or char_length(btrim(e.value ->> 'sourceId')) not between 1 and 300
      or jsonb_typeof(e.value -> 'version') is distinct from 'string'
      or char_length(btrim(e.value ->> 'version')) not between 1 and 200
  ) then
    raise exception 'fact input is invalid' using errcode = '22023';
  end if;

  select i.workspace_id into workspace_value
  from public.investigations i
  join public.workspace_memberships m on m.workspace_id = i.workspace_id and m.user_id = caller_id
  where i.id = p_investigation_id
  for share of m;
  if workspace_value is null then
    raise exception 'investigation not found' using errcode = 'P0002';
  end if;

  select v.* into revision_row from public.investigation_fact_versions v
  where v.workspace_id = workspace_value and v.investigation_id = p_investigation_id
    and v.fact_key = btrim(p_fact_key) and v.idempotency_key = p_idempotency_key;
  if found then
    if revision_row.value <> p_value or revision_row.provenance <> p_provenance then
      raise exception 'idempotency key was already used with different fact content' using errcode = '23505';
    end if;
    return jsonb_build_object('revision', to_jsonb(revision_row), 'duplicate', true);
  end if;

  insert into public.investigation_facts (
    workspace_id, investigation_id, fact_key, value, provenance, version, updated_by
  ) values (
    workspace_value, p_investigation_id, btrim(p_fact_key), p_value, p_provenance, 1, caller_id
  ) on conflict (workspace_id, investigation_id, fact_key) do nothing
  returning id into inserted_fact_id;
  created_new := inserted_fact_id is not null;

  select f.* into fact_row from public.investigation_facts f
  where f.workspace_id = workspace_value and f.investigation_id = p_investigation_id
  and f.fact_key = btrim(p_fact_key)
  for update;
  select v.* into revision_row from public.investigation_fact_versions v
  where v.workspace_id = workspace_value and v.investigation_id = p_investigation_id
    and v.fact_key = btrim(p_fact_key) and v.idempotency_key = p_idempotency_key;
  if found then
    if revision_row.value <> p_value or revision_row.provenance <> p_provenance then
      raise exception 'idempotency key was already used with different fact content' using errcode = '23505';
    end if;
    return jsonb_build_object('revision', to_jsonb(revision_row), 'duplicate', true);
  end if;

  if created_new then
    if p_expected_version <> 0 then
      raise exception 'fact version is stale' using errcode = '40001';
    end if;
    next_version := 1;
  else
    if fact_row.version <> p_expected_version then
      raise exception 'fact version is stale' using errcode = '40001';
    end if;
    next_version := fact_row.version + 1;
    update public.investigation_facts
    set value = p_value, provenance = p_provenance, version = next_version,
        updated_by = caller_id, updated_at = now()
    where id = fact_row.id
    returning * into fact_row;
  end if;

  insert into public.investigation_fact_versions (
    workspace_id, investigation_id, fact_id, fact_key, version, value, provenance, changed_by, idempotency_key
  ) values (
    workspace_value, p_investigation_id, fact_row.id, btrim(p_fact_key), next_version,
    p_value, p_provenance, caller_id, p_idempotency_key
  ) returning * into revision_row;

  insert into public.investigation_events (
    workspace_id, investigation_id, actor_id, event_type, idempotency_key, payload
  ) values (
    workspace_value, p_investigation_id, caller_id, 'fact', 'fact_revision:' || revision_row.id::text,
    jsonb_build_object('fact_id', fact_row.id, 'fact_key', fact_row.fact_key,
      'fact_version', revision_row.version, 'revision_id', revision_row.id)
  );
  return jsonb_build_object('revision', to_jsonb(revision_row), 'duplicate', false);
end;
$$;

revoke all on function public.set_investigation_fact(uuid, text, jsonb, jsonb, integer, text) from public, anon;
grant execute on function public.set_investigation_fact(uuid, text, jsonb, jsonb, integer, text) to authenticated;
