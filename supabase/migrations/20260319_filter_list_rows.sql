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
