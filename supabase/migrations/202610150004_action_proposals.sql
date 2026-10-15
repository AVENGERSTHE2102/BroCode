create table public.action_proposals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  investigation_id uuid not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  proposal_type text not null check (proposal_type in ('github_patch', 'deployment_rollback')),
  target jsonb not null check (jsonb_typeof(target) = 'object'),
  inputs jsonb not null check (jsonb_typeof(inputs) = 'object'),
  evidence jsonb not null check (
    case when jsonb_typeof(evidence) = 'array' then jsonb_array_length(evidence) between 1 and 30 else false end
  ),
  rationale text not null check (char_length(btrim(rationale)) between 1 and 4000),
  risk text not null check (char_length(btrim(risk)) between 1 and 2000),
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 160),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'proposed' check (status in ('proposed', 'approved', 'rejected', 'stale', 'executing', 'succeeded', 'failed')),
  created_at timestamptz not null default now(),
  foreign key (workspace_id, investigation_id)
    references public.investigations(workspace_id, id) on delete cascade,
  unique (workspace_id, id),
  unique (workspace_id, investigation_id, idempotency_key)
);

create index action_proposals_investigation_created_idx
  on public.action_proposals (workspace_id, investigation_id, created_at desc);

alter table public.action_proposals enable row level security;
revoke all on public.action_proposals from public, anon, authenticated;
grant select, insert on public.action_proposals to authenticated;

create policy "workspace members can read action proposals"
  on public.action_proposals for select to authenticated
  using (exists (
    select 1 from public.workspace_memberships m
    where m.workspace_id = action_proposals.workspace_id and m.user_id = (select auth.uid())
  ));

create policy "workspace members can create action proposals"
  on public.action_proposals for insert to authenticated
  with check (
    created_by = (select auth.uid()) and status = 'proposed' and exists (
      select 1 from public.workspace_memberships m
      where m.workspace_id = action_proposals.workspace_id and m.user_id = (select auth.uid())
    )
  );

create function public.audit_action_proposal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.investigation_events (
    workspace_id, investigation_id, actor_id, event_type, idempotency_key, payload
  ) values (
    new.workspace_id, new.investigation_id, new.created_by, 'action_proposal',
    'action_proposal:' || new.id::text,
    jsonb_build_object('proposal_id', new.id, 'proposal_type', new.proposal_type, 'content_hash', new.content_hash)
  );
  return new;
end;
$$;

revoke all on function public.audit_action_proposal() from public, anon, authenticated;
create trigger action_proposal_audit
  after insert on public.action_proposals
  for each row execute function public.audit_action_proposal();

create table public.action_proposal_reviews (
  workspace_id uuid not null,
  proposal_id uuid not null,
  reviewed_by uuid not null references auth.users(id) on delete restrict,
  decision text not null check (decision in ('approve', 'reject')),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  reviewed_at timestamptz not null default now(),
  primary key (workspace_id, proposal_id),
  foreign key (workspace_id, proposal_id)
    references public.action_proposals(workspace_id, id) on delete cascade
);

alter table public.action_proposal_reviews enable row level security;
revoke all on public.action_proposal_reviews from public, anon, authenticated;
grant select on public.action_proposal_reviews to authenticated;

create policy "workspace members can read proposal reviews"
  on public.action_proposal_reviews for select to authenticated
  using (exists (
    select 1 from public.workspace_memberships m
    where m.workspace_id = action_proposal_reviews.workspace_id and m.user_id = (select auth.uid())
  ));

create function public.review_action_proposal(
  p_investigation_id uuid,
  p_proposal_id uuid,
  p_decision text,
  p_expected_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  proposal public.action_proposals%rowtype;
  review_row public.action_proposal_reviews%rowtype;
  next_status text;
begin
  if auth.uid() is null then
    raise exception 'authenticated user required' using errcode = '42501';
  end if;
  if p_decision is null or p_decision not in ('approve', 'reject')
    or p_expected_hash is null or p_expected_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'review input is invalid' using errcode = '22023';
  end if;

  select p.* into proposal
  from public.action_proposals p
  join public.workspace_memberships m on m.workspace_id = p.workspace_id
  where p.id = p_proposal_id and p.investigation_id = p_investigation_id
    and m.user_id = auth.uid() and m.role in ('owner', 'admin')
  for update of p, m;
  if not found then
    raise exception 'proposal not found or reviewer is not an administrator' using errcode = 'P0002';
  end if;
  if proposal.content_hash <> p_expected_hash then
    raise exception 'proposal content changed after it was presented for review' using errcode = '40001';
  end if;

  next_status := case when p_decision = 'approve' then 'approved' else 'rejected' end;
  if proposal.status <> 'proposed' then
    select r.* into review_row from public.action_proposal_reviews r
    where r.workspace_id = proposal.workspace_id and r.proposal_id = proposal.id;
    if found and review_row.decision = p_decision and review_row.content_hash = p_expected_hash then
      return jsonb_build_object('proposal_id', proposal.id, 'status', proposal.status, 'decision', review_row.decision, 'reviewed_at', review_row.reviewed_at);
    end if;
    raise exception 'proposal cannot be reviewed in its current state' using errcode = '23505';
  end if;

  insert into public.action_proposal_reviews (workspace_id, proposal_id, reviewed_by, decision, content_hash)
  values (proposal.workspace_id, proposal.id, auth.uid(), p_decision, proposal.content_hash)
  returning * into review_row;
  update public.action_proposals set status = next_status
  where workspace_id = proposal.workspace_id and id = proposal.id;
  insert into public.investigation_events (
    workspace_id, investigation_id, actor_id, event_type, idempotency_key, payload
  ) values (
    proposal.workspace_id, proposal.investigation_id, auth.uid(), 'action_review',
    'action_review:' || proposal.id::text,
    jsonb_build_object('proposal_id', proposal.id, 'decision', p_decision, 'content_hash', proposal.content_hash)
  );
  return jsonb_build_object('proposal_id', proposal.id, 'status', next_status, 'decision', p_decision, 'reviewed_at', review_row.reviewed_at);
end;
$$;

revoke all on function public.review_action_proposal(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.review_action_proposal(uuid, uuid, text, text) to authenticated;
