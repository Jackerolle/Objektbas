import { mockObjects } from './mockData';
import { ObservationPayload, Objekt } from './types';

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:5298';

export async function fetchObjects(): Promise<Objekt[]> {
  try {
    const response = await fetch(`${API_BASE_URL}/objects`, {
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
    const response = await fetch(`${API_BASE_URL}/observations`, {
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
