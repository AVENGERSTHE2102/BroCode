alter table public.action_proposals
  add column execution_attempt integer not null default 0 check (execution_attempt >= 0),
  add column execution_lease_id uuid,
  add column execution_lease_until timestamptz,
  add column execution_result jsonb,
  add column execution_error text check (char_length(coalesce(execution_error, '')) <= 1000);

create function public.claim_action_proposal_execution(
  p_investigation_id uuid,
  p_proposal_id uuid,
  p_expected_hash text,
  p_lease_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  proposal public.action_proposals%rowtype;
  approval public.action_proposal_reviews%rowtype;
begin
  if auth.uid() is null then raise exception 'authenticated user required' using errcode = '42501'; end if;
  if p_expected_hash is null or p_expected_hash !~ '^[0-9a-f]{64}$' or p_lease_id is null then
    raise exception 'execution input is invalid' using errcode = '22023';
  end if;
  select p.* into proposal
  from public.action_proposals p
  join public.workspace_memberships m on m.workspace_id = p.workspace_id
  where p.id = p_proposal_id and p.investigation_id = p_investigation_id
    and m.user_id = auth.uid() and m.role in ('owner', 'admin')
  for update of p;
  if not found then raise exception 'proposal unavailable to this administrator' using errcode = 'P0002'; end if;
  if proposal.content_hash <> p_expected_hash then raise exception 'proposal content changed' using errcode = '40001'; end if;
  select r.* into approval from public.action_proposal_reviews r
  where r.workspace_id = proposal.workspace_id and r.proposal_id = proposal.id;
  if not found or approval.decision <> 'approve' or approval.content_hash <> proposal.content_hash then
    raise exception 'exact approval is required' using errcode = '42501';
  end if;
  if proposal.status = 'succeeded' then
    return jsonb_build_object('state', 'succeeded', 'result', proposal.execution_result);
  end if;
  if proposal.status = 'executing' and proposal.execution_lease_until > now() then
    return jsonb_build_object('state', 'executing', 'retry_after', proposal.execution_lease_until);
  end if;
  if proposal.status not in ('approved', 'failed', 'executing') then
    return jsonb_build_object('state', proposal.status);
  end if;
  if approval.reviewed_at < now() - interval '24 hours' then
    update public.action_proposals set status = 'stale', execution_lease_id = null, execution_lease_until = null
    where id = proposal.id and workspace_id = proposal.workspace_id;
    insert into public.investigation_events (workspace_id, investigation_id, actor_id, event_type, idempotency_key, payload)
    values (proposal.workspace_id, proposal.investigation_id, auth.uid(), 'action_execution_expired',
      'action_execution_expired:' || proposal.id::text,
      jsonb_build_object('proposal_id', proposal.id, 'content_hash', proposal.content_hash));
    return jsonb_build_object('state', 'stale');
  end if;
  update public.action_proposals set status = 'executing', execution_attempt = proposal.execution_attempt + 1,
    execution_lease_id = p_lease_id, execution_lease_until = now() + interval '10 minutes', execution_error = null
  where id = proposal.id and workspace_id = proposal.workspace_id
  returning * into proposal;
  insert into public.investigation_events (workspace_id, investigation_id, actor_id, event_type, idempotency_key, payload)
  values (proposal.workspace_id, proposal.investigation_id, auth.uid(), 'action_execution_started',
    'action_execution_started:' || proposal.id::text || ':' || proposal.execution_attempt::text,
    jsonb_build_object('proposal_id', proposal.id, 'content_hash', proposal.content_hash, 'attempt', proposal.execution_attempt));
  return jsonb_build_object(
    'state', 'claimed', 'lease_id', p_lease_id, 'attempt', proposal.execution_attempt,
    'proposal', jsonb_build_object('id', proposal.id, 'proposal_type', proposal.proposal_type, 'target', proposal.target,
      'inputs', proposal.inputs, 'evidence', proposal.evidence, 'rationale', proposal.rationale, 'risk', proposal.risk,
      'content_hash', proposal.content_hash, 'created_at', proposal.created_at)
  );
end;
$$;

create function public.finish_action_proposal_execution(
  p_investigation_id uuid,
  p_proposal_id uuid,
  p_lease_id uuid,
  p_success boolean,
  p_result jsonb,
  p_error text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  proposal public.action_proposals%rowtype;
  final_status text;
begin
  if auth.uid() is null then raise exception 'authenticated user required' using errcode = '42501'; end if;
  if p_lease_id is null or p_success is null or (p_success and (p_result is null or jsonb_typeof(p_result) <> 'object'))
    or char_length(coalesce(p_error, '')) > 1000 then
    raise exception 'execution result is invalid' using errcode = '22023';
  end if;
  select p.* into proposal from public.action_proposals p
  join public.workspace_memberships m on m.workspace_id = p.workspace_id
  where p.id = p_proposal_id and p.investigation_id = p_investigation_id
    and m.user_id = auth.uid() and m.role in ('owner', 'admin')
  for update of p;
  if not found then raise exception 'proposal unavailable to this administrator' using errcode = 'P0002'; end if;
  if proposal.status <> 'executing' or proposal.execution_lease_id <> p_lease_id then
    raise exception 'execution lease is no longer current' using errcode = '40001';
  end if;
  final_status := case when p_success then 'succeeded' else 'failed' end;
  update public.action_proposals set status = final_status, execution_result = case when p_success then p_result else null end,
    execution_error = case when p_success then null else left(coalesce(p_error, 'Execution could not be verified.'), 1000) end,
    execution_lease_id = null, execution_lease_until = null
  where id = proposal.id and workspace_id = proposal.workspace_id;
  insert into public.investigation_events (workspace_id, investigation_id, actor_id, event_type, idempotency_key, payload)
  values (proposal.workspace_id, proposal.investigation_id, auth.uid(), 'action_execution_finished',
    'action_execution_finished:' || proposal.id::text || ':' || proposal.execution_attempt::text,
    jsonb_build_object('proposal_id', proposal.id, 'status', final_status, 'attempt', proposal.execution_attempt,
      'result', case when p_success then p_result else null end,
      'error', case when p_success then null else left(coalesce(p_error, 'Execution could not be verified.'), 1000) end));
  return jsonb_build_object('state', final_status, 'result', case when p_success then p_result else null end);
end;
$$;

revoke all on function public.claim_action_proposal_execution(uuid, uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.finish_action_proposal_execution(uuid, uuid, uuid, boolean, jsonb, text) from public, anon, authenticated;
grant execute on function public.claim_action_proposal_execution(uuid, uuid, text, uuid) to authenticated;
grant execute on function public.finish_action_proposal_execution(uuid, uuid, uuid, boolean, jsonb, text) to authenticated;
