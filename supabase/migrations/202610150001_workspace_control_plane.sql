create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 80),
  graph_name text generated always as ('wp_' || replace(id::text, '-', '')) stored unique,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table public.workspace_memberships (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'member')),
  joined_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create index workspace_memberships_user_idx on public.workspace_memberships (user_id, joined_at);

alter table public.workspaces enable row level security;
alter table public.workspace_memberships enable row level security;

revoke all on public.workspaces from anon, authenticated;
revoke all on public.workspace_memberships from anon, authenticated;
grant select on public.workspaces, public.workspace_memberships to authenticated;

create policy "members can read their workspaces"
  on public.workspaces for select to authenticated
  using (
    exists (
      select 1 from public.workspace_memberships m
      where m.workspace_id = id and m.user_id = (select auth.uid())
    )
  );

create policy "users can read their memberships"
  on public.workspace_memberships for select to authenticated
  using (user_id = (select auth.uid()));

create function public.create_workspace(workspace_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_workspace_id uuid;
  clean_name text := btrim(workspace_name);
  caller_id uuid := auth.uid();
begin
  if caller_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if clean_name is null or char_length(clean_name) not between 2 and 80 then
    raise exception 'workspace name must be between 2 and 80 characters' using errcode = '22023';
  end if;

  insert into public.workspaces (name, created_by)
  values (clean_name, caller_id)
  returning id into new_workspace_id;

  insert into public.workspace_memberships (workspace_id, user_id, role)
  values (new_workspace_id, caller_id, 'owner');

  return new_workspace_id;
end;
$$;

revoke all on function public.create_workspace(text) from public, anon;
grant execute on function public.create_workspace(text) to authenticated;
