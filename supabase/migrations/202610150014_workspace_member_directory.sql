create function public.list_workspace_members(p_workspace_id uuid)
returns table(user_id uuid, role text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.workspace_memberships m
    where m.workspace_id = p_workspace_id and m.user_id = auth.uid()
  ) then
    raise exception 'workspace membership required' using errcode = '42501';
  end if;

  return query
  select m.user_id, m.role
  from public.workspace_memberships m
  where m.workspace_id = p_workspace_id
  order by m.role, m.joined_at, m.user_id;
end;
$$;

revoke all on function public.list_workspace_members(uuid) from public, anon;
grant execute on function public.list_workspace_members(uuid) to authenticated;
