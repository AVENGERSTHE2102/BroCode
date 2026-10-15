alter table public.workspace_github_records drop constraint workspace_github_records_record_type_check;
alter table public.workspace_github_records add constraint workspace_github_records_record_type_check
  check (record_type in ('repository', 'commit', 'issue', 'pull_request', 'file', 'security_finding'));
alter table public.workspace_github_record_versions drop constraint workspace_github_record_versions_record_type_check;
alter table public.workspace_github_record_versions add constraint workspace_github_record_versions_record_type_check
  check (record_type in ('repository', 'commit', 'issue', 'pull_request', 'file', 'security_finding'));

drop policy "workspace members can read imported GitHub records" on public.workspace_github_records;
create policy "workspace members can read imported GitHub records"
  on public.workspace_github_records for select to authenticated
  using (exists (
    select 1 from public.workspace_memberships m
    where m.workspace_id = workspace_github_records.workspace_id and m.user_id = (select auth.uid())
      and (workspace_github_records.record_type <> 'security_finding' or m.role in ('owner', 'admin'))
  ));

drop policy "workspace members can read GitHub record history" on public.workspace_github_record_versions;
create policy "workspace members can read GitHub record history"
  on public.workspace_github_record_versions for select to authenticated
  using (exists (
    select 1 from public.workspace_memberships m
    where m.workspace_id = workspace_github_record_versions.workspace_id and m.user_id = (select auth.uid())
      and (workspace_github_record_versions.record_type <> 'security_finding' or m.role in ('owner', 'admin'))
  ));

create function public.sync_workspace_github_security_findings(
  p_workspace_id uuid,
  p_user_id uuid,
  p_source_id uuid,
  p_records jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_row public.workspace_github_sources;
  item jsonb;
  record_key text;
  alert_number text;
  provider_revision text;
  source_url_value text;
  details_value jsonb;
  payload_value jsonb;
  changed_count integer := 0;
  affected integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_workspace_id is null or p_user_id is null or p_source_id is null
    or jsonb_typeof(p_records) is distinct from 'array'
    or jsonb_array_length(p_records) not between 1 and 200 then
    raise exception 'Security finding import input is invalid' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.workspace_memberships m
    where m.workspace_id = p_workspace_id and m.user_id = p_user_id and m.role in ('owner', 'admin')
  ) then raise exception 'workspace admin access required' using errcode = '42501'; end if;
  select s.* into source_row from public.workspace_github_sources s
    where s.id = p_source_id and s.workspace_id = p_workspace_id for update;
  if not found then raise exception 'GitHub source is not connected to this workspace' using errcode = '42501'; end if;

  for item in select value from jsonb_array_elements(p_records) loop
    record_key := item ->> 'record_id';
    alert_number := substring(record_key from ('^github:security:' || source_row.repository_id::text || ':([1-9][0-9]*)$'));
    provider_revision := item ->> 'provider_version';
    source_url_value := item ->> 'source_url';
    details_value := item -> 'details';
    if alert_number is null or record_key ~ '[[:cntrl:]]'
      or item ->> 'record_type' is distinct from 'security_finding'
      or provider_revision is null or char_length(provider_revision) not between 1 and 500
      or source_url_value is distinct from source_row.html_url || '/security/dependabot/' || alert_number
      or item ->> 'repository_id' is null or (item ->> 'repository_id')::bigint <> source_row.repository_id
      or item ->> 'repository_name' is distinct from source_row.full_name
      or item ->> 'repository_url' is distinct from source_row.html_url
      or char_length(coalesce(item ->> 'title', '')) > 1000
      or char_length(coalesce(item ->> 'body', '')) > 4000
      or char_length(coalesce(item ->> 'path', '')) > 1000
      or char_length(coalesce(item ->> 'author', '')) > 200
      or nullif(item ->> 'captured_at', '') is null
      or jsonb_typeof(details_value) is distinct from 'object'
      or octet_length(details_value::text) > 12000 then
      raise exception 'Security finding record is invalid' using errcode = '22023';
    end if;
    payload_value := jsonb_build_object(
      'workspace_id', p_workspace_id, 'github_source_id', p_source_id,
      'record_id', record_key, 'record_type', 'security_finding', 'provider_version', provider_revision,
      'source_url', source_url_value, 'title', coalesce(item ->> 'title', ''),
      'body', coalesce(item ->> 'body', ''), 'path', coalesce(item ->> 'path', ''),
      'author', coalesce(item ->> 'author', ''), 'updated_at', item ->> 'updated_at',
      'captured_at', item ->> 'captured_at', 'repository_id', source_row.repository_id::text,
      'repository_name', source_row.full_name, 'repository_url', source_row.html_url,
      'default_branch', source_row.default_branch, 'details', details_value
    );
    insert into public.workspace_github_records(workspace_id, github_source_id, record_id, record_type, provider_version, payload)
      values (p_workspace_id, p_source_id, record_key, 'security_finding', provider_revision, payload_value)
      on conflict (github_source_id, record_id) do update
      set record_type = excluded.record_type, provider_version = excluded.provider_version,
          payload = excluded.payload, version = public.workspace_github_records.version + 1, updated_at = now()
      where public.workspace_github_records.provider_version is distinct from excluded.provider_version
        or public.workspace_github_records.payload - 'captured_at' is distinct from excluded.payload - 'captured_at';
    get diagnostics affected = row_count;
    changed_count := changed_count + affected;
  end loop;
  return changed_count;
end;
$$;

revoke all on function public.sync_workspace_github_security_findings(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.sync_workspace_github_security_findings(uuid, uuid, uuid, jsonb) to service_role;
