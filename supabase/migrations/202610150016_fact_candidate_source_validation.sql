create table public.workspace_source_versions (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  source_type text not null check (source_type ~ '^[a-z][a-z0-9_]{0,63}$'),
  source_id text not null check (
    char_length(source_id) between 3 and 1500 and source_id ~ '^[a-z][a-z0-9_-]*:'
    and split_part(source_id, ':', 1) = source_type
  ),
  version text not null check (char_length(version) between 1 and 500),
  access_scope text not null check (access_scope in ('workspace', 'admin')),
  registered_at timestamptz not null default now(),
  primary key (workspace_id, source_type, source_id, version)
);

alter table public.workspace_source_versions enable row level security;
revoke all on public.workspace_source_versions from public, anon, authenticated, service_role;

create function public.register_workspace_source_version(
  p_workspace_id uuid,
  p_source_type text,
  p_source_id text,
  p_version text,
  p_access_scope text default 'workspace'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_workspace_id is null or p_source_type is null or p_source_type !~ '^[a-z][a-z0-9_]{0,63}$'
    or p_source_id is null or char_length(p_source_id) not between 3 and 1500
    or p_source_id !~ '^[a-z][a-z0-9_-]*:' or split_part(p_source_id, ':', 1) <> p_source_type
    or p_version is null or char_length(p_version) not between 1 and 500
    or p_access_scope not in ('workspace', 'admin') then
    raise exception 'source version input is invalid' using errcode = '22023';
  end if;
  insert into public.workspace_source_versions(workspace_id, source_type, source_id, version, access_scope)
  values (p_workspace_id, p_source_type, p_source_id, p_version, p_access_scope)
  on conflict (workspace_id, source_type, source_id, version)
  do update set access_scope = excluded.access_scope;
end;
$$;

revoke all on function public.register_workspace_source_version(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.register_workspace_source_version(uuid, text, text, text, text) to service_role;

create function public.sync_github_workspace_source_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    delete from public.workspace_source_versions
    where workspace_id = old.workspace_id and source_type = 'github' and source_id = old.record_id;
    return old;
  end if;
  perform public.register_workspace_source_version(
    new.workspace_id, 'github', new.record_id, new.provider_version,
    case when new.record_type = 'security_finding' then 'admin' else 'workspace' end
  );
  return new;
end;
$$;

create trigger register_github_current_source_version
  after insert or update of record_id, provider_version, record_type or delete on public.workspace_github_records
  for each row execute function public.sync_github_workspace_source_version();

create function public.sync_github_workspace_history_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.register_workspace_source_version(
    new.workspace_id, 'github', new.record_id, new.provider_version,
    case when new.record_type = 'security_finding' then 'admin' else 'workspace' end
  );
  return new;
end;
$$;

create trigger register_github_historical_source_version
  after insert on public.workspace_github_record_versions
  for each row execute function public.sync_github_workspace_history_version();

create function public.remove_github_workspace_source_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.workspace_github_records r
    where r.workspace_id = old.workspace_id and r.record_id = old.record_id and r.provider_version = old.provider_version
  ) then
    delete from public.workspace_source_versions
    where workspace_id = old.workspace_id and source_type = 'github'
      and source_id = old.record_id and version = old.provider_version;
  end if;
  return old;
end;
$$;

create trigger remove_github_historical_source_version
  after delete on public.workspace_github_record_versions
  for each row execute function public.remove_github_workspace_source_version();

insert into public.workspace_source_versions(workspace_id, source_type, source_id, version, access_scope)
select workspace_id, 'github', record_id, provider_version,
  case when record_type = 'security_finding' then 'admin' else 'workspace' end
from public.workspace_github_records
on conflict (workspace_id, source_type, source_id, version) do update set access_scope = excluded.access_scope;

insert into public.workspace_source_versions(workspace_id, source_type, source_id, version, access_scope)
select workspace_id, 'github', record_id, provider_version,
  case when record_type = 'security_finding' then 'admin' else 'workspace' end
from public.workspace_github_record_versions
on conflict (workspace_id, source_type, source_id, version) do update set access_scope = excluded.access_scope;

create function public.workspace_source_version_accessible(p_workspace_id uuid, p_source_id text, p_version text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_source_versions s
    where s.workspace_id = p_workspace_id and s.source_id = p_source_id and s.version = p_version
      and s.source_type = split_part(p_source_id, ':', 1)
      and (s.access_scope = 'workspace' or exists (
        select 1 from public.workspace_memberships m
        where m.workspace_id = p_workspace_id and m.user_id = auth.uid() and m.role in ('owner', 'admin')
      ))
  );
$$;

revoke all on function public.workspace_source_version_accessible(uuid, text, text) from public, anon, authenticated, service_role;

create function public.validate_fact_candidate_source_versions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'approved' and old.status is distinct from new.status and exists (
    select 1
    from jsonb_array_elements(new.provenance) as evidence(value)
    where not public.workspace_source_version_accessible(
      new.workspace_id, evidence.value ->> 'sourceId', evidence.value ->> 'version'
    )
  ) then
    raise exception 'fact candidate provenance must reference accessible workspace source versions'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger validate_fact_candidate_source_versions
  before update of status on public.investigation_fact_candidates
  for each row execute function public.validate_fact_candidate_source_versions();

revoke all on function public.validate_fact_candidate_source_versions() from public, anon, authenticated, service_role;
