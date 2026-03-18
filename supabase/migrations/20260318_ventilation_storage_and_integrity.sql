-- Ventilation: keep images local on device and harden relational integrity/indexing.

-- 1) Stop storing base64 image payloads in database.
alter table if exists public.ventilation_aggregates
  drop column if exists system_position_image_data_url;

alter table if exists public.ventilation_components
  drop column if exists image_data_url;

-- 2) Ensure system position id is never blank.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'chk_vent_aggregates_system_position_not_blank'
  ) then
    alter table public.ventilation_aggregates
      add constraint chk_vent_aggregates_system_position_not_blank
      check (length(trim(system_position_id)) > 0);
  end if;
end $$;

-- 3) Better indexes for library views (department filtering + recent updates).
create index if not exists idx_vent_aggregates_department_updated_at
  on public.ventilation_aggregates(department, updated_at desc);

create index if not exists idx_vent_aggregates_position
  on public.ventilation_aggregates(position);

create index if not exists idx_vent_components_aggregate_created_at
  on public.ventilation_components(aggregate_id, created_at desc);

-- 4) Add case-insensitive unique index for system position id when data allows it.
do $$
begin
  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and indexname = 'idx_vent_aggregates_system_position_unique_ci'
  ) then
    if exists (
      select 1
      from public.ventilation_aggregates
      group by lower(trim(system_position_id))
      having count(*) > 1
    ) then
      raise notice 'Duplicate system_position_id exists; skipping unique CI index creation.';
    else
      create unique index idx_vent_aggregates_system_position_unique_ci
        on public.ventilation_aggregates ((lower(trim(system_position_id))));
    end if;
  end if;
end $$;

-- 5) Keep aggregate.updated_at correct for insert/update/delete on components.
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
