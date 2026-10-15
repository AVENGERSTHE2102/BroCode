create table public.investigations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  status text not null default 'active' check (status in ('active', 'completed', 'blocked', 'abandoned')),
  version integer not null default 1 check (version > 0),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id)
);

create index investigations_workspace_updated_idx on public.investigations (workspace_id, updated_at desc);

create table public.investigation_events (
  id bigint generated always as identity primary key,
  workspace_id uuid not null,
  investigation_id uuid not null,
  actor_id uuid not null references auth.users(id) on delete restrict,
  event_type text not null check (char_length(event_type) between 1 and 80),
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 160),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  foreign key (workspace_id, investigation_id)
    references public.investigations(workspace_id, id) on delete cascade,
  unique (workspace_id, investigation_id, idempotency_key)
);

create index investigation_events_order_idx on public.investigation_events (workspace_id, investigation_id, id);

create function public.touch_investigation_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.version := old.version + 1;
  return new;
end;
$$;

create trigger investigations_updated_at
before update on public.investigations
for each row execute function public.touch_investigation_updated_at();

create function public.touch_investigation_after_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.investigations
  set updated_at = now()
  where id = new.investigation_id and workspace_id = new.workspace_id;
  return new;
end;
$$;

revoke all on function public.touch_investigation_updated_at() from public, anon, authenticated;
revoke all on function public.touch_investigation_after_event() from public, anon, authenticated;
create trigger investigation_event_updates_parent
after insert on public.investigation_events
for each row execute function public.touch_investigation_after_event();

alter table public.investigations enable row level security;
alter table public.investigation_events enable row level security;

revoke all on public.investigations, public.investigation_events from anon, authenticated;
grant select on public.investigations to authenticated;
grant insert (workspace_id, title, created_by) on public.investigations to authenticated;
grant update (title, status) on public.investigations to authenticated;
grant select, insert on public.investigation_events to authenticated;
grant usage, select on sequence public.investigation_events_id_seq to authenticated;

create policy "workspace members can read investigations"
  on public.investigations for select to authenticated
  using (exists (
    select 1 from public.workspace_memberships m
    where m.workspace_id = investigations.workspace_id and m.user_id = (select auth.uid())
  ));

create policy "workspace members can create investigations"
  on public.investigations for insert to authenticated
  with check (
    created_by = (select auth.uid()) and exists (
      select 1 from public.workspace_memberships m
      where m.workspace_id = investigations.workspace_id and m.user_id = (select auth.uid())
    )
  );

create policy "workspace members can update investigations"
  on public.investigations for update to authenticated
  using (exists (
    select 1 from public.workspace_memberships m
    where m.workspace_id = investigations.workspace_id and m.user_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.workspace_memberships m
    where m.workspace_id = investigations.workspace_id and m.user_id = (select auth.uid())
  ));

create policy "workspace members can read investigation events"
  on public.investigation_events for select to authenticated
  using (exists (
    select 1 from public.workspace_memberships m
    where m.workspace_id = investigation_events.workspace_id and m.user_id = (select auth.uid())
  ));

create policy "workspace members can append investigation events"
  on public.investigation_events for insert to authenticated
  with check (
    actor_id = (select auth.uid()) and exists (
      select 1 from public.workspace_memberships m
      where m.workspace_id = investigation_events.workspace_id and m.user_id = (select auth.uid())
    )
  );
