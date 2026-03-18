-- Prevent duplicate component rows per aggregate/component type.
-- Keep the latest row and remove older duplicates.

with ranked as (
  select
    id,
    row_number() over (
      partition by aggregate_id, component_type
      order by created_at desc, id desc
    ) as rn
  from public.ventilation_components
)
delete from public.ventilation_components c
using ranked r
where c.id = r.id
  and r.rn > 1;

create unique index if not exists idx_vent_components_unique_per_type
  on public.ventilation_components(aggregate_id, component_type);
