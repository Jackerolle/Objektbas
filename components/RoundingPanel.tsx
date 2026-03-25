'use client';

import { CameraCapture } from '@/components/CameraCapture';
import {
  analyzeSystemPosition,
  createRound,
  createRoundItem,
  deleteRound,
  createAggregate,
  listRounds,
  searchAggregates
} from '@/lib/api';
import {
  clearRoundingDraft,
  createEmptyRoundingAggregate,
  createEmptyRoundingDraft,
  loadRoundingDraft,
  RoundingAggregate,
  RoundingCategoryEntry,
  RoundingCategoryKey,
  RoundingDraft,
  RoundingStatus,
  saveRoundingDraft
} from '@/lib/roundingStore';
import { AggregateRecord, CreateRoundItemPayload, RoundRecord } from '@/lib/types';
import { useEffect, useMemo, useState } from 'react';

type PhotoTarget = {
  aggregateId: string;
  categoryKey: RoundingCategoryKey;
};

type CategoryDescriptor = {
  key: RoundingCategoryKey;
  label: string;
  description: string;
};

const ROUNDING_CATEGORIES: CategoryDescriptor[] = [
  {
    key: 'filterskick',
    label: 'Filterskick',
    description: 'Skick, smuts, skador och behov av byte.'
  },
  {
    key: 'drivpaket',
    label: 'Remskivor och kilrep',
    description: 'Slitage, justering, spårning och byte.'
  },
  {
    key: 'lagerljud',
    label: 'Lagerljud motor/fläkt',
    description: 'Onormala ljud, vibration eller varningstecken.'
  },
  {
    key: 'ovrigt',
    label: 'Övriga åtgärder',
    description: 'Fritext för allt annat som behöver åtgärdas.'
  }
];

function normalizeSystemPositionId(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/[^A-Z0-9-]/g, '')
    .replace(/^-+|-+$/g, '');
}

function isUsableSystemPositionId(value: string): boolean {
  const normalized = normalizeSystemPositionId(value);
  if (!normalized || normalized.length < 4 || normalized.length > 24) {
    return false;
  }

  if (!/[0-9]/.test(normalized)) {
    return false;
  }

  if (
    /^(MANUELL-KRAVS|UNKNOWN|OKAND|N\/A|NA)$/.test(normalized) ||
    /(OPENAI|QUOTA|RESOURCE|EXHAUSTED|ERROR|HTTP|RATE|API|GOOGLE|GEMINI)/.test(
      normalized
    )
  ) {
    return false;
  }

  return true;
}

function extractSystemPositionCandidate(value: string | undefined): string {
  if (!value) {
    return '';
  }

  const matches = value.match(/[A-Z0-9-]{4,24}/gi) ?? [];
  for (const match of matches) {
    const normalized = normalizeSystemPositionId(match);
    if (isUsableSystemPositionId(normalized)) {
      return normalized;
    }
  }

  return '';
}

function findAggregateBySystemPosition(
  candidates: AggregateRecord[],
  target: string
): AggregateRecord | null {
  const normalizedTarget = normalizeSystemPositionId(target);

  for (const aggregate of candidates) {
    const positions = [
      aggregate.systemPositionId,
      aggregate.flSystemPositionId ?? '',
      aggregate.seSystemPositionId ?? ''
    ].map((entry) => normalizeSystemPositionId(entry));

    if (positions.includes(normalizedTarget)) {
      return aggregate;
    }
  }

  return null;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function statusLabel(status: RoundingStatus): string {
  switch (status) {
    case 'ok':
      return 'OK';
    case 'atgard':
      return 'Åtgärd behövs';
    default:
      return 'Ej kontrollerad';
  }
}

function hasActionableContent(entry: RoundingCategoryEntry): boolean {
  return (
    entry.status === 'atgard' ||
    Boolean(entry.note.trim()) ||
    entry.photos.length > 0
  );
}

function buildSummaryDocumentHtml(draft: RoundingDraft): string {
  const generatedAt = new Date().toLocaleString('sv-SE');
  const metaLines = [
    draft.title.trim() ? `<p style="margin:0 0 6px;"><strong>Rubrik:</strong> ${escapeHtml(draft.title.trim())}</p>` : '',
    draft.department.trim()
      ? `<p style="margin:0 0 6px;"><strong>Avdelning:</strong> ${escapeHtml(draft.department.trim())}</p>`
      : '',
    draft.customerName.trim()
      ? `<p style="margin:0 0 6px;"><strong>Beställare:</strong> ${escapeHtml(draft.customerName.trim())}</p>`
      : '',
    draft.performedBy.trim()
      ? `<p style="margin:0 0 6px;"><strong>Utförd av:</strong> ${escapeHtml(draft.performedBy.trim())}</p>`
      : ''
  ]
    .filter(Boolean)
    .join('');
  const body = draft.aggregates
    .map((aggregate) => {
      const actionableCategories = ROUNDING_CATEGORIES.filter((category) =>
        hasActionableContent(aggregate.categories[category.key])
      );

      const categorySections =
        actionableCategories.length > 0
          ? actionableCategories
              .map((category) => {
                const entry = aggregate.categories[category.key];
                const notes = entry.note.trim();
                const images = entry.photos
                  .map(
                    (photo) =>
                      `<img src="${photo}" alt="${escapeHtml(
                        category.label
                      )}" style="width:320px;max-width:100%;border:1px solid #cbd5e1;border-radius:6px;margin:6px 10px 6px 0;" />`
                  )
                  .join('');

                return `
                  <h4 style="margin:12px 0 4px;">${escapeHtml(category.label)}</h4>
                  <p style="margin:0 0 6px;"><strong>Status:</strong> ${escapeHtml(
                    statusLabel(entry.status)
                  )}</p>
                  ${
                    notes
                      ? `<p style="margin:0 0 8px;"><strong>Notering/åtgärd:</strong> ${escapeHtml(
                          notes
                        )}</p>`
                      : ''
                  }
                  ${images ? `<div style="margin:4px 0 10px;">${images}</div>` : ''}
                `;
              })
              .join('')
          : '<p>Inga åtgärder noterade.</p>';

      return `
        <section style="margin:0 0 20px;padding:0 0 14px;border-bottom:1px solid #cbd5e1;">
          <h3 style="margin:0 0 8px;">Systemposition ${escapeHtml(
            aggregate.systemPositionId
          )}</h3>
          ${categorySections}
        </section>
      `;
    })
    .join('');

  return `
    <html>
      <head>
        <meta charset="utf-8" />
        <title>Ronderingssammanställning</title>
      </head>
      <body style="font-family:Calibri, Arial, sans-serif;color:#0f172a;line-height:1.4;">
        <h1 style="margin:0 0 8px;">Ronderingssammanställning</h1>
        <p style="margin:0 0 14px;">Genererad: ${escapeHtml(generatedAt)}</p>
        ${metaLines}
        ${body || '<p>Inga aggregat i ronderingen.</p>'}
      </body>
    </html>
  `;
}

function buildRoundItemPayloads(draft: RoundingDraft): CreateRoundItemPayload[] {
  return draft.aggregates.flatMap((aggregate) =>
    ROUNDING_CATEGORIES.flatMap((category) => {
      const entry = aggregate.categories[category.key];
      if (!hasActionableContent(entry)) {
        return [];
      }

      const note = entry.note.trim();
      const observation = note || `Status: ${statusLabel(entry.status)}.`;
      const recommendedAction =
        entry.status === 'atgard'
          ? `Följ upp ${category.label.toLowerCase()} och planera åtgärd.`
          : 'Ingen omedelbar åtgärd registrerad.';

      return [
        {
          systemPositionId: aggregate.systemPositionId,
          componentArea: category.label,
          title: category.label,
          observation,
          recommendedAction,
          severity: entry.status === 'atgard' ? 'atgard' : 'info',
          photos: entry.photos
        }
      ];
    })
  );
}

function downloadSummaryDocument(html: string): void {
  const filenameDate = new Date().toISOString().slice(0, 10);
  const blob = new Blob([`\ufeff${html}`], {
    type: 'application/msword'
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `Rondering_${filenameDate}.doc`;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function formatRoundStatus(status: RoundRecord['status']): string {
  return status === 'completed' ? 'Avslutad' : 'Pågående';
}

export function RoundingPanel() {
  const [draft, setDraft] = useState<RoundingDraft>(createEmptyRoundingDraft);
  const [isLoading, setIsLoading] = useState(true);
  const [savedRounds, setSavedRounds] = useState<RoundRecord[]>([]);
  const [isLoadingRounds, setIsLoadingRounds] = useState(true);
  const [deletingRoundId, setDeletingRoundId] = useState<string | null>(null);
  const [systemPositionInput, setSystemPositionInput] = useState('');
  const [feedback, setFeedback] = useState<string>('');
  const [isCapturingSystemPosition, setIsCapturingSystemPosition] = useState(true);
  const [isResolvingSystemPosition, setIsResolvingSystemPosition] = useState(false);
  const [photoTarget, setPhotoTarget] = useState<PhotoTarget | null>(null);
  const [isCompiling, setIsCompiling] = useState(false);

  const loadRoundHistory = async (options?: { silent?: boolean }) => {
    setIsLoadingRounds(true);

    try {
      const rounds = await listRounds();
      setSavedRounds(rounds);
    } catch (error) {
      if (!options?.silent) {
        setFeedback(`Kunde inte hämta ronderingshistorik: ${String(error)}`);
      }
    } finally {
      setIsLoadingRounds(false);
    }
  };

  useEffect(() => {
    let cancelled = false;

    void loadRoundingDraft()
      .then((loaded) => {
        if (cancelled) {
          return;
        }
        setDraft(loaded);
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    void loadRoundHistory({ silent: true });
  }, []);

  useEffect(() => {
    if (isLoading) {
      return;
    }

    void saveRoundingDraft(draft);
  }, [draft, isLoading]);

  const activeAggregate = useMemo(() => {
    if (!draft.activeAggregateId) {
      return draft.aggregates[0] ?? null;
    }

    return (
      draft.aggregates.find((aggregate) => aggregate.id === draft.activeAggregateId) ??
      draft.aggregates[0] ??
      null
    );
  }, [draft.activeAggregateId, draft.aggregates]);

  const roundItemPayloads = useMemo(() => buildRoundItemPayloads(draft), [draft]);

  const updateDraftMetadata = (
    patch: Partial<
      Pick<RoundingDraft, 'title' | 'department' | 'customerName' | 'performedBy'>
    >
  ) => {
    setDraft((current) => ({
      ...current,
      ...patch
    }));
  };

  const updateAggregate = (
    aggregateId: string,
    updater: (current: RoundingAggregate) => RoundingAggregate
  ) => {
    setDraft((current) => ({
      ...current,
      aggregates: current.aggregates.map((aggregate) =>
        aggregate.id === aggregateId ? updater(aggregate) : aggregate
      )
    }));
  };

  const activateDraftAggregate = (systemPositionId: string) => {
    const normalized = normalizeSystemPositionId(systemPositionId);
    setDraft((current) => {
      const existing = current.aggregates.find(
        (aggregate) => normalizeSystemPositionId(aggregate.systemPositionId) === normalized
      );

      if (existing) {
        return { ...current, activeAggregateId: existing.id };
      }

      const created = createEmptyRoundingAggregate(normalized);
      return {
        ...current,
        aggregates: [...current.aggregates, created],
        activeAggregateId: created.id
      };
    });
  };

  const registerSystemPosition = async (
    rawSystemPosition: string,
    source: 'foto' | 'manuell'
  ) => {
    const normalized = normalizeSystemPositionId(rawSystemPosition);
    if (!isUsableSystemPositionId(normalized)) {
      setFeedback(
        'Systempositionen är ogiltig. Ange ett ID med siffror (ex: 459AG222 eller 690772).'
      );
      return;
    }

    setFeedback('');
    setIsResolvingSystemPosition(true);

    try {
      const searchResult = await searchAggregates(normalized);
      const matched = findAggregateBySystemPosition(searchResult, normalized);

      if (matched) {
        const canonical = normalizeSystemPositionId(matched.systemPositionId) || normalized;
        activateDraftAggregate(canonical);
        setSystemPositionInput(canonical);
        setFeedback(
          `Systemposition ${normalized} hittades i biblioteket och kopplades till aggregat ${canonical}.`
        );
        return;
      }

      const created = await createAggregate({ systemPositionId: normalized });
      const canonical = normalizeSystemPositionId(created.systemPositionId) || normalized;
      activateDraftAggregate(canonical);
      setSystemPositionInput(canonical);
      setFeedback(
        `Nytt aggregat ${canonical} skapades i biblioteket via ${source === 'foto' ? 'fotot' : 'manuell registrering'}.`
      );
    } catch (error) {
      activateDraftAggregate(normalized);
      setSystemPositionInput(normalized);
      setFeedback(
        `Kunde inte verifiera biblioteket just nu (${String(error)}). ${normalized} lades till lokalt i ronderingen.`
      );
    } finally {
      setIsResolvingSystemPosition(false);
      setIsCapturingSystemPosition(false);
    }
  };

  const handleStartAggregate = () => {
    void registerSystemPosition(systemPositionInput, 'manuell');
  };

  const handleCaptureSystemPosition = async (imageDataUrl: string) => {
    setFeedback('Läser systemposition från foto...');
    setIsResolvingSystemPosition(true);

    try {
      const analysis = await analyzeSystemPosition(imageDataUrl);
      const direct = normalizeSystemPositionId(analysis.systemPositionId);
      const fromNotes = extractSystemPositionCandidate(analysis.notes);
      const candidate = isUsableSystemPositionId(direct)
        ? direct
        : isUsableSystemPositionId(fromNotes)
          ? fromNotes
          : '';

      if (!candidate) {
        setFeedback(
          'Kunde inte läsa systemposition från foto. Ange systemposition manuellt och fortsätt.'
        );
        return;
      }

      setSystemPositionInput(candidate);
      await registerSystemPosition(candidate, 'foto');
    } catch (error) {
      setFeedback(
        `Kunde inte analysera systempositionsfoto: ${String(error)}. Ange systemposition manuellt.`
      );
    } finally {
      setIsResolvingSystemPosition(false);
    }
  };

  const removeAggregate = (aggregateId: string) => {
    setDraft((current) => {
      const remaining = current.aggregates.filter((aggregate) => aggregate.id !== aggregateId);
      return {
        ...current,
        aggregates: remaining,
        activeAggregateId:
          current.activeAggregateId === aggregateId
            ? remaining[0]?.id
            : current.activeAggregateId
      };
    });
  };

  const updateCategory = (
    aggregateId: string,
    categoryKey: RoundingCategoryKey,
    patch: Partial<RoundingCategoryEntry>
  ) => {
    updateAggregate(aggregateId, (aggregate) => ({
      ...aggregate,
      categories: {
        ...aggregate.categories,
        [categoryKey]: {
          ...aggregate.categories[categoryKey],
          ...patch
        }
      }
    }));
  };

  const handleCapturePhoto = async (dataUrl: string) => {
    if (!photoTarget) {
      return;
    }

    updateAggregate(photoTarget.aggregateId, (aggregate) => ({
      ...aggregate,
      categories: {
        ...aggregate.categories,
        [photoTarget.categoryKey]: {
          ...aggregate.categories[photoTarget.categoryKey],
          photos: [
            ...aggregate.categories[photoTarget.categoryKey].photos,
            dataUrl
          ]
        }
      }
    }));

    setPhotoTarget(null);
    setFeedback('Bild sparad i ronderingen.');
  };

  const removePhoto = (
    aggregateId: string,
    categoryKey: RoundingCategoryKey,
    photoIndex: number
  ) => {
    updateAggregate(aggregateId, (aggregate) => ({
      ...aggregate,
      categories: {
        ...aggregate.categories,
        [categoryKey]: {
          ...aggregate.categories[categoryKey],
          photos: aggregate.categories[categoryKey].photos.filter(
            (_photo, index) => index !== photoIndex
          )
        }
      }
    }));
  };

  const handleCompileSummary = async () => {
    if (draft.aggregates.length === 0) {
      setFeedback('Lägg till minst ett aggregat i ronderingen först.');
      return;
    }

    setIsCompiling(true);
    setFeedback('');

    let createdRoundId = '';

    try {
      const html = buildSummaryDocumentHtml(draft);
      downloadSummaryDocument(html);

      let savedRound: RoundRecord;
      try {
        savedRound = await createRound({
          title: draft.title.trim() || undefined,
          department: draft.department.trim() || undefined,
          customerName: draft.customerName.trim() || undefined,
          performedBy: draft.performedBy.trim() || undefined,
          status: 'completed'
        });
        createdRoundId = savedRound.id;

        for (const payload of roundItemPayloads) {
          savedRound = await createRoundItem(savedRound.id, payload);
        }
      } catch (saveError) {
        if (createdRoundId) {
          try {
            await deleteRound(createdRoundId);
          } catch {
            // Ignore cleanup errors and report the original failure instead.
          }
        }

        throw saveError;
      }

      await clearRoundingDraft();
      setDraft(createEmptyRoundingDraft());
      setPhotoTarget(null);
      await loadRoundHistory({ silent: true });
      setFeedback(
        `Rondering sparad i historiken (${savedRound.items.length} punkt${savedRound.items.length === 1 ? '' : 'er'}) och Word-underlag nedladdat.`
      );
    } catch (error) {
      setFeedback(
        `Word-underlag laddades ned, men ronderingen kunde inte sparas i historiken: ${String(error)}`
      );
    } finally {
      setIsCompiling(false);
    }
  };

  const handleClearDraft = async () => {
    await clearRoundingDraft();
    setDraft(createEmptyRoundingDraft());
    setPhotoTarget(null);
    setFeedback('Ronderingsutkast rensat.');
  };

  const handleDeleteSavedRound = async (roundId: string) => {
    setDeletingRoundId(roundId);

    try {
      await deleteRound(roundId);
      await loadRoundHistory({ silent: true });
      setFeedback('Rondering borttagen från historiken.');
    } catch (error) {
      setFeedback(`Kunde inte ta bort rondering: ${String(error)}`);
    } finally {
      setDeletingRoundId(null);
    }
  };

  return (
    <section
      style={{
        border: '1px solid rgba(148, 163, 184, 0.28)',
        borderRadius: '1rem',
        background:
          'linear-gradient(170deg, rgba(21, 30, 39, 0.92), rgba(12, 18, 24, 0.94))',
        padding: '1rem'
      }}
    >
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '0.75rem',
          flexWrap: 'wrap'
        }}
      >
        <div>
          <h2 style={{ margin: 0 }}>Rondering</h2>
          <p style={{ margin: '0.25rem 0 0', color: '#9fb0bf' }}>
            Systemposition krävs först. Vid sammanställning sparas ronderingen i historik och
            Word-underlag laddas ned.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button
            onClick={() => void handleCompileSummary()}
            disabled={isCompiling || draft.aggregates.length === 0}
            style={{
              borderRadius: '0.7rem',
              border: 0,
              padding: '0.7rem 0.95rem',
              fontWeight: 700,
              background:
                'linear-gradient(120deg, rgba(251, 146, 60, 0.95), rgba(34, 211, 238, 0.95))',
              color: '#081019',
              cursor:
                isCompiling || draft.aggregates.length === 0 ? 'not-allowed' : 'pointer',
              opacity: isCompiling || draft.aggregates.length === 0 ? 0.6 : 1
            }}
          >
            {isCompiling ? 'Sparar...' : 'Spara och sammanställ'}
          </button>
          <button
            onClick={() => void handleClearDraft()}
            disabled={isCompiling}
            style={{
              borderRadius: '0.7rem',
              border: '1px solid rgba(248, 113, 113, 0.6)',
              padding: '0.7rem 0.95rem',
              fontWeight: 700,
              background: 'rgba(127, 29, 29, 0.35)',
              color: '#fee2e2',
              cursor: isCompiling ? 'not-allowed' : 'pointer',
              opacity: isCompiling ? 0.6 : 1
            }}
          >
            Rensa rondering
          </button>
        </div>
      </header>

      {!!feedback && (
        <p style={{ margin: '0.75rem 0 0', color: '#bae6fd' }}>{feedback}</p>
      )}

      <div
        style={{
          marginTop: '0.9rem',
          display: 'grid',
          gap: '0.6rem',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))'
        }}
      >
        <label
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '0.25rem'
          }}
        >
          Rubrik
          <input
            value={draft.title}
            onChange={(event) => updateDraftMetadata({ title: event.target.value })}
            placeholder='Valfri rubrik för ronderingen'
            style={{
              borderRadius: '0.7rem',
              border: '1px solid rgba(148, 163, 184, 0.36)',
              background: 'rgba(2, 6, 23, 0.85)',
              color: '#f8fafc',
              padding: '0.7rem'
            }}
          />
        </label>
        <label
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '0.25rem'
          }}
        >
          Avdelning
          <input
            value={draft.department}
            onChange={(event) => updateDraftMetadata({ department: event.target.value })}
            placeholder='Valfri avdelning'
            style={{
              borderRadius: '0.7rem',
              border: '1px solid rgba(148, 163, 184, 0.36)',
              background: 'rgba(2, 6, 23, 0.85)',
              color: '#f8fafc',
              padding: '0.7rem'
            }}
          />
        </label>
        <label
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '0.25rem'
          }}
        >
          Beställare
          <input
            value={draft.customerName}
            onChange={(event) => updateDraftMetadata({ customerName: event.target.value })}
            placeholder='Valfri beställare'
            style={{
              borderRadius: '0.7rem',
              border: '1px solid rgba(148, 163, 184, 0.36)',
              background: 'rgba(2, 6, 23, 0.85)',
              color: '#f8fafc',
              padding: '0.7rem'
            }}
          />
        </label>
        <label
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '0.25rem'
          }}
        >
          Utförd av
          <input
            value={draft.performedBy}
            onChange={(event) => updateDraftMetadata({ performedBy: event.target.value })}
            placeholder='Valfri tekniker'
            style={{
              borderRadius: '0.7rem',
              border: '1px solid rgba(148, 163, 184, 0.36)',
              background: 'rgba(2, 6, 23, 0.85)',
              color: '#f8fafc',
              padding: '0.7rem'
            }}
          />
        </label>
      </div>

      {isCapturingSystemPosition && !photoTarget && (
        <div style={{ marginTop: '0.9rem' }}>
          <CameraCapture
            onCapture={handleCaptureSystemPosition}
            title='Steg 1: Fotografera systemposition'
            subtitle='Systemposition måste läsas in innan rondering fortsätter.'
            helperText='Efter fotot kontrolleras om positionen redan finns i biblioteket eller om nytt aggregat ska skapas.'
          />
          <div style={{ marginTop: '0.55rem' }}>
            <button
              onClick={() => setIsCapturingSystemPosition(false)}
              disabled={isResolvingSystemPosition}
              style={{
                borderRadius: '0.65rem',
                border: '1px solid rgba(148, 163, 184, 0.38)',
                background: 'rgba(15, 23, 42, 0.7)',
                color: '#e2e8f0',
                padding: '0.55rem 0.8rem',
                cursor: isResolvingSystemPosition ? 'not-allowed' : 'pointer',
                opacity: isResolvingSystemPosition ? 0.6 : 1
              }}
            >
              Avbryt foto
            </button>
          </div>
        </div>
      )}

      <div
        style={{
          marginTop: '0.9rem',
          display: 'flex',
          flexWrap: 'wrap',
          gap: '0.6rem',
          alignItems: 'center'
        }}
      >
        <input
          value={systemPositionInput}
          onChange={(event) => setSystemPositionInput(event.target.value)}
          placeholder='Ange systemposition (ex: 459AG222 eller 690772)'
          style={{
            borderRadius: '0.7rem',
            border: '1px solid rgba(148, 163, 184, 0.36)',
            background: 'rgba(2, 6, 23, 0.85)',
            color: '#f8fafc',
            padding: '0.7rem',
            flex: '1 1 260px',
            minWidth: '220px'
          }}
        />
        <button
          onClick={() => setIsCapturingSystemPosition(true)}
          disabled={isLoading || isResolvingSystemPosition}
          style={{
            borderRadius: '0.7rem',
            border: '1px solid rgba(34, 211, 238, 0.5)',
            background: 'rgba(15, 23, 42, 0.75)',
            color: '#e2e8f0',
            padding: '0.7rem 0.95rem',
            fontWeight: 700,
            cursor:
              isLoading || isResolvingSystemPosition ? 'not-allowed' : 'pointer',
            opacity: isLoading || isResolvingSystemPosition ? 0.65 : 1
          }}
        >
          Ta bild systemposition
        </button>
        <button
          onClick={handleStartAggregate}
          disabled={isLoading || isResolvingSystemPosition}
          style={{
            borderRadius: '0.7rem',
            border: '1px solid rgba(34, 211, 238, 0.5)',
            background: 'rgba(15, 23, 42, 0.75)',
            color: '#e2e8f0',
            padding: '0.7rem 0.95rem',
            fontWeight: 700,
            cursor:
              isLoading || isResolvingSystemPosition ? 'not-allowed' : 'pointer',
            opacity: isLoading || isResolvingSystemPosition ? 0.65 : 1
          }}
        >
          Registrera systemposition
        </button>
      </div>

      <p style={{ margin: '0.5rem 0 0', color: '#cbd5e1', fontSize: '0.86rem' }}>
        {draft.aggregates.length} aggregat i utkastet, {roundItemPayloads.length} punkt
        {roundItemPayloads.length === 1 ? '' : 'er'} redo att sparas. Bilder sparas lokalt tills
        du klickar på <strong>Spara och sammanställ</strong>.
      </p>

      {!!draft.aggregates.length && (
        <div
          style={{
            marginTop: '0.8rem',
            display: 'flex',
            flexWrap: 'wrap',
            gap: '0.5rem'
          }}
        >
          {draft.aggregates.map((aggregate) => (
            <div
              key={aggregate.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.25rem',
                border: '1px solid rgba(148, 163, 184, 0.35)',
                borderRadius: '999px',
                padding: '0.2rem 0.25rem 0.2rem 0.55rem',
                background:
                  activeAggregate?.id === aggregate.id
                    ? 'rgba(59, 130, 246, 0.26)'
                    : 'rgba(15, 23, 42, 0.58)'
              }}
            >
              <button
                onClick={() =>
                  setDraft((current) => ({ ...current, activeAggregateId: aggregate.id }))
                }
                style={{
                  border: 0,
                  background: 'transparent',
                  color: '#e2e8f0',
                  cursor: 'pointer',
                  fontWeight: 700
                }}
              >
                {aggregate.systemPositionId}
              </button>
              <button
                onClick={() => removeAggregate(aggregate.id)}
                style={{
                  borderRadius: '999px',
                  border: '1px solid rgba(248, 113, 113, 0.6)',
                  background: 'rgba(127, 29, 29, 0.45)',
                  color: '#fee2e2',
                  width: '1.7rem',
                  height: '1.7rem',
                  cursor: 'pointer'
                }}
                aria-label={`Ta bort ${aggregate.systemPositionId}`}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {!!activeAggregate && (
        <div style={{ marginTop: '1rem', display: 'grid', gap: '0.75rem' }}>
          {ROUNDING_CATEGORIES.map((category) => {
            const entry = activeAggregate.categories[category.key];
            return (
              <article
                key={`${activeAggregate.id}-${category.key}`}
                style={{
                  border: '1px solid rgba(148, 163, 184, 0.3)',
                  borderRadius: '0.85rem',
                  padding: '0.75rem',
                  background: 'rgba(2, 6, 23, 0.62)'
                }}
              >
                <h3 style={{ margin: 0, fontSize: '0.95rem' }}>{category.label}</h3>
                <p style={{ margin: '0.2rem 0 0.65rem', color: '#9fb0bf', fontSize: '0.84rem' }}>
                  {category.description}
                </p>

                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '0.6rem',
                    alignItems: 'start'
                  }}
                >
                  <label
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.25rem',
                      flex: '1 1 200px',
                      minWidth: '170px'
                    }}
                  >
                    Status
                    <select
                      value={entry.status}
                      onChange={(event) =>
                        updateCategory(activeAggregate.id, category.key, {
                          status: event.target.value as RoundingStatus
                        })
                      }
                      style={{
                        borderRadius: '0.65rem',
                        border: '1px solid rgba(148, 163, 184, 0.36)',
                        background: 'rgba(2, 6, 23, 0.85)',
                        color: '#f8fafc',
                        padding: '0.6rem'
                      }}
                    >
                      <option value='ej_kontrollerad'>Ej kontrollerad</option>
                      <option value='ok'>OK</option>
                      <option value='atgard'>Åtgärd behövs</option>
                    </select>
                  </label>

                  <label
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.25rem',
                      flex: '2 1 320px',
                      minWidth: '240px'
                    }}
                  >
                    Notering / åtgärd
                    <textarea
                      value={entry.note}
                      onChange={(event) =>
                        updateCategory(activeAggregate.id, category.key, {
                          note: event.target.value
                        })
                      }
                      placeholder='Beskriv vad som behöver göras (valfritt)'
                      style={{
                        borderRadius: '0.65rem',
                        border: '1px solid rgba(148, 163, 184, 0.36)',
                        background: 'rgba(2, 6, 23, 0.85)',
                        color: '#f8fafc',
                        padding: '0.6rem',
                        minHeight: '84px',
                        resize: 'vertical'
                      }}
                    />
                  </label>
                </div>

                <div style={{ marginTop: '0.6rem', display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <button
                    onClick={() =>
                      setPhotoTarget({
                        aggregateId: activeAggregate.id,
                        categoryKey: category.key
                      })
                    }
                    style={{
                      borderRadius: '0.65rem',
                      border: '1px solid rgba(34, 211, 238, 0.5)',
                      background: 'rgba(2, 132, 199, 0.2)',
                      color: '#e0f2fe',
                      padding: '0.5rem 0.7rem',
                      cursor: 'pointer'
                    }}
                  >
                    Lägg till foto
                  </button>
                </div>

                {!!entry.photos.length && (
                  <div style={{ marginTop: '0.6rem', display: 'flex', flexWrap: 'wrap', gap: '0.55rem' }}>
                    {entry.photos.map((photo, index) => (
                      <div key={`${category.key}-${index}`} style={{ position: 'relative' }}>
                        <img
                          src={photo}
                          alt={`${category.label} ${index + 1}`}
                          style={{
                            width: '120px',
                            height: '90px',
                            objectFit: 'cover',
                            borderRadius: '0.5rem',
                            border: '1px solid rgba(148, 163, 184, 0.35)'
                          }}
                        />
                        <button
                          onClick={() =>
                            removePhoto(activeAggregate.id, category.key, index)
                          }
                          style={{
                            position: 'absolute',
                            top: '-8px',
                            right: '-8px',
                            borderRadius: '999px',
                            border: '1px solid rgba(248, 113, 113, 0.75)',
                            background: 'rgba(127, 29, 29, 0.92)',
                            color: '#fff',
                            width: '1.45rem',
                            height: '1.45rem',
                            cursor: 'pointer',
                            fontWeight: 700
                          }}
                          aria-label='Ta bort foto'
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      {photoTarget && (
        <div style={{ marginTop: '1rem' }}>
          <CameraCapture
            onCapture={handleCapturePhoto}
            title='Lägg till åtgärdsbild'
            subtitle={`Systemposition ${activeAggregate?.systemPositionId ?? ''}`}
            helperText='Bild är valfri. När bilden är sparad stängs kameran automatiskt.'
          />
          <div style={{ marginTop: '0.55rem' }}>
            <button
              onClick={() => setPhotoTarget(null)}
              style={{
                borderRadius: '0.65rem',
                border: '1px solid rgba(148, 163, 184, 0.38)',
                background: 'rgba(15, 23, 42, 0.7)',
                color: '#e2e8f0',
                padding: '0.55rem 0.8rem',
                cursor: 'pointer'
              }}
            >
              Avbryt foto
            </button>
          </div>
        </div>
      )}

      <section
        style={{
          marginTop: '1.2rem',
          borderTop: '1px solid rgba(148, 163, 184, 0.2)',
          paddingTop: '1rem'
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '0.75rem',
            flexWrap: 'wrap'
          }}
        >
          <div>
            <h3 style={{ margin: 0, fontSize: '1rem' }}>Ronderingshistorik</h3>
            <p style={{ margin: '0.25rem 0 0', color: '#9fb0bf', fontSize: '0.86rem' }}>
              Senast sparade ronderingar från databasen.
            </p>
          </div>
          <button
            onClick={() => void loadRoundHistory()}
            disabled={isLoadingRounds}
            style={{
              borderRadius: '0.65rem',
              border: '1px solid rgba(148, 163, 184, 0.38)',
              background: 'rgba(15, 23, 42, 0.7)',
              color: '#e2e8f0',
              padding: '0.55rem 0.8rem',
              cursor: isLoadingRounds ? 'not-allowed' : 'pointer',
              opacity: isLoadingRounds ? 0.6 : 1
            }}
          >
            {isLoadingRounds ? 'Laddar...' : 'Ladda om historik'}
          </button>
        </div>

        {!isLoadingRounds && savedRounds.length === 0 && (
          <p style={{ margin: '0.8rem 0 0', color: '#cbd5e1' }}>
            Ingen sparad rondering hittades ännu.
          </p>
        )}

        <div style={{ marginTop: '0.8rem', display: 'grid', gap: '0.75rem' }}>
          {savedRounds.map((round) => (
            <article
              key={round.id}
              style={{
                border: '1px solid rgba(148, 163, 184, 0.26)',
                borderRadius: '0.85rem',
                padding: '0.85rem',
                background: 'rgba(2, 6, 23, 0.52)'
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'start',
                  gap: '0.75rem',
                  flexWrap: 'wrap'
                }}
              >
                <div>
                  <strong>{round.title}</strong>
                  <div style={{ marginTop: '0.25rem', color: '#9fb0bf', fontSize: '0.84rem' }}>
                    {formatRoundStatus(round.status)} • {round.items.length} punkt
                    {round.items.length === 1 ? '' : 'er'} • Uppdaterad{' '}
                    {new Date(round.updatedAt).toLocaleString('sv-SE')}
                  </div>
                  {(round.department || round.performedBy || round.customerName) && (
                    <div
                      style={{
                        marginTop: '0.35rem',
                        color: '#cbd5e1',
                        fontSize: '0.84rem'
                      }}
                    >
                      {[
                        round.department ? `Avdelning: ${round.department}` : '',
                        round.customerName ? `Beställare: ${round.customerName}` : '',
                        round.performedBy ? `Utförd av: ${round.performedBy}` : ''
                      ]
                        .filter(Boolean)
                        .join(' • ')}
                    </div>
                  )}
                </div>

                <button
                  onClick={() => void handleDeleteSavedRound(round.id)}
                  disabled={deletingRoundId === round.id}
                  style={{
                    borderRadius: '0.65rem',
                    border: '1px solid rgba(248, 113, 113, 0.6)',
                    background: 'rgba(127, 29, 29, 0.35)',
                    color: '#fee2e2',
                    padding: '0.5rem 0.7rem',
                    cursor: deletingRoundId === round.id ? 'not-allowed' : 'pointer',
                    opacity: deletingRoundId === round.id ? 0.6 : 1
                  }}
                >
                  {deletingRoundId === round.id ? 'Tar bort...' : 'Ta bort'}
                </button>
              </div>

              <pre
                style={{
                  margin: '0.8rem 0 0',
                  whiteSpace: 'pre-wrap',
                  fontFamily: 'inherit',
                  color: '#e2e8f0',
                  background: 'rgba(15, 23, 42, 0.45)',
                  borderRadius: '0.75rem',
                  padding: '0.75rem'
                }}
              >
                {round.summaryText || 'Ingen sammanfattning sparad.'}
              </pre>
            </article>
          ))}
        </div>
      </section>
    </section>
  );
}
