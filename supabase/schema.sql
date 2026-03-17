-- Supabase schema for Objektbas ventilation flow
-- Run in Supabase SQL editor or as migration.

create extension if not exists pgcrypto;

create table if not exists public.ventilation_aggregates (
  id uuid primary key default gen_random_uuid(),
  system_position_id text not null,
  position text null,
  department text null,
  notes text null,
  system_position_image_data_url text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ventilation_components (
  id uuid primary key default gen_random_uuid(),
  aggregate_id uuid not null references public.ventilation_aggregates(id) on delete cascade,
  component_type text not null,
  identified_value text not null,
  notes text null,
  image_data_url text null,
  attributes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_vent_aggregates_system_position
  on public.ventilation_aggregates(system_position_id);

create index if not exists idx_vent_aggregates_updated_at
  on public.ventilation_aggregates(updated_at desc);

create index if not exists idx_vent_components_aggregate_id
  on public.ventilation_components(aggregate_id);

create index if not exists idx_vent_components_type
  on public.ventilation_components(component_type);

create index if not exists idx_vent_components_attributes_gin
  on public.ventilation_components using gin (attributes);

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_vent_aggregates_set_updated_at on public.ventilation_aggregates;
create trigger trg_vent_aggregates_set_updated_at
before update on public.ventilation_aggregates
for each row execute function public.set_updated_at();

create or replace function public.touch_parent_aggregate_updated_at()
returns trigger as $$
begin
  update public.ventilation_aggregates
  set updated_at = now()
  where id = new.aggregate_id;

  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_touch_parent_aggregate on public.ventilation_components;
create trigger trg_touch_parent_aggregate
after insert on public.ventilation_components
for each row execute function public.touch_parent_aggregate_updated_at();

alter table public.ventilation_aggregates enable row level security;
alter table public.ventilation_components enable row level security;

-- Policies for authenticated users (service role bypasses RLS automatically).
drop policy if exists "aggregates_select_authenticated" on public.ventilation_aggregates;
create policy "aggregates_select_authenticated"
  on public.ventilation_aggregates
  for select
  to authenticated
  using (true);

drop policy if exists "aggregates_insert_authenticated" on public.ventilation_aggregates;
create policy "aggregates_insert_authenticated"
  on public.ventilation_aggregates
  for insert
  to authenticated
  with check (true);

drop policy if exists "aggregates_update_authenticated" on public.ventilation_aggregates;
create policy "aggregates_update_authenticated"
  on public.ventilation_aggregates
  for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists "components_select_authenticated" on public.ventilation_components;
create policy "components_select_authenticated"
  on public.ventilation_components
  for select
  to authenticated
  using (true);

drop policy if exists "components_insert_authenticated" on public.ventilation_components;
create policy "components_insert_authenticated"
  on public.ventilation_components
  for insert
  to authenticated
  with check (true);
