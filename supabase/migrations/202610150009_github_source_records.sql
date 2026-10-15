create table public.workspace_github_records (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  github_source_id uuid not null references public.workspace_github_sources(id) on delete cascade,
  record_id text not null check (char_length(record_id) between 1 and 1500),
  record_type text not null check (record_type in ('repository', 'commit', 'issue', 'pull_request', 'file')),
  provider_version text not null check (char_length(provider_version) between 1 and 500),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  version integer not null default 1 check (version > 0),
  updated_at timestamptz not null default now(),
  unique (github_source_id, record_id)
);

create index workspace_github_records_workspace_idx on public.workspace_github_records (workspace_id, github_source_id);
alter table public.workspace_github_records enable row level security;
revoke all on public.workspace_github_records from public, anon, authenticated, service_role;
grant select on public.workspace_github_records to authenticated;
grant select, insert, update, delete on public.workspace_github_records to service_role;

create policy "workspace members can read imported GitHub records"
  on public.workspace_github_records for select to authenticated
  using (exists (
    select 1 from public.workspace_memberships m
    where m.workspace_id = workspace_github_records.workspace_id and m.user_id = (select auth.uid())
  ));

create trigger project_workspace_github_records
  after insert or update or delete on public.workspace_github_records
  for each row execute function public.enqueue_graph_projection();

create function public.sync_workspace_github_records(
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
  record_kind text;
  provider_revision text;
  source_url_value text;
  payload_value jsonb;
  changed_count integer := 0;
  affected integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_workspace_id is null or p_user_id is null or p_source_id is null
    or jsonb_typeof(p_records) is distinct from 'array'
    or jsonb_array_length(p_records) not between 1 and 1101 then
    raise exception 'GitHub import input is invalid' using errcode = '22023';
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
    record_kind := item ->> 'record_type';
    provider_revision := item ->> 'provider_version';
    source_url_value := item ->> 'source_url';
    if record_key is null or char_length(record_key) not between 1 and 1500 or record_key ~ '[[:cntrl:]]'
      or record_kind is null or record_kind not in ('repository', 'commit', 'issue', 'pull_request', 'file')
      or provider_revision is null or char_length(provider_revision) not between 1 and 500
      or source_url_value is null or source_url_value not like 'https://github.com/%'
      or item ->> 'repository_id' is null or (item ->> 'repository_id')::bigint <> source_row.repository_id
      or item ->> 'repository_name' is null or item ->> 'repository_name' <> source_row.full_name
      or item ->> 'repository_url' is null or item ->> 'repository_url' <> source_row.html_url
      or char_length(coalesce(item ->> 'title', '')) > 1000
      or char_length(coalesce(item ->> 'body', '')) > 4000
      or char_length(coalesce(item ->> 'path', '')) > 1000
      or char_length(coalesce(item ->> 'author', '')) > 200
      or nullif(item ->> 'captured_at', '') is null then
      raise exception 'GitHub import record is invalid' using errcode = '22023';
    end if;
    if record_kind = 'repository' and record_key <> 'github:repo:' || source_row.repository_id::text then
      raise exception 'GitHub repository identity is invalid' using errcode = '22023';
    end if;
    if record_kind = 'commit' and record_key !~ ('^github:commit:' || source_row.repository_id::text || ':[a-fA-F0-9]{40}$')
      or record_kind = 'issue' and record_key !~ ('^github:issue:' || source_row.repository_id::text || ':[0-9]+$')
      or record_kind = 'pull_request' and record_key !~ ('^github:pull:' || source_row.repository_id::text || ':[0-9]+$')
      or record_kind = 'file' and record_key not like 'github:file:' || source_row.repository_id::text || ':%' then
      raise exception 'GitHub record identity is invalid' using errcode = '22023';
    end if;
    payload_value := jsonb_build_object(
      'workspace_id', p_workspace_id, 'github_source_id', p_source_id,
      'record_id', record_key, 'record_type', record_kind, 'provider_version', provider_revision,
      'source_url', source_url_value, 'title', coalesce(item ->> 'title', ''),
      'body', coalesce(item ->> 'body', ''), 'path', coalesce(item ->> 'path', ''),
      'author', coalesce(item ->> 'author', ''), 'updated_at', item ->> 'updated_at',
      'captured_at', item ->> 'captured_at', 'repository_id', source_row.repository_id::text,
      'repository_name', source_row.full_name, 'repository_url', source_row.html_url,
      'default_branch', source_row.default_branch
    );
    insert into public.workspace_github_records(workspace_id, github_source_id, record_id, record_type, provider_version, payload)
      values (p_workspace_id, p_source_id, record_key, record_kind, provider_revision, payload_value)
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

revoke all on function public.sync_workspace_github_records(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.sync_workspace_github_records(uuid, uuid, uuid, jsonb) to service_role;
