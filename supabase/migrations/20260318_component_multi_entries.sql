-- Allow multiple components of same type per aggregate and add component scope fields.

alter table if exists public.ventilation_components
  add column if not exists assembly text null;

alter table if exists public.ventilation_components
  add column if not exists sub_component text null;

drop index if exists public.idx_vent_components_unique_per_type;

create index if not exists idx_vent_components_type_scope
  on public.ventilation_components(aggregate_id, component_type, assembly, sub_component);
