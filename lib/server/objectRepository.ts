import { ObservationPayload, Objekt } from '@/lib/types';
import { getSupabaseServerClient } from '@/lib/server/supabase';

type ObjectRow = {
  id: string;
  name: string;
  category: string;
  location: string;
  tags: string[] | null;
  last_service: string | null;
  updated_at: string;
  equipment: unknown[] | null;
};

type ObservationRow = {
  id: string;
  object_id: string;
  notes: string | null;
  image_data_url: string | null;
  timestamp: string;
  created_at: string;
};

export type ObservationRecord = {
  id: string;
  objectId: string;
  notes: string;
  imageDataUrl?: string;
  timestamp: string;
  createdAt: string;
};

function assertNoError(error: { message: string } | null) {
  if (error) {
    throw new Error(error.message);
  }
}

function toEquipment(
  value: unknown[] | null
): Objekt['equipment'] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry, index) => {
      if (!entry || typeof entry !== 'object') {
        return null;
      }

      const row = entry as Record<string, unknown>;
      const statusValue = row.status;
      const status =
        statusValue === 'ok' || statusValue === 'saknas' || statusValue === 'trasig'
          ? statusValue
          : 'ok';

      return {
        id: typeof row.id === 'string' && row.id.trim() ? row.id : `eq-${index + 1}`,
        name: typeof row.name === 'string' ? row.name : 'Okänd del',
        quantity: typeof row.quantity === 'number' ? row.quantity : 1,
        status
      };
    })
    .filter((entry): entry is Objekt['equipment'][number] => Boolean(entry));
}

function mapObject(row: ObjectRow): Objekt {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    location: row.location,
    tags: row.tags ?? [],
    lastService: row.last_service ?? '',
    updatedAt: row.updated_at,
    equipment: toEquipment(row.equipment)
  };
}

function mapObservation(row: ObservationRow): ObservationRecord {
  return {
    id: row.id,
    objectId: row.object_id,
    notes: row.notes ?? '',
    imageDataUrl: row.image_data_url ?? undefined,
    timestamp: row.timestamp,
    createdAt: row.created_at
  };
}

function toObjectId(name: string): string {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

  return slug || `objekt-${Date.now()}`;
}

export async function listObjects(): Promise<Objekt[]> {
  const supabase = getSupabaseServerClient();

  const { data, error } = await supabase
    .from('objekt_objects')
    .select('*')
    .order('updated_at', { ascending: false });

  assertNoError(error);

  return ((data ?? []) as ObjectRow[]).map(mapObject);
}

export async function createObjectRecord(payload: {
  name: string;
  category: string;
  location: string;
  tags: string[];
}): Promise<Objekt> {
  const supabase = getSupabaseServerClient();
  const nextId = toObjectId(payload.name);

  const { data, error } = await supabase
    .from('objekt_objects')
    .upsert(
      {
        id: nextId,
        name: payload.name,
        category: payload.category,
        location: payload.location,
        tags: payload.tags,
        last_service: new Date().toISOString().slice(0, 10),
        updated_at: new Date().toISOString(),
        equipment: []
      },
      { onConflict: 'id' }
    )
    .select('*')
    .single();

  assertNoError(error);

  return mapObject(data as ObjectRow);
}

export async function listObservations(): Promise<ObservationRecord[]> {
  const supabase = getSupabaseServerClient();

  const { data, error } = await supabase
    .from('objekt_observations')
    .select('*')
    .order('timestamp', { ascending: false })
    .limit(200);

  assertNoError(error);

  return ((data ?? []) as ObservationRow[]).map(mapObservation);
}

export async function createObservationRecord(
  payload: ObservationPayload
): Promise<ObservationRecord> {
  const supabase = getSupabaseServerClient();

  const { data: objectRow, error: objectError } = await supabase
    .from('objekt_objects')
    .select('id')
    .eq('id', payload.objectId)
    .maybeSingle();

  assertNoError(objectError);

  if (!objectRow) {
    throw new Error(`Objekt ${payload.objectId} saknas.`);
  }

  const { data, error } = await supabase
    .from('objekt_observations')
    .insert({
      object_id: payload.objectId,
      notes: payload.notes || null,
      image_data_url: payload.imageDataUrl ?? null,
      timestamp: payload.timestamp || new Date().toISOString()
    })
    .select('*')
    .single();

  assertNoError(error);

  return mapObservation(data as ObservationRow);
}
