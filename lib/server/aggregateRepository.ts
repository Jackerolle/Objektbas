import {
  AggregateRecord,
  CreateAggregateComponentPayload,
  CreateAggregatePayload
} from '@/lib/types';
import { getSupabaseServerClient } from '@/lib/server/supabase';

type AggregateRow = {
  id: string;
  system_position_id: string;
  position: string | null;
  department: string | null;
  notes: string | null;
  system_position_image_data_url: string | null;
  created_at: string;
  updated_at: string;
};

type ComponentRow = {
  id: string;
  aggregate_id: string;
  component_type: string;
  identified_value: string;
  notes: string | null;
  image_data_url: string | null;
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

function mapAggregate(row: AggregateRow, componentRows: ComponentRow[]): AggregateRecord {
  return {
    id: row.id,
    systemPositionId: row.system_position_id,
    position: row.position ?? undefined,
    department: row.department ?? undefined,
    notes: row.notes ?? undefined,
    systemPositionImageDataUrl: row.system_position_image_data_url ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    components: componentRows.map((component) => ({
      id: component.id,
      componentType: component.component_type,
      identifiedValue: component.identified_value,
      notes: component.notes ?? undefined,
      imageDataUrl: component.image_data_url ?? undefined,
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
      const fields = [component.componentType, component.identifiedValue, component.notes];
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

export async function createAggregateRecord(
  payload: CreateAggregatePayload
): Promise<AggregateRecord> {
  const supabase = getSupabaseServerClient();

  const { data, error } = await supabase
    .from('ventilation_aggregates')
    .insert({
      system_position_id: payload.systemPositionId,
      position: payload.position ?? null,
      department: payload.department ?? null,
      notes: payload.notes ?? null,
      system_position_image_data_url: payload.systemPositionImageDataUrl ?? null
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

  const { data, error } = await supabase
    .from('ventilation_aggregates')
    .update({
      system_position_id: payload.systemPositionId,
      position: payload.position ?? null,
      department: payload.department ?? null,
      notes: payload.notes ?? null,
      system_position_image_data_url: payload.systemPositionImageDataUrl ?? null,
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

  const { data: existingComponent, error: existingComponentError } = await supabase
    .from('ventilation_components')
    .select('id')
    .eq('aggregate_id', aggregateId)
    .eq('component_type', payload.componentType)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  assertNoError(existingComponentError);

  if (existingComponent?.id) {
    const { error: updateComponentError } = await supabase
      .from('ventilation_components')
      .update({
        identified_value: payload.identifiedValue,
        notes: payload.notes ?? null,
        image_data_url: payload.imageDataUrl ?? null,
        attributes: payload.attributes ?? {}
      })
      .eq('id', existingComponent.id);

    assertNoError(updateComponentError);
  } else {
    const { error: insertError } = await supabase
      .from('ventilation_components')
      .insert({
        aggregate_id: aggregateId,
        component_type: payload.componentType,
        identified_value: payload.identifiedValue,
        notes: payload.notes ?? null,
        image_data_url: payload.imageDataUrl ?? null,
        attributes: payload.attributes ?? {}
      });

    assertNoError(insertError);
  }

  const { error: updateError } = await supabase
    .from('ventilation_aggregates')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', aggregateId);

  assertNoError(updateError);

  return getAggregateById(aggregateId);
}
