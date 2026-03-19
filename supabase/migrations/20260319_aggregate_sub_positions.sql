-- Add optional linked system positions per aggregate (FL/SE).

alter table if exists public.ventilation_aggregates
  add column if not exists fl_system_position_id text null;

alter table if exists public.ventilation_aggregates
  add column if not exists se_system_position_id text null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'chk_vent_aggregates_fl_system_position_not_blank'
  ) then
    alter table public.ventilation_aggregates
      add constraint chk_vent_aggregates_fl_system_position_not_blank
      check (
        fl_system_position_id is null
        or length(trim(fl_system_position_id)) > 0
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'chk_vent_aggregates_se_system_position_not_blank'
  ) then
    alter table public.ventilation_aggregates
      add constraint chk_vent_aggregates_se_system_position_not_blank
      check (
        se_system_position_id is null
        or length(trim(se_system_position_id)) > 0
      );
  end if;
end $$;

create index if not exists idx_vent_aggregates_fl_system_position
  on public.ventilation_aggregates(fl_system_position_id);

create index if not exists idx_vent_aggregates_se_system_position
  on public.ventilation_aggregates(se_system_position_id);
