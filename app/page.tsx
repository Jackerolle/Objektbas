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
import {
  AggregateRecord,
  AppMode,
  ComponentAnalysis,
  ComponentType,
  SystemPositionAnalysis
} from '@/lib/types';
import { useMemo, useState } from 'react';
import styles from './page.module.css';

type CaptureTask = {
  id: string;
  label: string;
  description: string;
  componentType?: ComponentType;
  required?: boolean;
};

const CAPTURE_TASKS: CaptureTask[] = [
  {
    id: 'skylt',
    label: 'Objektsskylt',
    description: 'System-ID och märkplåt på aggregatet.',
    required: true
  },
  {
    id: 'remskiva',
    label: 'Remskiva',
    description: 'Driv- och medremskiva med spår.',
    componentType: 'Remskiva',
    required: true
  },
  {
    id: 'kilrem',
    label: 'Kilrem',
    description: 'Profil, längd och antal remmar.',
    componentType: 'Kilrem',
    required: true
  },
  {
    id: 'lager',
    label: 'Lager',
    description: 'Lagerkod och placering.',
    componentType: 'Lager',
    required: true
  },
  {
    id: 'motor',
    label: 'Motor',
    description: 'Motorplåt, effekt och märkström.',
    componentType: 'Motor',
    required: true
  },
  {
    id: 'flakt',
    label: 'Fläkt',
    description: 'Hjul/vinge, diameter och rotationsriktning.',
    componentType: 'Fläkt'
  },
  {
    id: 'filter',
    label: 'Filter',
    description: 'Filterklass och dimension.',
    componentType: 'Filter'
  }
];

const REQUIRED_TASK_IDS = CAPTURE_TASKS.filter((task) => task.required).map(
  (task) => task.id
);

function toPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function getTaskById(taskId: string): CaptureTask {
  return CAPTURE_TASKS.find((task) => task.id === taskId) ?? CAPTURE_TASKS[0];
}

export default function HomePage() {
  const [mode, setMode] = useState<AppMode>('lagg-till');

  const [selectedTaskId, setSelectedTaskId] = useState<string>(CAPTURE_TASKS[0].id);
  const [capturedPhotos, setCapturedPhotos] = useState<Record<string, string>>({});

  const [systemPositionImage, setSystemPositionImage] = useState<string | null>(null);
  const [systemPositionId, setSystemPositionId] = useState('');
  const [position, setPosition] = useState('');
  const [department, setDepartment] = useState('');
  const [aggregateNotes, setAggregateNotes] = useState('');
  const [systemAnalysis, setSystemAnalysis] = useState<SystemPositionAnalysis | null>(null);

  const [currentAggregate, setCurrentAggregate] = useState<AggregateRecord | null>(null);
  const [componentType, setComponentType] = useState<ComponentType>('Motor');
  const [componentImage, setComponentImage] = useState<string | null>(null);
  const [componentValue, setComponentValue] = useState('');
  const [componentAttributes, setComponentAttributes] = useState<Record<string, string>>(
    () => createEmptyAttributes('Motor')
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

  const selectedTask = getTaskById(selectedTaskId);
  const canCaptureSelectedTask = !selectedTask.componentType || Boolean(currentAggregate);
  const requiredDone = REQUIRED_TASK_IDS.filter((id) => Boolean(capturedPhotos[id])).length;
  const completionRate = Math.round((requiredDone / REQUIRED_TASK_IDS.length) * 100);

  const clearStatus = () => {
    setError(null);
    setStatus('');
  };

  const handleTaskSelection = (taskId: string) => {
    const task = getTaskById(taskId);
    setSelectedTaskId(taskId);

    if (task.componentType) {
      setComponentType(task.componentType);
      setComponentAttributes(createEmptyAttributes(task.componentType));
      setComponentValue('');
      setComponentNotes('');
      setComponentAnalysis(null);
    }
  };

  const handleSystemCapture = async (imageDataUrl: string) => {
    clearStatus();
    setCapturedPhotos((current) => ({ ...current, skylt: imageDataUrl }));
    setSystemPositionImage(imageDataUrl);
    setIsAnalyzingSystem(true);

    try {
      const analysis = await analyzeSystemPosition(imageDataUrl);
      setSystemAnalysis(analysis);
      setSystemPositionId(analysis.systemPositionId || '');
      setStatus('Objektsskylt tolkad. Bekräfta system-ID innan du sparar aggregatet.');
    } catch (captureError) {
      setError(`Kunde inte analysera objektsskylt: ${String(captureError)}`);
    } finally {
      setIsAnalyzingSystem(false);
    }
  };

  const handleComponentCapture = async (
    task: CaptureTask,
    imageDataUrl: string
  ) => {
    clearStatus();

    if (!task.componentType) {
      return;
    }

    if (!currentAggregate) {
      setError('Skapa aggregatet först innan du fotograferar komponenter.');
      return;
    }

    setCapturedPhotos((current) => ({ ...current, [task.id]: imageDataUrl }));
    setComponentType(task.componentType);
    setComponentImage(imageDataUrl);
    setIsAnalyzingComponent(true);

    try {
      const analysis = await analyzeComponentImage(task.componentType, imageDataUrl);
      setComponentAnalysis(analysis);
      setComponentValue(analysis.identifiedValue || '');
      setComponentAttributes({
        ...createEmptyAttributes(task.componentType),
        ...analysis.suggestedAttributes
      });
      setStatus(`${task.label} analyserad. Verifiera och spara komponentdata.`);
    } catch (analysisError) {
      setError(`Kunde inte analysera ${task.label.toLowerCase()}: ${String(analysisError)}`);
    } finally {
      setIsAnalyzingComponent(false);
    }
  };

  const handleTaskCapture = async (imageDataUrl: string) => {
    if (selectedTask.id === 'skylt') {
      await handleSystemCapture(imageDataUrl);
      return;
    }

    await handleComponentCapture(selectedTask, imageDataUrl);
  };

  const handleCreateAggregate = async () => {
    clearStatus();

    if (!systemPositionId.trim()) {
      setError('Systempositionens ID måste anges innan du kan spara aggregatet.');
      return;
    }

    if (!systemPositionImage) {
      setError('Ta först en bild på objektsskylten.');
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
      setStatus(`Aggregat ${aggregate.systemPositionId} skapat. Fortsätt med fotomenyn till vänster.`);
    } catch (createError) {
      setError(`Kunde inte skapa aggregat: ${String(createError)}`);
    } finally {
      setIsCreatingAggregate(false);
    }
  };

  const handleSaveComponent = async () => {
    clearStatus();

    if (!currentAggregate) {
      setError('Inget aggregat är valt.');
      return;
    }

    if (!componentValue.trim()) {
      setError('Identifierat värde måste fyllas i innan sparning.');
      return;
    }

    const missingAttributeLabels = COMPONENT_FIELD_CONFIG[componentType]
      .filter((field) => !componentAttributes[field.key]?.trim())
      .map((field) => field.label);

    if (missingAttributeLabels.length > 0) {
      setError(`Fyll i obligatoriska fält: ${missingAttributeLabels.join(', ')}.`);
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
      setStatus(`${componentType} sparad på aggregatet.`);
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
      setStatus(`${results.length} träffar hittades.`);
    } catch (searchError) {
      setError(`Kunde inte hämta resultat: ${String(searchError)}`);
    } finally {
      setIsSearching(false);
    }
  };

  const selectedPhoto = capturedPhotos[selectedTask.id] ?? null;

  const taskStatus = useMemo(() => {
    return CAPTURE_TASKS.map((task) => {
      const captured = Boolean(capturedPhotos[task.id]);
      const saved =
        !!task.componentType &&
        !!currentAggregate?.components.some(
          (component) => component.componentType === task.componentType
        );

      return { ...task, captured, saved };
    });
  }, [capturedPhotos, currentAggregate]);

  return (
    <main className={styles.pageRoot}>
      <header className={styles.hero}>
        <p className={styles.heroKicker}>Objektbas · Ventilation</p>
        <h1 className={styles.heroTitle}>Fältklar aggregatregistrering</h1>
        <p className={styles.heroText}>
          Byggt för tekniker i drift: välj fotopunkt, ta bild, verifiera data och
          spara utan onödiga klick.
        </p>

        <div className={styles.modeSwitch}>
          <button
            onClick={() => setMode('lagg-till')}
            className={`${styles.modeButton} ${
              mode === 'lagg-till' ? styles.modeButtonActive : ''
            }`}
          >
            Lägg till aggregat
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
            Sök historik
          </button>
        </div>
      </header>

      {error && <p className={styles.errorBanner}>{error}</p>}
      {status && <p className={styles.statusBanner}>{status}</p>}

      {mode === 'lagg-till' ? (
        <section className={styles.addLayout}>
          <aside className={styles.card}>
            <div className={styles.cardHeader}>
              <h2>Fotomeny</h2>
              <span className={styles.badge}>{requiredDone}/{REQUIRED_TASK_IDS.length} klara</span>
            </div>

            <div className={styles.progressTrack}>
              <div
                className={styles.progressValue}
                style={{ width: `${completionRate}%` }}
              />
            </div>

            <ul className={styles.taskList}>
              {taskStatus.map((task) => (
                <li key={task.id}>
                  <button
                    className={`${styles.taskButton} ${
                      selectedTaskId === task.id ? styles.taskButtonActive : ''
                    }`}
                    onClick={() => handleTaskSelection(task.id)}
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
                <h2>Aktivt fotomoment: {selectedTask.label}</h2>
                {selectedTask.componentType && !currentAggregate && (
                  <span className={styles.blocked}>Låst tills aggregat är skapat</span>
                )}
              </div>

              <CameraCapture
                onCapture={handleTaskCapture}
                title={`Fotografera ${selectedTask.label.toLowerCase()}`}
                subtitle={selectedTask.componentType ? 'Komponentbild' : 'Objektbild'}
                captureLabel={`Spara bild: ${selectedTask.label}`}
                helperText={
                  canCaptureSelectedTask
                    ? 'Kameran startar endast när du trycker på Starta kamera.'
                    : 'Skapa aggregatet först för att låsa upp komponentfotografering.'
                }
                disabled={
                  !canCaptureSelectedTask ||
                  isAnalyzingSystem ||
                  isAnalyzingComponent ||
                  isCreatingAggregate ||
                  isSavingComponent
                }
              />

              {selectedPhoto && (
                <div className={styles.previewWrap}>
                  <p>Senaste bild för {selectedTask.label}</p>
                  <img src={selectedPhoto} alt={`Bild för ${selectedTask.label}`} />
                </div>
              )}
            </article>

            <article className={styles.card}>
              <div className={styles.cardHeader}>
                <h2>Aggregatdata</h2>
                {currentAggregate && (
                  <span className={styles.aggregatePill}>
                    Aktivt aggregat: {currentAggregate.systemPositionId}
                  </span>
                )}
              </div>

              <div className={styles.formGrid}>
                <label>
                  Systemposition (ID)
                  <input
                    value={systemPositionId}
                    onChange={(event) => setSystemPositionId(event.target.value)}
                    placeholder='Exempel: VP-1024'
                  />
                </label>

                <label>
                  Position
                  <input
                    value={position}
                    onChange={(event) => setPosition(event.target.value)}
                    placeholder='Exempel: Takplan 2'
                  />
                </label>

                <label>
                  Avdelning
                  <input
                    value={department}
                    onChange={(event) => setDepartment(event.target.value)}
                    placeholder='Exempel: Produktion'
                  />
                </label>

                <label className={styles.fullWidth}>
                  Kommentar
                  <textarea
                    value={aggregateNotes}
                    onChange={(event) => setAggregateNotes(event.target.value)}
                    placeholder='Skick, ljudnivå, åtkomst eller annat som nästa tekniker behöver veta.'
                  />
                </label>
              </div>

              {systemAnalysis && (
                <div className={styles.aiBox}>
                  <p>
                    AI-förslag: <strong>{systemAnalysis.systemPositionId || 'Tomt'}</strong>
                    {' · '}
                    {toPercent(systemAnalysis.confidence)}
                  </p>
                  <p>{systemAnalysis.notes}</p>
                </div>
              )}

              <button
                onClick={handleCreateAggregate}
                disabled={isAnalyzingSystem || isCreatingAggregate}
                className={styles.primaryAction}
              >
                {isAnalyzingSystem
                  ? 'Analyserar objektsskylt...'
                  : isCreatingAggregate
                  ? 'Skapar aggregat...'
                  : 'Skapa aggregat'}
              </button>
            </article>

            <article className={styles.card}>
              <div className={styles.cardHeader}>
                <h2>Komponentverifiering</h2>
                <span className={styles.badge}>
                  {currentAggregate?.components.length ?? 0} sparade komponenter
                </span>
              </div>

              <div className={styles.formGrid}>
                <label>
                  Komponenttyp
                  <select
                    value={componentType}
                    onChange={(event) => {
                      const next = event.target.value as ComponentType;
                      setComponentType(next);
                      setComponentAttributes(createEmptyAttributes(next));
                      setComponentValue('');
                      setComponentNotes('');
                      setComponentAnalysis(null);
                    }}
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
                    value={componentValue}
                    onChange={(event) => setComponentValue(event.target.value)}
                    placeholder='Ex: SPA 1180, 6205-2RS C3, Radial 450'
                  />
                </label>

                {COMPONENT_FIELD_CONFIG[componentType].map((field) => (
                  <label key={field.key}>
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
                    />
                  </label>
                ))}

                <label className={styles.fullWidth}>
                  Notering
                  <textarea
                    value={componentNotes}
                    onChange={(event) => setComponentNotes(event.target.value)}
                    placeholder='Ex: Sprickor i rem, spel i lager, filterbyte krävs nästa stopp.'
                  />
                </label>
              </div>

              {componentAnalysis && (
                <div className={styles.aiBoxSuccess}>
                  <p>
                    AI-förslag ({componentAnalysis.componentType}):{' '}
                    <strong>{componentAnalysis.identifiedValue}</strong>
                    {' · '}
                    {toPercent(componentAnalysis.confidence)}
                  </p>
                  <p>{componentAnalysis.notes}</p>
                </div>
              )}

              <button
                onClick={handleSaveComponent}
                disabled={isAnalyzingComponent || isSavingComponent || !currentAggregate}
                className={styles.primaryAction}
              >
                {isAnalyzingComponent
                  ? 'Analyserar komponentbild...'
                  : isSavingComponent
                  ? 'Sparar komponent...'
                  : 'Spara komponent'}
              </button>

              {!!currentAggregate?.components.length && (
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
                      {component.notes && <p>{component.notes}</p>}
                    </li>
                  ))}
                </ul>
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
              placeholder='Sök på systemposition, avdelning, position eller komponent'
            />
            <button onClick={() => void handleSearch()} disabled={isSearching}>
              {isSearching ? 'Söker...' : 'Sök'}
            </button>
          </div>

          <ul className={styles.searchResultList}>
            {searchResults.map((aggregate) => (
              <li key={aggregate.id}>
                <header>
                  <strong>{aggregate.systemPositionId}</strong>
                  <span>{new Date(aggregate.updatedAt).toLocaleString('sv-SE')}</span>
                </header>
                <p>
                  Position: {aggregate.position || 'Ej angiven'} · Avdelning:{' '}
                  {aggregate.department || 'Ej angiven'}
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
              </li>
            ))}
          </ul>

          {!isSearching && searchResults.length === 0 && (
            <p className={styles.emptyState}>Inga sparade poster hittades ännu.</p>
          )}
        </section>
      )}
    </main>
  );
}
