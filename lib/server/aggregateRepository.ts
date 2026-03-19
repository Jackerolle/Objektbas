import {
  AggregateRecord,
  CreateAggregateComponentPayload,
  CreateAggregatePayload
} from '@/lib/types';
import { ensureFilterComponentInFilterList } from '@/lib/server/filterListRepository';
import { getSupabaseServerClient } from '@/lib/server/supabase';

type AggregateRow = {
  id: string;
  system_position_id: string;
  fl_system_position_id: string | null;
  se_system_position_id: string | null;
  position: string | null;
  department: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

type ComponentRow = {
  id: string;
  aggregate_id: string;
  component_type: string;
  identified_value: string;
  notes: string | null;
  assembly: string | null;
  sub_component: string | null;
  attributes: Record<string, unknown> | null;
  created_at: string;
};

function toAttributes(value: Record<string, unknown> | null): Record<string, string> {
  if (!value) {
    return {};
  }

  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    result[key] = typeof entry === 'string' ? entry : String(entry ?? '');
  }

  return result;
}

function normalizeOptionalSystemPosition(value: string | undefined): string | null {
  const next = value?.trim();
  return next ? next.toUpperCase() : null;
}

function hasOwn(payload: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(payload, key);
}

function mapAggregate(row: AggregateRow, componentRows: ComponentRow[]): AggregateRecord {
  return {
    id: row.id,
    systemPositionId: row.system_position_id,
    flSystemPositionId: row.fl_system_position_id ?? undefined,
    seSystemPositionId: row.se_system_position_id ?? undefined,
    position: row.position ?? undefined,
    department: row.department ?? undefined,
    notes: row.notes ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    components: componentRows.map((component) => ({
      id: component.id,
      componentType: component.component_type,
      identifiedValue: component.identified_value,
      notes: component.notes ?? undefined,
      assembly: component.assembly ?? undefined,
      subComponent: component.sub_component ?? undefined,
      attributes: toAttributes(component.attributes),
      createdAt: component.created_at
    }))
  };
}

function assertNoError(error: { message: string } | null) {
  if (error) {
    throw new Error(error.message);
  }
}

async function loadComponentsByAggregateIds(ids: string[]) {
  if (!ids.length) {
    return new Map<string, ComponentRow[]>();
  }

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from('ventilation_components')
    .select('*')
    .in('aggregate_id', ids)
    .order('created_at', { ascending: false });

  assertNoError(error);

  const map = new Map<string, ComponentRow[]>();
  for (const row of (data ?? []) as ComponentRow[]) {
    const list = map.get(row.aggregate_id) ?? [];
    list.push(row);
    map.set(row.aggregate_id, list);
  }

  return map;
}

export async function listAggregates(query: string): Promise<AggregateRecord[]> {
  const supabase = getSupabaseServerClient();

  const { data, error } = await supabase
    .from('ventilation_aggregates')
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(200);

  assertNoError(error);

  const aggregateRows = (data ?? []) as AggregateRow[];
  const componentMap = await loadComponentsByAggregateIds(aggregateRows.map((row) => row.id));

  const records = aggregateRows.map((row) => mapAggregate(row, componentMap.get(row.id) ?? []));
  const needle = query.trim().toLowerCase();

  if (!needle) {
    return records;
  }

  return records.filter((record) => {
    const directMatch = [
      record.systemPositionId,
      record.flSystemPositionId,
      record.seSystemPositionId,
      record.position,
      record.department,
      record.notes
    ]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(needle));

    if (directMatch) {
      return true;
    }

    return record.components.some((component) => {
      const fields = [
        component.componentType,
        component.assembly,
        component.subComponent,
        component.identifiedValue,
        component.notes
      ];
      const componentMatch = fields
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle));

      if (componentMatch) {
        return true;
      }

      return Object.entries(component.attributes).some(([key, value]) => {
        return key.toLowerCase().includes(needle) || value.toLowerCase().includes(needle);
      });
    });
  });
}

export async function getAggregateById(id: string): Promise<AggregateRecord | null> {
  const supabase = getSupabaseServerClient();

  const { data, error } = await supabase
    .from('ventilation_aggregates')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  assertNoError(error);

  if (!data) {
    return null;
  }

  const aggregate = data as AggregateRow;
  const componentMap = await loadComponentsByAggregateIds([id]);

  return mapAggregate(aggregate, componentMap.get(id) ?? []);
}

export async function findLatestAggregateBySystemPositionId(
  systemPositionId: string
): Promise<AggregateRecord | null> {
  const supabase = getSupabaseServerClient();

  const { data, error } = await supabase
    .from('ventilation_aggregates')
    .select('*')
    .eq('system_position_id', systemPositionId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  assertNoError(error);

  if (!data) {
    return null;
  }

  return getAggregateById((data as AggregateRow).id);
}

export async function updateAggregateMetadata(
  aggregateId: string,
  fields: Pick<
    CreateAggregatePayload,
    'position' | 'department' | 'notes' | 'flSystemPositionId' | 'seSystemPositionId'
  >
): Promise<AggregateRecord | null> {
  const patch: Record<string, string | null> = {};

  if (hasOwn(fields, 'position')) {
    patch.position = fields.position?.trim() || null;
  }

  if (hasOwn(fields, 'department')) {
    patch.department = fields.department?.trim() || null;
  }

  if (hasOwn(fields, 'notes')) {
    patch.notes = fields.notes?.trim() || null;
  }

  if (hasOwn(fields, 'flSystemPositionId')) {
    patch.fl_system_position_id = normalizeOptionalSystemPosition(
      fields.flSystemPositionId
    );
  }

  if (hasOwn(fields, 'seSystemPositionId')) {
    patch.se_system_position_id = normalizeOptionalSystemPosition(
      fields.seSystemPositionId
    );
  }

  if (Object.keys(patch).length === 0) {
    return getAggregateById(aggregateId);
  }

  const supabase = getSupabaseServerClient();
  const { error } = await supabase
    .from('ventilation_aggregates')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', aggregateId);

  assertNoError(error);

  return getAggregateById(aggregateId);
}

export async function createAggregateRecord(
  payload: CreateAggregatePayload
): Promise<AggregateRecord> {
  const supabase = getSupabaseServerClient();
  const normalizedSystemPositionId = payload.systemPositionId.trim().toUpperCase();
  const normalizedFlSystemPositionId = normalizeOptionalSystemPosition(
    payload.flSystemPositionId
  );
  const normalizedSeSystemPositionId = normalizeOptionalSystemPosition(
    payload.seSystemPositionId
  );

  const { data: existingRows, error: existingError } = await supabase
    .from('ventilation_aggregates')
    .select('id')
    .ilike('system_position_id', normalizedSystemPositionId)
    .order('updated_at', { ascending: false })
    .limit(1);

  assertNoError(existingError);

  const existingId = (existingRows as Array<{ id: string }> | null)?.[0]?.id;
  if (existingId) {
    const shouldUpdateExisting =
      hasOwn(payload, 'position') ||
      hasOwn(payload, 'department') ||
      hasOwn(payload, 'notes') ||
      hasOwn(payload, 'flSystemPositionId') ||
      hasOwn(payload, 'seSystemPositionId');

    if (shouldUpdateExisting) {
      const updated = await updateAggregateRecord(existingId, {
        ...payload,
        systemPositionId: normalizedSystemPositionId,
        flSystemPositionId: normalizedFlSystemPositionId ?? undefined,
        seSystemPositionId: normalizedSeSystemPositionId ?? undefined
      });

      if (updated) {
        return updated;
      }
    } else {
      const existing = await getAggregateById(existingId);
      if (existing) {
        return existing;
      }
    }
  }

  const { data, error } = await supabase
    .from('ventilation_aggregates')
    .insert({
      system_position_id: normalizedSystemPositionId,
      fl_system_position_id: normalizedFlSystemPositionId,
      se_system_position_id: normalizedSeSystemPositionId,
      position: payload.position?.trim() || null,
      department: payload.department?.trim() || null,
      notes: payload.notes?.trim() || null
    })
    .select('*')
    .single();

  assertNoError(error);

  return mapAggregate(data as AggregateRow, []);
}

export async function updateAggregateRecord(
  aggregateId: string,
  payload: CreateAggregatePayload
): Promise<AggregateRecord | null> {
  const supabase = getSupabaseServerClient();
  const normalizedSystemPositionId = payload.systemPositionId.trim().toUpperCase();
  const existing = await getAggregateById(aggregateId);

  if (!existing) {
    return null;
  }

  const nextFlSystemPositionId = hasOwn(payload, 'flSystemPositionId')
    ? normalizeOptionalSystemPosition(payload.flSystemPositionId)
    : existing.flSystemPositionId ?? null;
  const nextSeSystemPositionId = hasOwn(payload, 'seSystemPositionId')
    ? normalizeOptionalSystemPosition(payload.seSystemPositionId)
    : existing.seSystemPositionId ?? null;
  const nextPosition = hasOwn(payload, 'position')
    ? payload.position?.trim() || null
    : existing.position ?? null;
  const nextDepartment = hasOwn(payload, 'department')
    ? payload.department?.trim() || null
    : existing.department ?? null;
  const nextNotes = hasOwn(payload, 'notes')
    ? payload.notes?.trim() || null
    : existing.notes ?? null;

  const { data, error } = await supabase
    .from('ventilation_aggregates')
    .update({
      system_position_id: normalizedSystemPositionId,
      fl_system_position_id: nextFlSystemPositionId,
      se_system_position_id: nextSeSystemPositionId,
      position: nextPosition,
      department: nextDepartment,
      notes: nextNotes,
      updated_at: new Date().toISOString()
    })
    .eq('id', aggregateId)
    .select('*')
    .maybeSingle();

  assertNoError(error);

  if (!data) {
    return null;
  }

  const componentMap = await loadComponentsByAggregateIds([aggregateId]);
  return mapAggregate(data as AggregateRow, componentMap.get(aggregateId) ?? []);
}

export async function addComponentToAggregate(
  aggregateId: string,
  payload: CreateAggregateComponentPayload
): Promise<AggregateRecord | null> {
  const supabase = getSupabaseServerClient();

  const existing = await getAggregateById(aggregateId);
  if (!existing) {
    return null;
  }

  const { error: insertError } = await supabase
    .from('ventilation_components')
    .insert({
      aggregate_id: aggregateId,
      component_type: payload.componentType,
      identified_value: payload.identifiedValue,
      notes: payload.notes ?? null,
      assembly: payload.assembly?.trim() || null,
      sub_component: payload.subComponent?.trim() || null,
      attributes: payload.attributes ?? {}
    });

  assertNoError(insertError);

  const { error: updateError } = await supabase
    .from('ventilation_aggregates')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', aggregateId);

  assertNoError(updateError);

  try {
    await ensureFilterComponentInFilterList(existing, payload);
  } catch (filterListError) {
    console.warn(
      'Kunde inte uppdatera filterlista automatiskt vid ny komponent:',
      filterListError
    );
  }

  return getAggregateById(aggregateId);
}

export async function updateComponentInAggregate(
  aggregateId: string,
  componentId: string,
  payload: CreateAggregateComponentPayload
): Promise<AggregateRecord | null> {
  const supabase = getSupabaseServerClient();

  const existing = await getAggregateById(aggregateId);
  if (!existing) {
    return null;
  }

  const { data, error } = await supabase
    .from('ventilation_components')
    .update({
      component_type: payload.componentType,
      identified_value: payload.identifiedValue,
      notes: payload.notes ?? null,
      assembly: payload.assembly?.trim() || null,
      sub_component: payload.subComponent?.trim() || null,
      attributes: payload.attributes ?? {}
    })
    .eq('id', componentId)
    .eq('aggregate_id', aggregateId)
    .select('id')
    .maybeSingle();

  assertNoError(error);

  if (!data) {
    return null;
  }

  const { error: updateError } = await supabase
    .from('ventilation_aggregates')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', aggregateId);

  assertNoError(updateError);

  try {
    await ensureFilterComponentInFilterList(existing, payload);
  } catch (filterListError) {
    console.warn(
      'Kunde inte uppdatera filterlista automatiskt vid komponentuppdatering:',
      filterListError
    );
  }

  return getAggregateById(aggregateId);
}

export async function deleteComponentFromAggregate(
  aggregateId: string,
  componentId: string
): Promise<AggregateRecord | null> {
  const supabase = getSupabaseServerClient();

  const existing = await getAggregateById(aggregateId);
  if (!existing) {
    return null;
  }

  const { data, error } = await supabase
    .from('ventilation_components')
    .delete()
    .eq('id', componentId)
    .eq('aggregate_id', aggregateId)
    .select('id')
    .maybeSingle();

  assertNoError(error);

  if (!data) {
    return null;
  }

  const { error: updateError } = await supabase
    .from('ventilation_aggregates')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', aggregateId);

  assertNoError(updateError);

  return getAggregateById(aggregateId);
}

export async function deleteAggregateRecord(aggregateId: string): Promise<boolean> {
  const supabase = getSupabaseServerClient();

  const { data, error } = await supabase
    .from('ventilation_aggregates')
    .delete()
    .eq('id', aggregateId)
    .select('id')
    .maybeSingle();

  assertNoError(error);

  return Boolean(data);
}
