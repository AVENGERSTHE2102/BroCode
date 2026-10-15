create table public.workspace_github_installations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  installation_id bigint not null check (installation_id > 0),
  github_user_id bigint not null check (github_user_id > 0),
  github_login text not null check (char_length(github_login) between 1 and 100),
  authorized_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (workspace_id, installation_id)
);

alter table public.workspace_github_installations enable row level security;
revoke all on public.workspace_github_installations from anon, authenticated;
grant select, delete on public.workspace_github_installations to authenticated;
grant select, insert, update, delete on public.workspace_github_installations to service_role;

create policy "workspace members can read GitHub installations"
  on public.workspace_github_installations for select to authenticated
  using (exists (
    select 1 from public.workspace_memberships m
    where m.workspace_id = workspace_github_installations.workspace_id and m.user_id = (select auth.uid())
  ));

create policy "workspace admins can remove GitHub installations"
  on public.workspace_github_installations for delete to authenticated
  using (exists (
    select 1 from public.workspace_memberships m
    where m.workspace_id = workspace_github_installations.workspace_id
      and m.user_id = (select auth.uid()) and m.role in ('owner', 'admin')
  ));

create function public.bind_workspace_github_installation(
  p_workspace_id uuid,
  p_user_id uuid,
  p_installation_id bigint,
  p_github_user_id bigint,
  p_github_login text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_workspace_id is null or p_user_id is null or p_installation_id is null or p_installation_id <= 0
    or p_github_user_id is null or p_github_user_id <= 0 or p_github_login is null
    or char_length(btrim(p_github_login)) not between 1 and 100 then
    raise exception 'GitHub installation input is invalid' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.workspace_memberships m
    where m.workspace_id = p_workspace_id and m.user_id = p_user_id and m.role in ('owner', 'admin')
  ) then raise exception 'workspace admin access required' using errcode = '42501'; end if;
  insert into public.workspace_github_installations(workspace_id, installation_id, github_user_id, github_login, authorized_by)
  values (p_workspace_id, p_installation_id, p_github_user_id, btrim(p_github_login), p_user_id)
  on conflict (workspace_id, installation_id) do update
    set github_user_id = excluded.github_user_id, github_login = excluded.github_login, authorized_by = excluded.authorized_by;
end;
$$;

revoke all on function public.bind_workspace_github_installation(uuid, uuid, bigint, bigint, text) from public, anon, authenticated;
grant execute on function public.bind_workspace_github_installation(uuid, uuid, bigint, bigint, text) to service_role;

create table public.workspace_github_sources (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  installation_id bigint not null check (installation_id > 0),
  repository_id bigint not null check (repository_id > 0),
  full_name text not null check (char_length(full_name) between 3 and 201),
  html_url text not null check (html_url like 'https://github.com/%'),
  default_branch text not null default '' check (char_length(default_branch) <= 255),
  provider_updated_at timestamptz,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (workspace_id, repository_id),
  foreign key (workspace_id, installation_id)
    references public.workspace_github_installations(workspace_id, installation_id) on delete cascade
);

create index workspace_github_sources_workspace_idx on public.workspace_github_sources (workspace_id, created_at desc);
alter table public.workspace_github_sources enable row level security;
revoke all on public.workspace_github_sources from anon, authenticated;
grant select, delete on public.workspace_github_sources to authenticated;
grant select, insert, delete on public.workspace_github_sources to service_role;

create policy "workspace members can read GitHub sources"
  on public.workspace_github_sources for select to authenticated
  using (exists (
    select 1 from public.workspace_memberships m
    where m.workspace_id = workspace_github_sources.workspace_id and m.user_id = (select auth.uid())
  ));

create policy "workspace admins can remove GitHub sources"
  on public.workspace_github_sources for delete to authenticated
  using (exists (
    select 1 from public.workspace_memberships m
    where m.workspace_id = workspace_github_sources.workspace_id
      and m.user_id = (select auth.uid()) and m.role in ('owner', 'admin')
  ));

create function public.create_workspace_github_source(
  p_workspace_id uuid,
  p_user_id uuid,
  p_installation_id bigint,
  p_repository_id bigint,
  p_full_name text,
  p_html_url text,
  p_default_branch text,
  p_provider_updated_at timestamptz
)
returns public.workspace_github_sources
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.workspace_github_sources;
begin
  if p_workspace_id is null or p_user_id is null or p_installation_id is null or p_installation_id <= 0
    or p_repository_id is null or p_repository_id <= 0 or p_full_name is null or p_html_url is null
    or char_length(btrim(p_full_name)) not between 3 and 201
    or p_html_url not like 'https://github.com/%'
    or char_length(coalesce(p_default_branch, '')) > 255 then
    raise exception 'GitHub source input is invalid' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.workspace_memberships m
    where m.workspace_id = p_workspace_id and m.user_id = p_user_id and m.role in ('owner', 'admin')
  ) then raise exception 'workspace admin access required' using errcode = '42501'; end if;
  if not exists (
    select 1 from public.workspace_github_installations i
    where i.workspace_id = p_workspace_id and i.installation_id = p_installation_id
  ) then raise exception 'GitHub installation is not bound to this workspace' using errcode = '42501'; end if;
  insert into public.workspace_github_sources(
    workspace_id, installation_id, repository_id, full_name, html_url, default_branch, provider_updated_at, created_by
  ) values (
    p_workspace_id, p_installation_id, p_repository_id, btrim(p_full_name), p_html_url,
    coalesce(p_default_branch, ''), p_provider_updated_at, p_user_id
  ) returning * into result;
  return result;
end;
$$;

revoke all on function public.create_workspace_github_source(uuid, uuid, bigint, bigint, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.create_workspace_github_source(uuid, uuid, bigint, bigint, text, text, text, timestamptz) to service_role;
