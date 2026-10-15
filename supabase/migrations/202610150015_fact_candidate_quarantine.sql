create table public.investigation_fact_candidates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  investigation_id uuid not null,
  fact_key text not null check (char_length(btrim(fact_key)) between 1 and 200),
  value jsonb not null check (octet_length(value::text) <= 16000),
  provenance jsonb not null check (
    case when jsonb_typeof(provenance) = 'array' then jsonb_array_length(provenance) between 1 and 20 else false end
  ),
  expected_version integer not null check (expected_version >= 0),
  idempotency_key text not null check (char_length(btrim(idempotency_key)) between 1 and 160),
  submitted_by uuid not null references auth.users(id) on delete restrict,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid references auth.users(id) on delete restrict,
  reviewed_at timestamptz,
  review_note text check (review_note is null or char_length(review_note) <= 1000),
  created_at timestamptz not null default now(),
  foreign key (workspace_id, investigation_id)
    references public.investigations(workspace_id, id) on delete cascade,
  unique (workspace_id, investigation_id, idempotency_key)
);

create index investigation_fact_candidates_pending_idx
  on public.investigation_fact_candidates (workspace_id, investigation_id, created_at)
  where status = 'pending';

alter table public.investigation_fact_candidates enable row level security;
revoke all on public.investigation_fact_candidates from public, anon, authenticated;
grant select on public.investigation_fact_candidates to authenticated;

create policy "workspace owners and admins can review quarantined fact candidates"
  on public.investigation_fact_candidates for select to authenticated
  using (exists (
    select 1 from public.workspace_memberships m
    where m.workspace_id = investigation_fact_candidates.workspace_id
      and m.user_id = (select auth.uid()) and m.role in ('owner', 'admin')
  ));

create function public.propose_investigation_fact_candidate(
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
  candidate_row public.investigation_fact_candidates%rowtype;
begin
  if caller_id is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if p_fact_key is null or char_length(btrim(p_fact_key)) not between 1 and 200
    or p_value is null or octet_length(p_value::text) > 16000
    or p_provenance is null or jsonb_typeof(p_provenance) <> 'array'
    or case when jsonb_typeof(p_provenance) = 'array' then not (jsonb_array_length(p_provenance) between 1 and 20) else true end
    or case when jsonb_typeof(p_provenance) = 'array' then exists (
      select 1 from jsonb_array_elements(p_provenance) e(value)
      where jsonb_typeof(e.value) <> 'object'
        or jsonb_typeof(e.value -> 'sourceId') is distinct from 'string'
        or char_length(btrim(e.value ->> 'sourceId')) not between 1 and 300
        or jsonb_typeof(e.value -> 'version') is distinct from 'string'
        or char_length(btrim(e.value ->> 'version')) not between 1 and 200
    ) else true end
    or octet_length(p_provenance::text) > 8000
    or p_expected_version is null or p_expected_version < 0
    or p_idempotency_key is null or char_length(btrim(p_idempotency_key)) not between 1 and 160 then
    raise exception 'fact candidate input is invalid' using errcode = '22023';
  end if;

  select i.workspace_id into workspace_value
  from public.investigations i
  join public.workspace_memberships m on m.workspace_id = i.workspace_id and m.user_id = caller_id
  where i.id = p_investigation_id
  for share of m;
  if workspace_value is null then raise exception 'investigation not found' using errcode = 'P0002'; end if;

  insert into public.investigation_fact_candidates (
    workspace_id, investigation_id, fact_key, value, provenance, expected_version, idempotency_key, submitted_by
  ) values (
    workspace_value, p_investigation_id, btrim(p_fact_key), p_value, p_provenance, p_expected_version, btrim(p_idempotency_key), caller_id
  ) on conflict (workspace_id, investigation_id, idempotency_key) do nothing
  returning * into candidate_row;
  if not found then
    select c.* into candidate_row from public.investigation_fact_candidates c
    where c.workspace_id = workspace_value and c.investigation_id = p_investigation_id
      and c.idempotency_key = btrim(p_idempotency_key);
    if candidate_row.fact_key <> btrim(p_fact_key) or candidate_row.value <> p_value
      or candidate_row.provenance <> p_provenance or candidate_row.expected_version <> p_expected_version then
      raise exception 'idempotency key was already used with different candidate content' using errcode = '23505';
    end if;
    return jsonb_build_object('candidate', jsonb_build_object(
      'id', candidate_row.id, 'fact_key', candidate_row.fact_key, 'status', candidate_row.status, 'created_at', candidate_row.created_at
    ), 'duplicate', true);
  end if;
  return jsonb_build_object('candidate', jsonb_build_object(
    'id', candidate_row.id, 'fact_key', candidate_row.fact_key, 'status', candidate_row.status, 'created_at', candidate_row.created_at
  ), 'duplicate', false);
end;
$$;

create function public.review_investigation_fact_candidate(
  p_investigation_id uuid,
  p_candidate_id uuid,
  p_decision text,
  p_review_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  candidate_row public.investigation_fact_candidates%rowtype;
  fact_result jsonb;
  next_status text;
begin
  if caller_id is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if p_decision is null or p_decision not in ('approve', 'reject') or p_review_note is not null and char_length(p_review_note) > 1000 then
    raise exception 'fact candidate review input is invalid' using errcode = '22023';
  end if;
  select c.* into candidate_row
  from public.investigation_fact_candidates c
  join public.workspace_memberships m on m.workspace_id = c.workspace_id
  where c.id = p_candidate_id and c.investigation_id = p_investigation_id
    and m.user_id = caller_id and m.role in ('owner', 'admin')
  for update of c;
  if not found then raise exception 'fact candidate not found' using errcode = 'P0002'; end if;
  next_status := case when p_decision = 'approve' then 'approved' else 'rejected' end;
  if candidate_row.status <> 'pending' then
    if candidate_row.status = next_status then return jsonb_build_object('candidate', to_jsonb(candidate_row), 'duplicate', true); end if;
    raise exception 'fact candidate has already been reviewed' using errcode = '40001';
  end if;

  if p_decision = 'approve' then
    fact_result := public.set_investigation_fact(
      candidate_row.investigation_id, candidate_row.fact_key, candidate_row.value,
      candidate_row.provenance, candidate_row.expected_version, candidate_row.idempotency_key
    );
  end if;
  update public.investigation_fact_candidates
  set status = next_status, reviewed_by = caller_id, reviewed_at = now(), review_note = nullif(btrim(p_review_note), '')
  where id = candidate_row.id returning * into candidate_row;
  return jsonb_build_object('candidate', to_jsonb(candidate_row), 'fact', fact_result, 'duplicate', false);
end;
$$;

revoke all on function public.propose_investigation_fact_candidate(uuid, text, jsonb, jsonb, integer, text) from public, anon;
grant execute on function public.propose_investigation_fact_candidate(uuid, text, jsonb, jsonb, integer, text) to authenticated;
revoke all on function public.review_investigation_fact_candidate(uuid, uuid, text, text) from public, anon;
grant execute on function public.review_investigation_fact_candidate(uuid, uuid, text, text) to authenticated;

revoke all on function public.set_investigation_fact(uuid, text, jsonb, jsonb, integer, text) from authenticated;
