import { mockObjects } from './mockData';
import {
  AggregateRecord,
  CreateAggregateEventPayload,
  AggregateEvent,
  ComponentAnalysis,
  CreateAggregateComponentPayload,
  CreateAggregatePayload,
  FilterListSearchResult,
  ImportAggregatesResult,
  ImportFilterListResult,
  ImportPreviewResult,
  ObservationPayload,
  Objekt,
  SystemPositionAnalysis
} from './types';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL?.trim() ?? '';

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
    const response = await fetch(toApiUrl('/api/objects'), {
      cache: 'no-store'
    });

    if (!response.ok) {
      throw new Error('Misslyckades att hämta objekt');
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
    const response = await fetch(toApiUrl('/api/observations'), {
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
  const response = await fetch(
    toApiUrl(`/api/aggregates/${aggregateId}/components`),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }
  );

  if (!response.ok) {
    throw new Error(await parseError(response));
  }

  return (await response.json()) as AggregateRecord;
}

export async function updateAggregateComponent(
  aggregateId: string,
  componentId: string,
  payload: CreateAggregateComponentPayload
): Promise<AggregateRecord> {
  const response = await fetch(
    toApiUrl(`/api/aggregates/${aggregateId}/components/${componentId}`),
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }
  );

  if (!response.ok) {
    throw new Error(await parseError(response));
  }

  return (await response.json()) as AggregateRecord;
}

export async function deleteAggregateComponent(
  aggregateId: string,
  componentId: string
): Promise<AggregateRecord> {
  const response = await fetch(
    toApiUrl(`/api/aggregates/${aggregateId}/components/${componentId}`),
    {
      method: 'DELETE'
    }
  );

  if (!response.ok) {
    throw new Error(await parseError(response));
  }

  return (await response.json()) as AggregateRecord;
}

export async function updateAggregate(
  aggregateId: string,
  payload: CreateAggregatePayload
): Promise<AggregateRecord> {
  const response = await fetch(toApiUrl(`/api/aggregates/${aggregateId}`), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(await parseError(response));
  }

  return (await response.json()) as AggregateRecord;
}

export async function deleteAggregate(aggregateId: string): Promise<void> {
  const response = await fetch(toApiUrl(`/api/aggregates/${aggregateId}`), {
    method: 'DELETE'
  });

  if (!response.ok) {
    throw new Error(await parseError(response));
  }
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

export async function previewAggregatesFile(
  file: File
): Promise<ImportPreviewResult> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(toApiUrl('/api/import/aggregates?dryRun=true'), {
    method: 'POST',
    body: formData
  });

  if (!response.ok) {
    throw new Error(await parseError(response));
  }

  return (await response.json()) as ImportPreviewResult;
}

export async function importAggregatesFile(
  file: File
): Promise<ImportAggregatesResult> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(toApiUrl('/api/import/aggregates'), {
    method: 'POST',
    body: formData
  });

  if (!response.ok) {
    throw new Error(await parseError(response));
  }

  return (await response.json()) as ImportAggregatesResult;
}

export async function getAggregateEvents(
  aggregateId: string,
  limit = 100
): Promise<AggregateEvent[]> {
  const params = new URLSearchParams();
  params.set('limit', String(limit));

  const response = await fetch(
    toApiUrl(`/api/aggregates/${aggregateId}/events?${params.toString()}`),
    {
      cache: 'no-store'
    }
  );

  if (!response.ok) {
    throw new Error(await parseError(response));
  }

  return (await response.json()) as AggregateEvent[];
}

export async function createAggregateEvent(
  aggregateId: string,
  payload: CreateAggregateEventPayload
): Promise<AggregateEvent> {
  const response = await fetch(toApiUrl(`/api/aggregates/${aggregateId}/events`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(await parseError(response));
  }

  return (await response.json()) as AggregateEvent;
}

export async function searchFilterList(
  query: string,
  limit = 1000
): Promise<FilterListSearchResult> {
  const params = new URLSearchParams();
  if (query.trim()) {
    params.set('query', query.trim());
  }
  params.set('limit', String(limit));

  const response = await fetch(toApiUrl(`/api/filterlist?${params.toString()}`), {
    cache: 'no-store'
  });

  if (!response.ok) {
    throw new Error(await parseError(response));
  }

  return (await response.json()) as FilterListSearchResult;
}

export async function importFilterListFile(
  file: File
): Promise<ImportFilterListResult> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(toApiUrl('/api/filterlist/import'), {
    method: 'POST',
    body: formData
  });

  if (!response.ok) {
    throw new Error(await parseError(response));
  }

  return (await response.json()) as ImportFilterListResult;
}
