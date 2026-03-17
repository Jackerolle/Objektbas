'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { get, set } from 'idb-keyval';
import { createObservation, fetchObjects } from './api';
import { mockObjects } from './mockData';
import { ObservationPayload, Objekt, SyncState } from './types';

const OBJECT_CACHE_KEY = 'objekt-cache-v1';
const CAPTURE_QUEUE_KEY = 'objekt-capture-queue-v1';

type QueuedCapture = ObservationPayload & { id: string };

export function useLocalObjects() {
  const [objects, setObjects] = useState<Objekt[]>([]);
  const [syncState, setSyncState] = useState<SyncState>('idle');
  const [queueLength, setQueueLength] = useState(0);

  const loadCache = useCallback(async () => {
    const cached = await get<Objekt[]>(OBJECT_CACHE_KEY);
    if (cached?.length) {
      setObjects(cached);
    } else {
      setObjects(mockObjects);
    }
  }, []);

  const sync = useCallback(async () => {
    setSyncState('syncing');
    try {
      const fresh = await fetchObjects();
      setObjects(fresh);
      await set(OBJECT_CACHE_KEY, fresh);
      setSyncState('idle');
    } catch {
      setSyncState('offline');
    }
  }, []);

  const refreshQueueLength = useCallback(async () => {
    const queue = (await get<QueuedCapture[]>(CAPTURE_QUEUE_KEY)) ?? [];
    setQueueLength(queue.length);
  }, []);

  const queueCapture = useCallback(
    async (payload: ObservationPayload) => {
      const queue = (await get<QueuedCapture[]>(CAPTURE_QUEUE_KEY)) ?? [];
      const entry: QueuedCapture = { ...payload, id: crypto.randomUUID() };
      const nextQueue = [entry, ...queue];
      await set(CAPTURE_QUEUE_KEY, nextQueue);
      setQueueLength(nextQueue.length);
    },
    []
  );

  const flushQueue = useCallback(async () => {
    const queue = (await get<QueuedCapture[]>(CAPTURE_QUEUE_KEY)) ?? [];
    if (!queue.length) {
      return;
    }

    const remaining: QueuedCapture[] = [];
    for (const capture of queue.reverse()) {
      try {
        await createObservation(capture);
      } catch (error) {
        console.warn('Kan inte skicka capture just nu', error);
        remaining.push(capture);
      }
    }

    await set(CAPTURE_QUEUE_KEY, remaining);
    setQueueLength(remaining.length);
  }, []);

  useEffect(() => {
    loadCache();
    refreshQueueLength();
    sync();
  }, [loadCache, refreshQueueLength, sync]);

  useEffect(() => {
    const handleOnline = () => {
      flushQueue();
      sync();
    };

    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [flushQueue, sync]);

  return useMemo(
    () => ({
      objects,
      sync,
      syncState,
      queueLength,
      queueCapture
    }),
    [objects, sync, syncState, queueLength, queueCapture]
  );
}
