import {
  AggregateRecord,
  CreateAggregateComponentPayload,
  FilterListRow,
  FilterListSearchResult
} from '@/lib/types';
import { getSupabaseServerClient } from '@/lib/server/supabase';
import { ImportedFilterListRow } from '@/lib/server/importFilterList';

type FilterListDbRow = {
  id: string;
  source_file_name: string | null;
  row_number: number;
  data: Record<string, unknown> | null;
  search_text: string;
  created_at: string;
};

const FILTER_COMPONENT_TYPES = new Set(['filter', 'kolfilter']);

const OB_KEY_ALIASES = [
  'ob',
  'obnr',
  'obnummer',
  'objektsnummer',
  'systemposition',
  'systemid',
  'aggregat',
  'ag'
];

const FILTER_KEY_ALIASES = [
  'filter',
  'filternamn',
  'filtertyp',
  'beteckning',
  'artikel',
  'produkt'
];

const DIMENSION_KEY_ALIASES = ['dimension', 'storlek', 'size'];
const KLASS_KEY_ALIASES = ['filterklass', 'klass'];
const ANTAL_KEY_ALIASES = ['antal', 'qty', 'quantity', 'st'];
const PLACERING_KEY_ALIASES = ['placering', 'position', 'lokation', 'plats'];
const INTERVALL_KEY_ALIASES = ['intervall', 'bytesintervall', 'serviceintervall'];

function assertNoError(error: { message: string } | null) {
  if (error) {
    throw new Error(error.message);
  }
}

function normalizeToken(value: string | undefined): string {
  if (!value) {
    return '';
  }

  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function findValueByAliases(
  data: Record<string, string>,
  aliases: string[]
): string {
  const entries = Object.entries(data).map(([key, value]) => ({
    token: normalizeToken(key),
    value: value.trim()
  }));

  for (const alias of aliases) {
    const aliasToken = normalizeToken(alias);
    const hit = entries.find(
      (entry) => entry.token === aliasToken || entry.token.includes(aliasToken)
    );
    if (hit?.value) {
      return hit.value;
    }
  }

  return '';
}

function toStringRecord(value: Record<string, unknown> | null): Record<string, string> {
  if (!value) {
    return {};
  }

  const result: Record<string, string> = {};

  for (const [key, entry] of Object.entries(value)) {
    result[key] = typeof entry === 'string' ? entry : String(entry ?? '');
  }

  return result;
}

function mapRow(row: FilterListDbRow): FilterListRow {
  return {
    id: row.id,
    rowNumber: row.row_number,
    sourceFileName: row.source_file_name ?? undefined,
    data: toStringRecord(row.data),
    createdAt: row.created_at
  };
}

function collectColumns(rows: FilterListRow[]): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];

  for (const row of rows) {
    for (const key of Object.keys(row.data)) {
      if (!seen.has(key)) {
        seen.add(key);
        ordered.push(key);
      }
    }
  }

  return ordered;
}

export async function replaceFilterListRows(
  sourceFileName: string,
  rows: ImportedFilterListRow[]
): Promise<number> {
  const supabase = getSupabaseServerClient();

  const { error: deleteError } = await supabase
    .from('ventilation_filter_list_rows')
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000');

  assertNoError(deleteError);

  if (!rows.length) {
    return 0;
  }

  const chunkSize = 500;
  let imported = 0;

  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const { error } = await supabase.from('ventilation_filter_list_rows').insert(
      chunk.map((row) => ({
        source_file_name: sourceFileName || null,
        row_number: row.rowNumber,
        data: row.data,
        search_text: row.searchText
      }))
    );

    assertNoError(error);
    imported += chunk.length;
  }

  return imported;
}

export async function listFilterListRows(
  query: string,
  limit: number
): Promise<FilterListSearchResult> {
  const supabase = getSupabaseServerClient();
  const normalizedLimit = Math.max(1, Math.min(5000, limit));
  const needle = query.trim().toLowerCase();

  const baseQuery = supabase
    .from('ventilation_filter_list_rows')
    .select('*', { count: 'exact' })
    .order('row_number', { ascending: true })
    .limit(normalizedLimit);

  const { data, error, count } = needle
    ? await baseQuery.ilike('search_text', `%${needle}%`)
    : await baseQuery;

  assertNoError(error);

  const mapped = ((data ?? []) as FilterListDbRow[]).map(mapRow);

  const { count: totalRowsCount, error: totalRowsError } = await supabase
    .from('ventilation_filter_list_rows')
    .select('id', { count: 'exact', head: true });

  assertNoError(totalRowsError);

  return {
    totalRows: totalRowsCount ?? 0,
    filteredRows: count ?? mapped.length,
    columns: collectColumns(mapped),
    rows: mapped
  };
}

function chooseObNumber(aggregate: AggregateRecord): string {
  const se = aggregate.seSystemPositionId?.trim() ?? '';
  const fl = aggregate.flSystemPositionId?.trim() ?? '';
  const ag = aggregate.systemPositionId.trim();

  if (/^OB/i.test(se)) {
    return se;
  }
  if (/^OB/i.test(fl)) {
    return fl;
  }

  return ag;
}

function containsSameToken(left: string, right: string): boolean {
  const a = normalizeToken(left);
  const b = normalizeToken(right);
  if (!a || !b) {
    return false;
  }

  return a === b || a.includes(b) || b.includes(a);
}

function buildSearchText(data: Record<string, string>): string {
  return Object.entries(data)
    .map(([key, value]) => `${key} ${value}`)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function inferFilterComponentType(filterName: string): 'Filter' | 'Kolfilter' {
  const token = normalizeToken(filterName);
  if (token.includes('kol') || token.includes('carbon')) {
    return 'Kolfilter';
  }

  return 'Filter';
}

function buildFilterSignature(
  componentType: string,
  filterName: string,
  dimension: string,
  filterClass: string
): string {
  return [
    normalizeToken(componentType),
    normalizeToken(filterName),
    normalizeToken(dimension),
    normalizeToken(filterClass)
  ].join('|');
}

export async function ensureFilterComponentInFilterList(
  aggregate: AggregateRecord,
  payload: CreateAggregateComponentPayload
): Promise<boolean> {
  const componentTypeToken = normalizeToken(payload.componentType);
  if (!FILTER_COMPONENT_TYPES.has(componentTypeToken)) {
    return false;
  }

  const attributes = payload.attributes ?? {};
  const filterName = (attributes.filterNamn ?? payload.identifiedValue ?? '').trim();
  if (!filterName) {
    return false;
  }

  const dimension = (attributes.dimension ?? '').trim();
  const filterClass = (attributes.filterklass ?? '').trim();
  const antal = (attributes.antal ?? '').trim();
  const obNumber = chooseObNumber(aggregate);

  const supabase = getSupabaseServerClient();
  const lookupNeedle = normalizeToken(obNumber || aggregate.systemPositionId);
  const { data: candidates, error: lookupError } = await supabase
    .from('ventilation_filter_list_rows')
    .select('id, data')
    .ilike('search_text', `%${lookupNeedle}%`)
    .limit(250);

  assertNoError(lookupError);

  for (const row of (candidates ?? []) as Array<{ id: string; data: Record<string, unknown> | null }>) {
    const data = toStringRecord(row.data);
    const existingOb = findValueByAliases(data, OB_KEY_ALIASES);
    const existingFilter = findValueByAliases(data, FILTER_KEY_ALIASES);
    const existingDimension = findValueByAliases(data, DIMENSION_KEY_ALIASES);
    const existingClass = findValueByAliases(data, KLASS_KEY_ALIASES);

    const obMatch =
      containsSameToken(existingOb, obNumber) ||
      containsSameToken(existingOb, aggregate.systemPositionId);
    const filterMatch = containsSameToken(existingFilter, filterName);
    const dimensionMatch =
      !dimension || !existingDimension || containsSameToken(existingDimension, dimension);
    const classMatch =
      !filterClass || !existingClass || containsSameToken(existingClass, filterClass);

    if (obMatch && filterMatch && dimensionMatch && classMatch) {
      return false;
    }
  }

  const { data: latestRow, error: latestError } = await supabase
    .from('ventilation_filter_list_rows')
    .select('row_number')
    .order('row_number', { ascending: false })
    .limit(1)
    .maybeSingle();

  assertNoError(latestError);

  const nextRowNumber = ((latestRow as { row_number?: number } | null)?.row_number ?? 0) + 1;

  const data: Record<string, string> = {
    'OB-nummer': obNumber,
    Systemposition: aggregate.systemPositionId,
    Filter: filterName,
    Filterklass: filterClass,
    Dimension: dimension,
    Antal: antal,
    Avdelning: aggregate.department ?? '',
    Position: aggregate.position ?? '',
    Huvudkategori: payload.assembly?.trim() || payload.componentType,
    Underkategori: payload.subComponent?.trim() || payload.componentType,
    Komponenttyp: payload.componentType,
    Notering: payload.notes?.trim() || '',
    'Skapad via': 'App auto'
  };

  const { error: insertError } = await supabase.from('ventilation_filter_list_rows').insert({
    source_file_name: 'Auto (fran app)',
    row_number: nextRowNumber,
    data,
    search_text: buildSearchText(data)
  });

  assertNoError(insertError);
  return true;
}

type SyncFilterListResult = {
  syncedAggregates: number;
  insertedFilterComponents: number;
  skippedNoObjectMatch: number;
  skippedNoFilterData: number;
  skippedExistingFilter: number;
};

type AggregateLiteRow = {
  id: string;
  system_position_id: string;
  fl_system_position_id: string | null;
  se_system_position_id: string | null;
};

type ComponentLiteRow = {
  aggregate_id: string;
  component_type: string;
  identified_value: string;
  attributes: Record<string, unknown> | null;
};

export async function syncFilterListRowsToAggregates(
  rows: ImportedFilterListRow[]
): Promise<SyncFilterListResult> {
  const supabase = getSupabaseServerClient();

  const { data: aggregatesData, error: aggregatesError } = await supabase
    .from('ventilation_aggregates')
    .select('id, system_position_id, fl_system_position_id, se_system_position_id')
    .limit(10000);

  assertNoError(aggregatesError);

  const aggregates = (aggregatesData ?? []) as AggregateLiteRow[];
  if (!aggregates.length || !rows.length) {
    return {
      syncedAggregates: 0,
      insertedFilterComponents: 0,
      skippedNoObjectMatch: rows.length,
      skippedNoFilterData: 0,
      skippedExistingFilter: 0
    };
  }

  const { data: componentsData, error: componentsError } = await supabase
    .from('ventilation_components')
    .select('aggregate_id, component_type, identified_value, attributes')
    .in('aggregate_id', aggregates.map((aggregate) => aggregate.id))
    .in('component_type', ['Filter', 'Kolfilter']);

  assertNoError(componentsError);

  const existingSignaturesByAggregate = new Map<string, Set<string>>();
  for (const row of (componentsData ?? []) as ComponentLiteRow[]) {
    const attrs = toStringRecord(row.attributes);
    const signature = buildFilterSignature(
      row.component_type,
      attrs.filterNamn || row.identified_value || '',
      attrs.dimension || '',
      attrs.filterklass || ''
    );

    const current = existingSignaturesByAggregate.get(row.aggregate_id) ?? new Set<string>();
    current.add(signature);
    existingSignaturesByAggregate.set(row.aggregate_id, current);
  }

  const normalizedPositions = new Map<
    string,
    { aggregateId: string; source: 'AG' | 'FL' | 'SE' }[]
  >();

  for (const aggregate of aggregates) {
    const positions: Array<[string, 'AG' | 'FL' | 'SE']> = [
      [aggregate.system_position_id, 'AG'],
      [aggregate.fl_system_position_id ?? '', 'FL'],
      [aggregate.se_system_position_id ?? '', 'SE']
    ];

    for (const [value, source] of positions) {
      const token = normalizeToken(value);
      if (!token) {
        continue;
      }

      const list = normalizedPositions.get(token) ?? [];
      list.push({ aggregateId: aggregate.id, source });
      normalizedPositions.set(token, list);
    }
  }

  const pendingInserts: Array<{
    aggregate_id: string;
    component_type: 'Filter' | 'Kolfilter';
    identified_value: string;
    notes: string;
    assembly: string;
    sub_component: string;
    attributes: Record<string, string>;
  }> = [];

  const touchedAggregates = new Set<string>();
  let skippedNoObjectMatch = 0;
  let skippedNoFilterData = 0;
  let skippedExistingFilter = 0;

  for (const row of rows) {
    const obNumber = findValueByAliases(row.data, OB_KEY_ALIASES);
    const filterName = findValueByAliases(row.data, FILTER_KEY_ALIASES);

    if (!obNumber || !filterName) {
      skippedNoFilterData += 1;
      continue;
    }

    const normalizedOb = normalizeToken(obNumber);
    if (!normalizedOb) {
      skippedNoObjectMatch += 1;
      continue;
    }

    const matches = normalizedPositions.get(normalizedOb) ?? [];
    if (!matches.length) {
      skippedNoObjectMatch += 1;
      continue;
    }

    const dimension = findValueByAliases(row.data, DIMENSION_KEY_ALIASES);
    const filterClass = findValueByAliases(row.data, KLASS_KEY_ALIASES);
    const antal = findValueByAliases(row.data, ANTAL_KEY_ALIASES);
    const placering = findValueByAliases(row.data, PLACERING_KEY_ALIASES);
    const intervall = findValueByAliases(row.data, INTERVALL_KEY_ALIASES);
    const componentType = inferFilterComponentType(filterName);
    const signature = buildFilterSignature(
      componentType,
      filterName,
      dimension,
      filterClass
    );

    for (const match of matches) {
      const signatures = existingSignaturesByAggregate.get(match.aggregateId) ?? new Set<string>();
      if (signatures.has(signature)) {
        skippedExistingFilter += 1;
        continue;
      }

      signatures.add(signature);
      existingSignaturesByAggregate.set(match.aggregateId, signatures);
      touchedAggregates.add(match.aggregateId);

      const notesParts = [`Synkad fran filterlista (rad ${row.rowNumber}, match ${match.source})`];
      if (placering) {
        notesParts.push(`Placering: ${placering}`);
      }
      if (intervall) {
        notesParts.push(`Intervall: ${intervall}`);
      }

      pendingInserts.push({
        aggregate_id: match.aggregateId,
        component_type: componentType,
        identified_value: filterName,
        notes: notesParts.join(' | '),
        assembly: 'Aggregat',
        sub_component: componentType,
        attributes: {
          filterNamn: filterName,
          filterklass: filterClass,
          dimension,
          antal
        }
      });
    }
  }

  let insertedFilterComponents = 0;
  if (pendingInserts.length > 0) {
    const chunkSize = 500;
    for (let i = 0; i < pendingInserts.length; i += chunkSize) {
      const chunk = pendingInserts.slice(i, i + chunkSize);
      const { error } = await supabase.from('ventilation_components').insert(chunk);
      assertNoError(error);
      insertedFilterComponents += chunk.length;
    }
  }

  if (touchedAggregates.size > 0) {
    const { error: touchError } = await supabase
      .from('ventilation_aggregates')
      .update({ updated_at: new Date().toISOString() })
      .in('id', Array.from(touchedAggregates));

    assertNoError(touchError);
  }

  return {
    syncedAggregates: touchedAggregates.size,
    insertedFilterComponents,
    skippedNoObjectMatch,
    skippedNoFilterData,
    skippedExistingFilter
  };
}
