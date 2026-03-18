'use client';

import { get, set } from 'idb-keyval';

const PHOTO_STORE_PREFIX = 'objektbas-aggregate-photos-v1';

function aggregatePhotoKey(aggregateId: string): string {
  return `${PHOTO_STORE_PREFIX}:${aggregateId}`;
}

export async function loadAggregateLocalPhotos(
  aggregateId: string
): Promise<Record<string, string>> {
  if (!aggregateId.trim()) {
    return {};
  }

  const saved = await get<Record<string, string>>(aggregatePhotoKey(aggregateId));
  if (!saved || typeof saved !== 'object') {
    return {};
  }

  return saved;
}

export async function saveAggregateLocalPhoto(
  aggregateId: string,
  taskId: string,
  imageDataUrl: string
): Promise<void> {
  if (!aggregateId.trim() || !taskId.trim() || !imageDataUrl.trim()) {
    return;
  }

  const current = await loadAggregateLocalPhotos(aggregateId);
  await set(aggregatePhotoKey(aggregateId), {
    ...current,
    [taskId]: imageDataUrl
  });
}
