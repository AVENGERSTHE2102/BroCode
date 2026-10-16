alter table public.workspace_github_sources
  add column last_synced_at timestamptz,
  add column last_synced_commit_sha text check (last_synced_commit_sha is null or last_synced_commit_sha ~ '^[a-fA-F0-9]{40}$');

create or replace function public.finish_workspace_github_sync(
  p_workspace_id uuid,
  p_source_id uuid,
  p_run_id uuid,
  p_status text,
  p_counts jsonb default '{}'::jsonb,
  p_changed_records integer default 0,
  p_partial_errors jsonb default '[]'::jsonb,
  p_error_code text default null,
  p_synced_commit_sha text default null
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
    or (p_synced_commit_sha is not null and p_synced_commit_sha !~ '^[a-fA-F0-9]{40}$')
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
  if not found then return false; end if;
  if p_status in ('succeeded', 'partial') then
    update public.workspace_github_sources set
      last_synced_at = now(),
      last_synced_commit_sha = coalesce(p_synced_commit_sha, last_synced_commit_sha)
    where id = p_source_id and workspace_id = p_workspace_id;
  end if;
  return true;
end;
$$;

revoke all on function public.finish_workspace_github_sync(uuid, uuid, uuid, text, jsonb, integer, jsonb, text, text) from public, anon, authenticated, service_role;
grant execute on function public.finish_workspace_github_sync(uuid, uuid, uuid, text, jsonb, integer, jsonb, text, text) to service_role;
