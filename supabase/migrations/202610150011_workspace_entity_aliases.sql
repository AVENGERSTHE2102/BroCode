create table public.workspace_entity_aliases (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  alias text not null check (char_length(alias) between 2 and 128 and char_length(btrim(alias)) between 2 and 128 and alias ~ '^[A-Za-z0-9._:/ -]+$'),
  normalized_alias text generated always as (lower(btrim(alias))) stored,
  target_source_id text not null check (char_length(target_source_id) between 1 and 256),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (workspace_id, normalized_alias)
);

create index workspace_entity_aliases_workspace_idx on public.workspace_entity_aliases (workspace_id, normalized_alias);
alter table public.workspace_entity_aliases enable row level security;
revoke all on public.workspace_entity_aliases from public, anon, authenticated, service_role;
grant select, delete on public.workspace_entity_aliases to authenticated;
grant select, insert, delete on public.workspace_entity_aliases to service_role;

create policy "workspace members can read entity aliases"
  on public.workspace_entity_aliases for select to authenticated
  using (exists (
    select 1 from public.workspace_memberships m
    where m.workspace_id = workspace_entity_aliases.workspace_id and m.user_id = (select auth.uid())
  ));

create policy "workspace admins can remove entity aliases"
  on public.workspace_entity_aliases for delete to authenticated
  using (exists (
    select 1 from public.workspace_memberships m
    where m.workspace_id = workspace_entity_aliases.workspace_id
      and m.user_id = (select auth.uid()) and m.role in ('owner', 'admin')
  ));

create function public.create_workspace_entity_alias(
  p_workspace_id uuid,
  p_user_id uuid,
  p_alias text,
  p_target_source_id text
)
returns public.workspace_entity_aliases
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.workspace_entity_aliases;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_workspace_id is null or p_user_id is null or p_alias is null or p_target_source_id is null
    or char_length(p_alias) not between 2 and 128 or char_length(btrim(p_alias)) not between 2 and 128
    or p_alias !~ '^[A-Za-z0-9._:/ -]+$'
    or char_length(btrim(p_target_source_id)) not between 1 and 256 then
    raise exception 'Alias input is invalid' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.workspace_memberships m
    where m.workspace_id = p_workspace_id and m.user_id = p_user_id and m.role in ('owner', 'admin')
  ) then raise exception 'workspace admin access required' using errcode = '42501'; end if;
  insert into public.workspace_entity_aliases(workspace_id, alias, target_source_id, created_by)
  values (p_workspace_id, btrim(p_alias), btrim(p_target_source_id), p_user_id)
  returning * into result;
  return result;
end;
$$;

revoke all on function public.create_workspace_entity_alias(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.create_workspace_entity_alias(uuid, uuid, text, text) to service_role;
