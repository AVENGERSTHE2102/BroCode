create function public.validate_action_proposal_source_versions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if jsonb_typeof(new.evidence) is distinct from 'array' then
    raise exception 'action proposal evidence must be an array'
      using errcode = '23514';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(new.evidence) as evidence(value)
    where not public.workspace_source_version_accessible(
      new.workspace_id, evidence.value ->> 'sourceId', evidence.value ->> 'version'
    )
  ) then
    raise exception 'action proposal evidence must reference accessible workspace source versions'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.validate_action_proposal_source_versions() from public, anon, authenticated, service_role;
create trigger validate_action_proposal_source_versions
  before insert or update of workspace_id, evidence on public.action_proposals
  for each row execute function public.validate_action_proposal_source_versions();
