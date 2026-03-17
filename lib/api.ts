import { mockObjects } from './mockData';
import {
  AggregateRecord,
  ComponentAnalysis,
  CreateAggregateComponentPayload,
  CreateAggregatePayload,
  ObservationPayload,
  Objekt,
  SystemPositionAnalysis
} from './types';

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL?.trim() ?? '';

function toApiUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  if (!API_BASE_URL) {
    return normalizedPath;
  }

  return `${API_BASE_URL.replace(/\/+$/, '')}${normalizedPath}`;
}

async function parseError(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text || `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}

export async function fetchObjects(): Promise<Objekt[]> {
  try {
    const response = await fetch(toApiUrl('/objects'), {
      cache: 'no-store'
    });

    if (!response.ok) {
      throw new Error('Misslyckades att hamta objekt');
    }

    return (await response.json()) as Objekt[];
  } catch (error) {
    console.warn('Faller tillbaka till mockad data', error);
    return mockObjects;
  }
}

export async function createObservation(
  payload: ObservationPayload
): Promise<void> {
  try {
    const response = await fetch(toApiUrl('/observations'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error('Misslyckades att spara observation');
    }
  } catch (error) {
    console.warn('Observation sparas lokalt tills nasta synk', error);
    throw error;
  }
}

export async function analyzeSystemPosition(
  imageDataUrl: string
): Promise<SystemPositionAnalysis> {
  const response = await fetch(toApiUrl('/api/ai/systemposition'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageDataUrl })
  });

  if (!response.ok) {
    throw new Error(await parseError(response));
  }

  return (await response.json()) as SystemPositionAnalysis;
}

export async function analyzeComponentImage(
  componentType: string,
  imageDataUrl: string
): Promise<ComponentAnalysis> {
  const response = await fetch(toApiUrl('/api/ai/component'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ componentType, imageDataUrl })
  });

  if (!response.ok) {
    throw new Error(await parseError(response));
  }

  return (await response.json()) as ComponentAnalysis;
}

export async function createAggregate(
  payload: CreateAggregatePayload
): Promise<AggregateRecord> {
  const response = await fetch(toApiUrl('/api/aggregates'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(await parseError(response));
  }

  return (await response.json()) as AggregateRecord;
}

export async function addAggregateComponent(
  aggregateId: string,
  payload: CreateAggregateComponentPayload
): Promise<AggregateRecord> {
  const response = await fetch(toApiUrl(`/api/aggregates/${aggregateId}/components`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(await parseError(response));
  }

  return (await response.json()) as AggregateRecord;
}

export async function searchAggregates(query: string): Promise<AggregateRecord[]> {
  const params = new URLSearchParams();
  if (query.trim()) {
    params.set('query', query.trim());
  }

  const response = await fetch(toApiUrl(`/api/aggregates?${params.toString()}`), {
    cache: 'no-store'
  });

  if (!response.ok) {
    throw new Error(await parseError(response));
  }

  return (await response.json()) as AggregateRecord[];
}
