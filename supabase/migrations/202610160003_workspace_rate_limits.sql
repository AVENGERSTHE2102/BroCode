create table public.workspace_rate_limits (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  bucket text not null check (char_length(bucket) between 1 and 64),
  window_start timestamptz not null,
  count integer not null default 1 check (count >= 0),
  primary key (workspace_id, bucket, window_start)
);

alter table public.workspace_rate_limits enable row level security;
revoke all on public.workspace_rate_limits from public, anon, authenticated, service_role;

create function public.check_workspace_rate_limit(
  p_workspace_id uuid,
  p_bucket text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  bucket_window timestamptz;
  current_count integer;
begin
  if auth.uid() is null then raise exception 'authenticated user required' using errcode = '42501'; end if;
  if p_workspace_id is null or p_bucket is null or char_length(p_bucket) not between 1 and 64
    or p_bucket !~ '^[a-z_]+$'
    or p_limit is null or p_limit < 1 or p_limit > 100000
    or p_window_seconds is null or p_window_seconds < 1 or p_window_seconds > 86400 then
    raise exception 'rate limit input is invalid' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.workspace_memberships m
    where m.workspace_id = p_workspace_id and m.user_id = auth.uid()
  ) then raise exception 'workspace membership required' using errcode = '42501'; end if;

  bucket_window := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);

  insert into public.workspace_rate_limits (workspace_id, bucket, window_start, count)
  values (p_workspace_id, p_bucket, bucket_window, 1)
  on conflict (workspace_id, bucket, window_start) do update
    set count = public.workspace_rate_limits.count + 1
  returning count into current_count;

  delete from public.workspace_rate_limits
  where workspace_id = p_workspace_id and bucket = p_bucket and window_start < now() - interval '1 hour';

  return current_count <= p_limit;
end;
$$;

revoke all on function public.check_workspace_rate_limit(uuid, text, integer, integer) from public, anon;
grant execute on function public.check_workspace_rate_limit(uuid, text, integer, integer) to authenticated;
