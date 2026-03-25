import {
  CreateRoundItemPayload,
  CreateRoundPayload,
  RoundItemRecord,
  RoundRecord,
  RoundSeverity,
  RoundStatus,
  UpdateRoundItemPayload,
  UpdateRoundPayload
} from '@/lib/types';
import { getSupabaseServerClient } from '@/lib/server/supabase';

type RoundRow = {
  id: string;
  title: string;
  department: string | null;
  customer_name: string | null;
  performed_by: string | null;
  status: RoundStatus;
  summary_text: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

type RoundItemRow = {
  id: string;
  round_id: string;
  aggregate_id: string | null;
  system_position_id: string;
  component_area: string | null;
  title: string;
  observation: string;
  recommended_action: string;
  severity: RoundSeverity;
  photos: unknown;
  created_at: string;
  updated_at: string;
};

function assertNoError(error: { message: string } | null) {
  if (error) {
    throw new Error(error.message);
  }
}

function hasOwn(payload: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(payload, key);
}

function normalizeText(value: string | undefined | null): string | null {
  const next = value?.trim();
  return next ? next : null;
}

function normalizeSystemPositionId(value: string | undefined | null): string {
  return (
    value
      ?.trim()
      .toUpperCase()
      .replace(/\s+/g, '')
      .replace(/[^A-Z0-9-]/g, '') ?? ''
  );
}

function normalizePhotos(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter(Boolean);
}

function defaultRoundTitle(): string {
  return `Rondering ${new Date().toLocaleDateString('sv-SE')}`;
}

function severityRank(severity: RoundSeverity): number {
  switch (severity) {
    case 'akut':
      return 0;
    case 'atgard':
      return 1;
    default:
      return 2;
  }
}

function mapRoundItem(row: RoundItemRow): RoundItemRecord {
  return {
    id: row.id,
    roundId: row.round_id,
    aggregateId: row.aggregate_id ?? undefined,
    systemPositionId: row.system_position_id,
    componentArea: row.component_area ?? undefined,
    title: row.title,
    observation: row.observation,
    recommendedAction: row.recommended_action,
    severity: row.severity,
    photos: normalizePhotos(row.photos),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapRound(row: RoundRow, items: RoundItemRecord[]): RoundRecord {
  return {
    id: row.id,
    title: row.title,
    department: row.department ?? undefined,
    customerName: row.customer_name ?? undefined,
    performedBy: row.performed_by ?? undefined,
    status: row.status,
    summaryText: row.summary_text ?? '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at ?? undefined,
    items
  };
}

async function loadItemsByRoundIds(ids: string[]): Promise<Map<string, RoundItemRecord[]>> {
  if (!ids.length) {
    return new Map<string, RoundItemRecord[]>();
  }

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from('ventilation_round_items')
    .select('*')
    .in('round_id', ids)
    .order('created_at', { ascending: true });

  assertNoError(error);

  const result = new Map<string, RoundItemRecord[]>();
  for (const row of (data ?? []) as RoundItemRow[]) {
    const item = mapRoundItem(row);
    const current = result.get(row.round_id) ?? [];
    current.push(item);
    result.set(row.round_id, current);
  }

  return result;
}

function buildRoundSummary(record: RoundRecord): string {
  const dateLabel = new Date(record.completedAt ?? record.updatedAt).toLocaleDateString('sv-SE');
  const header = [
    record.title.trim() || `Rondering ${dateLabel}`,
    record.department ? `Avdelning: ${record.department}` : '',
    record.customerName ? `Beställare: ${record.customerName}` : '',
    record.performedBy ? `Utförd av: ${record.performedBy}` : ''
  ].filter(Boolean);

  if (!record.items.length) {
    return [...header, '', 'Inga ronderingspunkter registrerade.'].join('\n');
  }

  const grouped = new Map<string, RoundItemRecord[]>();
  for (const item of [...record.items].sort((a, b) => {
    const severityDiff = severityRank(a.severity) - severityRank(b.severity);
    if (severityDiff !== 0) {
      return severityDiff;
    }

    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  })) {
    const key = normalizeSystemPositionId(item.systemPositionId) || 'OKÄND SYSTEMPOSITION';
    const bucket = grouped.get(key) ?? [];
    bucket.push(item);
    grouped.set(key, bucket);
  }

  const lines = [...header, '', 'Följande punkter noterades vid ronderingen:', ''];
  for (const [systemPositionId, items] of grouped.entries()) {
    lines.push(systemPositionId);
    for (const item of items) {
      const prefix =
        item.severity === 'akut' ? '[Akut] ' : item.severity === 'info' ? '[Info] ' : '';
      const area = item.componentArea?.trim() ? ` (${item.componentArea.trim()})` : '';
      const observation = item.observation.trim();
      const action = item.recommendedAction.trim();
      lines.push(`- ${prefix}${item.title.trim()}${area}.`);
      lines.push(`  Observation: ${observation}`);
      lines.push(`  Rekommenderad åtgärd: ${action}`);
    }
    lines.push('');
  }

  const acuteCount = record.items.filter((item) => item.severity === 'akut').length;
  const actionCount = record.items.filter((item) => item.severity === 'atgard').length;
  const infoCount = record.items.filter((item) => item.severity === 'info').length;

  lines.push(`Totalt antal punkter: ${record.items.length}`);
  lines.push(`Akuta punkter: ${acuteCount}`);
  lines.push(`Åtgärdspunkter: ${actionCount}`);
  lines.push(`Informationspunkter: ${infoCount}`);

  return lines.join('\n').trim();
}

async function syncRoundSummary(roundId: string): Promise<void> {
  const current = await getRoundById(roundId);
  if (!current) {
    return;
  }

  const supabase = getSupabaseServerClient();
  const summaryText = buildRoundSummary(current);
  const { error } = await supabase
    .from('ventilation_rounds')
    .update({ summary_text: summaryText })
    .eq('id', roundId);

  assertNoError(error);
}

export async function listRounds(filters?: {
  query?: string;
  department?: string;
  status?: RoundStatus | '';
}): Promise<RoundRecord[]> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from('ventilation_rounds')
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(200);

  assertNoError(error);

  const roundRows = (data ?? []) as RoundRow[];
  const itemsMap = await loadItemsByRoundIds(roundRows.map((row) => row.id));
  const records = roundRows.map((row) => mapRound(row, itemsMap.get(row.id) ?? []));

  const queryNeedle = filters?.query?.trim().toLowerCase() ?? '';
  const departmentNeedle = filters?.department?.trim().toLowerCase() ?? '';
  const statusNeedle = filters?.status ?? '';

  return records.filter((record) => {
    if (departmentNeedle) {
      const department = record.department?.trim().toLowerCase() ?? '';
      if (department !== departmentNeedle) {
        return false;
      }
    }

    if (statusNeedle && record.status !== statusNeedle) {
      return false;
    }

    if (!queryNeedle) {
      return true;
    }

    const directFields = [
      record.title,
      record.department,
      record.customerName,
      record.performedBy,
      record.summaryText
    ]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(queryNeedle));

    if (directFields) {
      return true;
    }

    return record.items.some((item) =>
      [
        item.systemPositionId,
        item.componentArea,
        item.title,
        item.observation,
        item.recommendedAction
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(queryNeedle))
    );
  });
}

export async function getRoundById(id: string): Promise<RoundRecord | null> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from('ventilation_rounds')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  assertNoError(error);

  if (!data) {
    return null;
  }

  const row = data as RoundRow;
  const itemsMap = await loadItemsByRoundIds([id]);
  return mapRound(row, itemsMap.get(id) ?? []);
}

export async function createRound(payload: CreateRoundPayload): Promise<RoundRecord> {
  const supabase = getSupabaseServerClient();
  const status = payload.status ?? 'ongoing';
  const { data, error } = await supabase
    .from('ventilation_rounds')
    .insert({
      title: normalizeText(payload.title) ?? defaultRoundTitle(),
      department: normalizeText(payload.department),
      customer_name: normalizeText(payload.customerName),
      performed_by: normalizeText(payload.performedBy),
      status,
      completed_at: status === 'completed' ? new Date().toISOString() : null
    })
    .select('*')
    .single();

  assertNoError(error);

  const created = mapRound(data as RoundRow, []);
  await syncRoundSummary(created.id);
  return (await getRoundById(created.id)) as RoundRecord;
}

export async function updateRound(
  id: string,
  payload: UpdateRoundPayload
): Promise<RoundRecord | null> {
  const existing = await getRoundById(id);
  if (!existing) {
    return null;
  }

  const supabase = getSupabaseServerClient();
  const updateData: Record<string, unknown> = {};

  if (hasOwn(payload, 'title')) {
    updateData.title = normalizeText(payload.title) ?? defaultRoundTitle();
  }
  if (hasOwn(payload, 'department')) {
    updateData.department = normalizeText(payload.department);
  }
  if (hasOwn(payload, 'customerName')) {
    updateData.customer_name = normalizeText(payload.customerName);
  }
  if (hasOwn(payload, 'performedBy')) {
    updateData.performed_by = normalizeText(payload.performedBy);
  }
  if (hasOwn(payload, 'status')) {
    updateData.status = payload.status;
    updateData.completed_at =
      payload.status === 'completed'
        ? existing.completedAt ?? new Date().toISOString()
        : null;
  }
  if (hasOwn(payload, 'summaryText')) {
    updateData.summary_text = payload.summaryText?.trim() ?? '';
  }

  const { error } = await supabase.from('ventilation_rounds').update(updateData).eq('id', id);
  assertNoError(error);

  if (!hasOwn(payload, 'summaryText')) {
    await syncRoundSummary(id);
  }

  return getRoundById(id);
}

export async function deleteRound(id: string): Promise<boolean> {
  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from('ventilation_rounds').delete().eq('id', id);
  assertNoError(error);
  return true;
}

export async function createRoundItem(
  roundId: string,
  payload: CreateRoundItemPayload
): Promise<RoundRecord | null> {
  const existing = await getRoundById(roundId);
  if (!existing) {
    return null;
  }

  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from('ventilation_round_items').insert({
    round_id: roundId,
    aggregate_id: normalizeText(payload.aggregateId),
    system_position_id: normalizeSystemPositionId(payload.systemPositionId),
    component_area: normalizeText(payload.componentArea),
    title: payload.title.trim(),
    observation: payload.observation.trim(),
    recommended_action: payload.recommendedAction.trim(),
    severity: payload.severity,
    photos: payload.photos ?? []
  });

  assertNoError(error);
  await syncRoundSummary(roundId);
  return getRoundById(roundId);
}

export async function updateRoundItem(
  roundId: string,
  itemId: string,
  payload: UpdateRoundItemPayload
): Promise<RoundRecord | null> {
  const existing = await getRoundById(roundId);
  if (!existing) {
    return null;
  }

  const updateData: Record<string, unknown> = {};
  if (hasOwn(payload, 'aggregateId')) {
    updateData.aggregate_id = normalizeText(payload.aggregateId);
  }
  if (hasOwn(payload, 'systemPositionId')) {
    updateData.system_position_id = normalizeSystemPositionId(payload.systemPositionId);
  }
  if (hasOwn(payload, 'componentArea')) {
    updateData.component_area = normalizeText(payload.componentArea);
  }
  if (hasOwn(payload, 'title')) {
    updateData.title = payload.title?.trim() ?? '';
  }
  if (hasOwn(payload, 'observation')) {
    updateData.observation = payload.observation?.trim() ?? '';
  }
  if (hasOwn(payload, 'recommendedAction')) {
    updateData.recommended_action = payload.recommendedAction?.trim() ?? '';
  }
  if (hasOwn(payload, 'severity')) {
    updateData.severity = payload.severity;
  }
  if (hasOwn(payload, 'photos')) {
    updateData.photos = payload.photos ?? [];
  }

  const supabase = getSupabaseServerClient();
  const { error } = await supabase
    .from('ventilation_round_items')
    .update(updateData)
    .eq('id', itemId)
    .eq('round_id', roundId);

  assertNoError(error);
  await syncRoundSummary(roundId);
  return getRoundById(roundId);
}

export async function deleteRoundItem(
  roundId: string,
  itemId: string
): Promise<RoundRecord | null> {
  const existing = await getRoundById(roundId);
  if (!existing) {
    return null;
  }

  const supabase = getSupabaseServerClient();
  const { error } = await supabase
    .from('ventilation_round_items')
    .delete()
    .eq('id', itemId)
    .eq('round_id', roundId);

  assertNoError(error);
  await syncRoundSummary(roundId);
  return getRoundById(roundId);
}
