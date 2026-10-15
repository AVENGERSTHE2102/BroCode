alter table public.investigations
  add column workflow_domain text not null default 'general'
  check (workflow_domain in ('general', 'fraud_investigation', 'security_triage', 'codebase_work'));

grant insert (workflow_domain) on public.investigations to authenticated;
