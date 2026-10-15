alter table public.workspace_github_sources
  add constraint workspace_github_sources_workspace_id_id_key unique (workspace_id, id);

create table public.workspace_github_sync_state (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  github_source_id uuid not null,
  run_id uuid not null,
  started_by uuid not null references auth.users(id) on delete restrict,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  status text not null check (status in ('running', 'succeeded', 'partial', 'failed')),
  counts jsonb not null default '{}'::jsonb check (jsonb_typeof(counts) = 'object'),
  changed_records integer not null default 0 check (changed_records >= 0),
  partial_errors jsonb not null default '[]'::jsonb check (
    case when jsonb_typeof(partial_errors) = 'array' then jsonb_array_length(partial_errors) <= 20 else false end
  ),
  error_code text check (error_code in ('provider_error', 'storage_error', 'sync_error')),
  primary key (workspace_id, github_source_id),
  foreign key (workspace_id, github_source_id)
    references public.workspace_github_sources(workspace_id, id) on delete cascade,
  check (
    (status = 'running' and completed_at is null and error_code is null and partial_errors = '[]'::jsonb)
    or (status = 'succeeded' and completed_at is not null and error_code is null and partial_errors = '[]'::jsonb)
    or (status = 'partial' and completed_at is not null and error_code is null and jsonb_array_length(partial_errors) > 0)
    or (status = 'failed' and completed_at is not null and error_code is not null and partial_errors = '[]'::jsonb)
  )
);

alter table public.workspace_github_sync_state enable row level security;
revoke all on public.workspace_github_sync_state from public, anon, authenticated, service_role;
grant select on public.workspace_github_sync_state to authenticated;
create policy "workspace admins can read GitHub sync status"
  on public.workspace_github_sync_state for select to authenticated
  using (exists (
    select 1 from public.workspace_memberships m
    where m.workspace_id = workspace_github_sync_state.workspace_id
      and m.user_id = (select auth.uid()) and m.role in ('owner', 'admin')
  ));

create function public.begin_workspace_github_sync(
  p_workspace_id uuid,
  p_source_id uuid,
  p_user_id uuid,
  p_run_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_workspace_id is null or p_source_id is null or p_user_id is null or p_run_id is null then
    raise exception 'GitHub sync input is invalid' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.workspace_memberships m
    where m.workspace_id = p_workspace_id and m.user_id = p_user_id and m.role in ('owner', 'admin')
  ) or not exists (
    select 1 from public.workspace_github_sources s
    where s.workspace_id = p_workspace_id and s.id = p_source_id
  ) then
    raise exception 'workspace admin access or GitHub source required' using errcode = '42501';
  end if;
  insert into public.workspace_github_sync_state (
    workspace_id, github_source_id, run_id, started_by, started_at, completed_at,
    status, counts, changed_records, partial_errors, error_code
  ) values (
    p_workspace_id, p_source_id, p_run_id, p_user_id, now(), null,
    'running', '{}'::jsonb, 0, '[]'::jsonb, null
  ) on conflict (workspace_id, github_source_id) do update set
    run_id = excluded.run_id, started_by = excluded.started_by, started_at = excluded.started_at,
    completed_at = null, status = 'running', counts = '{}'::jsonb, changed_records = 0,
    partial_errors = '[]'::jsonb, error_code = null;
  return true;
end;
$$;

revoke all on function public.begin_workspace_github_sync(uuid, uuid, uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.begin_workspace_github_sync(uuid, uuid, uuid, uuid) to service_role;

create function public.finish_workspace_github_sync(
  p_workspace_id uuid,
  p_source_id uuid,
  p_run_id uuid,
  p_status text,
  p_counts jsonb default '{}'::jsonb,
  p_changed_records integer default 0,
  p_partial_errors jsonb default '[]'::jsonb,
  p_error_code text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_workspace_id is null or p_source_id is null or p_run_id is null or p_status is null
    or p_status not in ('succeeded', 'partial', 'failed')
    or p_counts is null or jsonb_typeof(p_counts) <> 'object'
    or p_changed_records is null or p_changed_records < 0
    or p_partial_errors is null or jsonb_typeof(p_partial_errors) <> 'array'
    or jsonb_array_length(p_partial_errors) > 20
    or (p_status = 'failed' and (p_error_code is null or p_error_code not in ('provider_error', 'storage_error', 'sync_error')))
    or (p_status <> 'failed' and p_error_code is not null)
    or (p_status = 'succeeded' and jsonb_array_length(p_partial_errors) > 0)
    or (p_status = 'partial' and jsonb_array_length(p_partial_errors) = 0)
    or exists (
      select 1 from jsonb_array_elements(p_partial_errors) as item(value)
      where jsonb_typeof(item.value) <> 'string' or char_length(item.value #>> '{}') not between 1 and 500
    ) then
    raise exception 'GitHub sync result is invalid' using errcode = '22023';
  end if;
  update public.workspace_github_sync_state set
    completed_at = now(), status = p_status, counts = p_counts,
    changed_records = p_changed_records, partial_errors = p_partial_errors, error_code = p_error_code
  where workspace_id = p_workspace_id and github_source_id = p_source_id
    and run_id = p_run_id and status = 'running';
  return found;
end;
$$;

revoke all on function public.finish_workspace_github_sync(uuid, uuid, uuid, text, jsonb, integer, jsonb, text) from public, anon, authenticated, service_role;
grant execute on function public.finish_workspace_github_sync(uuid, uuid, uuid, text, jsonb, integer, jsonb, text) to service_role;
