import {
  AggregateRecord,
  CreateAggregateComponentPayload,
  FilterListRow,
  FilterListSearchResult
} from '@/lib/types';
import { logAggregateEvents } from '@/lib/server/aggregateEventRepository';
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
const SYSTEMPOSITION_KEY_ALIASES = ['systemposition', 'systempositionid', 'systemid'];
const NOTES_KEY_ALIASES = ['notering', 'kommentar', 'anmärkning', 'anmarkning'];
const SOURCE_KEY_ALIASES = ['skapadvia', 'källa', 'kalla', 'source'];
const CATEGORY_KEY_ALIASES = ['huvudkategori', 'kategori'];
const SUBCATEGORY_KEY_ALIASES = ['underkategori', 'delkategori'];
const COMPONENTTYPE_KEY_ALIASES = ['komponenttyp', 'typ'];
const MATERIALBETECKNING_KEY_ALIASES = [
  'materialbeteckning',
  'korrektbenamning',
  'korrektbenämning',
  'benamning',
  'benämning'
];
const DINAIR_ARTIKEL_KEY_ALIASES = ['dinairartikel', 'dinairartikelnr', 'artikelnummer'];
const TAGG_KEY_ALIASES = ['tagg'];
const STATUS_KEY_ALIASES = ['status'];

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

function findKeyByAliases(
  data: Record<string, string>,
  aliases: string[]
): string | undefined {
  const entries = Object.keys(data).map((key) => ({
    key,
    token: normalizeToken(key)
  }));

  for (const alias of aliases) {
    const aliasToken = normalizeToken(alias);
    if (!aliasToken) {
      continue;
    }

    const exact = entries.find((entry) => entry.token === aliasToken);
    if (exact) {
      return exact.key;
    }
  }

  for (const alias of aliases) {
    const aliasToken = normalizeToken(alias);
    if (!aliasToken) {
      continue;
    }

    const partial = entries.find(
      (entry) => entry.token.includes(aliasToken) || aliasToken.includes(entry.token)
    );
    if (partial) {
      return partial.key;
    }
  }

  return undefined;
}

function setValueByAliases(
  data: Record<string, string>,
  aliases: string[],
  fallbackKey: string,
  value: string
) {
  const key = findKeyByAliases(data, aliases) ?? fallbackKey;
  data[key] = value.trim();
}

function setValueIfPresent(
  data: Record<string, string>,
  aliases: string[],
  fallbackKey: string,
  value: string
) {
  if (!value.trim()) {
    return;
  }

  setValueByAliases(data, aliases, fallbackKey, value);
}

function setValueIfMissingByAliases(
  data: Record<string, string>,
  aliases: string[],
  fallbackKey: string,
  value: string
) {
  const normalized = value.trim();
  if (!normalized) {
    return;
  }

  const key = findKeyByAliases(data, aliases) ?? fallbackKey;
  if ((data[key] ?? '').trim()) {
    return;
  }

  data[key] = normalized;
}

type FilterRowValues = {
  obNumber: string;
  systemPosition: string;
  filterName: string;
  filterClass: string;
  dimension: string;
  antal: string;
  placering: string;
  intervall: string;
  notes: string;
  category: string;
  subCategory: string;
  componentType: string;
  materialbeteckning: string;
  dinairArtikel: string;
  tagg: string;
  status: string;
  sourceTag: string;
  department: string;
};

function extractFilterRowValues(data: Record<string, string>): FilterRowValues {
  return {
    obNumber: findValueByAliases(data, OB_KEY_ALIASES),
    systemPosition: findValueByAliases(data, SYSTEMPOSITION_KEY_ALIASES),
    filterName: findValueByAliases(data, FILTER_KEY_ALIASES),
    filterClass: findValueByAliases(data, KLASS_KEY_ALIASES),
    dimension: findValueByAliases(data, DIMENSION_KEY_ALIASES),
    antal: findValueByAliases(data, ANTAL_KEY_ALIASES),
    placering: findValueByAliases(data, PLACERING_KEY_ALIASES),
    intervall: findValueByAliases(data, INTERVALL_KEY_ALIASES),
    notes: findValueByAliases(data, NOTES_KEY_ALIASES),
    category: findValueByAliases(data, CATEGORY_KEY_ALIASES),
    subCategory: findValueByAliases(data, SUBCATEGORY_KEY_ALIASES),
    componentType: findValueByAliases(data, COMPONENTTYPE_KEY_ALIASES),
    materialbeteckning: findValueByAliases(data, MATERIALBETECKNING_KEY_ALIASES),
    dinairArtikel: findValueByAliases(data, DINAIR_ARTIKEL_KEY_ALIASES),
    tagg: findValueByAliases(data, TAGG_KEY_ALIASES),
    status: findValueByAliases(data, STATUS_KEY_ALIASES),
    sourceTag: findValueByAliases(data, SOURCE_KEY_ALIASES),
    department: findValueByAliases(data, ['avdelning', 'department'])
  };
}

function applyFilterRowValues(
  data: Record<string, string>,
  values: FilterRowValues,
  mode: 'overwrite' | 'fill-missing'
) {
  const setValue =
    mode === 'overwrite' ? setValueIfPresent : setValueIfMissingByAliases;

  setValue(data, OB_KEY_ALIASES, 'OB-nummer', values.obNumber);
  setValue(data, SYSTEMPOSITION_KEY_ALIASES, 'Systemposition', values.systemPosition);
  setValue(data, FILTER_KEY_ALIASES, 'Filter', values.filterName);
  setValue(data, KLASS_KEY_ALIASES, 'Filterklass', values.filterClass);
  setValue(data, DIMENSION_KEY_ALIASES, 'Dimension', values.dimension);
  setValue(data, ANTAL_KEY_ALIASES, 'Antal', values.antal);
  setValue(data, PLACERING_KEY_ALIASES, 'Placering', values.placering);
  setValue(data, INTERVALL_KEY_ALIASES, 'Bytesintervall', values.intervall);
  setValue(data, NOTES_KEY_ALIASES, 'Notering', values.notes);
  setValue(data, CATEGORY_KEY_ALIASES, 'Huvudkategori', values.category);
  setValue(data, SUBCATEGORY_KEY_ALIASES, 'Underkategori', values.subCategory);
  setValue(data, COMPONENTTYPE_KEY_ALIASES, 'Komponenttyp', values.componentType);
  setValue(data, MATERIALBETECKNING_KEY_ALIASES, 'Materialbeteckning', values.materialbeteckning);
  setValue(data, DINAIR_ARTIKEL_KEY_ALIASES, 'DINAIR artikel', values.dinairArtikel);
  setValue(data, TAGG_KEY_ALIASES, 'Tagg', values.tagg);
  setValue(data, STATUS_KEY_ALIASES, 'status', values.status);
  setValue(data, SOURCE_KEY_ALIASES, 'Skapad via', values.sourceTag);
  setValue(data, ['avdelning', 'department'], 'Avdelning', values.department);
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
    .select('id, source_file_name, row_number, data')
    .ilike('search_text', `%${lookupNeedle}%`)
    .order('row_number', { ascending: true })
    .limit(400);

  assertNoError(lookupError);

  const objectMatchedRows: Array<{
    id: string;
    sourceFileName: string | null;
    rowNumber: number;
    data: Record<string, string>;
    existingFilter: string;
    existingDimension: string;
    existingClass: string;
  }> = [];

  for (const row of (candidates ?? []) as Array<{
    id: string;
    source_file_name: string | null;
    row_number: number;
    data: Record<string, unknown> | null;
  }>) {
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

    if (obMatch) {
      objectMatchedRows.push({
        id: row.id,
        sourceFileName: row.source_file_name,
        rowNumber: row.row_number,
        data,
        existingFilter,
        existingDimension,
        existingClass
      });
    }
  }

  const updateTarget =
    objectMatchedRows.find((row) => !row.existingFilter.trim()) ??
    objectMatchedRows.find((row) => !row.existingDimension.trim() && !row.existingClass.trim()) ??
    null;

  if (updateTarget) {
    const merged = { ...updateTarget.data };
    setValueByAliases(merged, OB_KEY_ALIASES, 'OB-nummer', obNumber);
    setValueByAliases(
      merged,
      SYSTEMPOSITION_KEY_ALIASES,
      'Systemposition',
      aggregate.systemPositionId
    );
    setValueByAliases(merged, FILTER_KEY_ALIASES, 'Filter', filterName);
    setValueIfPresent(merged, DIMENSION_KEY_ALIASES, 'Dimension', dimension);
    setValueIfPresent(merged, KLASS_KEY_ALIASES, 'Filterklass', filterClass);
    setValueIfPresent(merged, ANTAL_KEY_ALIASES, 'Antal', antal);
    setValueIfPresent(
      merged,
      MATERIALBETECKNING_KEY_ALIASES,
      'Materialbeteckning',
      filterName
    );
    setValueIfPresent(merged, TAGG_KEY_ALIASES, 'Tagg', obNumber);
    setValueIfPresent(merged, PLACERING_KEY_ALIASES, 'Placering', aggregate.position ?? '');
    setValueIfPresent(merged, INTERVALL_KEY_ALIASES, 'Bytesintervall', attributes.bytesintervall ?? '');
    setValueIfPresent(merged, NOTES_KEY_ALIASES, 'Notering', payload.notes?.trim() ?? '');
    setValueIfPresent(
      merged,
      CATEGORY_KEY_ALIASES,
      'Huvudkategori',
      payload.assembly?.trim() || payload.componentType
    );
    setValueIfPresent(
      merged,
      SUBCATEGORY_KEY_ALIASES,
      'Underkategori',
      payload.subComponent?.trim() || payload.componentType
    );
    setValueIfPresent(merged, COMPONENTTYPE_KEY_ALIASES, 'Komponenttyp', payload.componentType);
    setValueIfPresent(merged, SOURCE_KEY_ALIASES, 'Skapad via', 'App auto');
    setValueIfPresent(merged, STATUS_KEY_ALIASES, 'status', 'systemövervakat');

    const { error: updateError } = await supabase
      .from('ventilation_filter_list_rows')
      .update({
        data: merged,
        search_text: buildSearchText(merged)
      })
      .eq('id', updateTarget.id);

    assertNoError(updateError);
    return true;
  }

  const { data: latestRow, error: latestError } = await supabase
    .from('ventilation_filter_list_rows')
    .select('row_number')
    .order('row_number', { ascending: false })
    .limit(1)
    .maybeSingle();

  assertNoError(latestError);

  const nextRowNumber = ((latestRow as { row_number?: number } | null)?.row_number ?? 0) + 1;

  const templateData = objectMatchedRows[0]?.data ?? {};
  const data: Record<string, string> = Object.fromEntries(
    Object.keys(templateData).map((key) => [key, ''])
  );

  setValueByAliases(data, OB_KEY_ALIASES, 'OB-nummer', obNumber);
  setValueByAliases(data, SYSTEMPOSITION_KEY_ALIASES, 'Systemposition', aggregate.systemPositionId);
  setValueByAliases(data, FILTER_KEY_ALIASES, 'Filter', filterName);
  setValueIfPresent(data, DIMENSION_KEY_ALIASES, 'Dimension', dimension);
  setValueIfPresent(data, KLASS_KEY_ALIASES, 'Filterklass', filterClass);
  setValueIfPresent(data, ANTAL_KEY_ALIASES, 'Antal', antal);
  setValueIfPresent(data, PLACERING_KEY_ALIASES, 'Placering', aggregate.position ?? '');
  setValueIfPresent(data, MATERIALBETECKNING_KEY_ALIASES, 'Materialbeteckning', filterName);
  setValueIfPresent(
    data,
    DINAIR_ARTIKEL_KEY_ALIASES,
    'DINAIR artikel',
    attributes.dinairArtikel ?? attributes.artikelnummer ?? ''
  );
  setValueIfPresent(data, TAGG_KEY_ALIASES, 'Tagg', obNumber);
  setValueIfPresent(data, INTERVALL_KEY_ALIASES, 'Bytesintervall', attributes.bytesintervall ?? '');
  setValueIfPresent(data, NOTES_KEY_ALIASES, 'Notering', payload.notes?.trim() || '');
  setValueIfPresent(
    data,
    CATEGORY_KEY_ALIASES,
    'Huvudkategori',
    payload.assembly?.trim() || payload.componentType
  );
  setValueIfPresent(
    data,
    SUBCATEGORY_KEY_ALIASES,
    'Underkategori',
    payload.subComponent?.trim() || payload.componentType
  );
  setValueIfPresent(data, COMPONENTTYPE_KEY_ALIASES, 'Komponenttyp', payload.componentType);
  setValueIfPresent(data, SOURCE_KEY_ALIASES, 'Skapad via', 'App auto');
  setValueIfPresent(data, STATUS_KEY_ALIASES, 'status', 'systemövervakat');
  setValueIfPresent(data, ['avdelning', 'department'], 'Avdelning', aggregate.department ?? '');

  const { error: insertError } = await supabase.from('ventilation_filter_list_rows').insert({
    source_file_name: objectMatchedRows[0]?.sourceFileName ?? 'Auto (fran app)',
    row_number: nextRowNumber,
    data,
    search_text: buildSearchText(data)
  });

  assertNoError(insertError);
  return true;
}

export type RepairAutoFilterRowsResult = {
  scannedRows: number;
  autoRows: number;
  mergedIntoExistingRows: number;
  normalizedRows: number;
  deletedAutoRows: number;
  skippedRows: number;
};

type RepairRow = {
  id: string;
  sourceFileName: string | null;
  rowNumber: number;
  searchText: string;
  data: Record<string, string>;
  values: FilterRowValues;
  obToken: string;
  filterSignature: string;
};

function toRepairRow(row: {
  id: string;
  source_file_name: string | null;
  row_number: number;
  search_text: string;
  data: Record<string, unknown> | null;
}): RepairRow {
  const data = toStringRecord(row.data);
  const values = extractFilterRowValues(data);
  const obToken = normalizeToken(values.obNumber || values.systemPosition);
  const filterName = values.filterName || values.materialbeteckning;
  const inferredType = values.componentType || inferFilterComponentType(filterName);
  const filterSignature = buildFilterSignature(
    inferredType,
    filterName,
    values.dimension,
    values.filterClass
  );

  return {
    id: row.id,
    sourceFileName: row.source_file_name,
    rowNumber: row.row_number,
    searchText: row.search_text,
    data,
    values,
    obToken,
    filterSignature
  };
}

function refreshRepairRow(row: RepairRow) {
  row.values = extractFilterRowValues(row.data);
  row.obToken = normalizeToken(row.values.obNumber || row.values.systemPosition);
  const filterName = row.values.filterName || row.values.materialbeteckning;
  const inferredType = row.values.componentType || inferFilterComponentType(filterName);
  row.filterSignature = buildFilterSignature(
    inferredType,
    filterName,
    row.values.dimension,
    row.values.filterClass
  );
  row.searchText = buildSearchText(row.data);
}

function isAutoRow(row: RepairRow): boolean {
  const sourceToken = normalizeToken(row.sourceFileName ?? '');
  if (sourceToken.startsWith('auto') || sourceToken.includes('franapp')) {
    return true;
  }

  const createdViaToken = normalizeToken(row.values.sourceTag);
  return createdViaToken.includes('appauto');
}

function hasMeaningfulFilter(row: RepairRow): boolean {
  const filterName = (row.values.filterName || row.values.materialbeteckning).trim();
  return Boolean(filterName);
}

function cloneEmptyTemplate(data: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.keys(data).map((key) => [key, '']));
}

export async function repairAutoFilterRows(): Promise<RepairAutoFilterRowsResult> {
  const supabase = getSupabaseServerClient();

  const { data: rows, error } = await supabase
    .from('ventilation_filter_list_rows')
    .select('id, source_file_name, row_number, search_text, data')
    .order('row_number', { ascending: true })
    .limit(20000);

  assertNoError(error);

  const parsed = ((rows ?? []) as Array<{
    id: string;
    source_file_name: string | null;
    row_number: number;
    search_text: string;
    data: Record<string, unknown> | null;
  }>).map(toRepairRow);

  const canonicalRows = parsed.filter((row) => !isAutoRow(row));
  const autoRows = parsed.filter((row) => isAutoRow(row));
  const canonicalByOb = new Map<string, RepairRow[]>();

  for (const row of canonicalRows) {
    if (!row.obToken) {
      continue;
    }
    const bucket = canonicalByOb.get(row.obToken) ?? [];
    bucket.push(row);
    canonicalByOb.set(row.obToken, bucket);
  }

  const fallbackTemplate = canonicalRows[0]?.data ?? {};

  let mergedIntoExistingRows = 0;
  let normalizedRows = 0;
  let deletedAutoRows = 0;
  let skippedRows = 0;

  for (const autoRow of autoRows) {
    if (!autoRow.obToken || !hasMeaningfulFilter(autoRow)) {
      skippedRows += 1;
      continue;
    }

    const sameObRows = canonicalByOb.get(autoRow.obToken) ?? [];
    const exactMatch = sameObRows.find(
      (row) => row.filterSignature === autoRow.filterSignature && hasMeaningfulFilter(row)
    );
    const emptyTarget = sameObRows.find((row) => !hasMeaningfulFilter(row));
    const mergeTarget = exactMatch ?? emptyTarget ?? null;

    if (mergeTarget) {
      const merged = { ...mergeTarget.data };
      applyFilterRowValues(merged, autoRow.values, 'fill-missing');
      const nextSearchText = buildSearchText(merged);
      const dataChanged = JSON.stringify(merged) !== JSON.stringify(mergeTarget.data);
      const searchChanged = nextSearchText !== mergeTarget.searchText;

      if (dataChanged || searchChanged) {
        const { error: updateError } = await supabase
          .from('ventilation_filter_list_rows')
          .update({
            data: merged,
            search_text: nextSearchText
          })
          .eq('id', mergeTarget.id);
        assertNoError(updateError);
        mergeTarget.data = merged;
        refreshRepairRow(mergeTarget);
      }

      const { error: deleteError } = await supabase
        .from('ventilation_filter_list_rows')
        .delete()
        .eq('id', autoRow.id);
      assertNoError(deleteError);

      mergedIntoExistingRows += 1;
      deletedAutoRows += 1;
      continue;
    }

    const template =
      sameObRows[0]?.data ??
      (Object.keys(fallbackTemplate).length ? fallbackTemplate : autoRow.data);
    const normalized = cloneEmptyTemplate(template);
    applyFilterRowValues(normalized, autoRow.values, 'overwrite');
    const normalizedSearchText = buildSearchText(normalized);
    const targetSource = sameObRows[0]?.sourceFileName ?? autoRow.sourceFileName;

    const dataChanged = JSON.stringify(normalized) !== JSON.stringify(autoRow.data);
    const searchChanged = normalizedSearchText !== autoRow.searchText;
    const sourceChanged = targetSource !== autoRow.sourceFileName;

    if (dataChanged || searchChanged || sourceChanged) {
      const { error: updateError } = await supabase
        .from('ventilation_filter_list_rows')
        .update({
          source_file_name: targetSource,
          data: normalized,
          search_text: normalizedSearchText
        })
        .eq('id', autoRow.id);
      assertNoError(updateError);
    }

    autoRow.data = normalized;
    autoRow.sourceFileName = targetSource;
    refreshRepairRow(autoRow);

    if (autoRow.obToken) {
      const bucket = canonicalByOb.get(autoRow.obToken) ?? [];
      bucket.push(autoRow);
      canonicalByOb.set(autoRow.obToken, bucket);
    }

    normalizedRows += 1;
  }

  return {
    scannedRows: parsed.length,
    autoRows: autoRows.length,
    mergedIntoExistingRows,
    normalizedRows,
    deletedAutoRows,
    skippedRows
  };
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
  const insertedCountByAggregate = new Map<string, number>();
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
      insertedCountByAggregate.set(
        match.aggregateId,
        (insertedCountByAggregate.get(match.aggregateId) ?? 0) + 1
      );

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

  if (insertedCountByAggregate.size > 0) {
    try {
      await logAggregateEvents(
        Array.from(insertedCountByAggregate.entries()).map(
          ([aggregateId, insertedCount]) => ({
            aggregateId,
            eventType: 'filterlist_sync_added',
            message: `Filter synkade fran filterlista (+${insertedCount}).`,
            metadata: {
              insertedCount,
              source: 'filterlista-import'
            }
          })
        )
      );
    } catch (eventError) {
      console.warn('Kunde inte skriva handelselogg for filterlista-synk:', eventError);
    }
  }

  return {
    syncedAggregates: touchedAggregates.size,
    insertedFilterComponents,
    skippedNoObjectMatch,
    skippedNoFilterData,
    skippedExistingFilter
  };
}
