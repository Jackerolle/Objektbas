'use client';

import { CameraCapture } from '@/components/CameraCapture';
import {
  addAggregateComponent,
  analyzeComponentImage,
  analyzeSystemPosition,
  createAggregate,
  searchAggregates,
  updateAggregate
} from '@/lib/api';
import {
  COMPONENT_FIELD_CONFIG,
  COMPONENT_OPTIONS,
  createEmptyAttributes
} from '@/lib/componentSchema';
import { AggregateRecord, AppMode, ComponentType } from '@/lib/types';
import { useMemo, useState } from 'react';
import styles from './page.module.css';

type CaptureTask = {
  id: string;
  label: string;
  description: string;
  componentType?: ComponentType;
  required?: boolean;
};

type SortOrder = 'nyast' | 'aldst';

const DEPARTMENT_PRESETS = [
  'Produktion',
  'Underhåll',
  'Energi',
  'Logistik',
  'Verkstad',
  'Kvalitet'
];

const CAPTURE_TASKS: CaptureTask[] = [
  {
    id: 'skylt',
    label: 'Objektskylt',
    description: 'Steg 1: läs system-ID och skapa aggregat.',
    required: true
  },
  {
    id: 'kilrem',
    label: 'Kilrem',
    description: 'Profil, längd och antal remmar.',
    componentType: 'Kilrem'
  },
  {
    id: 'filter',
    label: 'Filter',
    description: 'Filterklass och dimension.',
    componentType: 'Filter'
  },
  {
    id: 'remskiva',
    label: 'Remskiva',
    description: 'Driv- och medremskiva med spår.',
    componentType: 'Remskiva'
  },
  {
    id: 'lager',
    label: 'Lager',
    description: 'Lagertyp, placering och antal.',
    componentType: 'Lager'
  },
  {
    id: 'motor',
    label: 'Motor',
    description: 'Motormodell, effekt och märkström.',
    componentType: 'Motor'
  },
  {
    id: 'flakt',
    label: 'Fläkt',
    description: 'Fläkttyp, diameter och rotationsriktning.',
    componentType: 'Fläkt'
  }
];

const REQUIRED_TASK_IDS = CAPTURE_TASKS.filter((task) => task.required).map(
  (task) => task.id
);

function toPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function findTask(taskId: string): CaptureTask {
  return CAPTURE_TASKS.find((task) => task.id === taskId) ?? CAPTURE_TASKS[0];
}

function getNextTaskId(currentTaskId: string, captured: Record<string, string>): string {
  const currentIndex = CAPTURE_TASKS.findIndex((task) => task.id === currentTaskId);
  const startIndex = currentIndex >= 0 ? currentIndex + 1 : 0;

  for (let i = startIndex; i < CAPTURE_TASKS.length; i += 1) {
    const task = CAPTURE_TASKS[i];
    if (!captured[task.id]) {
      return task.id;
    }
  }

  return currentTaskId;
}

function normalizeAutoAttributes(
  componentType: ComponentType,
  suggested: Record<string, string> | undefined
): Record<string, string> {
  const template = createEmptyAttributes(componentType);

  for (const field of COMPONENT_FIELD_CONFIG[componentType]) {
    const value = suggested?.[field.key]?.trim();
    template[field.key] = value || 'Ej avläst';
  }

  return template;
}

export default function HomePage() {
  const [mode, setMode] = useState<AppMode>('lagg-till');

  const [selectedTaskId, setSelectedTaskId] = useState<string>('skylt');
  const [capturedPhotos, setCapturedPhotos] = useState<Record<string, string>>({});

  const [systemPositionId, setSystemPositionId] = useState('');
  const [department, setDepartment] = useState('');
  const [position, setPosition] = useState('');
  const [aggregateNotes, setAggregateNotes] = useState('');

  const [currentAggregate, setCurrentAggregate] = useState<AggregateRecord | null>(null);
  const [isSavingAggregate, setIsSavingAggregate] = useState(false);

  const [manualComponentType, setManualComponentType] = useState<ComponentType>('Kilrem');
  const [manualValue, setManualValue] = useState('');
  const [manualAttributes, setManualAttributes] = useState<Record<string, string>>(
    () => createEmptyAttributes('Kilrem')
  );
  const [manualNotes, setManualNotes] = useState('');
  const [isSavingManual, setIsSavingManual] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<AggregateRecord[]>([]);
  const [departmentFilter, setDepartmentFilter] = useState('alla');
  const [sortOrder, setSortOrder] = useState<SortOrder>('nyast');

  const [isProcessingCapture, setIsProcessingCapture] = useState(false);
  const [isSearching, setIsSearching] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('');

  const selectedTask = findTask(selectedTaskId);
  const aggregateReady = Boolean(currentAggregate);

  const requiredDone = REQUIRED_TASK_IDS.filter((id) => Boolean(capturedPhotos[id])).length;
  const completionRate = Math.round((requiredDone / REQUIRED_TASK_IDS.length) * 100);

  const taskStatuses = useMemo(() => {
    return CAPTURE_TASKS.map((task) => {
      const captured = Boolean(capturedPhotos[task.id]);
      const saved =
        !!task.componentType &&
        !!currentAggregate?.components.some(
          (component) => component.componentType === task.componentType
        );
      const locked = !aggregateReady && task.id !== 'skylt';

      return { ...task, captured, saved, locked };
    });
  }, [capturedPhotos, currentAggregate, aggregateReady]);

  const departmentOptions = useMemo(() => {
    const values = searchResults
      .map((record) => record.department?.trim())
      .filter((value): value is string => Boolean(value));

    return ['alla', ...Array.from(new Set(values)).sort((a, b) => a.localeCompare(b, 'sv-SE'))];
  }, [searchResults]);

  const filteredSearchResults = useMemo(() => {
    const scoped =
      departmentFilter === 'alla'
        ? searchResults
        : searchResults.filter((item) => (item.department ?? '') === departmentFilter);

    return [...scoped].sort((a, b) => {
      const aTime = new Date(a.updatedAt).getTime();
      const bTime = new Date(b.updatedAt).getTime();
      return sortOrder === 'nyast' ? bTime - aTime : aTime - bTime;
    });
  }, [departmentFilter, searchResults, sortOrder]);

  const clearFeedback = () => {
    setError(null);
    setStatus('');
  };

  const buildAggregatePayload = (systemId: string, imageDataUrl?: string) => ({
    systemPositionId: systemId.trim(),
    position: position.trim() || undefined,
    department: department.trim() || undefined,
    notes: aggregateNotes.trim() || undefined,
    systemPositionImageDataUrl: imageDataUrl
  });

  const handleTaskSelection = (taskId: string) => {
    const task = findTask(taskId);
    if (!aggregateReady && task.id !== 'skylt') {
      setError('Steg 1 är alltid objektskylt. Skapa aggregatet först.');
      return;
    }

    setSelectedTaskId(taskId);
  };

  const ensureAggregate = async (
    objectPhotoDataUrl: string,
    forcedSystemPositionId?: string
  ): Promise<AggregateRecord> => {
    if (currentAggregate) {
      return currentAggregate;
    }

    const candidateId = forcedSystemPositionId?.trim() || systemPositionId.trim();
    if (!candidateId) {
      throw new Error('Systemposition saknas. Ange ID manuellt och fotografera objektskylt igen.');
    }

    const created = await createAggregate(
      buildAggregatePayload(candidateId, objectPhotoDataUrl)
    );

    setCurrentAggregate(created);
    setSystemPositionId(created.systemPositionId);
    return created;
  };

  const handleSearch = async (queryOverride?: string) => {
    clearFeedback();
    setIsSearching(true);

    try {
      const query = queryOverride ?? searchQuery;
      const results = await searchAggregates(query);
      setSearchResults(results);
      setStatus(`${results.length} träffar i biblioteket.`);
    } catch (searchError) {
      setError(`Kunde inte hämta biblioteket: ${String(searchError)}`);
    } finally {
      setIsSearching(false);
    }
  };

  const handleCapture = async (imageDataUrl: string) => {
    clearFeedback();
    setIsProcessingCapture(true);

    const task = selectedTask;

    try {
      if (task.id === 'skylt') {
        const analysis = await analyzeSystemPosition(imageDataUrl);
        const aiId = analysis.systemPositionId?.trim();
        const resolvedId = aiId && aiId !== 'MANUELL-KRAVS' ? aiId : systemPositionId.trim();

        if (!resolvedId) {
          throw new Error(
            'Kunde inte läsa ID från skylten. Ange Systemposition manuellt och ladda upp/fota skylten igen.'
          );
        }

        setSystemPositionId(resolvedId);

        const aggregate = currentAggregate
          ? await updateAggregate(
              currentAggregate.id,
              buildAggregatePayload(resolvedId, imageDataUrl)
            )
          : await ensureAggregate(imageDataUrl, resolvedId);

        setCurrentAggregate(aggregate);
        const nextCaptured = { ...capturedPhotos, skylt: imageDataUrl };
        setCapturedPhotos(nextCaptured);
        setSelectedTaskId(getNextTaskId('skylt', nextCaptured));

        setStatus(
          `Objektskylt tolkad (${toPercent(
            analysis.confidence
          )}) och aggregat sparat. Fortsätt med komponentfoton.`
        );
        return;
      }

      if (!aggregateReady || !currentAggregate) {
        throw new Error('Objektskylt måste registreras först för att skapa aggregat.');
      }

      if (!task.componentType) {
        throw new Error('Felaktig fotopunkt.');
      }

      let identifiedValue = `Ej avläst (${task.label})`;
      let attributes = createEmptyAttributes(task.componentType);
      let note = 'Automatiskt registrerad utan säker AI-tolkning.';

      try {
        const analysis = await analyzeComponentImage(task.componentType, imageDataUrl);
        identifiedValue = analysis.identifiedValue?.trim() || identifiedValue;
        attributes = normalizeAutoAttributes(task.componentType, analysis.suggestedAttributes);
        note = `Automatiskt registrerad (${toPercent(analysis.confidence)}): ${analysis.notes}`;
      } catch {
        attributes = normalizeAutoAttributes(task.componentType, undefined);
      }

      const updated = await addAggregateComponent(currentAggregate.id, {
        componentType: task.componentType,
        identifiedValue,
        imageDataUrl,
        notes: note,
        attributes
      });

      const nextCaptured = { ...capturedPhotos, [task.id]: imageDataUrl };
      setCapturedPhotos(nextCaptured);
      setCurrentAggregate(updated);
      setSelectedTaskId(getNextTaskId(task.id, nextCaptured));
      setStatus(`${task.label} sparad i aggregatet.`);
    } catch (captureError) {
      setError(`Kunde inte slutföra ${task.label.toLowerCase()}: ${String(captureError)}`);
    } finally {
      setIsProcessingCapture(false);
    }
  };

  const handleSaveAggregateChanges = async () => {
    clearFeedback();

    if (!currentAggregate) {
      setError('Ingen aktiv aggregatpost att uppdatera.');
      return;
    }

    if (!systemPositionId.trim()) {
      setError('Systemposition krävs.');
      return;
    }

    setIsSavingAggregate(true);

    try {
      const updated = await updateAggregate(
        currentAggregate.id,
        buildAggregatePayload(
          systemPositionId,
          currentAggregate.systemPositionImageDataUrl
        )
      );

      setCurrentAggregate(updated);
      setStatus('Aggregat uppdaterat.');
    } catch (saveError) {
      setError(`Kunde inte uppdatera aggregat: ${String(saveError)}`);
    } finally {
      setIsSavingAggregate(false);
    }
  };

  const handleOpenAggregateForEditing = (aggregate: AggregateRecord) => {
    setCurrentAggregate(aggregate);
    setSystemPositionId(aggregate.systemPositionId);
    setDepartment(aggregate.department ?? '');
    setPosition(aggregate.position ?? '');
    setAggregateNotes(aggregate.notes ?? '');
    setCapturedPhotos((current) => ({
      ...current,
      ...(aggregate.systemPositionImageDataUrl
        ? { skylt: aggregate.systemPositionImageDataUrl }
        : {})
    }));
    setSelectedTaskId('kilrem');
    setMode('lagg-till');
    setStatus(`Öppnade aggregat ${aggregate.systemPositionId} för redigering.`);
  };

  const handleManualTypeChange = (nextType: ComponentType) => {
    setManualComponentType(nextType);
    setManualValue('');
    setManualAttributes(createEmptyAttributes(nextType));
    setManualNotes('');
  };

  const handleManualSave = async () => {
    clearFeedback();

    if (!aggregateReady || !currentAggregate) {
      setError('Skapa aggregatet via objektskylt först innan manuell registrering.');
      return;
    }

    if (!manualValue.trim()) {
      setError('Identifierat värde krävs för manuell registrering.');
      return;
    }

    const missing = COMPONENT_FIELD_CONFIG[manualComponentType]
      .filter((field) => !manualAttributes[field.key]?.trim())
      .map((field) => field.label);

    if (missing.length > 0) {
      setError(`Fyll i obligatoriska fält: ${missing.join(', ')}.`);
      return;
    }

    setIsSavingManual(true);

    try {
      const updated = await addAggregateComponent(currentAggregate.id, {
        componentType: manualComponentType,
        identifiedValue: manualValue.trim(),
        attributes: manualAttributes,
        notes: manualNotes.trim() || 'Manuellt registrerad post.'
      });

      setCurrentAggregate(updated);
      setManualValue('');
      setManualAttributes(createEmptyAttributes(manualComponentType));
      setManualNotes('');
      setStatus(`${manualComponentType} sparad manuellt i biblioteket.`);
    } catch (manualError) {
      setError(`Kunde inte spara manuell post: ${String(manualError)}`);
    } finally {
      setIsSavingManual(false);
    }
  };

  const selectedPhoto = capturedPhotos[selectedTask.id] ?? null;

  return (
    <main className={styles.pageRoot}>
      <header className={styles.hero}>
        <p className={styles.heroKicker}>Objektbas · Ventilation</p>
        <h1 className={styles.heroTitle}>Enkel dokumentation med foto först</h1>
        <p className={styles.heroText}>
          Objektskylt är enda obligatoriska steg. Därefter kan du lägga till och
          redigera komponenter utan dubletter i samma aggregat.
        </p>

        <div className={styles.modeSwitch}>
          <button
            onClick={() => setMode('lagg-till')}
            className={`${styles.modeButton} ${
              mode === 'lagg-till' ? styles.modeButtonActive : ''
            }`}
          >
            Registrera med foto
          </button>
          <button
            onClick={() => {
              setMode('sok');
              void handleSearch('');
            }}
            className={`${styles.modeButton} ${
              mode === 'sok' ? styles.modeButtonActive : ''
            }`}
          >
            Bibliotek
          </button>
        </div>
      </header>

      {error && <p className={styles.errorBanner}>{error}</p>}
      {status && <p className={styles.statusBanner}>{status}</p>}

      {mode === 'lagg-till' ? (
        <section className={styles.addLayout}>
          <aside className={styles.card}>
            <div className={styles.cardHeader}>
              <h2>Fotopunkter</h2>
              <span className={styles.badge}>
                {requiredDone}/{REQUIRED_TASK_IDS.length} obligatoriska
              </span>
            </div>

            <div className={styles.progressTrack}>
              <div className={styles.progressValue} style={{ width: `${completionRate}%` }} />
            </div>

            <ul className={styles.taskList}>
              {taskStatuses.map((task) => (
                <li key={task.id}>
                  <button
                    className={`${styles.taskButton} ${
                      selectedTaskId === task.id ? styles.taskButtonActive : ''
                    } ${task.locked ? styles.taskButtonLocked : ''}`}
                    onClick={() => handleTaskSelection(task.id)}
                    disabled={task.locked}
                  >
                    <div>
                      <strong>{task.label}</strong>
                      <p>{task.description}</p>
                    </div>
                    <div className={styles.taskMeta}>
                      {task.required && <span className={styles.required}>Obligatorisk</span>}
                      {task.saved ? (
                        <span className={styles.saved}>Sparad</span>
                      ) : task.captured ? (
                        <span className={styles.captured}>Fotad</span>
                      ) : (
                        <span className={styles.pending}>Ej fotad</span>
                      )}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </aside>

          <section className={styles.workspace}>
            <article className={styles.card}>
              <div className={styles.cardHeader}>
                <h2>Aktivt moment: {selectedTask.label}</h2>
                {isProcessingCapture && <span className={styles.badge}>Bearbetar...</span>}
              </div>

              <CameraCapture
                onCapture={handleCapture}
                title={`Fotografera ${selectedTask.label.toLowerCase()}`}
                subtitle={selectedTask.id === 'skylt' ? 'Steg 1: obligatoriskt' : 'Komponentfoto'}
                captureLabel={`Spara ${selectedTask.label}`}
                uploadLabel='Ladda upp foto'
                helperText={
                  selectedTask.id === 'skylt'
                    ? 'Skapar aggregat första gången, eller uppdaterar befintligt aggregat.'
                    : 'Sparas i befintligt aggregat. Samma komponenttyp uppdateras istället för att dubblas.'
                }
                disabled={isProcessingCapture || (!aggregateReady && selectedTask.id !== 'skylt')}
              />

              {selectedPhoto && (
                <div className={styles.previewWrap}>
                  <p>Senaste bild: {selectedTask.label}</p>
                  <img src={selectedPhoto} alt={`Foto ${selectedTask.label}`} />
                </div>
              )}
            </article>

            <article className={styles.card}>
              <div className={styles.cardHeader}>
                <h2>Aggregatram</h2>
                <span className={styles.aggregatePill}>
                  {currentAggregate
                    ? `Aktivt ID: ${currentAggregate.systemPositionId}`
                    : 'Skapas efter objektskylt'}
                </span>
              </div>

              <div className={styles.quickForm}>
                <label>
                  Systemposition
                  <input
                    value={systemPositionId}
                    onChange={(event) => setSystemPositionId(event.target.value)}
                    placeholder='Exempel: VP-1024'
                  />
                </label>

                <label>
                  Avdelning
                  <input
                    value={department}
                    onChange={(event) => setDepartment(event.target.value)}
                    list='department-presets'
                    placeholder='Exempel: Produktion'
                  />
                  <datalist id='department-presets'>
                    {DEPARTMENT_PRESETS.map((option) => (
                      <option key={option} value={option} />
                    ))}
                  </datalist>
                </label>

                <label>
                  Position
                  <input
                    value={position}
                    onChange={(event) => setPosition(event.target.value)}
                    placeholder='Exempel: Takplan 2, AHU-rum'
                  />
                </label>

                <label>
                  Notering
                  <textarea
                    value={aggregateNotes}
                    onChange={(event) => setAggregateNotes(event.target.value)}
                    placeholder='Valfri kontext för nästa tekniker.'
                  />
                </label>
              </div>

              <div className={styles.aggregateActions}>
                <button
                  className={styles.manualSaveButton}
                  onClick={handleSaveAggregateChanges}
                  disabled={!currentAggregate || isSavingAggregate}
                >
                  {isSavingAggregate ? 'Sparar...' : 'Spara ändringar i aggregat'}
                </button>
              </div>

              <div className={styles.libraryHint}>
                <strong>Regel i flödet:</strong>
                <p>
                  Endast objektskylt är obligatorisk. När aggregatet finns kan du
                  återkomma senare, uppdatera metadata och lägga till/ändra komponenter.
                </p>
              </div>
            </article>

            <article className={styles.card}>
              <div className={styles.cardHeader}>
                <h2>Manuell registrering (fallback)</h2>
                <span className={styles.badge}>Använd vid svårläst bild</span>
              </div>

              <div className={styles.manualGrid}>
                <label>
                  Komponenttyp
                  <select
                    value={manualComponentType}
                    onChange={(event) =>
                      handleManualTypeChange(event.target.value as ComponentType)
                    }
                  >
                    {COMPONENT_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  Identifierat värde
                  <input
                    value={manualValue}
                    onChange={(event) => setManualValue(event.target.value)}
                    placeholder='Exempel: SPA 1180, 6205-2RS C3'
                  />
                </label>

                {COMPONENT_FIELD_CONFIG[manualComponentType].map((field) => (
                  <label key={field.key}>
                    {field.label}
                    <input
                      value={manualAttributes[field.key] ?? ''}
                      onChange={(event) =>
                        setManualAttributes((current) => ({
                          ...current,
                          [field.key]: event.target.value
                        }))
                      }
                      placeholder={field.placeholder}
                    />
                  </label>
                ))}

                <label className={styles.fullRow}>
                  Notering
                  <textarea
                    value={manualNotes}
                    onChange={(event) => setManualNotes(event.target.value)}
                    placeholder='Exempel: OCR misslyckades, värde kontrollerat manuellt.'
                  />
                </label>
              </div>

              <button
                className={styles.manualSaveButton}
                onClick={handleManualSave}
                disabled={!aggregateReady || isSavingManual}
              >
                {isSavingManual ? 'Sparar...' : 'Spara manuell post'}
              </button>
            </article>

            <article className={styles.card}>
              <div className={styles.cardHeader}>
                <h2>Sparade komponenter</h2>
                <span className={styles.badge}>
                  {currentAggregate?.components.length ?? 0} komponentposter
                </span>
              </div>

              {!!currentAggregate?.components.length ? (
                <ul className={styles.componentList}>
                  {currentAggregate.components.map((component) => (
                    <li key={component.id}>
                      <p>
                        <strong>{component.componentType}</strong>: {component.identifiedValue}
                      </p>
                      <p>
                        {Object.entries(component.attributes)
                          .map(([key, value]) => `${key}: ${value}`)
                          .join(' · ')}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={styles.emptyState}>
                  Inga komponenter sparade ännu. Börja med objektskylt, fortsätt sedan
                  med foto eller manuell registrering.
                </p>
              )}
            </article>
          </section>
        </section>
      ) : (
        <section className={styles.searchCard}>
          <div className={styles.searchControls}>
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder='Sök på systemposition, komponent eller fritext'
            />
            <button onClick={() => void handleSearch()} disabled={isSearching}>
              {isSearching ? 'Söker...' : 'Sök'}
            </button>
          </div>

          <div className={styles.libraryToolbar}>
            <label>
              Avdelning
              <select
                value={departmentFilter}
                onChange={(event) => setDepartmentFilter(event.target.value)}
              >
                {departmentOptions.map((option) => (
                  <option key={option} value={option}>
                    {option === 'alla' ? 'Alla avdelningar' : option}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Sortering
              <select
                value={sortOrder}
                onChange={(event) => setSortOrder(event.target.value as SortOrder)}
              >
                <option value='nyast'>Senast uppdaterad</option>
                <option value='aldst'>Äldst först</option>
              </select>
            </label>
          </div>

          <ul className={styles.searchResultList}>
            {filteredSearchResults.map((aggregate) => (
              <li key={aggregate.id}>
                <header>
                  <strong>{aggregate.systemPositionId}</strong>
                  <span>{new Date(aggregate.updatedAt).toLocaleString('sv-SE')}</span>
                </header>
                <p>
                  Avdelning: {aggregate.department || 'Ej satt'} · Position:{' '}
                  {aggregate.position || 'Ej satt'}
                </p>

                {!!aggregate.components.length && (
                  <div className={styles.tags}>
                    {aggregate.components.map((component) => (
                      <span key={component.id}>
                        {component.componentType}: {component.identifiedValue}
                      </span>
                    ))}
                  </div>
                )}

                <button
                  className={styles.openButton}
                  onClick={() => handleOpenAggregateForEditing(aggregate)}
                >
                  Öppna för redigering
                </button>
              </li>
            ))}
          </ul>

          {!isSearching && filteredSearchResults.length === 0 && (
            <p className={styles.emptyState}>
              Inga träffar ännu. Registrera objekt via fotoflödet så byggs biblioteket upp.
            </p>
          )}
        </section>
      )}
    </main>
  );
}
