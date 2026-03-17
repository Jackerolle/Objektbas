'use client';

import { CameraCapture } from '@/components/CameraCapture';
import {
  addAggregateComponent,
  analyzeComponentImage,
  analyzeSystemPosition,
  createAggregate,
  searchAggregates
} from '@/lib/api';
import {
  COMPONENT_FIELD_CONFIG,
  COMPONENT_OPTIONS,
  createEmptyAttributes
} from '@/lib/componentSchema';
import { AggregateRecord, AppMode, ComponentAnalysis, ComponentType, SystemPositionAnalysis } from '@/lib/types';
import { useState } from 'react';

function toPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export default function HomePage() {
  const [mode, setMode] = useState<AppMode>('lagg-till');

  const [systemPositionImage, setSystemPositionImage] = useState<string | null>(null);
  const [systemPositionId, setSystemPositionId] = useState('');
  const [position, setPosition] = useState('');
  const [department, setDepartment] = useState('');
  const [aggregateNotes, setAggregateNotes] = useState('');
  const [systemAnalysis, setSystemAnalysis] = useState<SystemPositionAnalysis | null>(null);

  const [currentAggregate, setCurrentAggregate] = useState<AggregateRecord | null>(null);
  const [componentType, setComponentType] = useState<ComponentType>('Motorbricka');
  const [componentImage, setComponentImage] = useState<string | null>(null);
  const [componentValue, setComponentValue] = useState('');
  const [componentAttributes, setComponentAttributes] = useState<Record<string, string>>(
    () => createEmptyAttributes('Motorbricka')
  );
  const [componentNotes, setComponentNotes] = useState('');
  const [componentAnalysis, setComponentAnalysis] = useState<ComponentAnalysis | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<AggregateRecord[]>([]);

  const [isAnalyzingSystem, setIsAnalyzingSystem] = useState(false);
  const [isCreatingAggregate, setIsCreatingAggregate] = useState(false);
  const [isAnalyzingComponent, setIsAnalyzingComponent] = useState(false);
  const [isSavingComponent, setIsSavingComponent] = useState(false);
  const [isSearching, setIsSearching] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('');

  const clearStatus = () => {
    setError(null);
    setStatus('');
  };

  const handleSystemCapture = async (imageDataUrl: string) => {
    clearStatus();
    setSystemPositionImage(imageDataUrl);
    setIsAnalyzingSystem(true);

    try {
      const analysis = await analyzeSystemPosition(imageDataUrl);
      setSystemAnalysis(analysis);
      setSystemPositionId(analysis.systemPositionId || '');
      setStatus('Systemposition analyserad. Bekrafta ID innan du sparar.');
    } catch (captureError) {
      setError(`Kunde inte analysera systemposition: ${String(captureError)}`);
    } finally {
      setIsAnalyzingSystem(false);
    }
  };

  const handleCreateAggregate = async () => {
    clearStatus();

    if (!systemPositionId.trim()) {
      setError('Systempositionens ID maste anges innan du kan spara aggregatet.');
      return;
    }

    setIsCreatingAggregate(true);

    try {
      const aggregate = await createAggregate({
        systemPositionId: systemPositionId.trim(),
        position: position.trim() || undefined,
        department: department.trim() || undefined,
        notes: aggregateNotes.trim() || undefined,
        systemPositionImageDataUrl: systemPositionImage || undefined
      });

      setCurrentAggregate(aggregate);
      setComponentValue('');
      setComponentNotes('');
      setComponentImage(null);
      setComponentAnalysis(null);
      setComponentAttributes(createEmptyAttributes(componentType));
      setStatus(`Aggregat ${aggregate.systemPositionId} skapades. Nu kan du lagga till komponenter.`);
    } catch (createError) {
      setError(`Kunde inte skapa aggregat: ${String(createError)}`);
    } finally {
      setIsCreatingAggregate(false);
    }
  };

  const handleComponentCapture = async (imageDataUrl: string) => {
    clearStatus();

    if (!currentAggregate) {
      setError('Skapa aggregatet forst innan du lagger till komponenter.');
      return;
    }

    setComponentImage(imageDataUrl);
    setIsAnalyzingComponent(true);

    try {
      const analysis = await analyzeComponentImage(componentType, imageDataUrl);
      setComponentAnalysis(analysis);
      setComponentValue(analysis.identifiedValue || '');
      setComponentAttributes((current) => ({
        ...createEmptyAttributes(componentType),
        ...current,
        ...analysis.suggestedAttributes
      }));
      setStatus('Komponent analyserad. Bekrafta eller justera faltet innan sparning.');
    } catch (analysisError) {
      setError(`Kunde inte analysera komponenten: ${String(analysisError)}`);
    } finally {
      setIsAnalyzingComponent(false);
    }
  };

  const handleSaveComponent = async () => {
    clearStatus();

    if (!currentAggregate) {
      setError('Inget aggregat ar valt.');
      return;
    }

    if (!componentValue.trim()) {
      setError('Komponentvarde maste fyllas i innan sparning.');
      return;
    }

    const missingAttributeLabels = COMPONENT_FIELD_CONFIG[componentType]
      .filter((field) => !componentAttributes[field.key]?.trim())
      .map((field) => field.label);

    if (missingAttributeLabels.length > 0) {
      setError(`Fyll i obligatoriska falt: ${missingAttributeLabels.join(', ')}.`);
      return;
    }

    setIsSavingComponent(true);

    try {
      const updated = await addAggregateComponent(currentAggregate.id, {
        componentType,
        identifiedValue: componentValue.trim(),
        notes: componentNotes.trim() || undefined,
        imageDataUrl: componentImage || undefined,
        attributes: componentAttributes
      });

      setCurrentAggregate(updated);
      setComponentImage(null);
      setComponentValue('');
      setComponentAttributes(createEmptyAttributes(componentType));
      setComponentNotes('');
      setComponentAnalysis(null);
      setStatus(`${componentType} sparad pa aggregatet.`);
    } catch (saveError) {
      setError(`Kunde inte spara komponent: ${String(saveError)}`);
    } finally {
      setIsSavingComponent(false);
    }
  };

  const handleSearch = async (queryOverride?: string) => {
    clearStatus();
    setIsSearching(true);

    try {
      const query = queryOverride ?? searchQuery;
      const results = await searchAggregates(query);
      setSearchResults(results);
      setStatus(`${results.length} resultat hittades.`);
    } catch (searchError) {
      setError(`Kunde inte hamta resultat: ${String(searchError)}`);
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <main
      style={{
        padding: '1.25rem',
        maxWidth: '1200px',
        margin: '0 auto',
        display: 'flex',
        flexDirection: 'column',
        gap: '1rem'
      }}
    >
      <header>
        <p
          style={{
            margin: 0,
            color: '#94a3b8',
            textTransform: 'uppercase',
            letterSpacing: '0.1em',
            fontSize: '0.75rem'
          }}
        >
          Objektbas
        </p>
        <h1 style={{ marginTop: '0.25rem', marginBottom: '0.35rem' }}>
          Ventilation - registrering och sok
        </h1>
        <p style={{ margin: 0, color: '#cbd5f5' }}>
          Fota systempositionen, bekrafta AI-forslag, lagg till komponentdata och sok tidigare poster.
        </p>
      </header>

      <section style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
        <button
          onClick={() => setMode('lagg-till')}
          style={{
            borderRadius: '999px',
            border: mode === 'lagg-till' ? '1px solid #60a5fa' : '1px solid rgba(148,163,184,0.3)',
            background: mode === 'lagg-till' ? 'rgba(37,99,235,0.25)' : 'transparent',
            color: '#f8fafc',
            padding: '0.55rem 1rem',
            cursor: 'pointer',
            fontWeight: 600
          }}
        >
          Lagg till
        </button>
        <button
          onClick={() => {
            setMode('sok');
            void handleSearch('');
          }}
          style={{
            borderRadius: '999px',
            border: mode === 'sok' ? '1px solid #60a5fa' : '1px solid rgba(148,163,184,0.3)',
            background: mode === 'sok' ? 'rgba(37,99,235,0.25)' : 'transparent',
            color: '#f8fafc',
            padding: '0.55rem 1rem',
            cursor: 'pointer',
            fontWeight: 600
          }}
        >
          Sok
        </button>
      </section>

      {error && (
        <p style={{ margin: 0, color: '#fb7185', fontWeight: 600 }}>
          {error}
        </p>
      )}
      {status && (
        <p style={{ margin: 0, color: '#93c5fd' }}>
          {status}
        </p>
      )}

      {mode === 'lagg-till' ? (
        <>
          <section
            style={{
              borderRadius: '1rem',
              border: '1px solid rgba(148,163,184,0.25)',
              background: '#0b1120',
              padding: '1rem',
              display: 'grid',
              gap: '1rem',
              gridTemplateColumns: 'repeat(auto-fit, minmax(290px, 1fr))'
            }}
          >
            <CameraCapture
              onCapture={handleSystemCapture}
              title='Fota systemposition'
              subtitle='Steg 1 av 2'
              captureLabel='Ta bild pa ID'
            />

            <section style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              <h2 style={{ margin: 0, fontSize: '1rem' }}>Bekrafta systemposition</h2>

              <label style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', fontSize: '0.9rem' }}>
                Systemposition (ID)
                <input
                  value={systemPositionId}
                  onChange={(event) => setSystemPositionId(event.target.value)}
                  placeholder='Exempel: VP-1024'
                  style={{
                    borderRadius: '0.7rem',
                    border: '1px solid rgba(148,163,184,0.4)',
                    padding: '0.65rem',
                    background: '#020617',
                    color: '#f8fafc'
                  }}
                />
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', fontSize: '0.9rem' }}>
                Position
                <input
                  value={position}
                  onChange={(event) => setPosition(event.target.value)}
                  placeholder='Exempel: Takplan 2'
                  style={{
                    borderRadius: '0.7rem',
                    border: '1px solid rgba(148,163,184,0.4)',
                    padding: '0.65rem',
                    background: '#020617',
                    color: '#f8fafc'
                  }}
                />
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', fontSize: '0.9rem' }}>
                Avdelning
                <input
                  value={department}
                  onChange={(event) => setDepartment(event.target.value)}
                  placeholder='Exempel: Produktion'
                  style={{
                    borderRadius: '0.7rem',
                    border: '1px solid rgba(148,163,184,0.4)',
                    padding: '0.65rem',
                    background: '#020617',
                    color: '#f8fafc'
                  }}
                />
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', fontSize: '0.9rem' }}>
                Kommentar
                <textarea
                  value={aggregateNotes}
                  onChange={(event) => setAggregateNotes(event.target.value)}
                  placeholder='Valfri notering'
                  style={{
                    minHeight: '80px',
                    borderRadius: '0.7rem',
                    border: '1px solid rgba(148,163,184,0.4)',
                    padding: '0.65rem',
                    background: '#020617',
                    color: '#f8fafc',
                    resize: 'vertical'
                  }}
                />
              </label>

              {systemAnalysis && (
                <div
                  style={{
                    borderRadius: '0.7rem',
                    border: '1px solid rgba(96,165,250,0.35)',
                    padding: '0.65rem',
                    background: 'rgba(30,64,175,0.15)',
                    fontSize: '0.9rem'
                  }}
                >
                  <p style={{ margin: '0 0 0.25rem' }}>
                    AI-forslag: <strong>{systemAnalysis.systemPositionId || 'Tomt'}</strong> ({toPercent(systemAnalysis.confidence)})
                  </p>
                  <p style={{ margin: 0, color: '#bfdbfe' }}>{systemAnalysis.notes}</p>
                </div>
              )}

              <button
                onClick={handleCreateAggregate}
                disabled={isAnalyzingSystem || isCreatingAggregate}
                style={{
                  marginTop: '0.25rem',
                  borderRadius: '0.75rem',
                  border: 'none',
                  padding: '0.8rem 1rem',
                  background: 'linear-gradient(120deg, #0ea5e9, #2563eb)',
                  color: '#f8fafc',
                  cursor: 'pointer',
                  fontWeight: 700,
                  opacity: isAnalyzingSystem || isCreatingAggregate ? 0.6 : 1
                }}
              >
                {isAnalyzingSystem
                  ? 'Analyserar bild...'
                  : isCreatingAggregate
                  ? 'Sparar aggregat...'
                  : 'Spara och starta aggregat'}
              </button>
            </section>
          </section>

          {currentAggregate && (
            <section
              style={{
                borderRadius: '1rem',
                border: '1px solid rgba(148,163,184,0.25)',
                background: '#0b1120',
                padding: '1rem',
                display: 'grid',
                gap: '1rem',
                gridTemplateColumns: 'repeat(auto-fit, minmax(290px, 1fr))'
              }}
            >
              <CameraCapture
                onCapture={handleComponentCapture}
                title={`Fota ${componentType.toLowerCase()}`}
                subtitle='Steg 2 av 2'
                captureLabel='Ta komponentbild'
              />

              <section style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                <h2 style={{ margin: 0, fontSize: '1rem' }}>
                  Lagg till komponent pa {currentAggregate.systemPositionId}
                </h2>

                <label style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', fontSize: '0.9rem' }}>
                  Komponenttyp
                  <select
                    value={componentType}
                    onChange={(event) => {
                      const next = event.target.value as ComponentType;
                      setComponentType(next);
                      setComponentValue('');
                      setComponentAttributes(createEmptyAttributes(next));
                      setComponentNotes('');
                      setComponentImage(null);
                      setComponentAnalysis(null);
                    }}
                    style={{
                      borderRadius: '0.7rem',
                      border: '1px solid rgba(148,163,184,0.4)',
                      padding: '0.65rem',
                      background: '#020617',
                      color: '#f8fafc'
                    }}
                  >
                    {COMPONENT_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>

                <label style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', fontSize: '0.9rem' }}>
                  Identifierat varde
                  <input
                    value={componentValue}
                    onChange={(event) => setComponentValue(event.target.value)}
                    placeholder='Ex: SPA 1180, C3-lager 6205, F7-595x595'
                    style={{
                      borderRadius: '0.7rem',
                      border: '1px solid rgba(148,163,184,0.4)',
                      padding: '0.65rem',
                      background: '#020617',
                      color: '#f8fafc'
                    }}
                  />
                </label>

                {COMPONENT_FIELD_CONFIG[componentType].map((field) => (
                  <label
                    key={field.key}
                    style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', fontSize: '0.9rem' }}
                  >
                    {field.label}
                    <input
                      value={componentAttributes[field.key] ?? ''}
                      onChange={(event) =>
                        setComponentAttributes((current) => ({
                          ...current,
                          [field.key]: event.target.value
                        }))
                      }
                      placeholder={field.placeholder}
                      style={{
                        borderRadius: '0.7rem',
                        border: '1px solid rgba(148,163,184,0.4)',
                        padding: '0.65rem',
                        background: '#020617',
                        color: '#f8fafc'
                      }}
                    />
                  </label>
                ))}

                <label style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', fontSize: '0.9rem' }}>
                  Notering
                  <textarea
                    value={componentNotes}
                    onChange={(event) => setComponentNotes(event.target.value)}
                    placeholder='Valfri notering om komponentens skick eller byte'
                    style={{
                      minHeight: '80px',
                      borderRadius: '0.7rem',
                      border: '1px solid rgba(148,163,184,0.4)',
                      padding: '0.65rem',
                      background: '#020617',
                      color: '#f8fafc',
                      resize: 'vertical'
                    }}
                  />
                </label>

                {componentAnalysis && (
                  <div
                    style={{
                      borderRadius: '0.7rem',
                      border: '1px solid rgba(45,212,191,0.35)',
                      padding: '0.65rem',
                      background: 'rgba(13,148,136,0.12)',
                      fontSize: '0.9rem'
                    }}
                  >
                    <p style={{ margin: '0 0 0.25rem' }}>
                      AI-forslag ({componentAnalysis.componentType}):{' '}
                      <strong>{componentAnalysis.identifiedValue}</strong> ({toPercent(componentAnalysis.confidence)})
                    </p>
                    <p style={{ margin: 0, color: '#99f6e4' }}>{componentAnalysis.notes}</p>
                  </div>
                )}

                <button
                  onClick={handleSaveComponent}
                  disabled={isAnalyzingComponent || isSavingComponent}
                  style={{
                    marginTop: '0.25rem',
                    borderRadius: '0.75rem',
                    border: 'none',
                    padding: '0.8rem 1rem',
                    background: 'linear-gradient(120deg, #14b8a6, #0ea5e9)',
                    color: '#f8fafc',
                    cursor: 'pointer',
                    fontWeight: 700,
                    opacity: isAnalyzingComponent || isSavingComponent ? 0.6 : 1
                  }}
                >
                  {isAnalyzingComponent
                    ? 'Analyserar komponentbild...'
                    : isSavingComponent
                    ? 'Sparar komponent...'
                    : 'Spara komponent'}
                </button>

                <section
                  style={{
                    marginTop: '0.5rem',
                    borderTop: '1px solid rgba(148,163,184,0.2)',
                    paddingTop: '0.75rem'
                  }}
                >
                  <p style={{ margin: '0 0 0.35rem', color: '#94a3b8', fontSize: '0.85rem' }}>
                    Sparade komponenter ({currentAggregate.components.length})
                  </p>

                  <ul
                    style={{
                      listStyle: 'none',
                      margin: 0,
                      padding: 0,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.4rem'
                    }}
                  >
                    {currentAggregate.components.map((component) => (
                      <li
                        key={component.id}
                        style={{
                          borderRadius: '0.65rem',
                          border: '1px solid rgba(148,163,184,0.2)',
                          padding: '0.55rem',
                          background: '#020617'
                        }}
                      >
                        <p style={{ margin: '0 0 0.2rem' }}>
                          <strong>{component.componentType}</strong>: {component.identifiedValue}
                        </p>
                        {Object.keys(component.attributes || {}).length > 0 && (
                          <p style={{ margin: '0 0 0.2rem', color: '#93c5fd', fontSize: '0.8rem' }}>
                            {Object.entries(component.attributes)
                              .map(([key, value]) => `${key}: ${value}`)
                              .join(' | ')}
                          </p>
                        )}
                        {component.notes && (
                          <p style={{ margin: 0, color: '#cbd5f5', fontSize: '0.85rem' }}>
                            {component.notes}
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              </section>
            </section>
          )}
        </>
      ) : (
        <section
          style={{
            borderRadius: '1rem',
            border: '1px solid rgba(148,163,184,0.25)',
            background: '#0b1120',
            padding: '1rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.75rem'
          }}
        >
          <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder='Sok pa systemposition, avdelning, position eller komponent'
              style={{
                flex: 1,
                minWidth: '220px',
                borderRadius: '0.7rem',
                border: '1px solid rgba(148,163,184,0.4)',
                padding: '0.7rem',
                background: '#020617',
                color: '#f8fafc'
              }}
            />
            <button
              onClick={() => void handleSearch()}
              disabled={isSearching}
              style={{
                borderRadius: '0.7rem',
                border: 'none',
                padding: '0.7rem 1rem',
                background: 'linear-gradient(120deg, #38bdf8, #6366f1)',
                color: '#f8fafc',
                cursor: 'pointer',
                fontWeight: 700,
                opacity: isSearching ? 0.6 : 1
              }}
            >
              {isSearching ? 'Soker...' : 'Sok'}
            </button>
          </div>

          <ul
            style={{
              listStyle: 'none',
              margin: 0,
              padding: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: '0.7rem'
            }}
          >
            {searchResults.map((aggregate) => (
              <li
                key={aggregate.id}
                style={{
                  borderRadius: '0.8rem',
                  border: '1px solid rgba(148,163,184,0.25)',
                  padding: '0.8rem',
                  background: '#020617'
                }}
              >
                <p style={{ margin: '0 0 0.25rem' }}>
                  <strong>{aggregate.systemPositionId}</strong>
                  {' - '}
                  {aggregate.position || 'Ingen position angiven'}
                </p>
                <p style={{ margin: '0 0 0.4rem', color: '#94a3b8', fontSize: '0.85rem' }}>
                  Avdelning: {aggregate.department || 'Ej satt'} | Komponenter: {aggregate.components.length} | Uppdaterad:{' '}
                  {new Date(aggregate.updatedAt).toLocaleString('sv-SE')}
                </p>

                {!!aggregate.components.length && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                    {aggregate.components.slice(0, 6).map((component) => (
                      <span
                        key={component.id}
                        style={{
                          fontSize: '0.75rem',
                          borderRadius: '999px',
                          padding: '0.2rem 0.55rem',
                          background: 'rgba(14,165,233,0.15)',
                          color: '#7dd3fc'
                        }}
                      >
                        {component.componentType}: {component.identifiedValue}
                        {Object.keys(component.attributes || {}).length > 0
                          ? ` (${Object.entries(component.attributes)
                              .slice(0, 1)
                              .map((entry) => entry[1])
                              .join(', ')})`
                          : ''}
                      </span>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>

          {!isSearching && searchResults.length === 0 && (
            <p style={{ margin: 0, color: '#94a3b8' }}>Inga sparade poster hittades.</p>
          )}
        </section>
      )}
    </main>
  );
}
