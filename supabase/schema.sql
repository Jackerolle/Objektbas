-- Supabase schema for Objektbas ventilation flow
-- Run in Supabase SQL editor or as migration.

create extension if not exists pgcrypto;

create table if not exists public.ventilation_aggregates (
  id uuid primary key default gen_random_uuid(),
  system_position_id text not null check (length(trim(system_position_id)) > 0),
  fl_system_position_id text null check (
    fl_system_position_id is null or length(trim(fl_system_position_id)) > 0
  ),
  se_system_position_id text null check (
    se_system_position_id is null or length(trim(se_system_position_id)) > 0
  ),
  position text null,
  department text null,
  notes text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ventilation_components (
  id uuid primary key default gen_random_uuid(),
  aggregate_id uuid not null references public.ventilation_aggregates(id) on delete cascade,
  component_type text not null,
  identified_value text not null,
  assembly text null,
  sub_component text null,
  notes text null,
  attributes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_vent_aggregates_system_position
  on public.ventilation_aggregates(system_position_id);

create index if not exists idx_vent_aggregates_fl_system_position
  on public.ventilation_aggregates(fl_system_position_id);

create index if not exists idx_vent_aggregates_se_system_position
  on public.ventilation_aggregates(se_system_position_id);

create unique index if not exists idx_vent_aggregates_system_position_unique_ci
  on public.ventilation_aggregates ((lower(trim(system_position_id))));

create index if not exists idx_vent_aggregates_updated_at
  on public.ventilation_aggregates(updated_at desc);

create index if not exists idx_vent_aggregates_department_updated_at
  on public.ventilation_aggregates(department, updated_at desc);

create index if not exists idx_vent_aggregates_position
  on public.ventilation_aggregates(position);

create index if not exists idx_vent_components_aggregate_id
  on public.ventilation_components(aggregate_id);

create index if not exists idx_vent_components_aggregate_created_at
  on public.ventilation_components(aggregate_id, created_at desc);

create index if not exists idx_vent_components_type
  on public.ventilation_components(component_type);

create index if not exists idx_vent_components_type_scope
  on public.ventilation_components(aggregate_id, component_type, assembly, sub_component);

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
  if tg_op = 'INSERT' then
    update public.ventilation_aggregates
    set updated_at = now()
    where id = new.aggregate_id;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    update public.ventilation_aggregates
    set updated_at = now()
    where id = new.aggregate_id;

    if old.aggregate_id is distinct from new.aggregate_id then
      update public.ventilation_aggregates
      set updated_at = now()
      where id = old.aggregate_id;
    end if;

    return new;
  end if;

  update public.ventilation_aggregates
  set updated_at = now()
  where id = old.aggregate_id;
  return old;
end;
$$ language plpgsql;

drop trigger if exists trg_touch_parent_aggregate on public.ventilation_components;
create trigger trg_touch_parent_aggregate
after insert or update or delete on public.ventilation_components
for each row execute function public.touch_parent_aggregate_updated_at();

alter table public.ventilation_aggregates enable row level security;
alter table public.ventilation_components enable row level security;

-- Event log per aggregate (create/update/component changes/sync actions).
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

-- Filter list rows imported from Excel ("Filterlista" tab).
create table if not exists public.ventilation_filter_list_rows (
  id uuid primary key default gen_random_uuid(),
  source_file_name text null,
  row_number integer not null check (row_number > 0),
  data jsonb not null default '{}'::jsonb,
  search_text text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists idx_filter_list_rows_row_number
  on public.ventilation_filter_list_rows(row_number);

create index if not exists idx_filter_list_rows_created_at
  on public.ventilation_filter_list_rows(created_at desc);

create index if not exists idx_filter_list_rows_data_gin
  on public.ventilation_filter_list_rows using gin (data);

alter table public.ventilation_filter_list_rows enable row level security;

drop policy if exists "filter_list_rows_select_authenticated" on public.ventilation_filter_list_rows;
create policy "filter_list_rows_select_authenticated"
  on public.ventilation_filter_list_rows
  for select
  to authenticated
  using (true);

drop policy if exists "filter_list_rows_insert_authenticated" on public.ventilation_filter_list_rows;
create policy "filter_list_rows_insert_authenticated"
  on public.ventilation_filter_list_rows
  for insert
  to authenticated
  with check (true);

drop policy if exists "filter_list_rows_update_authenticated" on public.ventilation_filter_list_rows;
create policy "filter_list_rows_update_authenticated"
  on public.ventilation_filter_list_rows
  for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists "filter_list_rows_delete_authenticated" on public.ventilation_filter_list_rows;
create policy "filter_list_rows_delete_authenticated"
  on public.ventilation_filter_list_rows
  for delete
  to authenticated
  using (true);

-- Rounds and round items used by the ventilation rounding workflow/history.
create table if not exists public.ventilation_rounds (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) > 0),
  department text null,
  customer_name text null,
  performed_by text null,
  status text not null default 'ongoing' check (status in ('ongoing', 'completed')),
  summary_text text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz null
);

create table if not exists public.ventilation_round_items (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.ventilation_rounds(id) on delete cascade,
  aggregate_id uuid null references public.ventilation_aggregates(id) on delete set null,
  system_position_id text not null check (length(trim(system_position_id)) > 0),
  component_area text null,
  title text not null check (length(trim(title)) > 0),
  observation text not null check (length(trim(observation)) > 0),
  recommended_action text not null check (length(trim(recommended_action)) > 0),
  severity text not null default 'atgard' check (severity in ('info', 'atgard', 'akut')),
  photos jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_vent_rounds_updated_at
  on public.ventilation_rounds(updated_at desc);

create index if not exists idx_vent_rounds_department_updated_at
  on public.ventilation_rounds(department, updated_at desc);

create index if not exists idx_vent_rounds_status_updated_at
  on public.ventilation_rounds(status, updated_at desc);

create index if not exists idx_vent_round_items_round_created_at
  on public.ventilation_round_items(round_id, created_at asc);

create index if not exists idx_vent_round_items_aggregate_id
  on public.ventilation_round_items(aggregate_id);

create index if not exists idx_vent_round_items_system_position
  on public.ventilation_round_items(system_position_id);

drop trigger if exists trg_vent_rounds_set_updated_at on public.ventilation_rounds;
create trigger trg_vent_rounds_set_updated_at
before update on public.ventilation_rounds
for each row execute function public.set_updated_at();

drop trigger if exists trg_vent_round_items_set_updated_at on public.ventilation_round_items;
create trigger trg_vent_round_items_set_updated_at
before update on public.ventilation_round_items
for each row execute function public.set_updated_at();

create or replace function public.touch_parent_round_updated_at()
returns trigger as $$
begin
  if tg_op = 'INSERT' then
    update public.ventilation_rounds
    set updated_at = now()
    where id = new.round_id;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    update public.ventilation_rounds
    set updated_at = now()
    where id = new.round_id;

    if old.round_id is distinct from new.round_id then
      update public.ventilation_rounds
      set updated_at = now()
      where id = old.round_id;
    end if;

    return new;
  end if;

  update public.ventilation_rounds
  set updated_at = now()
  where id = old.round_id;
  return old;
end;
$$ language plpgsql;

drop trigger if exists trg_touch_parent_round on public.ventilation_round_items;
create trigger trg_touch_parent_round
after insert or update or delete on public.ventilation_round_items
for each row execute function public.touch_parent_round_updated_at();

alter table public.ventilation_rounds enable row level security;
alter table public.ventilation_round_items enable row level security;

drop policy if exists "rounds_select_authenticated" on public.ventilation_rounds;
create policy "rounds_select_authenticated"
  on public.ventilation_rounds
  for select
  to authenticated
  using (true);

drop policy if exists "rounds_insert_authenticated" on public.ventilation_rounds;
create policy "rounds_insert_authenticated"
  on public.ventilation_rounds
  for insert
  to authenticated
  with check (true);

drop policy if exists "rounds_update_authenticated" on public.ventilation_rounds;
create policy "rounds_update_authenticated"
  on public.ventilation_rounds
  for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists "rounds_delete_authenticated" on public.ventilation_rounds;
create policy "rounds_delete_authenticated"
  on public.ventilation_rounds
  for delete
  to authenticated
  using (true);

drop policy if exists "round_items_select_authenticated" on public.ventilation_round_items;
create policy "round_items_select_authenticated"
  on public.ventilation_round_items
  for select
  to authenticated
  using (true);

drop policy if exists "round_items_insert_authenticated" on public.ventilation_round_items;
create policy "round_items_insert_authenticated"
  on public.ventilation_round_items
  for insert
  to authenticated
  with check (true);

drop policy if exists "round_items_update_authenticated" on public.ventilation_round_items;
create policy "round_items_update_authenticated"
  on public.ventilation_round_items
  for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists "round_items_delete_authenticated" on public.ventilation_round_items;
create policy "round_items_delete_authenticated"
  on public.ventilation_round_items
  for delete
  to authenticated
  using (true);

-- Inventory tables used by /api/objects and /api/observations.
create table if not exists public.objekt_objects (
  id text primary key,
  name text not null,
  category text not null,
  location text not null,
  tags text[] not null default '{}'::text[],
  last_service text null,
  updated_at timestamptz not null default now(),
  equipment jsonb not null default '[]'::jsonb
);

create table if not exists public.objekt_observations (
  id uuid primary key default gen_random_uuid(),
  object_id text not null references public.objekt_objects(id) on delete cascade,
  notes text null,
  image_data_url text null,
  "timestamp" timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_objekt_objects_updated_at
  on public.objekt_objects(updated_at desc);

create index if not exists idx_objekt_observations_object_id
  on public.objekt_observations(object_id);

create index if not exists idx_objekt_observations_timestamp
  on public.objekt_observations("timestamp" desc);

create or replace function public.objekt_set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_objekt_objects_set_updated_at on public.objekt_objects;
create trigger trg_objekt_objects_set_updated_at
before update on public.objekt_objects
for each row execute function public.objekt_set_updated_at();

alter table public.objekt_objects enable row level security;
alter table public.objekt_observations enable row level security;

drop policy if exists "objekt_objects_select_authenticated" on public.objekt_objects;
create policy "objekt_objects_select_authenticated"
  on public.objekt_objects
  for select
  to authenticated
  using (true);

drop policy if exists "objekt_objects_insert_authenticated" on public.objekt_objects;
create policy "objekt_objects_insert_authenticated"
  on public.objekt_objects
  for insert
  to authenticated
  with check (true);

drop policy if exists "objekt_objects_update_authenticated" on public.objekt_objects;
create policy "objekt_objects_update_authenticated"
  on public.objekt_objects
  for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists "objekt_observations_select_authenticated" on public.objekt_observations;
create policy "objekt_observations_select_authenticated"
  on public.objekt_observations
  for select
  to authenticated
  using (true);

drop policy if exists "objekt_observations_insert_authenticated" on public.objekt_observations;
create policy "objekt_observations_insert_authenticated"
  on public.objekt_observations
  for insert
  to authenticated
  with check (true);
