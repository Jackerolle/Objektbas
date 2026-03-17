'use client';

import { CameraCapture } from '@/components/CameraCapture';
import { ObjectList } from '@/components/ObjectList';
import { RealtimeFeed } from '@/components/RealtimeFeed';
import { SyncStatus } from '@/components/SyncStatus';
import { useRealtimeFeed } from '@/hooks/useRealtimeFeed';
import { useLocalObjects } from '@/lib/useLocalObjects';
import { ObservationPayload, Objekt } from '@/lib/types';
import { useMemo, useState } from 'react';

export default function HomePage() {
  const { objects, queueCapture, queueLength, sync, syncState } =
    useLocalObjects();
  const feed = useRealtimeFeed();
  const [selectedObject, setSelectedObject] = useState<Objekt | null>(null);
  const [note, setNote] = useState('');
  const [lastPhoto, setLastPhoto] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedTitle = useMemo(
    () => selectedObject?.name ?? 'Ingen vald',
    [selectedObject]
  );

  const handleCapture = async (imageDataUrl: string) => {
    setLastPhoto(imageDataUrl);
    setError(null);

    if (!selectedObject) {
      setError('Valj ett objekt innan du sparar bilden.');
      return;
    }

    const payload: ObservationPayload = {
      objectId: selectedObject.id,
      notes: note,
      imageDataUrl,
      timestamp: new Date().toISOString()
    };

    await queueCapture(payload);
    setNote('');
  };

  return (
    <main
      style={{
        padding: '1.25rem',
        maxWidth: '1200px',
        margin: '0 auto',
        display: 'flex',
        flexDirection: 'column',
        gap: '1.25rem'
      }}
    >
      <header>
        <p style={{ margin: 0, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.1em', fontSize: '0.75rem' }}>
          Objektbas
        </p>
        <h1 style={{ marginTop: '0.25rem', marginBottom: '0.25rem' }}>
          Visuell inventering
        </h1>
        <p style={{ margin: 0, color: '#cbd5f5' }}>
          Ta en bild, matcha mot objekt och dela med teamet direkt i webblasen.
        </p>
      </header>

      <SyncStatus state={syncState} queued={queueLength} onSync={sync} />

      <section
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: '1rem'
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <CameraCapture onCapture={handleCapture} />

          <section
            style={{
              borderRadius: '1rem',
              background: '#0b1120',
              padding: '1rem',
              border: '1px solid rgba(148, 163, 184, 0.2)',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.5rem'
            }}
          >
            <header>
              <p style={{ margin: 0, color: '#94a3b8', fontSize: '0.8rem' }}>
                Vald post
              </p>
              <strong>{selectedTitle}</strong>
            </header>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Anteckning (valfritt)"
              style={{
                minHeight: '80px',
                borderRadius: '0.75rem',
                border: '1px solid rgba(148,163,184,0.3)',
                background: '#020617',
                color: '#f8fafc',
                padding: '0.75rem',
                resize: 'vertical'
              }}
            />
            {lastPhoto && (
              <div>
                <p style={{ margin: '0 0 0.25rem', color: '#94a3b8', fontSize: '0.8rem' }}>
                  Senaste bild
                </p>
                <img
                  src={lastPhoto}
                  alt="Senaste tagna bilden"
                  style={{
                    width: '100%',
                    borderRadius: '0.75rem',
                    border: '1px solid rgba(148,163,184,0.3)'
                  }}
                />
              </div>
            )}
            {error && (
              <p style={{ color: '#fb7185', fontSize: '0.85rem', margin: 0 }}>
                {error}
              </p>
            )}
            <small style={{ color: '#94a3b8' }}>
              Fotot lagras lokalt tills anslutning finns. {queueLength} poster i kö.
            </small>
          </section>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div>
            <p style={{ margin: '0 0 0.25rem', color: '#94a3b8', fontSize: '0.8rem' }}>
              Objekt i narmast
            </p>
            <ObjectList
              objects={objects}
              selectedId={selectedObject?.id}
              onSelect={(obj) => setSelectedObject(obj)}
            />
          </div>

          <RealtimeFeed items={feed} />
        </div>
      </section>
    </main>
  );
}
