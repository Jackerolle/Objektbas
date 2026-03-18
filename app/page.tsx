'use client';

import { CameraCapture } from '@/components/CameraCapture';
import {
  addAggregateComponent,
  analyzeComponentImage,
  analyzeSystemPosition,
  createAggregate,
  deleteAggregate,
  deleteAggregateComponent,
  searchAggregates,
  updateAggregateComponent,
  updateAggregate
} from '@/lib/api';
import {
  COMPONENT_FIELD_CONFIG,
  COMPONENT_OPTIONS,
  createEmptyAttributes,
  isKnownComponentType
} from '@/lib/componentSchema';
import {
  loadAggregateLocalPhotos,
  saveAggregateLocalPhoto
} from '@/lib/localPhotoStore';
import {
  AggregateRecord,
  AppMode,
  ComponentType,
  SystemPositionAnalysis
} from '@/lib/types';
import { useEffect, useMemo, useState } from 'react';
import styles from './page.module.css';

type CaptureTask = {
  id: string;
  label: string;
  description: string;
  componentType?: ComponentType;
  required?: boolean;
};

type SortOrder = 'nyast' | 'aldst';
type StartMethod = 'foto' | 'manuell';

const ASSEMBLY_OPTIONS = ['Motor', 'Fläkt', 'Aggregat', 'Övrigt'] as const;
type AssemblyOption = (typeof ASSEMBLY_OPTIONS)[number];

const SUB_COMPONENT_PRESETS: Record<AssemblyOption, string[]> = {
  Motor: ['Motorskylt', 'Remskiva', 'Bussning', 'Lager', 'Axeldiameter', 'Kilrem'],
  Fläkt: ['Fläkthjul', 'Remskiva', 'Lager', 'Axeldiameter', 'Bussning', 'Kilrem'],
  Aggregat: ['Filter', 'Objektskylt', 'Spjäll', 'Värmebatteri'],
  Övrigt: []
};

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

function normalizeSystemPositionId(value: string | undefined): string {
  if (!value) {
    return '';
  }

  return value
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/[^A-Z0-9-]/g, '')
    .replace(/^-+|-+$/g, '');
}

function isUsableDetectedSystemPositionId(value: string): boolean {
  const normalized = normalizeSystemPositionId(value);
  if (!normalized) {
    return false;
  }

  if (normalized.length < 4) {
    return false;
  }

  if (['MANUELL-KRAVS', 'OKAND', 'UNKNOWN', 'UNK', 'NA', 'N/A'].includes(normalized)) {
    return false;
  }

  return /[A-Z]/.test(normalized) && /[0-9]/.test(normalized);
}

function getDefaultScopeForTask(task: CaptureTask): {
  assembly: AssemblyOption;
  subComponent: string;
} {
  switch (task.id) {
    case 'motor':
      return { assembly: 'Motor', subComponent: 'Motorskylt' };
    case 'flakt':
      return { assembly: 'Fläkt', subComponent: 'Fläkthjul' };
    case 'remskiva':
      return { assembly: 'Motor', subComponent: 'Remskiva' };
    case 'lager':
      return { assembly: 'Motor', subComponent: 'Lager' };
    case 'kilrem':
      return { assembly: 'Motor', subComponent: 'Kilrem' };
    case 'filter':
      return { assembly: 'Aggregat', subComponent: 'Filter' };
    default:
      return { assembly: 'Aggregat', subComponent: task.label };
  }
}

function getDefaultScopeForComponentType(componentType: ComponentType): {
  assembly: AssemblyOption;
  subComponent: string;
} {
  switch (componentType) {
    case 'Motor':
      return { assembly: 'Motor', subComponent: 'Motorskylt' };
    case 'Fläkt':
      return { assembly: 'Fläkt', subComponent: 'Fläkthjul' };
    case 'Remskiva':
      return { assembly: 'Motor', subComponent: 'Remskiva' };
    case 'Lager':
      return { assembly: 'Motor', subComponent: 'Lager' };
    case 'Kilrem':
      return { assembly: 'Motor', subComponent: 'Kilrem' };
    case 'Filter':
      return { assembly: 'Aggregat', subComponent: 'Filter' };
    default:
      return { assembly: 'Övrigt', subComponent: componentType };
  }
}

export default function HomePage() {
  const [mode, setMode] = useState<AppMode>('lagg-till');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [startMethod, setStartMethod] = useState<StartMethod | null>(null);

  const [selectedTaskId, setSelectedTaskId] = useState<string>('skylt');
  const [capturedPhotos, setCapturedPhotos] = useState<Record<string, string>>({});

  const [systemPositionId, setSystemPositionId] = useState('');
  const [department, setDepartment] = useState('');
  const [position, setPosition] = useState('');
  const [aggregateNotes, setAggregateNotes] = useState('');

  const [currentAggregate, setCurrentAggregate] = useState<AggregateRecord | null>(null);
  const [isSavingAggregate, setIsSavingAggregate] = useState(false);

  const [captureAssembly, setCaptureAssembly] = useState<AssemblyOption>('Motor');
  const [captureSubComponent, setCaptureSubComponent] = useState('Motorskylt');

  const [manualComponentType, setManualComponentType] = useState<ComponentType>('Kilrem');
  const [manualAssembly, setManualAssembly] = useState<AssemblyOption>('Motor');
  const [manualSubComponent, setManualSubComponent] = useState('Kilrem');
  const [manualValue, setManualValue] = useState('');
  const [manualAttributes, setManualAttributes] = useState<Record<string, string>>(
    () => createEmptyAttributes('Kilrem')
  );
  const [manualNotes, setManualNotes] = useState('');
  const [isSavingManual, setIsSavingManual] = useState(false);

  const [editingComponentId, setEditingComponentId] = useState<string | null>(null);
  const [editingComponentType, setEditingComponentType] = useState<ComponentType>('Kilrem');
  const [editingAssembly, setEditingAssembly] = useState<AssemblyOption>('Motor');
  const [editingSubComponent, setEditingSubComponent] = useState('Kilrem');
  const [editingIdentifiedValue, setEditingIdentifiedValue] = useState('');
  const [editingAttributes, setEditingAttributes] = useState<Record<string, string>>(
    () => createEmptyAttributes('Kilrem')
  );
  const [editingNotes, setEditingNotes] = useState('');
  const [isSavingComponentEdit, setIsSavingComponentEdit] = useState(false);
  const [deletingComponentId, setDeletingComponentId] = useState<string | null>(null);
  const [deletingAggregateId, setDeletingAggregateId] = useState<string | null>(null);

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
      const savedCount = task.componentType
        ? (currentAggregate?.components.filter(
            (component) => component.componentType === task.componentType
          ).length ?? 0)
        : 0;
      const locked = !aggregateReady && task.id !== 'skylt';

      return { ...task, captured, savedCount, locked };
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

  const captureSubComponentSuggestions = useMemo(
    () => SUB_COMPONENT_PRESETS[captureAssembly] ?? [],
    [captureAssembly]
  );

  const manualSubComponentSuggestions = useMemo(
    () => SUB_COMPONENT_PRESETS[manualAssembly] ?? [],
    [manualAssembly]
  );

  const editingSubComponentSuggestions = useMemo(
    () => SUB_COMPONENT_PRESETS[editingAssembly] ?? [],
    [editingAssembly]
  );

  const clearFeedback = () => {
    setError(null);
    setStatus('');
  };

  const resetComponentEditing = () => {
    setEditingComponentId(null);
    setEditingComponentType('Kilrem');
    setEditingAssembly('Motor');
    setEditingSubComponent('Kilrem');
    setEditingIdentifiedValue('');
    setEditingAttributes(createEmptyAttributes('Kilrem'));
    setEditingNotes('');
  };

  const syncAggregateInSearchResults = (nextAggregate: AggregateRecord) => {
    setSearchResults((current) =>
      current.map((item) => (item.id === nextAggregate.id ? nextAggregate : item))
    );
  };

  useEffect(() => {
    const defaults = getDefaultScopeForTask(findTask(selectedTaskId));
    setCaptureAssembly(defaults.assembly);
    setCaptureSubComponent(defaults.subComponent);
  }, [selectedTaskId]);

  const resetAggregateDraft = () => {
    setSelectedTaskId('skylt');
    setCapturedPhotos({});
    setCurrentAggregate(null);
    setSystemPositionId('');
    setDepartment('');
    setPosition('');
    setAggregateNotes('');
    const captureDefaults = getDefaultScopeForTask(findTask('skylt'));
    setCaptureAssembly(captureDefaults.assembly);
    setCaptureSubComponent(captureDefaults.subComponent);
    const manualDefaults = getDefaultScopeForComponentType('Kilrem');
    setManualAssembly(manualDefaults.assembly);
    setManualSubComponent(manualDefaults.subComponent);
    setManualComponentType('Kilrem');
    setManualValue('');
    setManualAttributes(createEmptyAttributes('Kilrem'));
    setManualNotes('');
    resetComponentEditing();
  };

  const openAddAggregateModal = () => {
    clearFeedback();
    setMode('lagg-till');
    setIsAddModalOpen(true);
  };

  const chooseStartMethod = (method: StartMethod) => {
    resetAggregateDraft();
    setStartMethod(method);
    setIsAddModalOpen(false);
    setStatus(
      method === 'foto'
        ? 'Startläge: fota objektskylt.'
        : 'Startläge: lägg in manuellt (fyll i systemposition och skapa aggregat).'
    );
  };

  const buildAggregatePayload = (systemId: string) => ({
    systemPositionId: normalizeSystemPositionId(systemId),
    position: position.trim() || undefined,
    department: department.trim() || undefined,
    notes: aggregateNotes.trim() || undefined
  });

  const handleTaskSelection = (taskId: string) => {
    const task = findTask(taskId);
    if (!aggregateReady && task.id !== 'skylt') {
      setError('Steg 1 är alltid objektskylt. Skapa aggregatet först.');
      return;
    }

    setSelectedTaskId(taskId);
  };

  const ensureAggregate = async (forcedSystemPositionId?: string): Promise<AggregateRecord> => {
    if (currentAggregate) {
      return currentAggregate;
    }

    const candidateId = normalizeSystemPositionId(forcedSystemPositionId || systemPositionId);
    if (!candidateId) {
      throw new Error('Systemposition saknas. Ange ID manuellt och fotografera objektskylt igen.');
    }

    const created = await createAggregate(buildAggregatePayload(candidateId));

    setCurrentAggregate(created);
    syncAggregateInSearchResults(created);
    setSystemPositionId(created.systemPositionId);
    return created;
  };

  const persistLocalPhoto = async (
    aggregateId: string,
    taskId: string,
    imageDataUrl: string
  ) => {
    try {
      await saveAggregateLocalPhoto(aggregateId, taskId, imageDataUrl);
    } catch (localError) {
      console.warn('Kunde inte spara lokal bild för aggregat', localError);
    }
  };

  useEffect(() => {
    if (!currentAggregate?.id) {
      return;
    }

    let cancelled = false;
    void loadAggregateLocalPhotos(currentAggregate.id)
      .then((photos) => {
        if (cancelled || !photos || !Object.keys(photos).length) {
          return;
        }

        setCapturedPhotos((current) => ({ ...photos, ...current }));
      })
      .catch((localError) => {
        console.warn('Kunde inte läsa lokala bilder för aggregat', localError);
      });

    return () => {
      cancelled = true;
    };
  }, [currentAggregate?.id]);

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
        setStatus('Bild mottagen. Laser objektskylt med OCR och AI...');
        let analysis: SystemPositionAnalysis;

        try {
          analysis = await analyzeSystemPosition(imageDataUrl);
        } catch (analysisError) {
          analysis = {
            systemPositionId: 'MANUELL-KRAVS',
            confidence: 0.1,
            notes: `AI-analys misslyckades: ${String(analysisError).slice(0, 120)}`,
            provider: 'fallback',
            requiresManualConfirmation: true
          };
        }

        const aiId = normalizeSystemPositionId(analysis.systemPositionId);
        const manualId = normalizeSystemPositionId(systemPositionId);
        const aiIdIsUsable =
          isUsableDetectedSystemPositionId(aiId) && analysis.confidence >= 0.35;
        const resolvedId = aiIdIsUsable ? aiId : manualId;

        if (!resolvedId) {
          throw new Error(
            'Kunde inte lasa ID fran skylten. Ange systemposition manuellt och prova igen med ny bild.'
          );
        }

        setStatus('Tolkning klar. Sparar aggregat...');
        setSystemPositionId(resolvedId);

        const aggregate = currentAggregate
          ? await updateAggregate(
              currentAggregate.id,
              buildAggregatePayload(resolvedId)
            )
          : await ensureAggregate(resolvedId);

        setCurrentAggregate(aggregate);
        syncAggregateInSearchResults(aggregate);
        const nextCaptured = { ...capturedPhotos, skylt: imageDataUrl };
        setCapturedPhotos(nextCaptured);
        void persistLocalPhoto(aggregate.id, 'skylt', imageDataUrl);
        setSelectedTaskId(getNextTaskId('skylt', nextCaptured));

        const analysisNote = analysis.notes?.trim() ? ` ${analysis.notes.trim()}` : '';
        const usedManual = !aiIdIsUsable;
        setStatus(
          usedManual
            ? `Objektskylt sparad med manuellt ID ${resolvedId}.${analysisNote}`
            : `Objektskylt tolkad (${toPercent(
                analysis.confidence
              )}) och aggregat sparat. Fortsätt med komponentfoton.${analysisNote}`
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
      setStatus(`Bild mottagen. Laser ${task.label.toLowerCase()} med OCR och AI...`);

      try {
        const analysis = await analyzeComponentImage(task.componentType, imageDataUrl);
        identifiedValue = analysis.identifiedValue?.trim() || identifiedValue;
        attributes = normalizeAutoAttributes(task.componentType, analysis.suggestedAttributes);
        note = `Automatiskt registrerad (${toPercent(analysis.confidence)}): ${analysis.notes}`;
      } catch (analysisError) {
        attributes = normalizeAutoAttributes(task.componentType, undefined);
        note = `OCR/AI kunde inte lasa sakert: ${String(analysisError).slice(0, 140)}`;
      }

      setStatus('Tolkning klar. Sparar komponent...');
      const updated = await addAggregateComponent(currentAggregate.id, {
        componentType: task.componentType,
        identifiedValue,
        notes: note,
        assembly: captureAssembly,
        subComponent: captureSubComponent.trim() || task.label,
        attributes
      });

      const nextCaptured = { ...capturedPhotos, [task.id]: imageDataUrl };
      setCapturedPhotos(nextCaptured);
      setCurrentAggregate(updated);
      syncAggregateInSearchResults(updated);
      void persistLocalPhoto(currentAggregate.id, task.id, imageDataUrl);
      setSelectedTaskId(getNextTaskId(task.id, nextCaptured));
      const scopeText = [captureAssembly, captureSubComponent.trim()]
        .filter(Boolean)
        .join(' / ');
      setStatus(`${task.label} sparad i aggregatet${scopeText ? ` (${scopeText})` : ''}.`);
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
        buildAggregatePayload(normalizeSystemPositionId(systemPositionId))
      );

      setCurrentAggregate(updated);
      syncAggregateInSearchResults(updated);
      setStatus('Aggregat uppdaterat.');
    } catch (saveError) {
      setError(`Kunde inte uppdatera aggregat: ${String(saveError)}`);
    } finally {
      setIsSavingAggregate(false);
    }
  };

  const handleCreateAggregateManually = async () => {
    clearFeedback();

    if (currentAggregate) {
      setStatus(`Aggregat ${currentAggregate.systemPositionId} är redan aktivt.`);
      return;
    }

    const candidateId = normalizeSystemPositionId(systemPositionId);
    if (!candidateId) {
      setError('Ange Systemposition för att skapa aggregat manuellt.');
      return;
    }

    setIsSavingAggregate(true);

    try {
      const created = await ensureAggregate(candidateId);
      setCurrentAggregate(created);
      syncAggregateInSearchResults(created);

      const nextCaptured = {
        ...capturedPhotos,
        skylt: capturedPhotos.skylt || 'manual-entry'
      };
      setCapturedPhotos(nextCaptured);
      setSelectedTaskId(getNextTaskId('skylt', nextCaptured));
      setStatus(`Aggregat ${created.systemPositionId} skapat manuellt.`);
    } catch (manualCreateError) {
      setError(`Kunde inte skapa aggregat manuellt: ${String(manualCreateError)}`);
    } finally {
      setIsSavingAggregate(false);
    }
  };

  const handleOpenAggregateForEditing = (aggregate: AggregateRecord) => {
    resetComponentEditing();
    setCurrentAggregate(aggregate);
    setStartMethod('foto');
    setIsAddModalOpen(false);
    setSystemPositionId(aggregate.systemPositionId);
    setDepartment(aggregate.department ?? '');
    setPosition(aggregate.position ?? '');
    setAggregateNotes(aggregate.notes ?? '');
    setCapturedPhotos({});
    setSelectedTaskId('kilrem');
    setMode('lagg-till');
    setStatus(`Öppnade aggregat ${aggregate.systemPositionId} för redigering.`);
  };

  const handleManualTypeChange = (nextType: ComponentType) => {
    const defaults = getDefaultScopeForComponentType(nextType);
    setManualComponentType(nextType);
    setManualAssembly(defaults.assembly);
    setManualSubComponent(defaults.subComponent);
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

    if (!manualAssembly.trim()) {
      setError('Huvudkategori krävs för manuell registrering.');
      return;
    }

    if (!manualSubComponent.trim()) {
      setError('Underkategori krävs för manuell registrering.');
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
        assembly: manualAssembly,
        subComponent: manualSubComponent.trim(),
        attributes: manualAttributes,
        notes: manualNotes.trim() || 'Manuellt registrerad post.'
      });

      setCurrentAggregate(updated);
      syncAggregateInSearchResults(updated);
      setManualValue('');
      setManualAttributes(createEmptyAttributes(manualComponentType));
      setManualNotes('');
      setStatus(
        `${manualComponentType} sparad manuellt (${manualAssembly} / ${manualSubComponent.trim()}) i biblioteket.`
      );
    } catch (manualError) {
      setError(`Kunde inte spara manuell post: ${String(manualError)}`);
    } finally {
      setIsSavingManual(false);
    }
  };

  const handleStartEditComponent = (componentId: string) => {
    if (!currentAggregate) {
      return;
    }

    const component = currentAggregate.components.find((item) => item.id === componentId);
    if (!component) {
      return;
    }

    const componentType = isKnownComponentType(component.componentType)
      ? component.componentType
      : 'Kilrem';
    const defaultScope = getDefaultScopeForComponentType(componentType);

    setEditingComponentId(component.id);
    setEditingComponentType(componentType);
    setEditingAssembly((component.assembly as AssemblyOption | undefined) ?? defaultScope.assembly);
    setEditingSubComponent(component.subComponent ?? defaultScope.subComponent);
    setEditingIdentifiedValue(component.identifiedValue);
    setEditingAttributes({
      ...createEmptyAttributes(componentType),
      ...component.attributes
    });
    setEditingNotes(component.notes ?? '');
  };

  const handleEditingTypeChange = (nextType: ComponentType) => {
    const defaults = getDefaultScopeForComponentType(nextType);
    setEditingComponentType(nextType);
    setEditingAssembly(defaults.assembly);
    setEditingSubComponent(defaults.subComponent);
    setEditingAttributes(createEmptyAttributes(nextType));
  };

  const handleSaveComponentEdit = async () => {
    clearFeedback();

    if (!currentAggregate || !editingComponentId) {
      setError('Ingen komponent vald för redigering.');
      return;
    }

    if (!editingIdentifiedValue.trim()) {
      setError('Identifierat värde krävs.');
      return;
    }

    if (!editingAssembly.trim()) {
      setError('Huvudkategori krävs.');
      return;
    }

    if (!editingSubComponent.trim()) {
      setError('Underkategori krävs.');
      return;
    }

    const missing = COMPONENT_FIELD_CONFIG[editingComponentType]
      .filter((field) => !editingAttributes[field.key]?.trim())
      .map((field) => field.label);

    if (missing.length > 0) {
      setError(`Fyll i obligatoriska fält: ${missing.join(', ')}.`);
      return;
    }

    setIsSavingComponentEdit(true);

    try {
      const updated = await updateAggregateComponent(currentAggregate.id, editingComponentId, {
        componentType: editingComponentType,
        identifiedValue: editingIdentifiedValue.trim(),
        assembly: editingAssembly,
        subComponent: editingSubComponent.trim(),
        attributes: editingAttributes,
        notes: editingNotes.trim() || undefined
      });

      setCurrentAggregate(updated);
      syncAggregateInSearchResults(updated);
      resetComponentEditing();
      setStatus('Komponent uppdaterad.');
    } catch (updateError) {
      setError(`Kunde inte uppdatera komponent: ${String(updateError)}`);
    } finally {
      setIsSavingComponentEdit(false);
    }
  };

  const handleDeleteComponent = async (componentId: string) => {
    clearFeedback();

    if (!currentAggregate) {
      setError('Ingen aktiv aggregatpost vald.');
      return;
    }

    const component = currentAggregate.components.find((item) => item.id === componentId);
    if (!component) {
      setError('Komponenten hittades inte.');
      return;
    }

    const confirmed = window.confirm(
      `Ta bort komponenten "${component.componentType} (${component.subComponent ?? 'Ingen underkategori'})"?`
    );
    if (!confirmed) {
      return;
    }

    setDeletingComponentId(componentId);

    try {
      const updated = await deleteAggregateComponent(currentAggregate.id, componentId);
      setCurrentAggregate(updated);
      syncAggregateInSearchResults(updated);

      if (editingComponentId === componentId) {
        resetComponentEditing();
      }

      setStatus('Komponent borttagen.');
    } catch (deleteError) {
      setError(`Kunde inte ta bort komponent: ${String(deleteError)}`);
    } finally {
      setDeletingComponentId(null);
    }
  };

  const handleDeleteAggregate = async (aggregate: AggregateRecord) => {
    clearFeedback();

    const confirmed = window.confirm(
      `Ta bort aggregat "${aggregate.systemPositionId}" inklusive alla komponenter? Detta går inte att ångra.`
    );
    if (!confirmed) {
      return;
    }

    setDeletingAggregateId(aggregate.id);

    try {
      await deleteAggregate(aggregate.id);
      setSearchResults((current) => current.filter((item) => item.id !== aggregate.id));

      if (currentAggregate?.id === aggregate.id) {
        resetAggregateDraft();
        setStartMethod(null);
        setMode('sok');
      }

      setStatus(`Aggregat ${aggregate.systemPositionId} borttaget.`);
    } catch (deleteError) {
      setError(`Kunde inte ta bort aggregat: ${String(deleteError)}`);
    } finally {
      setDeletingAggregateId(null);
    }
  };

  const selectedPhoto = capturedPhotos[selectedTask.id] ?? null;
  const selectedPhotoIsPreviewable = Boolean(selectedPhoto?.startsWith('data:image/'));
  const showAddWorkspace = Boolean(startMethod) || Boolean(currentAggregate);
  const showManualSkyltStart =
    selectedTask.id === 'skylt' && startMethod === 'manuell' && !aggregateReady;

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
            onClick={openAddAggregateModal}
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
            Bibliotek
          </button>
        </div>
      </header>

      {error && <p className={styles.errorBanner}>{error}</p>}
      {status && <p className={styles.statusBanner}>{status}</p>}

      {isAddModalOpen && (
        <div className={styles.modalBackdrop} onClick={() => setIsAddModalOpen(false)}>
          <section
            className={styles.choiceModal}
            onClick={(event) => event.stopPropagation()}
          >
            <h2>Hur vill du starta aggregatet?</h2>
            <p>Välj ett alternativ.</p>
            <div className={styles.choiceButtons}>
              <button onClick={() => chooseStartMethod('foto')}>Fota</button>
              <button onClick={() => chooseStartMethod('manuell')}>Lägg in manuellt</button>
            </div>
          </section>
        </div>
      )}

      {mode === 'lagg-till' ? (
        !showAddWorkspace ? (
          <section className={styles.searchCard}>
            <p className={styles.emptyState}>
              Klicka på <strong>Lägg till aggregat</strong> och välj <strong>Fota</strong> eller{' '}
              <strong>Lägg in manuellt</strong>.
            </p>
            <div className={styles.quickStartActions}>
              <button
                className={styles.manualSaveButton}
                onClick={() => chooseStartMethod('foto')}
              >
                Starta med foto
              </button>
              <button
                className={styles.inlineButton}
                onClick={() => chooseStartMethod('manuell')}
              >
                Starta manuellt
              </button>
            </div>
          </section>
        ) : (
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
                      {task.savedCount ? (
                        <span className={styles.saved}>{task.savedCount} sparade</span>
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

              {selectedTask.id !== 'skylt' && (
                <div className={styles.scopeGrid}>
                  <label>
                    Huvudkategori
                    <select
                      value={captureAssembly}
                      onChange={(event) => setCaptureAssembly(event.target.value as AssemblyOption)}
                    >
                      {ASSEMBLY_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    Underkategori
                    <input
                      value={captureSubComponent}
                      onChange={(event) => setCaptureSubComponent(event.target.value)}
                      list='capture-subcomponent-presets'
                      placeholder='Exempel: Remskiva motorsida'
                    />
                    <datalist id='capture-subcomponent-presets'>
                      {captureSubComponentSuggestions.map((option) => (
                        <option key={option} value={option} />
                      ))}
                    </datalist>
                  </label>
                </div>
              )}

              {showManualSkyltStart ? (
                <div className={styles.libraryHint}>
                  <strong>Manuell start</strong>
                  <p>Fyll i Systemposition i aggregatramen och skapa aggregatet manuellt.</p>
                  <div className={styles.quickStartActions}>
                    <button
                      className={styles.manualSaveButton}
                      onClick={() => void handleCreateAggregateManually()}
                      disabled={isSavingAggregate || isProcessingCapture}
                    >
                      {isSavingAggregate ? 'Skapar...' : 'Lägg till manuellt'}
                    </button>
                    <button
                      className={styles.inlineButton}
                      onClick={() => setStartMethod('foto')}
                      disabled={isSavingAggregate || isProcessingCapture}
                    >
                      Byt till foto
                    </button>
                  </div>
                </div>
              ) : (
                <CameraCapture
                  onCapture={handleCapture}
                  title={`Fotografera ${selectedTask.label.toLowerCase()}`}
                  subtitle={selectedTask.id === 'skylt' ? 'Steg 1: obligatoriskt' : 'Komponentfoto'}
                  captureLabel='Ta foto med enhet'
                  uploadLabel='Ladda upp foto'
                helperText={
                  selectedTask.id === 'skylt'
                    ? 'Skapar aggregat första gången, eller uppdaterar befintligt aggregat. Bilden sparas lokalt på enheten.'
                    : 'Sparas i befintligt aggregat med vald huvudkategori/underkategori. Flera komponenter av samma typ stöds. Bilden sparas lokalt på enheten.'
                }
                  disabled={isProcessingCapture || (!aggregateReady && selectedTask.id !== 'skylt')}
                />
              )}

              {selectedPhoto && selectedPhotoIsPreviewable && (
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
                <button
                  className={styles.dangerButton}
                  onClick={() => currentAggregate && void handleDeleteAggregate(currentAggregate)}
                  disabled={!currentAggregate || deletingAggregateId === currentAggregate.id}
                >
                  {deletingAggregateId === currentAggregate?.id
                    ? 'Tar bort aggregat...'
                    : 'Ta bort aggregat'}
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
                  Huvudkategori
                  <select
                    value={manualAssembly}
                    onChange={(event) => setManualAssembly(event.target.value as AssemblyOption)}
                  >
                    {ASSEMBLY_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  Underkategori
                  <input
                    value={manualSubComponent}
                    onChange={(event) => setManualSubComponent(event.target.value)}
                    list='manual-subcomponent-presets'
                    placeholder='Exempel: Remskiva fläktsida'
                  />
                  <datalist id='manual-subcomponent-presets'>
                    {manualSubComponentSuggestions.map((option) => (
                      <option key={option} value={option} />
                    ))}
                  </datalist>
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
                  {currentAggregate.components.map((component) => {
                    const isEditing = editingComponentId === component.id;
                    const attributeSummary = Object.entries(component.attributes)
                      .filter(([, value]) => value?.trim())
                      .map(([key, value]) => `${key}: ${value}`)
                      .join(' · ');

                    return (
                      <li key={component.id}>
                        <div className={styles.componentItemHeader}>
                          <p>
                            <strong>{component.componentType}</strong>
                            {component.assembly ? ` · ${component.assembly}` : ''}
                            {component.subComponent ? ` / ${component.subComponent}` : ''}: {component.identifiedValue}
                          </p>

                          <div className={styles.componentItemActions}>
                            <button
                              className={styles.inlineButton}
                              onClick={() => handleStartEditComponent(component.id)}
                              disabled={isEditing || deletingComponentId === component.id || isSavingComponentEdit}
                            >
                              Redigera
                            </button>
                            <button
                              className={styles.inlineDangerButton}
                              onClick={() => void handleDeleteComponent(component.id)}
                              disabled={deletingComponentId === component.id || isSavingComponentEdit}
                            >
                              {deletingComponentId === component.id ? 'Tar bort...' : 'Ta bort'}
                            </button>
                          </div>
                        </div>

                        {isEditing ? (
                          <div className={styles.componentEditGrid}>
                            <label>
                              Komponenttyp
                              <select
                                value={editingComponentType}
                                onChange={(event) =>
                                  handleEditingTypeChange(event.target.value as ComponentType)
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
                              Huvudkategori
                              <select
                                value={editingAssembly}
                                onChange={(event) =>
                                  setEditingAssembly(event.target.value as AssemblyOption)
                                }
                              >
                                {ASSEMBLY_OPTIONS.map((option) => (
                                  <option key={option} value={option}>
                                    {option}
                                  </option>
                                ))}
                              </select>
                            </label>

                            <label>
                              Underkategori
                              <input
                                value={editingSubComponent}
                                onChange={(event) => setEditingSubComponent(event.target.value)}
                                list={`editing-subcomponent-${component.id}`}
                                placeholder='Exempel: Remskiva motorsida'
                              />
                              <datalist id={`editing-subcomponent-${component.id}`}>
                                {editingSubComponentSuggestions.map((option) => (
                                  <option key={option} value={option} />
                                ))}
                              </datalist>
                            </label>

                            <label>
                              Identifierat värde
                              <input
                                value={editingIdentifiedValue}
                                onChange={(event) => setEditingIdentifiedValue(event.target.value)}
                                placeholder='Exempel: SPA 1180, 6205-2RS C3'
                              />
                            </label>

                            {COMPONENT_FIELD_CONFIG[editingComponentType].map((field) => (
                              <label key={field.key}>
                                {field.label}
                                <input
                                  value={editingAttributes[field.key] ?? ''}
                                  onChange={(event) =>
                                    setEditingAttributes((current) => ({
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
                                value={editingNotes}
                                onChange={(event) => setEditingNotes(event.target.value)}
                                placeholder='Valfri notering för komponenten.'
                              />
                            </label>

                            <div className={styles.inlineEditActions}>
                              <button
                                className={styles.manualSaveButton}
                                onClick={() => void handleSaveComponentEdit()}
                                disabled={isSavingComponentEdit || deletingComponentId === component.id}
                              >
                                {isSavingComponentEdit ? 'Sparar...' : 'Spara ändring'}
                              </button>
                              <button
                                className={styles.inlineButton}
                                onClick={resetComponentEditing}
                                disabled={isSavingComponentEdit}
                              >
                                Avbryt
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <p>{attributeSummary || 'Inga attribut angivna.'}</p>
                            {component.notes && <p>Notering: {component.notes}</p>}
                          </>
                        )}
                      </li>
                    );
                  })}
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
        )
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
                  <div className={styles.componentOverview}>
                    <p className={styles.componentOverviewTitle}>
                      Komponentöversikt ({aggregate.components.length})
                    </p>
                    <ul className={styles.componentOverviewList}>
                      {aggregate.components.map((component) => (
                        <li key={component.id}>
                          <strong>{component.componentType}</strong>
                          <span>
                            {component.assembly ? `${component.assembly}` : 'Ingen huvudkategori'}
                            {component.subComponent ? ` / ${component.subComponent}` : ''}
                          </span>
                          <span>{component.identifiedValue}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className={styles.resultActions}>
                  <button
                    className={styles.openButton}
                    onClick={() => handleOpenAggregateForEditing(aggregate)}
                  >
                    Öppna för redigering
                  </button>
                  <button
                    className={styles.deleteButton}
                    onClick={() => void handleDeleteAggregate(aggregate)}
                    disabled={deletingAggregateId === aggregate.id}
                  >
                    {deletingAggregateId === aggregate.id ? 'Tar bort...' : 'Ta bort aggregat'}
                  </button>
                </div>
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
