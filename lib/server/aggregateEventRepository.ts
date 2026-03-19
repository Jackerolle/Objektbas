import { AggregateEvent } from '@/lib/types';
import { getSupabaseServerClient } from '@/lib/server/supabase';

type AggregateEventRow = {
  id: string;
  aggregate_id: string;
  event_type: string;
  message: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

type CreateAggregateEventPayload = {
  aggregateId: string;
  eventType: string;
  message: string;
  metadata?: Record<string, unknown>;
};

function assertNoError(error: { message: string } | null) {
  if (error) {
    throw new Error(error.message);
  }
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

function mapEvent(row: AggregateEventRow): AggregateEvent {
  return {
    id: row.id,
    aggregateId: row.aggregate_id,
    eventType: row.event_type,
    message: row.message,
    metadata: toStringRecord(row.metadata),
    createdAt: row.created_at
  };
}

export async function listAggregateEvents(
  aggregateId: string,
  limit = 100
): Promise<AggregateEvent[]> {
  const supabase = getSupabaseServerClient();
  const normalizedLimit = Math.max(1, Math.min(500, limit));

  const { data, error } = await supabase
    .from('ventilation_aggregate_events')
    .select('*')
    .eq('aggregate_id', aggregateId)
    .order('created_at', { ascending: false })
    .limit(normalizedLimit);

  assertNoError(error);
  return ((data ?? []) as AggregateEventRow[]).map(mapEvent);
}

export async function logAggregateEvent(
  payload: CreateAggregateEventPayload
): Promise<void> {
  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from('ventilation_aggregate_events').insert({
    aggregate_id: payload.aggregateId,
    event_type: payload.eventType.trim(),
    message: payload.message.trim(),
    metadata: payload.metadata ?? {}
  });

  assertNoError(error);
}

export async function logAggregateEvents(
  events: CreateAggregateEventPayload[]
): Promise<void> {
  if (!events.length) {
    return;
  }

  const supabase = getSupabaseServerClient();
  const chunkSize = 500;

  for (let i = 0; i < events.length; i += chunkSize) {
    const chunk = events.slice(i, i + chunkSize);
    const { error } = await supabase.from('ventilation_aggregate_events').insert(
      chunk.map((event) => ({
        aggregate_id: event.aggregateId,
        event_type: event.eventType.trim(),
        message: event.message.trim(),
        metadata: event.metadata ?? {}
      }))
    );

    assertNoError(error);
  }
}
