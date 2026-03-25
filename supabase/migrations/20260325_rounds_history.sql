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
