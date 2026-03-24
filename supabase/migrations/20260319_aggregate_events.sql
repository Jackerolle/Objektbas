-- Aggregate event log for traceability in library view.

create table if not exists public.ventilation_aggregate_events (
  id uuid primary key default gen_random_uuid(),
  aggregate_id uuid not null references public.ventilation_aggregates(id) on delete cascade,
  event_type text not null check (length(trim(event_type)) > 0),
  message text not null check (length(trim(message)) > 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_vent_events_aggregate_created_at
  on public.ventilation_aggregate_events(aggregate_id, created_at desc);

create index if not exists idx_vent_events_event_type
  on public.ventilation_aggregate_events(event_type);

alter table public.ventilation_aggregate_events enable row level security;

drop policy if exists "events_select_authenticated" on public.ventilation_aggregate_events;
create policy "events_select_authenticated"
  on public.ventilation_aggregate_events
  for select
  to authenticated
  using (true);

drop policy if exists "events_insert_authenticated" on public.ventilation_aggregate_events;
create policy "events_insert_authenticated"
  on public.ventilation_aggregate_events
  for insert
  to authenticated
  with check (true);
