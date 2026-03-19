import {
  COMPONENT_FIELD_CONFIG,
  normalizeAttributes,
  resolveComponentType
} from '@/lib/componentSchema';
import { ComponentType } from '@/lib/types';
import * as XLSX from 'xlsx';

export type ImportedComponent = {
  componentType: ComponentType;
  identifiedValue: string;
  notes?: string;
  attributes: Record<string, string>;
};

export type ImportedAggregate = {
  systemPositionId: string;
  flSystemPositionId?: string;
  seSystemPositionId?: string;
  position?: string;
  department?: string;
  notes?: string;
  components: ImportedComponent[];
};

export type ParsedImportPayload = {
  totalRows: number;
  skippedRows: number;
  aggregates: ImportedAggregate[];
  warnings: string[];
};

const ALL_COMPONENT_ATTRIBUTE_KEYS = new Set(
  Object.values(COMPONENT_FIELD_CONFIG)
    .flat()
    .map((field) => field.key.toLowerCase())
);

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function asString(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  return String(value).trim();
}

function pickValue(row: Record<string, unknown>, aliases: string[]): string {
  const normalized = new Map<string, unknown>();
  for (const [key, value] of Object.entries(row)) {
    normalized.set(normalizeKey(key), value);
  }

  for (const alias of aliases) {
    const raw = normalized.get(normalizeKey(alias));
    const value = asString(raw);
    if (value) {
      return value;
    }
  }

  return '';
}

function extractAttributes(row: Record<string, unknown>): Record<string, string> {
  const attributes: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(row)) {
    const normalized = normalizeKey(key);
    const stringValue = asString(value);

    if (!stringValue) {
      continue;
    }

    if (normalized.startsWith('attr')) {
      const dynamicKey = key
        .replace(/^attr[_\s-]*/i, '')
        .trim()
        .replace(/\s+/g, '_');
      if (dynamicKey) {
        attributes[dynamicKey] = stringValue;
      }
      continue;
    }

    if (ALL_COMPONENT_ATTRIBUTE_KEYS.has(normalized)) {
      attributes[key.trim()] = stringValue;
    }
  }

  return normalizeAttributes(attributes);
}

export function parseAggregateWorkbook(buffer: Buffer): ParsedImportPayload {
  const workbook = XLSX.read(buffer, { type: 'buffer' });

  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    throw new Error('Excel-filen innehaller inga blad.');
  }

  const sheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: ''
  });

  const grouped = new Map<string, ImportedAggregate>();
  const warnings: string[] = [];
  let skippedRows = 0;

  rows.forEach((row: Record<string, unknown>, index: number) => {
    const rowNumber = index + 2;

    const systemPositionId = pickValue(row, [
      'systemPositionId',
      'system_position_id',
      'systemposition',
      'id'
    ]);

    if (!systemPositionId) {
      skippedRows += 1;
      warnings.push(`Rad ${rowNumber}: saknar systemPositionId.`);
      return;
    }

    const position = pickValue(row, ['position']);
    const flSystemPositionId = pickValue(row, [
      'flSystemPositionId',
      'fl_system_position_id',
      'flSystemposition',
      'fl-position',
      'fl'
    ]);
    const seSystemPositionId = pickValue(row, [
      'seSystemPositionId',
      'se_system_position_id',
      'seSystemposition',
      'se-position',
      'se'
    ]);
    const department = pickValue(row, ['department', 'avdelning']);
    const notes = pickValue(row, ['notes', 'kommentar', 'aggregateNotes']);

    const existing = grouped.get(systemPositionId) ?? {
      systemPositionId,
      flSystemPositionId: flSystemPositionId || undefined,
      seSystemPositionId: seSystemPositionId || undefined,
      position: position || undefined,
      department: department || undefined,
      notes: notes || undefined,
      components: []
    };

    if (!existing.flSystemPositionId && flSystemPositionId) {
      existing.flSystemPositionId = flSystemPositionId;
    }
    if (!existing.seSystemPositionId && seSystemPositionId) {
      existing.seSystemPositionId = seSystemPositionId;
    }
    if (!existing.position && position) {
      existing.position = position;
    }
    if (!existing.department && department) {
      existing.department = department;
    }
    if (!existing.notes && notes) {
      existing.notes = notes;
    }

    const componentTypeRaw = pickValue(row, [
      'componentType',
      'component_type',
      'tillbehortyp',
      'tillbehor'
    ]);
    const identifiedValue = pickValue(row, [
      'identifiedValue',
      'identified_value',
      'beteckning',
      'value'
    ]);
    const componentNotes = pickValue(row, [
      'componentNotes',
      'component_notes',
      'tillbehornotes'
    ]);

    if (!componentTypeRaw && !identifiedValue) {
      grouped.set(systemPositionId, existing);
      return;
    }

    if (!componentTypeRaw || !identifiedValue) {
      skippedRows += 1;
      warnings.push(`Rad ${rowNumber}: komponentrad ar ofullstandig.`);
      grouped.set(systemPositionId, existing);
      return;
    }

    const resolvedComponentType = resolveComponentType(componentTypeRaw);
    if (!resolvedComponentType) {
      skippedRows += 1;
      warnings.push(`Rad ${rowNumber}: okand komponenttyp '${componentTypeRaw}'.`);
      grouped.set(systemPositionId, existing);
      return;
    }

    existing.components.push({
      componentType: resolvedComponentType,
      identifiedValue,
      notes: componentNotes || undefined,
      attributes: extractAttributes(row)
    });

    grouped.set(systemPositionId, existing);
  });

  return {
    totalRows: rows.length,
    skippedRows,
    aggregates: Array.from(grouped.values()),
    warnings
  };
}
