-- Inventory tables used by /api/objects and /api/observations

create extension if not exists pgcrypto;

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

insert into public.objekt_objects (
  id,
  name,
  category,
  location,
  tags,
  last_service,
  equipment
)
values
  (
    'lift-23',
    'SkyLift 23',
    'Lift',
    'Verkstad Nord',
    array['hydraulik', 'besiktigad'],
    '2024-05-04',
    '[
      {"id":"bat-1","name":"Batteripack 48V","quantity":2,"status":"ok"},
      {"id":"selar","name":"Fallskyddssele","quantity":2,"status":"saknas"}
    ]'::jsonb
  ),
  (
    'borrlag-11',
    'Borraggregat 11',
    'Borr',
    'Site A',
    array['ute', 'service'],
    '2024-04-12',
    '[
      {"id":"borrkrona","name":"Borrkrona 35mm","quantity":3,"status":"ok"},
      {"id":"coolant","name":"Kylmedel","quantity":1,"status":"trasig"}
    ]'::jsonb
  ),
  (
    'generator-07',
    'Generator 07',
    'Energi',
    'Region Syd',
    array['kritisk', 'service'],
    '2024-02-28',
    '[
      {"id":"olja","name":"Oljefilter","quantity":2,"status":"ok"},
      {"id":"sensor","name":"Vibrationssensor","quantity":4,"status":"saknas"}
    ]'::jsonb
  )
on conflict (id) do nothing;
