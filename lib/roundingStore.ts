'use client';

import { del, get, set } from 'idb-keyval';

export type RoundingStatus = 'ej_kontrollerad' | 'ok' | 'atgard';

export type RoundingCategoryKey =
  | 'filterskick'
  | 'drivpaket'
  | 'lagerljud'
  | 'ovrigt';

export type RoundingCategoryEntry = {
  status: RoundingStatus;
  note: string;
  photos: string[];
};

export type RoundingAggregate = {
  id: string;
  systemPositionId: string;
  createdAt: string;
  categories: Record<RoundingCategoryKey, RoundingCategoryEntry>;
};

export type RoundingDraft = {
  aggregates: RoundingAggregate[];
  activeAggregateId?: string;
  updatedAt: string;
};

const ROUNDING_DRAFT_KEY = 'objektbas-rounding-draft-v1';

export function createEmptyRoundingCategory(): RoundingCategoryEntry {
  return {
    status: 'ej_kontrollerad',
    note: '',
    photos: []
  };
}

export function createEmptyRoundingAggregate(systemPositionId: string): RoundingAggregate {
  const now = new Date().toISOString();
  return {
    id:
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    systemPositionId,
    createdAt: now,
    categories: {
      filterskick: createEmptyRoundingCategory(),
      drivpaket: createEmptyRoundingCategory(),
      lagerljud: createEmptyRoundingCategory(),
      ovrigt: createEmptyRoundingCategory()
    }
  };
}

export function createEmptyRoundingDraft(): RoundingDraft {
  return {
    aggregates: [],
    updatedAt: new Date().toISOString()
  };
}

export async function loadRoundingDraft(): Promise<RoundingDraft> {
  const saved = await get<RoundingDraft>(ROUNDING_DRAFT_KEY);
  if (!saved || typeof saved !== 'object' || !Array.isArray(saved.aggregates)) {
    return createEmptyRoundingDraft();
  }

  return {
    ...createEmptyRoundingDraft(),
    ...saved
  };
}

export async function saveRoundingDraft(draft: RoundingDraft): Promise<void> {
  await set(ROUNDING_DRAFT_KEY, {
    ...draft,
    updatedAt: new Date().toISOString()
  });
}

export async function clearRoundingDraft(): Promise<void> {
  await del(ROUNDING_DRAFT_KEY);
}
