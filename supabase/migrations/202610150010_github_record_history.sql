create table public.workspace_github_record_versions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  github_source_id uuid not null references public.workspace_github_sources(id) on delete cascade,
  current_record_id uuid not null references public.workspace_github_records(id) on delete cascade,
  record_id text not null check (char_length(record_id) between 1 and 1500),
  record_type text not null check (record_type in ('repository', 'commit', 'issue', 'pull_request', 'file')),
  provider_version text not null check (char_length(provider_version) between 1 and 500),
  version integer not null check (version > 0),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  archived_at timestamptz not null default now(),
  unique (current_record_id, version)
);

create index workspace_github_record_versions_lookup_idx
  on public.workspace_github_record_versions (workspace_id, github_source_id, record_id, version desc);
alter table public.workspace_github_record_versions enable row level security;
revoke all on public.workspace_github_record_versions from public, anon, authenticated, service_role;
grant select on public.workspace_github_record_versions to authenticated;

create policy "workspace members can read GitHub record history"
  on public.workspace_github_record_versions for select to authenticated
  using (exists (
    select 1 from public.workspace_memberships m
    where m.workspace_id = workspace_github_record_versions.workspace_id and m.user_id = (select auth.uid())
  ));

create function public.archive_workspace_github_record_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.provider_version is not distinct from new.provider_version
    and old.payload - 'captured_at' is not distinct from new.payload - 'captured_at' then
    return new;
  end if;
  insert into public.workspace_github_record_versions(
    workspace_id, github_source_id, current_record_id, record_id, record_type,
    provider_version, version, payload
  ) values (
    old.workspace_id, old.github_source_id, old.id, old.record_id, old.record_type,
    old.provider_version, old.version, old.payload
  ) on conflict (current_record_id, version) do nothing;
  return new;
end;
$$;

create trigger archive_workspace_github_record_before_update
  before update of provider_version, payload on public.workspace_github_records
  for each row execute function public.archive_workspace_github_record_version();
revoke all on function public.archive_workspace_github_record_version() from public, anon, authenticated;

create trigger project_workspace_github_record_versions
  after insert or delete on public.workspace_github_record_versions
  for each row execute function public.enqueue_graph_projection();
