create function public.validate_attempt_source_versions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.retry_explanation is not null and exists (
    select 1
    from jsonb_array_elements(new.changed_conditions) as evidence(value)
    where not public.workspace_source_version_accessible(
      new.workspace_id, evidence.value ->> 'sourceId', evidence.value ->> 'version'
    )
  ) then
    raise exception 'attempt changed-condition evidence must reference available workspace source versions'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger validate_attempt_source_versions
  before insert or update of workspace_id, retry_explanation, changed_conditions on public.investigation_attempts
  for each row execute function public.validate_attempt_source_versions();

revoke all on function public.validate_attempt_source_versions() from public, anon, authenticated, service_role;
