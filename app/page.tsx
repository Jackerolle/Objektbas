'use client';

import { CameraCapture } from '@/components/CameraCapture';
import { PwaInstallPrompt } from '@/components/PwaInstallPrompt';
import {
  addAggregateComponent,
  analyzeComponentImage,
  analyzeSystemPosition,
  createAggregateEvent,
  createAggregate,
  deleteAggregate,
  deleteAggregateComponent,
  getAggregateEvents,
  importFilterListFile,
  searchAggregates,
  searchFilterList,
  updateAggregateComponent,
  updateAggregate
} from '@/lib/api';
import {
  COMPONENT_FIELD_CONFIG,
  type ComponentFieldConfig,
  createEmptyAttributes,
  getMissingRequiredFields,
  isKnownComponentType
} from '@/lib/componentSchema';
import {
  loadAggregateLocalPhotos,
  saveAggregateLocalPhoto
} from '@/lib/localPhotoStore';
import { analyzeSystemPositionLocally } from '@/lib/client/freeOcr';
import {
  AggregateEvent,
  AggregateRecord,
  AppMode,
  ComponentType,
  CreateAggregateComponentPayload,
  FilterListRow,
  SystemPositionAnalysis
} from '@/lib/types';
import { useEffect, useMemo, useRef, useState } from 'react';
import styles from './page.module.css';

type CaptureTask = {
  id: string;
  label: string;
  description: string;
  componentType?: ComponentType;
  required?: boolean;
};

type StartMethod = 'foto' | 'manuell';

type CapturedComponentDraft = {
  taskId: string;
  taskLabel: string;
  imageDataUrl: string;
  componentType: ComponentType;
  assembly: AssemblyOption;
  subComponent: string;
  identifiedValue: string;
  attributes: Record<string, string>;
  overallConfidence: number;
  identifiedValueConfidence: number;
  attributeConfidence: Record<string, number>;
  ocrText: string;
  provider: string;
  notes: string;
};

type PendingDuplicateAction = {
  payload: CreateAggregateComponentPayload;
  source:
    | {
        kind: 'capture';
        draft: CapturedComponentDraft;
      }
    | {
        kind: 'manual';
        summary: string;
      };
  candidateIds: string[];
  selectedCandidateId: string;
};

type RoundStatus = 'OK' | 'Atgard kravs' | 'Akut';

const ASSEMBLY_OPTIONS = ['Aggregat', 'Motor', 'Fl\u00e4kt', '\u00d6vrigt'] as const;
type AssemblyOption = (typeof ASSEMBLY_OPTIONS)[number];

const SUB_COMPONENT_PRESETS: Record<AssemblyOption, string[]> = {
  Motor: ['Motorskylt', 'Remskiva', 'Bussning', 'Lager'],
  Fl\u00e4kt: ['Remskiva', 'Bussning', 'Lager'],
  Aggregat: ['Kilrem', 'Filter', 'Kolfilter'],
  \u00d6vrigt: ['Notering']
};

const DEPARTMENT_PRESETS = [
  '\u00c5C2',
  'Biorening 1',
  'Biorening 2',
  'IMM',
  'Kokeri',
  'PM 1',
  'PM 2',
  'Renseri',
  'RF 3',
  'Silstation/Degern\u00e4s'
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
    description: 'Remskiva namn.',
    componentType: 'Remskiva'
  },
  {
    id: 'lager',
    label: 'Lager',
    description: 'Lager fram och bak.',
    componentType: 'Lager'
  },
  {
    id: 'motor',
    label: 'Motor',
    description: 'Motormodell, effekt och volt.',
    componentType: 'Motor'
  },
  {
    id: 'flakt',
    label: 'Fl\u00e4kt',
    description: 'Fl\u00e4kttyp, diameter och rotationsriktning.',
    componentType: 'Fl\u00e4kt'
  }
];

const REQUIRED_TASK_IDS = CAPTURE_TASKS.filter((task) => task.required).map(
  (task) => task.id
);
const COMPONENT_TYPE_OPTIONS = Object.keys(COMPONENT_FIELD_CONFIG) as ComponentType[];

function toPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatDateTimeSv(value: string | undefined): string {
  if (!value) {
    return '-';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString('sv-SE');
}

function formatEventMetadata(metadata: Record<string, string>): string {
  const entries = Object.entries(metadata).filter(([, value]) => value?.trim());
  if (!entries.length) {
    return '';
  }

  return entries
    .slice(0, 6)
    .map(([key, value]) => `${formatAttributeLabel(key)}: ${value}`)
    .join(' | ');
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

  if (
    /(OPENAI|QUOTA|RESOURCE|EXHAUSTED|ERROR|HTTP|RATE|API)/.test(
      normalized
    )
  ) {
    return false;
  }

  return /[A-Z]/.test(normalized) && /[0-9]/.test(normalized);
}

function extractSystemPositionCandidateFromNotes(value: string | undefined): string {
  if (!value) {
    return '';
  }

  const matches = value.matchAll(
    /(OCR-kandidat|Direkt-kandidat)\s*:\s*([A-Z0-9-]{4,24})/gi
  );

  for (const match of matches) {
    const candidate = normalizeSystemPositionId(match[2]);
    if (isUsableDetectedSystemPositionId(candidate)) {
      return candidate;
    }
  }

  return '';
}

function scoreSystemAnalysis(analysis: SystemPositionAnalysis): number {
  const normalizedId = normalizeSystemPositionId(analysis.systemPositionId);
  let score = clampDraftConfidence(analysis.confidence) * 100;

  if (isUsableDetectedSystemPositionId(normalizedId)) {
    score += 42;
  } else {
    score -= 35;
  }

  if (/^\d{3}(AG|FL|SE)\d{3,4}$/.test(normalizedId)) {
    score += 6;
  }

  if (normalizedId.length === 9) {
    score -= 1.2;
  }

  if (analysis.provider?.includes('local-tesseract-idline')) {
    score += 3;
  }

  if (/kunde inte|manuell|fallback/i.test(analysis.notes ?? '')) {
    score -= 8;
  }

  return score;
}

function chooseBestSystemAnalysis(candidates: SystemPositionAnalysis[]): SystemPositionAnalysis {
  const ranked = [...candidates];
  ranked.sort((a, b) => scoreSystemAnalysis(b) - scoreSystemAnalysis(a));
  return ranked[0];
}

function getDefaultScopeForTask(task: CaptureTask): {
  assembly: AssemblyOption;
  subComponent: string;
} {
  switch (task.id) {
    case 'motor':
      return { assembly: 'Motor', subComponent: 'Motorskylt' };
    case 'flakt':
      return { assembly: 'Fl\u00e4kt', subComponent: 'Lager' };
    case 'remskiva':
      return { assembly: 'Motor', subComponent: 'Remskiva' };
    case 'lager':
      return { assembly: 'Motor', subComponent: 'Lager' };
    case 'kilrem':
      return { assembly: 'Aggregat', subComponent: 'Kilrem' };
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
    case 'Fl\u00e4kt':
      return { assembly: 'Fl\u00e4kt', subComponent: 'Lager' };
    case 'Motorskylt':
      return { assembly: 'Motor', subComponent: 'Motorskylt' };
    case 'Remskiva':
      return { assembly: 'Motor', subComponent: 'Remskiva' };
    case 'Bussning':
      return { assembly: 'Motor', subComponent: 'Bussning' };
    case 'Axeldiameter':
      return { assembly: 'Motor', subComponent: 'Axeldiameter' };
    case 'Lager':
      return { assembly: 'Motor', subComponent: 'Lager' };
    case 'Kilrem':
      return { assembly: 'Aggregat', subComponent: 'Kilrem' };
    case 'Filter':
      return { assembly: 'Aggregat', subComponent: 'Filter' };
    case 'Kolfilter':
      return { assembly: 'Aggregat', subComponent: 'Kolfilter' };
    case '\u00d6vrigt':
      return { assembly: '\u00d6vrigt', subComponent: 'Notering' };
    default:
      return { assembly: '\u00d6vrigt', subComponent: componentType };
  }
}

const SUB_COMPONENT_COMPONENT_TYPE_MAP: Record<string, ComponentType> = {
  motorskylt: 'Motorskylt',
  remskiva: 'Remskiva',
  bussning: 'Bussning',
  axeldiameter: 'Axeldiameter',
  lager: 'Lager',
  kilrem: 'Kilrem',
  filter: 'Filter',
  kolfilter: 'Kolfilter',
  notering: '\u00d6vrigt'
};

const MULTI_ENTRY_COMPONENT_TYPES = new Set<ComponentType>([
  'Filter',
  'Kolfilter',
  '\u00d6vrigt'
]);

function normalizeScopeToken(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function resolveComponentTypeFromScope(
  assembly: AssemblyOption,
  subComponent: string
): ComponentType {
  const assemblyToken = normalizeScopeToken(assembly);
  const subToken = normalizeScopeToken(subComponent);

  if (assemblyToken === 'ovrigt') {
    return '\u00d6vrigt';
  }

  if (subToken in SUB_COMPONENT_COMPONENT_TYPE_MAP) {
    return SUB_COMPONENT_COMPONENT_TYPE_MAP[subToken];
  }

  if (assemblyToken === 'aggregat') {
    return 'Kilrem';
  }

  if (assemblyToken === 'motor' || assemblyToken === 'flakt') {
    return 'Lager';
  }

  return '\u00d6vrigt';
}

function splitManualLines(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function buildIdentifiedValue(
  componentType: ComponentType,
  identifiedValueFallback: string,
  attributes: Record<string, string>
): string {
  const direct = identifiedValueFallback.trim();
  if (direct) {
    return direct;
  }

  if (componentType === 'Lager') {
    const front = attributes.lagerFram?.trim();
    const back = attributes.lagerBak?.trim();

    if (front && back) {
      return `Fram: ${front}, Bak: ${back}`;
    }

    return front || back || '';
  }

  if (componentType === 'Remskiva') {
    return attributes.remskivaNamn?.trim() || '';
  }

  if (componentType === 'Bussning') {
    return attributes.bussningStorlek?.trim() || '';
  }

  if (componentType === 'Axeldiameter') {
    const mm = attributes.axeldiameterMm?.trim();
    return mm ? `${mm} mm` : '';
  }

  if (componentType === 'Motorskylt') {
    return attributes.motorModell?.trim() || '';
  }

  if (componentType === 'Filter' || componentType === 'Kolfilter') {
    return attributes.filterNamn?.trim() || '';
  }

  if (componentType === 'Kilrem') {
    const profil = attributes.profil?.trim();
    const langd = attributes.langd?.trim();
    const antal = attributes.antal?.trim();
    return [profil, langd, antal ? `antal ${antal}` : '']
      .filter(Boolean)
      .join(' ');
  }

  return '';
}

function getScopedFieldConfig(
  componentType: ComponentType,
  assembly: AssemblyOption
): ComponentFieldConfig[] {
  const baseConfig = COMPONENT_FIELD_CONFIG[componentType];

  if (componentType === 'Lager' && normalizeScopeToken(assembly) === 'flakt') {
    const singleField = baseConfig.find((field) => field.key === 'lagerFram');
    if (singleField) {
      return [{ ...singleField, label: 'Lager' }];
    }
  }

  return baseConfig;
}

function sanitizeAttributesForScope(
  componentType: ComponentType,
  assembly: AssemblyOption,
  attributes: Record<string, string>
): Record<string, string> {
  if (componentType === 'Lager' && normalizeScopeToken(assembly) === 'flakt') {
    return {
      ...attributes,
      lagerBak: ''
    };
  }

  return attributes;
}

function isMultiEntryComponentType(componentType: ComponentType): boolean {
  return MULTI_ENTRY_COMPONENT_TYPES.has(componentType);
}

function formatAttributeLabel(key: string): string {
  if (!key) {
    return '';
  }

  const withSpaces = key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim();

  return withSpaces.charAt(0).toUpperCase() + withSpaces.slice(1);
}

function normalizeCompareToken(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? '';
}

function clampDraftConfidence(value: number | undefined): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 0.5;
  }

  return Math.max(0, Math.min(1, value));
}

function createFieldConfidenceMap(
  componentType: ComponentType,
  fallback = 0.5
): Record<string, number> {
  const result: Record<string, number> = {};
  for (const field of COMPONENT_FIELD_CONFIG[componentType]) {
    result[field.key] = clampDraftConfidence(fallback);
  }

  return result;
}

export default function HomePage() {
  const [mode, setMode] = useState<AppMode>('lagg-till');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [startMethod, setStartMethod] = useState<StartMethod | null>(null);

  const [selectedTaskId, setSelectedTaskId] = useState<string>('skylt');
  const [capturedPhotos, setCapturedPhotos] = useState<Record<string, string>>({});

  const [systemPositionId, setSystemPositionId] = useState('');
  const [flSystemPositionId, setFlSystemPositionId] = useState('');
  const [seSystemPositionId, setSeSystemPositionId] = useState('');
  const [department, setDepartment] = useState('');
  const [position, setPosition] = useState('');
  const [aggregateNotes, setAggregateNotes] = useState('');

  const [currentAggregate, setCurrentAggregate] = useState<AggregateRecord | null>(null);
  const [isSavingAggregate, setIsSavingAggregate] = useState(false);

  const [captureAssembly, setCaptureAssembly] = useState<AssemblyOption>('Motor');
  const [captureSubComponent, setCaptureSubComponent] = useState('Motorskylt');
  const [capturedComponentDraft, setCapturedComponentDraft] =
    useState<CapturedComponentDraft | null>(null);
  const [capturedComponentQueue, setCapturedComponentQueue] = useState<
    CapturedComponentDraft[]
  >([]);
  const [isSavingCaptureDraft, setIsSavingCaptureDraft] = useState(false);
  const [isResolvingDuplicate, setIsResolvingDuplicate] = useState(false);
  const [pendingDuplicateAction, setPendingDuplicateAction] =
    useState<PendingDuplicateAction | null>(null);
  const [showManualPanel, setShowManualPanel] = useState(false);
  const cameraTriggerRef = useRef<(() => void) | null>(null);
  const [activeVisitId, setActiveVisitId] = useState('');
  const [activeVisitStartedAt, setActiveVisitStartedAt] = useState('');
  const [isStartingVisit, setIsStartingVisit] = useState(false);

  const [manualComponentType, setManualComponentType] = useState<ComponentType>('Kilrem');
  const [manualAssembly, setManualAssembly] = useState<AssemblyOption>('Aggregat');
  const [manualSubComponent, setManualSubComponent] = useState('Kilrem');
  const [manualValue, setManualValue] = useState('');
  const [manualExtraValues, setManualExtraValues] = useState('');
  const [manualAttributes, setManualAttributes] = useState<Record<string, string>>(
    () => createEmptyAttributes('Kilrem')
  );
  const [manualNotes, setManualNotes] = useState('');
  const [isSavingManual, setIsSavingManual] = useState(false);

  const [editingComponentId, setEditingComponentId] = useState<string | null>(null);
  const [editingComponentType, setEditingComponentType] = useState<ComponentType>('Kilrem');
  const [editingAssembly, setEditingAssembly] = useState<AssemblyOption>('Aggregat');
  const [editingSubComponent, setEditingSubComponent] = useState('Kilrem');
  const [editingIdentifiedValue, setEditingIdentifiedValue] = useState('');
  const [editingAttributes, setEditingAttributes] = useState<Record<string, string>>(
    () => createEmptyAttributes('Kilrem')
  );
  const [editingNotes, setEditingNotes] = useState('');
  const [isSavingComponentEdit, setIsSavingComponentEdit] = useState(false);
  const [deletingComponentId, setDeletingComponentId] = useState<string | null>(null);
  const [deletingAggregateId, setDeletingAggregateId] = useState<string | null>(null);

  const [searchResults, setSearchResults] = useState<AggregateRecord[]>([]);
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [expandedLibraryAggregateId, setExpandedLibraryAggregateId] = useState<string | null>(
    null
  );
  const [aggregateEventsById, setAggregateEventsById] = useState<
    Record<string, AggregateEvent[]>
  >({});
  const [aggregateEventErrorById, setAggregateEventErrorById] = useState<
    Record<string, string>
  >({});
  const [loadingAggregateEventsId, setLoadingAggregateEventsId] = useState<string | null>(
    null
  );
  const [filterRows, setFilterRows] = useState<FilterListRow[]>([]);
  const [filterColumns, setFilterColumns] = useState<string[]>([]);
  const [filterQuery, setFilterQuery] = useState('');
  const [filterFile, setFilterFile] = useState<File | null>(null);
  const [totalFilterRows, setTotalFilterRows] = useState(0);
  const [filteredFilterRows, setFilteredFilterRows] = useState(0);
  const [isLoadingFilterList, setIsLoadingFilterList] = useState(false);
  const [isImportingFilterList, setIsImportingFilterList] = useState(false);

  const [isProcessingCapture, setIsProcessingCapture] = useState(false);
  const [isSearching, setIsSearching] = useState(false);

  const [roundAggregateId, setRoundAggregateId] = useState('');
  const [roundComponentType, setRoundComponentType] = useState<ComponentType>('Övrigt');
  const [roundAssembly, setRoundAssembly] = useState<AssemblyOption>('Övrigt');
  const [roundSubComponent, setRoundSubComponent] = useState('Notering');
  const [roundStatus, setRoundStatus] = useState<RoundStatus>('OK');
  const [roundIdentifiedValue, setRoundIdentifiedValue] = useState('');
  const [roundNotes, setRoundNotes] = useState('');
  const [roundAction, setRoundAction] = useState('');
  const [isSavingRoundNote, setIsSavingRoundNote] = useState(false);

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

  const filteredSearchResults = useMemo(() => {
    const departmentToken = departmentFilter.trim().toLowerCase();
    if (!departmentToken) {
      return [];
    }

    const scoped = searchResults.filter(
      (item) => (item.department ?? '').trim().toLowerCase() === departmentToken
    );

    return scoped.sort((a, b) => {
      const aTime = new Date(a.updatedAt).getTime();
      const bTime = new Date(b.updatedAt).getTime();
      return bTime - aTime;
    });
  }, [departmentFilter, searchResults]);

  const roundAggregate = useMemo(
    () => searchResults.find((aggregate) => aggregate.id === roundAggregateId) ?? null,
    [roundAggregateId, searchResults]
  );

  const roundSubComponentSuggestions = useMemo(
    () => SUB_COMPONENT_PRESETS[roundAssembly] ?? [],
    [roundAssembly]
  );

  const roundEvents = useMemo(() => {
    if (!roundAggregateId) {
      return [];
    }

    return (aggregateEventsById[roundAggregateId] ?? []).filter((event) =>
      event.eventType.startsWith('round_') || event.eventType.startsWith('visit_')
    );
  }, [aggregateEventsById, roundAggregateId]);

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
  const captureDraftSubComponentSuggestions = useMemo(
    () =>
      capturedComponentDraft
        ? (SUB_COMPONENT_PRESETS[capturedComponentDraft.assembly] ?? [])
        : [],
    [capturedComponentDraft]
  );
  const manualAllowsMultiple = isMultiEntryComponentType(manualComponentType);
  const manualFieldConfig = useMemo(
    () => getScopedFieldConfig(manualComponentType, manualAssembly),
    [manualAssembly, manualComponentType]
  );
  const editingFieldConfig = useMemo(
    () => getScopedFieldConfig(editingComponentType, editingAssembly),
    [editingAssembly, editingComponentType]
  );
  const captureDraftFieldConfig = useMemo(() => {
    if (!capturedComponentDraft) {
      return [];
    }

    return getScopedFieldConfig(
      capturedComponentDraft.componentType,
      capturedComponentDraft.assembly
    );
  }, [capturedComponentDraft]);
  const pendingDuplicateCandidates = useMemo(() => {
    if (!pendingDuplicateAction || !currentAggregate) {
      return [];
    }

    const idSet = new Set(pendingDuplicateAction.candidateIds);
    return currentAggregate.components.filter((component) => idSet.has(component.id));
  }, [currentAggregate, pendingDuplicateAction]);

  const clearFeedback = () => {
    setError(null);
    setStatus('');
  };

  const resetComponentEditing = () => {
    setEditingComponentId(null);
    setEditingComponentType('Kilrem');
    setEditingAssembly('Aggregat');
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
    setCapturedComponentDraft(null);
    setCapturedComponentQueue([]);
    setPendingDuplicateAction(null);
    setCurrentAggregate(null);
    setActiveVisitId('');
    setActiveVisitStartedAt('');
    setSystemPositionId('');
    setFlSystemPositionId('');
    setSeSystemPositionId('');
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
    setManualExtraValues('');
    setManualAttributes(createEmptyAttributes('Kilrem'));
    setManualNotes('');
    setShowManualPanel(false);
    setRoundAggregateId('');
    setRoundAssembly('Övrigt');
    setRoundSubComponent('Notering');
    setRoundComponentType('Övrigt');
    setRoundStatus('OK');
    setRoundIdentifiedValue('');
    setRoundNotes('');
    setRoundAction('');
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
    setStatus('');
  };

  const buildAggregatePayload = (systemId: string) => ({
    systemPositionId: normalizeSystemPositionId(systemId),
    flSystemPositionId: normalizeSystemPositionId(flSystemPositionId) || undefined,
    seSystemPositionId: normalizeSystemPositionId(seSystemPositionId) || undefined,
    position: position.trim() || undefined,
    department: department.trim() || undefined,
    notes: aggregateNotes.trim() || undefined
  });

  const findDuplicateCandidates = (
    aggregate: AggregateRecord,
    payload: CreateAggregateComponentPayload
  ) => {
    const componentType = normalizeCompareToken(payload.componentType);
    const assembly = normalizeCompareToken(payload.assembly);
    const subComponent = normalizeCompareToken(payload.subComponent);

    return aggregate.components.filter((component) => {
      if (normalizeCompareToken(component.componentType) !== componentType) {
        return false;
      }

      if (normalizeCompareToken(component.assembly) !== assembly) {
        return false;
      }

      return normalizeCompareToken(component.subComponent) === subComponent;
    });
  };

  const applySavedAggregate = (updated: AggregateRecord) => {
    setCurrentAggregate(updated);
    syncAggregateInSearchResults(updated);
  };

  const startVisitForAggregate = async (
    aggregate: AggregateRecord,
    reason: 'manual' | 'auto' | 'rondering'
  ): Promise<string> => {
    if (activeVisitId && currentAggregate?.id === aggregate.id) {
      return activeVisitId;
    }

    const visitId =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `visit-${Date.now()}`;
    const startedAt = new Date().toISOString();

    setIsStartingVisit(true);
    try {
      await createAggregateEvent(aggregate.id, {
        eventType: 'visit_started',
        message: 'Nytt besök startat.',
        metadata: {
          visitId,
          reason,
          startedAt
        }
      });
      setActiveVisitId(visitId);
      setActiveVisitStartedAt(startedAt);
      void loadAggregateEvents(aggregate.id, true);
      return visitId;
    } catch (visitError) {
      setError(`Kunde inte starta besök: ${String(visitError)}`);
      return '';
    } finally {
      setIsStartingVisit(false);
    }
  };

  const handleTaskSelection = (taskId: string) => {
    clearFeedback();
    const task = findTask(taskId);
    if (!aggregateReady && task.id !== 'skylt') {
      setError('Steg 1 är alltid objektskylt. Skapa aggregatet först.');
      return;
    }

    const defaults = getDefaultScopeForTask(task);
    setCaptureAssembly(defaults.assembly);
    setCaptureSubComponent(defaults.subComponent);
    setSelectedTaskId(taskId);

    const shouldOpenCamera =
      !isProcessingCapture &&
      !(task.id === 'skylt' && startMethod === 'manuell' && !aggregateReady);

    if (shouldOpenCamera) {
      cameraTriggerRef.current?.();
    }
  };

  const ensureAggregate = async (forcedSystemPositionId?: string): Promise<AggregateRecord> => {
    if (currentAggregate) {
      return currentAggregate;
    }

    const candidateId = normalizeSystemPositionId(forcedSystemPositionId || systemPositionId);
    if (!candidateId) {
      throw new Error('AG-systemposition saknas. Ange ID manuellt och fotografera objektskylt igen.');
    }

    const created = await createAggregate(buildAggregatePayload(candidateId));

    setCurrentAggregate(created);
    syncAggregateInSearchResults(created);
    setSystemPositionId(created.systemPositionId);
    setFlSystemPositionId(created.flSystemPositionId ?? '');
    setSeSystemPositionId(created.seSystemPositionId ?? '');
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
      const query = queryOverride ?? '';
      const results = await searchAggregates(query);
      setSearchResults(results);
      setStatus(`${results.length} träffar i biblioteket.`);
    } catch (searchError) {
      setError(`Kunde inte hämta biblioteket: ${String(searchError)}`);
    } finally {
      setIsSearching(false);
    }
  };

  const loadAggregateEvents = async (aggregateId: string, force = false) => {
    if (!force && aggregateEventsById[aggregateId]) {
      return;
    }

    setLoadingAggregateEventsId(aggregateId);
    setAggregateEventErrorById((current) => {
      const next = { ...current };
      delete next[aggregateId];
      return next;
    });

    try {
      const events = await getAggregateEvents(aggregateId, 120);
      setAggregateEventsById((current) => ({
        ...current,
        [aggregateId]: events
      }));
    } catch (eventsError) {
      const message = `Kunde inte hamta handelser: ${String(eventsError)}`;
      setAggregateEventErrorById((current) => ({
        ...current,
        [aggregateId]: message
      }));
    } finally {
      setLoadingAggregateEventsId((current) =>
        current === aggregateId ? null : current
      );
    }
  };

  const handleToggleLibraryAggregate = (aggregateId: string) => {
    if (expandedLibraryAggregateId === aggregateId) {
      setExpandedLibraryAggregateId(null);
      return;
    }

    setExpandedLibraryAggregateId(aggregateId);
    void loadAggregateEvents(aggregateId);
  };

  const handleLoadFilterList = async (queryOverride?: string) => {
    clearFeedback();
    setIsLoadingFilterList(true);

    try {
      const query = queryOverride ?? filterQuery;
      const result = await searchFilterList(query, 2000);
      setFilterRows(result.rows);
      setFilterColumns(result.columns);
      setTotalFilterRows(result.totalRows);
      setFilteredFilterRows(result.filteredRows);
      setStatus(
        query.trim()
          ? `${result.filteredRows} filterrader matchar "${query.trim()}".`
          : `${result.totalRows} filterrader laddade.`
      );
    } catch (filterError) {
      setError(`Kunde inte hamta filterlista: ${String(filterError)}`);
    } finally {
      setIsLoadingFilterList(false);
    }
  };

  const handleImportFilterList = async () => {
    clearFeedback();

    if (!filterFile) {
      setError('Valj en Excel-fil for filterlistan.');
      return;
    }

    setIsImportingFilterList(true);

    try {
      const result = await importFilterListFile(filterFile);
      setFilterFile(null);
      setFilterQuery('');
      const syncSummary =
        typeof result.insertedFilterComponents === 'number'
          ? ` Synk: +${result.insertedFilterComponents} filter pa ${result.syncedAggregates ?? 0} aggregat.`
          : '';
      const warningSummary = result.warnings?.length
        ? ` Varning: ${result.warnings.slice(0, 2).join(' | ')}`
        : '';
      const zeroRowsSummary =
        result.importedRows === 0 ? ' Inga datarader kunde tolkas fran filen.' : '';
      setStatus(
        `Filterlista importerad (${result.importedRows}/${result.totalRows} rader).${syncSummary}${zeroRowsSummary}${warningSummary}`
      );
      await handleLoadFilterList('');
    } catch (importError) {
      setError(`Kunde inte importera filterlista: ${String(importError)}`);
    } finally {
      setIsImportingFilterList(false);
    }
  };

  const handleCapture = async (imageDataUrl: string) => {
    clearFeedback();
    setIsProcessingCapture(true);

    const task = selectedTask;

    try {
      if (task.id === 'skylt') {
        setStatus('Bild mottagen. Läser objektskylt med AI + lokal OCR...');
        const analysisCandidates: SystemPositionAnalysis[] = [];
        const diagnostics: string[] = [];

        const [serverAnalysis, localAnalysis] = await Promise.allSettled([
          analyzeSystemPosition(imageDataUrl),
          analyzeSystemPositionLocally(imageDataUrl)
        ]);

        if (serverAnalysis.status === 'fulfilled') {
          analysisCandidates.push(serverAnalysis.value);
        } else {
          diagnostics.push(`Server-OCR: ${String(serverAnalysis.reason).slice(0, 120)}`);
        }

        if (localAnalysis.status === 'fulfilled') {
          analysisCandidates.push(localAnalysis.value);
        } else {
          diagnostics.push(`Lokal OCR: ${String(localAnalysis.reason).slice(0, 120)}`);
        }

        if (!analysisCandidates.length) {
          analysisCandidates.push({
            systemPositionId: 'MANUELL-KRAVS',
            confidence: 0.1,
            notes: diagnostics.join(' | ') || 'Ingen OCR-källa gav resultat.',
            provider: 'fallback',
            requiresManualConfirmation: true
          });
        }

        const analysis = chooseBestSystemAnalysis(analysisCandidates);

        const aiId = normalizeSystemPositionId(analysis.systemPositionId);
        const noteId = extractSystemPositionCandidateFromNotes(analysis.notes);
        const secondaryCandidate =
          analysisCandidates
            .filter((candidate) => candidate !== analysis)
            .map((candidate) => normalizeSystemPositionId(candidate.systemPositionId))
            .find((candidate) => isUsableDetectedSystemPositionId(candidate)) ?? '';
        const manualId = normalizeSystemPositionId(systemPositionId);
        const aiIdIsUsable = isUsableDetectedSystemPositionId(aiId);
        const noteIdIsUsable = isUsableDetectedSystemPositionId(noteId);
        const highConfidenceAi = aiIdIsUsable && analysis.confidence >= 0.4;
        const resolvedId = highConfidenceAi
          ? aiId
          : manualId ||
            (aiIdIsUsable ? aiId : noteIdIsUsable ? noteId : secondaryCandidate || '');

        if (!resolvedId) {
          const reason = analysis.notes?.trim()
            ? ` Detektering: ${analysis.notes.trim().slice(0, 180)}`
            : '';
          throw new Error(
            `Kunde inte lasa ID fran skylten. Ange systemposition manuellt och prova igen med ny bild.${reason}`
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

        applySavedAggregate(aggregate);
        if (!activeVisitId) {
          await startVisitForAggregate(aggregate, 'auto');
        }
        const nextCaptured = { ...capturedPhotos, skylt: imageDataUrl };
        setCapturedPhotos(nextCaptured);
        void persistLocalPhoto(aggregate.id, 'skylt', imageDataUrl);
        setSelectedTaskId(getNextTaskId('skylt', nextCaptured));

        const analysisNote = analysis.notes?.trim() ? ` ${analysis.notes.trim()}` : '';
        const providerText = analysis.provider ? ` [${analysis.provider}]` : '';
        const secondaryText =
          secondaryCandidate && secondaryCandidate !== resolvedId
            ? ` Reservkandidat: ${secondaryCandidate}.`
            : '';
        const usedManual = Boolean(manualId) && resolvedId === manualId && !highConfidenceAi;
        const usedLowConfidenceAi = resolvedId === aiId && aiIdIsUsable && !highConfidenceAi;
        const usedNoteFallback = resolvedId === noteId && noteIdIsUsable && !highConfidenceAi;
        setStatus(
          usedManual
            ? `Objektskylt sparad med manuellt ID ${resolvedId}.${providerText}${secondaryText}${analysisNote}`
            : usedLowConfidenceAi
              ? `Objektskylt tolkad med lagre sakerhet (${toPercent(
                  analysis.confidence
                )}) och sparad som ${resolvedId}.${providerText}${secondaryText} Bekrafta ID.${analysisNote}`
            : usedNoteFallback
              ? `Objektskylt sparad med OCR-kandidat ${resolvedId}.${providerText}${secondaryText} Bekrafta ID manuellt.${analysisNote}`
            : `Objektskylt tolkad (${toPercent(
                analysis.confidence
              )}) och aggregat sparat.${providerText}${secondaryText} Fortsätt med komponentfoton.${analysisNote}`
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
      let overallConfidence = 0.2;
      let identifiedValueConfidence = 0.2;
      let attributeConfidence: Record<string, number> = createFieldConfidenceMap(
        task.componentType,
        0.2
      );
      let ocrText = '';
      let provider = 'fallback';
      let note = 'Automatiskt registrerad utan säker AI-tolkning.';
      setStatus(`Bild mottagen. Laser ${task.label.toLowerCase()} med lokal OCR...`);

      try {
        const analysis = await analyzeComponentImage(task.componentType, imageDataUrl);
        identifiedValue = analysis.identifiedValue?.trim() || identifiedValue;
        attributes = normalizeAutoAttributes(task.componentType, analysis.suggestedAttributes);
        overallConfidence = clampDraftConfidence(analysis.confidence);
        identifiedValueConfidence = clampDraftConfidence(
          analysis.identifiedValueConfidence ?? analysis.confidence
        );
        provider = analysis.provider || 'ocr';
        ocrText = analysis.ocrText?.trim() ?? '';
        for (const field of COMPONENT_FIELD_CONFIG[task.componentType]) {
          attributeConfidence[field.key] = clampDraftConfidence(
            analysis.attributeConfidence?.[field.key] ?? analysis.confidence
          );
        }
        note = `Automatiskt registrerad (${toPercent(analysis.confidence)}): ${analysis.notes}`;
      } catch (analysisError) {
        attributes = normalizeAutoAttributes(task.componentType, undefined);
        note = `OCR/AI kunde inte lasa sakert: ${String(analysisError).slice(0, 140)}`;
      }

      const nextCaptured = { ...capturedPhotos, [task.id]: imageDataUrl };
      setCapturedPhotos(nextCaptured);
      void persistLocalPhoto(currentAggregate.id, task.id, imageDataUrl);

      const normalizedSubComponent = captureSubComponent.trim() || task.label;
      const nextDraft: CapturedComponentDraft = {
        taskId: task.id,
        taskLabel: task.label,
        imageDataUrl,
        componentType: task.componentType,
        identifiedValue,
        notes: note,
        assembly: captureAssembly,
        subComponent: normalizedSubComponent,
        attributes,
        overallConfidence,
        identifiedValueConfidence,
        attributeConfidence,
        ocrText,
        provider
      };

      if (capturedComponentDraft) {
        setCapturedComponentQueue((current) => [...current, nextDraft]);
      } else {
        setCapturedComponentDraft(nextDraft);
      }

      const scopeText = [captureAssembly, normalizedSubComponent]
        .filter(Boolean)
        .join(' / ');
      setStatus(
        `${task.label} tolkad. Kontrollera komponentutkastet och spara till biblioteket${scopeText ? ` (${scopeText})` : ''}.${capturedComponentDraft ? ` (${capturedComponentQueue.length + 1} i kö)` : ''}`
      );
    } catch (captureError) {
      setError(`Kunde inte slutföra ${task.label.toLowerCase()}: ${String(captureError)}`);
    } finally {
      setIsProcessingCapture(false);
    }
  };

  const handleCaptureDraftAssemblyChange = (nextAssembly: AssemblyOption) => {
    setCapturedComponentDraft((current) => {
      if (!current) {
        return current;
      }

      const nextSubComponent = (SUB_COMPONENT_PRESETS[nextAssembly] ?? [])[0] ?? 'Notering';
      const nextType = resolveComponentTypeFromScope(nextAssembly, nextSubComponent);

      return {
        ...current,
        assembly: nextAssembly,
        subComponent: nextSubComponent,
        componentType: nextType,
        attributes:
          nextType === current.componentType
            ? current.attributes
            : createEmptyAttributes(nextType),
        attributeConfidence:
          nextType === current.componentType
            ? current.attributeConfidence
            : createFieldConfidenceMap(nextType, current.overallConfidence)
      };
    });
  };

  const handleCaptureDraftSubComponentChange = (nextSubComponent: string) => {
    setCapturedComponentDraft((current) => {
      if (!current) {
        return current;
      }

      const nextType = resolveComponentTypeFromScope(current.assembly, nextSubComponent);
      return {
        ...current,
        subComponent: nextSubComponent,
        componentType: nextType,
        attributes:
          nextType === current.componentType
            ? current.attributes
            : createEmptyAttributes(nextType),
        attributeConfidence:
          nextType === current.componentType
            ? current.attributeConfidence
            : createFieldConfidenceMap(nextType, current.overallConfidence)
      };
    });
  };

  const handleSaveCaptureDraft = async () => {
    clearFeedback();

    if (!aggregateReady || !currentAggregate || !capturedComponentDraft) {
      setError('Ingen komponenttolkning att spara.');
      return;
    }

    if (!capturedComponentDraft.assembly.trim()) {
      setError('Huvudkategori kravs.');
      return;
    }

    if (!capturedComponentDraft.subComponent.trim()) {
      setError('Underkategori kravs.');
      return;
    }

    const resolvedType = resolveComponentTypeFromScope(
      capturedComponentDraft.assembly,
      capturedComponentDraft.subComponent.trim()
    );
    const scopedAttributes = sanitizeAttributesForScope(
      resolvedType,
      capturedComponentDraft.assembly,
      capturedComponentDraft.attributes
    );
    const identifiedValue = buildIdentifiedValue(
      resolvedType,
      capturedComponentDraft.identifiedValue,
      scopedAttributes
    );

    if (!identifiedValue.trim()) {
      setError('Fyll i komponentdata innan sparning.');
      return;
    }

    const missing = getMissingRequiredFields(resolvedType, scopedAttributes).map(
      (field) => field.label
    );

    if (missing.length > 0) {
      setError(`Fyll i obligatoriska falt: ${missing.join(', ')}.`);
      return;
    }

    const payload: CreateAggregateComponentPayload = {
      componentType: resolvedType,
      identifiedValue: identifiedValue.trim(),
      notes: capturedComponentDraft.notes.trim() || undefined,
      assembly: capturedComponentDraft.assembly,
      subComponent: capturedComponentDraft.subComponent.trim(),
      attributes: scopedAttributes,
      visitId: activeVisitId || undefined
    };

    const duplicateCandidates = findDuplicateCandidates(currentAggregate, payload);
    if (duplicateCandidates.length > 0) {
      setPendingDuplicateAction({
        payload,
        source: {
          kind: 'capture',
          draft: capturedComponentDraft
        },
        candidateIds: duplicateCandidates.map((component) => component.id),
        selectedCandidateId: duplicateCandidates[0].id
      });
      return;
    }

    setIsSavingCaptureDraft(true);

    try {
      const updated = await addAggregateComponent(currentAggregate.id, payload);
      applySavedAggregate(updated);

      const nextTask = getNextTaskId(capturedComponentDraft.taskId, {
        ...capturedPhotos,
        [capturedComponentDraft.taskId]: capturedComponentDraft.imageDataUrl
      });

      setSelectedTaskId(nextTask);
      setStatus(
        `${capturedComponentDraft.taskLabel} sparad i biblioteket. Fortsatt med nasta fotopunkt eller ta fler bilder i samma kategori.`
      );

      if (capturedComponentQueue.length > 0) {
        const [nextDraft, ...rest] = capturedComponentQueue;
        setCapturedComponentQueue(rest);
        setCapturedComponentDraft(nextDraft);
      } else {
        setCapturedComponentDraft(null);
      }
    } catch (saveError) {
      setError(`Kunde inte spara komponentutkast: ${String(saveError)}`);
    } finally {
      setIsSavingCaptureDraft(false);
    }
  };

  const handleResolveDuplicateAction = async (mode: 'update' | 'new') => {
    clearFeedback();

    if (!currentAggregate || !pendingDuplicateAction) {
      return;
    }

    const source = pendingDuplicateAction.source;
    setIsResolvingDuplicate(true);

    try {
      const updated =
        mode === 'update'
          ? await updateAggregateComponent(
              currentAggregate.id,
              pendingDuplicateAction.selectedCandidateId,
              pendingDuplicateAction.payload
            )
          : await addAggregateComponent(currentAggregate.id, pendingDuplicateAction.payload);

      applySavedAggregate(updated);

      if (source.kind === 'capture') {
        const draft = source.draft;
        const nextTask = getNextTaskId(draft.taskId, {
          ...capturedPhotos,
          [draft.taskId]: draft.imageDataUrl
        });
        setSelectedTaskId(nextTask);
        setStatus(
          mode === 'update'
            ? `${draft.taskLabel} uppdaterade befintlig komponent i biblioteket.`
            : `${draft.taskLabel} sparad som ny komponentpost i biblioteket.`
        );

        if (capturedComponentQueue.length > 0) {
          const [nextDraft, ...rest] = capturedComponentQueue;
          setCapturedComponentQueue(rest);
          setCapturedComponentDraft(nextDraft);
        } else {
          setCapturedComponentDraft(null);
        }
      } else {
        const nextManualType = isKnownComponentType(
          pendingDuplicateAction.payload.componentType
        )
          ? pendingDuplicateAction.payload.componentType
          : manualComponentType;
        setManualValue('');
        setManualExtraValues('');
        setManualAttributes(createEmptyAttributes(nextManualType));
        setManualNotes('');
        setStatus(
          mode === 'update'
            ? 'Manuell post uppdaterade befintlig komponent.'
            : 'Manuell post sparad som ny komponent.'
        );
      }

      setPendingDuplicateAction(null);
    } catch (saveError) {
      setError(`Kunde inte slutföra dubletthantering: ${String(saveError)}`);
    } finally {
      setIsResolvingDuplicate(false);
    }
  };

  const handleRoundPhotoCapture = async (imageDataUrl: string) => {
    clearFeedback();

    try {
      const analysis = await analyzeComponentImage(roundComponentType, imageDataUrl);
      const attributes = normalizeAutoAttributes(
        roundComponentType,
        analysis.suggestedAttributes
      );
      const attributePreview = Object.entries(attributes)
        .filter(([, value]) => value?.trim() && value !== 'Ej avläst')
        .slice(0, 2)
        .map(([key, value]) => `${formatAttributeLabel(key)}: ${value}`)
        .join(' | ');

      setRoundIdentifiedValue(analysis.identifiedValue?.trim() || roundIdentifiedValue);
      setRoundNotes((current) => {
        const prefix = current.trim() ? `${current.trim()}\n` : '';
        const details = [
          `OCR ${toPercent(analysis.confidence)} (${analysis.provider})`,
          analysis.notes?.trim(),
          attributePreview ? `Fält: ${attributePreview}` : ''
        ]
          .filter(Boolean)
          .join(' | ');
        return `${prefix}${details}`.slice(0, 700);
      });
      setStatus('Ronderingsfoto avläst. Kontrollera värden och spara notering.');
    } catch (analysisError) {
      setError(`Kunde inte läsa ronderingsfoto: ${String(analysisError)}`);
    }
  };

  const handleSaveRoundNote = async () => {
    clearFeedback();

    if (!roundAggregate) {
      setError('Välj ett aggregat för rondering.');
      return;
    }

    if (!roundSubComponent.trim()) {
      setError('Underkategori krävs för rondering.');
      return;
    }

    if (!roundNotes.trim() && !roundAction.trim() && !roundIdentifiedValue.trim()) {
      setError('Lägg in notering, åtgärd eller identifierat värde.');
      return;
    }

    setIsSavingRoundNote(true);
    try {
      const currentVisit =
        activeVisitId && currentAggregate?.id === roundAggregate.id
          ? activeVisitId
          : await startVisitForAggregate(roundAggregate, 'rondering');

      await createAggregateEvent(roundAggregate.id, {
        eventType: 'round_note_added',
        message: `Rondering: ${roundStatus} (${roundAssembly} / ${roundSubComponent.trim()})`,
        metadata: {
          status: roundStatus,
          componentType: roundComponentType,
          assembly: roundAssembly,
          subComponent: roundSubComponent.trim(),
          identifiedValue: roundIdentifiedValue.trim(),
          notes: roundNotes.trim(),
          action: roundAction.trim(),
          visitId: currentVisit || ''
        }
      });

      setRoundIdentifiedValue('');
      setRoundNotes('');
      setRoundAction('');
      setStatus('Ronderingsnotering sparad.');
      void loadAggregateEvents(roundAggregate.id, true);
    } catch (roundError) {
      setError(`Kunde inte spara ronderingsnotering: ${String(roundError)}`);
    } finally {
      setIsSavingRoundNote(false);
    }
  };

  const handleSaveAggregateChanges = async () => {
    clearFeedback();

    if (!currentAggregate) {
      setError('Ingen aktiv aggregatpost att uppdatera.');
      return;
    }

    if (!systemPositionId.trim()) {
      setError('AG-systemposition krävs.');
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
      setSystemPositionId(updated.systemPositionId);
      setFlSystemPositionId(updated.flSystemPositionId ?? '');
      setSeSystemPositionId(updated.seSystemPositionId ?? '');
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
      setError('Ange AG-systemposition för att skapa aggregat manuellt.');
      return;
    }

    setIsSavingAggregate(true);

    try {
      const created = await ensureAggregate(candidateId);
      applySavedAggregate(created);
      if (!activeVisitId) {
        await startVisitForAggregate(created, 'manual');
      }

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

  const handleOpenAggregateForEditing = async (aggregate: AggregateRecord) => {
    resetComponentEditing();
    setCapturedComponentDraft(null);
    setCapturedComponentQueue([]);
    setPendingDuplicateAction(null);
    applySavedAggregate(aggregate);
    setActiveVisitId('');
    setActiveVisitStartedAt('');
    setStartMethod('foto');
    setIsAddModalOpen(false);
    setSystemPositionId(aggregate.systemPositionId);
    setFlSystemPositionId(aggregate.flSystemPositionId ?? '');
    setSeSystemPositionId(aggregate.seSystemPositionId ?? '');
    setDepartment(aggregate.department ?? '');
    setPosition(aggregate.position ?? '');
    setAggregateNotes(aggregate.notes ?? '');
    setCapturedPhotos({});
    setSelectedTaskId('kilrem');
    setMode('lagg-till');
    setStatus(`\u00d6ppnade aggregat ${aggregate.systemPositionId} f\u00f6r redigering.`);
    await startVisitForAggregate(aggregate, 'manual');
  };

  const handleStartNewVisit = async () => {
    clearFeedback();

    if (!currentAggregate) {
      setError('Öppna eller skapa ett aggregat först.');
      return;
    }

    const startedVisitId = await startVisitForAggregate(currentAggregate, 'manual');
    if (startedVisitId) {
      setStatus(
        `Nytt besök startat ${formatDateTimeSv(new Date().toISOString())} (${startedVisitId.slice(0, 8)}).`
      );
    }
  };

  const handleStartRoundVisit = async () => {
    clearFeedback();

    if (!roundAggregate) {
      setError('Välj ett aggregat i rondering.');
      return;
    }

    const startedVisitId = await startVisitForAggregate(roundAggregate, 'rondering');
    if (startedVisitId) {
      setStatus(
        `Ronderingsbesök startat ${formatDateTimeSv(
          new Date().toISOString()
        )} (${startedVisitId.slice(0, 8)}).`
      );
    }
  };

  const handleManualAssemblyChange = (nextAssembly: AssemblyOption) => {
    const nextSubComponent = (SUB_COMPONENT_PRESETS[nextAssembly] ?? [])[0] ?? 'Notering';
    const nextType = resolveComponentTypeFromScope(nextAssembly, nextSubComponent);
    setManualAssembly(nextAssembly);
    setManualSubComponent(nextSubComponent);
    setManualComponentType(nextType);
    setManualValue('');
    setManualExtraValues('');
    setManualAttributes(createEmptyAttributes(nextType));
    setManualNotes('');
  };

  const handleManualSubComponentChange = (nextSubComponent: string) => {
    const nextType = resolveComponentTypeFromScope(manualAssembly, nextSubComponent);
    setManualSubComponent(nextSubComponent);
    setManualComponentType(nextType);
    setManualValue('');
    setManualExtraValues('');
    setManualAttributes(createEmptyAttributes(nextType));
  };

  const handleRoundAssemblyChange = (nextAssembly: AssemblyOption) => {
    const nextSubComponent = (SUB_COMPONENT_PRESETS[nextAssembly] ?? [])[0] ?? 'Notering';
    const nextType = resolveComponentTypeFromScope(nextAssembly, nextSubComponent);
    setRoundAssembly(nextAssembly);
    setRoundSubComponent(nextSubComponent);
    setRoundComponentType(nextType);
  };

  const handleRoundSubComponentChange = (nextSubComponent: string) => {
    setRoundSubComponent(nextSubComponent);
    setRoundComponentType(resolveComponentTypeFromScope(roundAssembly, nextSubComponent));
  };

  const handleManualSave = async () => {
    clearFeedback();

    if (!aggregateReady || !currentAggregate) {
      setError('Skapa aggregatet via objektskylt forst innan manuell registrering.');
      return;
    }

    if (!manualAssembly.trim()) {
      setError('Huvudkategori kravs for manuell registrering.');
      return;
    }

    if (!manualSubComponent.trim()) {
      setError('Underkategori kravs for manuell registrering.');
      return;
    }

    const resolvedType = resolveComponentTypeFromScope(
      manualAssembly,
      manualSubComponent.trim()
    );
    const scopedAttributes = sanitizeAttributesForScope(
      resolvedType,
      manualAssembly,
      manualAttributes
    );

    const identifiedValue = buildIdentifiedValue(
      resolvedType,
      manualValue,
      scopedAttributes
    );

    const valuesToSave = [
      identifiedValue,
      ...(manualAllowsMultiple ? splitManualLines(manualExtraValues) : [])
    ].filter(Boolean);

    if (valuesToSave.length === 0) {
      setError('Fyll i uppgifter for vald underkategori innan sparning.');
      return;
    }

    const missing = getMissingRequiredFields(resolvedType, scopedAttributes).map(
      (field) => field.label
    );

    if (missing.length > 0) {
      setError(`Fyll i obligatoriska falt: ${missing.join(', ')}.`);
      return;
    }

    setIsSavingManual(true);

    try {
      let updated = currentAggregate;
      const basePayload = {
        componentType: resolvedType,
        assembly: manualAssembly,
        subComponent: manualSubComponent.trim(),
        attributes: scopedAttributes,
        notes: manualNotes.trim() || 'Manuellt registrerad post.',
        visitId: activeVisitId || undefined
      };

      if (valuesToSave.length === 1) {
        const payload: CreateAggregateComponentPayload = {
          ...basePayload,
          identifiedValue: valuesToSave[0]
        };
        const duplicateCandidates = findDuplicateCandidates(updated, payload);
        if (duplicateCandidates.length > 0) {
          setPendingDuplicateAction({
            payload,
            source: {
              kind: 'manual',
              summary: `${manualAssembly} / ${manualSubComponent.trim()}`
            },
            candidateIds: duplicateCandidates.map((component) => component.id),
            selectedCandidateId: duplicateCandidates[0].id
          });
          return;
        }
      }

      for (const value of valuesToSave) {
        updated = await addAggregateComponent(updated.id, {
          ...basePayload,
          identifiedValue: value,
          visitId: activeVisitId || undefined
        });
      }

      applySavedAggregate(updated);
      setManualValue('');
      setManualExtraValues('');
      setManualAttributes(createEmptyAttributes(resolvedType));
      setManualNotes('');
      setStatus(
        `${valuesToSave.length} post(er) sparade manuellt (${manualAssembly} / ${manualSubComponent.trim()}).`
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
    const componentAssembly =
      (component.assembly as AssemblyOption | undefined) ?? defaultScope.assembly;
    const baseAttributes = {
      ...createEmptyAttributes(componentType),
      ...component.attributes
    };
    const scopedAttributes =
      componentType === 'Lager' &&
      normalizeScopeToken(componentAssembly) === 'flakt' &&
      !baseAttributes.lagerFram?.trim() &&
      baseAttributes.lagerBak?.trim()
        ? {
            ...baseAttributes,
            lagerFram: baseAttributes.lagerBak,
            lagerBak: ''
          }
        : baseAttributes;

    setEditingComponentId(component.id);
    setEditingComponentType(componentType);
    setEditingAssembly(componentAssembly);
    setEditingSubComponent(component.subComponent ?? defaultScope.subComponent);
    setEditingIdentifiedValue(component.identifiedValue);
    setEditingAttributes(scopedAttributes);
    setEditingNotes(component.notes ?? '');
  };

  const handleEditingAssemblyChange = (nextAssembly: AssemblyOption) => {
    const nextSubComponent = (SUB_COMPONENT_PRESETS[nextAssembly] ?? [])[0] ?? 'Notering';
    const nextType = resolveComponentTypeFromScope(nextAssembly, nextSubComponent);
    setEditingAssembly(nextAssembly);
    setEditingSubComponent(nextSubComponent);
    setEditingComponentType(nextType);
    setEditingAttributes(createEmptyAttributes(nextType));
  };

  const handleEditingSubComponentChange = (nextSubComponent: string) => {
    const nextType = resolveComponentTypeFromScope(editingAssembly, nextSubComponent);
    setEditingSubComponent(nextSubComponent);
    setEditingComponentType(nextType);
    setEditingAttributes(createEmptyAttributes(nextType));
  };

  const handleSaveComponentEdit = async () => {
    clearFeedback();

    if (!currentAggregate || !editingComponentId) {
      setError('Ingen komponent vald for redigering.');
      return;
    }

    if (!editingAssembly.trim()) {
      setError('Huvudkategori kravs.');
      return;
    }

    if (!editingSubComponent.trim()) {
      setError('Underkategori kravs.');
      return;
    }

    const resolvedType = resolveComponentTypeFromScope(
      editingAssembly,
      editingSubComponent.trim()
    );
    const scopedAttributes = sanitizeAttributesForScope(
      resolvedType,
      editingAssembly,
      editingAttributes
    );

    const identifiedValue = buildIdentifiedValue(
      resolvedType,
      editingIdentifiedValue,
      scopedAttributes
    );

    if (!identifiedValue.trim()) {
      setError('Fyll i uppgifter for vald underkategori innan sparning.');
      return;
    }

    const missing = getMissingRequiredFields(resolvedType, scopedAttributes).map(
      (field) => field.label
    );

    if (missing.length > 0) {
      setError(`Fyll i obligatoriska falt: ${missing.join(', ')}.`);
      return;
    }

    setIsSavingComponentEdit(true);

    try {
      const updated = await updateAggregateComponent(currentAggregate.id, editingComponentId, {
        componentType: resolvedType,
        identifiedValue: identifiedValue.trim(),
        assembly: editingAssembly,
        subComponent: editingSubComponent.trim(),
        attributes: scopedAttributes,
        notes: editingNotes.trim() || undefined,
        visitId: activeVisitId || undefined
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
      setAggregateEventsById((current) => {
        const next = { ...current };
        delete next[aggregate.id];
        return next;
      });
      setAggregateEventErrorById((current) => {
        const next = { ...current };
        delete next[aggregate.id];
        return next;
      });

      if (currentAggregate?.id === aggregate.id) {
        resetAggregateDraft();
        setStartMethod(null);
        setMode('sok');
        setDepartmentFilter('');
        setExpandedLibraryAggregateId(null);
        void handleSearch('');
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
  const showTopStatusBanner = Boolean(status) && mode !== 'lagg-till';

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
              setDepartmentFilter('');
              setExpandedLibraryAggregateId(null);
              void handleSearch('');
            }}
            className={`${styles.modeButton} ${
              mode === 'sok' ? styles.modeButtonActive : ''
            }`}
          >
            Bibliotek
          </button>
          <button
            onClick={() => {
              setMode('filterlista');
              void handleLoadFilterList(filterQuery);
            }}
            className={`${styles.modeButton} ${
              mode === 'filterlista' ? styles.modeButtonActive : ''
            }`}
          >
            Filterlista
          </button>
          <button
            onClick={() => {
              setMode('rondering');
              if (!searchResults.length) {
                void handleSearch('');
              }
            }}
            className={`${styles.modeButton} ${
              mode === 'rondering' ? styles.modeButtonActive : ''
            }`}
          >
            Rondering
          </button>
        </div>
        <div className={styles.installPromptRow}>
          <PwaInstallPrompt />
        </div>
      </header>

      {error && <p className={styles.errorBanner}>{error}</p>}
      {showTopStatusBanner && <p className={styles.statusBanner}>{status}</p>}

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

      {pendingDuplicateAction && (
        <div className={styles.modalBackdrop} onClick={() => setPendingDuplicateAction(null)}>
          <section
            className={styles.choiceModal}
            onClick={(event) => event.stopPropagation()}
          >
            <h2>Dublett hittad i aggregatet</h2>
            <p>
              Komponent med samma huvudkategori/underkategori finns redan. Välj hur du vill
              fortsätta.
            </p>

            <div className={styles.componentList}>
              {pendingDuplicateCandidates.map((component) => (
                <label key={`dup-${component.id}`} className={styles.taskButton}>
                  <input
                    type='radio'
                    name='duplicate-candidate'
                    checked={pendingDuplicateAction.selectedCandidateId === component.id}
                    onChange={() =>
                      setPendingDuplicateAction((current) =>
                        current
                          ? {
                              ...current,
                              selectedCandidateId: component.id
                            }
                          : current
                      )
                    }
                  />
                  <div>
                    <strong>
                      {component.componentType} · {component.assembly ?? '-'} /{' '}
                      {component.subComponent ?? '-'}
                    </strong>
                    <p>Nuvarande värde: {component.identifiedValue}</p>
                  </div>
                </label>
              ))}
            </div>

            <div className={styles.choiceButtons}>
              <button
                onClick={() => void handleResolveDuplicateAction('update')}
                disabled={isResolvingDuplicate}
              >
                {isResolvingDuplicate ? 'Sparar...' : 'Uppdatera befintlig'}
              </button>
              <button
                onClick={() => void handleResolveDuplicateAction('new')}
                disabled={isResolvingDuplicate}
              >
                {isResolvingDuplicate ? 'Sparar...' : 'Lägg som ny post'}
              </button>
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
          <aside className={`${styles.card} ${styles.taskSidebar}`}>
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
              {status && <p className={styles.inlineStatus}>{status}</p>}

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

              <CameraCapture
                onCapture={handleCapture}
                onRegisterCameraTrigger={(trigger) => {
                  cameraTriggerRef.current = trigger;
                }}
                title={`Fotografera ${selectedTask.label.toLowerCase()}`}
                subtitle={selectedTask.id === 'skylt' ? 'Steg 1: obligatoriskt' : 'Komponentfoto'}
                captureLabel='Ta foto med enhet'
                uploadLabel='Ladda upp foto'
                allowBatchUpload={selectedTask.id !== 'skylt'}
                helperText={
                  selectedTask.id === 'skylt'
                    ? 'Objektskylt först. Du kan skapa aggregat manuellt i Aggregatram.'
                    : 'Ta foto, kontrollera utkastet och spara komponenten.'
                }
                disabled={isProcessingCapture || (!aggregateReady && selectedTask.id !== 'skylt')}
              />

              {selectedPhoto && selectedPhotoIsPreviewable && (
                <details className={styles.previewDetails}>
                  <summary>Senaste bild: {selectedTask.label}</summary>
                  <div className={styles.previewWrap}>
                    <img src={selectedPhoto} alt={`Foto ${selectedTask.label}`} />
                  </div>
                </details>
              )}
            </article>

            <article className={styles.card}>
              <div className={styles.cardHeader}>
                <h2>Aggregatram</h2>
                <span className={styles.aggregatePill}>
                  {currentAggregate
                    ? `Aktivt AG: ${currentAggregate.systemPositionId}`
                    : 'Skapas efter objektskylt'}
                </span>
              </div>

              <div className={styles.quickForm}>
                <label>
                  AG-systemposition
                  <input
                    value={systemPositionId}
                    onChange={(event) => setSystemPositionId(event.target.value)}
                    placeholder='Exempel: 459AG222'
                  />
                </label>

                <label>
                  FL-systemposition
                  <input
                    value={flSystemPositionId}
                    onChange={(event) => setFlSystemPositionId(event.target.value)}
                    placeholder='Exempel: 459FL222'
                  />
                </label>

                <label>
                  SE-systemposition
                  <input
                    value={seSystemPositionId}
                    onChange={(event) => setSeSystemPositionId(event.target.value)}
                    placeholder='Exempel: 459SE222'
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
                {!currentAggregate && (
                  <button
                    className={styles.manualSaveButton}
                    onClick={() => void handleCreateAggregateManually()}
                    disabled={isSavingAggregate || isProcessingCapture}
                  >
                    {isSavingAggregate ? 'Skapar...' : 'Skapa aggregat manuellt'}
                  </button>
                )}

                {currentAggregate && (
                  <>
                    <button
                      className={styles.manualSaveButton}
                      onClick={handleSaveAggregateChanges}
                      disabled={isSavingAggregate}
                    >
                      {isSavingAggregate ? 'Sparar...' : 'Spara ändringar i aggregat'}
                    </button>
                    <button
                      className={styles.dangerButton}
                      onClick={() => void handleDeleteAggregate(currentAggregate)}
                      disabled={deletingAggregateId === currentAggregate.id}
                    >
                      {deletingAggregateId === currentAggregate.id
                        ? 'Tar bort aggregat...'
                        : 'Ta bort aggregat'}
                    </button>
                    <button
                      className={styles.inlineButton}
                      onClick={() => void handleStartNewVisit()}
                      disabled={isStartingVisit}
                    >
                      {isStartingVisit ? 'Startar besök...' : 'Nytt besök'}
                    </button>
                  </>
                )}

                <button
                  className={styles.inlineButton}
                  onClick={() => setShowManualPanel((current) => !current)}
                >
                  {showManualPanel ? 'Dölj manuell inmatning' : 'Manuell inmatning'}
                </button>
              </div>
              {currentAggregate && activeVisitId && (
                <p className={styles.inlineStatus}>
                  Aktivt besök: {formatDateTimeSv(activeVisitStartedAt)} · ID {activeVisitId.slice(0, 8)}
                </p>
              )}
            </article>

            <article className={styles.card}>
              <div className={styles.cardHeader}>
                <h2>Komponentutkast från foto</h2>
                <span className={styles.badge}>
                  {capturedComponentDraft
                    ? capturedComponentQueue.length
                      ? `Redo + ${capturedComponentQueue.length} i kö`
                      : 'Redo att spara'
                    : 'Ingen väntande avläsning'}
                </span>
              </div>
              {!!capturedComponentQueue.length && (
                <p className={styles.inlineStatus}>
                  {capturedComponentQueue.length} foton väntar i kö för kontroll/sparning.
                </p>
              )}

              {capturedComponentDraft ? (
                <div className={styles.componentEditGrid}>
                  <div className={`${styles.ocrAudit} ${styles.fullRow}`}>
                    <p>
                      OCR-kontroll ({capturedComponentDraft.provider}): Total{' '}
                      {toPercent(capturedComponentDraft.overallConfidence)}
                    </p>
                    <p>
                      Identifierat värde:{' '}
                      {toPercent(capturedComponentDraft.identifiedValueConfidence)}
                    </p>
                    {capturedComponentDraft.ocrText?.trim() && (
                      <p>OCR-text: {capturedComponentDraft.ocrText.slice(0, 220)}</p>
                    )}
                  </div>

                  <label>
                    Huvudkategori
                    <select
                      value={capturedComponentDraft.assembly}
                      onChange={(event) =>
                        handleCaptureDraftAssemblyChange(event.target.value as AssemblyOption)
                      }
                    >
                      {ASSEMBLY_OPTIONS.map((option) => (
                        <option key={`draft-${option}`} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    Underkategori
                    <input
                      value={capturedComponentDraft.subComponent}
                      onChange={(event) => handleCaptureDraftSubComponentChange(event.target.value)}
                      list='capture-draft-subcomponent-presets'
                      placeholder='Exempel: Remskiva motorsida'
                    />
                    <datalist id='capture-draft-subcomponent-presets'>
                      {captureDraftSubComponentSuggestions.map((option) => (
                        <option key={`draft-${capturedComponentDraft.assembly}-${option}`} value={option} />
                      ))}
                    </datalist>
                  </label>

                  <label className={styles.fullRow}>
                    Identifierat värde{' '}
                    <span className={styles.confidenceChip}>
                      {toPercent(capturedComponentDraft.identifiedValueConfidence)}
                    </span>
                    <input
                      value={capturedComponentDraft.identifiedValue}
                      onChange={(event) =>
                        setCapturedComponentDraft((current) =>
                          current
                            ? {
                                ...current,
                                identifiedValue: event.target.value
                              }
                            : current
                        )
                      }
                      placeholder='Exempel: SPA 1180'
                    />
                  </label>

                  {captureDraftFieldConfig.map((field) => (
                    <label key={`draft-field-${field.key}`}>
                      {field.label}{' '}
                      <span className={styles.confidenceChip}>
                        {toPercent(capturedComponentDraft.attributeConfidence[field.key] ?? 0)}
                      </span>
                      <input
                        value={capturedComponentDraft.attributes[field.key] ?? ''}
                        onChange={(event) =>
                          setCapturedComponentDraft((current) =>
                            current
                              ? {
                                  ...current,
                                  attributes: {
                                    ...current.attributes,
                                    [field.key]: event.target.value
                                  }
                                }
                              : current
                          )
                        }
                        placeholder={field.placeholder}
                      />
                    </label>
                  ))}

                  <label className={styles.fullRow}>
                    Notering
                    <textarea
                      value={capturedComponentDraft.notes}
                      onChange={(event) =>
                        setCapturedComponentDraft((current) =>
                          current
                            ? {
                                ...current,
                                notes: event.target.value
                              }
                            : current
                        )
                      }
                      placeholder='Valfri notering för komponenten.'
                    />
                  </label>

                  {capturedComponentDraft.imageDataUrl.startsWith('data:image/') && (
                    <div className={`${styles.previewWrap} ${styles.fullRow}`}>
                      <p>Fotounderlag: {capturedComponentDraft.taskLabel}</p>
                      <img
                        src={capturedComponentDraft.imageDataUrl}
                        alt={`Utkastbild ${capturedComponentDraft.taskLabel}`}
                      />
                    </div>
                  )}

                  <div className={styles.inlineEditActions}>
                    <button
                      className={styles.manualSaveButton}
                      onClick={() => void handleSaveCaptureDraft()}
                      disabled={!aggregateReady || isSavingCaptureDraft || isResolvingDuplicate}
                    >
                      {isSavingCaptureDraft ? 'Sparar...' : 'Spara till biblioteket'}
                    </button>
                    <button
                      className={styles.inlineButton}
                      onClick={() => {
                        if (capturedComponentQueue.length > 0) {
                          const [nextDraft, ...rest] = capturedComponentQueue;
                          setCapturedComponentQueue(rest);
                          setCapturedComponentDraft(nextDraft);
                        } else {
                          setCapturedComponentDraft(null);
                        }
                      }}
                      disabled={isSavingCaptureDraft}
                    >
                      Rensa utkast
                    </button>
                  </div>
                </div>
              ) : (
                <div className={styles.emptyStateWrap}>
                  <p className={styles.emptyState}>
                    Ta en komponentbild från fotopunkterna så hamnar avläsningen här för kontroll innan sparning.
                  </p>
                  {!showManualPanel && (
                    <button className={styles.inlineButton} onClick={() => setShowManualPanel(true)}>
                      Öppna manuell inmatning
                    </button>
                  )}
                </div>
              )}
            </article>

            {showManualPanel && (
              <article className={`${styles.card} ${styles.manualPanelCard}`}>
                <div className={styles.cardHeader}>
                  <h2>Manuell registrering</h2>
                  <span style={{ display: 'none' }}>Manuell registrering (fallback)</span>
                  <button
                    className={styles.inlineButton}
                    onClick={() => setShowManualPanel(false)}
                    disabled={isSavingManual}
                  >
                    Stäng
                  </button>
                </div>

                <div className={styles.manualGrid}>
                  <label>
                    Huvudkategori
                    <select
                      value={manualAssembly}
                      onChange={(event) =>
                        handleManualAssemblyChange(event.target.value as AssemblyOption)
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
                    <select
                      value={manualSubComponent}
                      onChange={(event) => handleManualSubComponentChange(event.target.value)}
                    >
                      {manualSubComponentSuggestions.map((option) => (
                        <option key={`${manualAssembly}-${option}`} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </label>

                  {manualAllowsMultiple && (
                    <label className={styles.fullRow}>
                      Flera poster (en per rad)
                      <textarea
                        value={manualExtraValues}
                        onChange={(event) => setManualExtraValues(event.target.value)}
                        placeholder={'Exempel: Filter 2\nFilter 3'}
                      />
                    </label>
                  )}

                  {manualFieldConfig.map((field) => (
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

                <div className={styles.inlineEditActions}>
                  <button
                      className={styles.manualSaveButton}
                      onClick={handleManualSave}
                      disabled={!aggregateReady || isSavingManual || isResolvingDuplicate}
                    >
                    {isSavingManual ? 'Sparar...' : 'Spara manuell post'}
                  </button>
                </div>
              </article>
            )}

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
                              Huvudkategori
                              <select
                                value={editingAssembly}
                                onChange={(event) =>
                                  handleEditingAssemblyChange(event.target.value as AssemblyOption)
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
                              <select
                                value={editingSubComponent}
                                onChange={(event) =>
                                  handleEditingSubComponentChange(event.target.value)
                                }
                              >
                                {editingSubComponentSuggestions.map((option) => (
                                  <option key={`${editingAssembly}-${option}`} value={option}>
                                    {option}
                                  </option>
                                ))}
                              </select>
                            </label>

                            {editingFieldConfig.map((field) => (
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
      ) : mode === 'sok' ? (
        <section className={styles.searchCard}>
          <div className={styles.libraryToolbar}>
            <label>
              Avdelning
              <select
                value={departmentFilter}
                onChange={(event) => {
                  setDepartmentFilter(event.target.value);
                  setExpandedLibraryAggregateId(null);
                }}
              >
                <option value=''>Välj avdelning</option>
                {DEPARTMENT_PRESETS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {!!departmentFilter && (
            <ul className={styles.searchResultList}>
              {filteredSearchResults.map((aggregate) => (
                <li key={aggregate.id}>
                  <button
                    className={styles.libraryAggregateRow}
                    onClick={() => handleToggleLibraryAggregate(aggregate.id)}
                  >
                    <span>
                      <strong>AG:</strong> {aggregate.systemPositionId || 'Ej satt'}
                    </span>
                    <span>
                      <strong>FL:</strong> {aggregate.flSystemPositionId || 'Ej satt'}
                    </span>
                    <span>
                      <strong>SE:</strong> {aggregate.seSystemPositionId || 'Ej satt'}
                    </span>
                    <span>
                      <strong>Position:</strong> {aggregate.position || 'Ej satt'}
                    </span>
                  </button>

                  {expandedLibraryAggregateId === aggregate.id && (
                    <div className={styles.libraryAggregateDetails}>
                      <div className={styles.aggregateMetaGrid}>
                        <p className={styles.aggregateMetaItem}>
                          <strong>Avdelning:</strong> {aggregate.department || 'Ej satt'}
                        </p>
                        <p className={styles.aggregateMetaItem}>
                          <strong>Position:</strong> {aggregate.position || 'Ej satt'}
                        </p>
                        <p className={styles.aggregateMetaItem}>
                          <strong>FL:</strong> {aggregate.flSystemPositionId || 'Ej satt'}
                        </p>
                        <p className={styles.aggregateMetaItem}>
                          <strong>SE:</strong> {aggregate.seSystemPositionId || 'Ej satt'}
                        </p>
                        <p className={styles.aggregateMetaItem}>
                          <strong>Skapad:</strong>{' '}
                          {new Date(aggregate.createdAt).toLocaleString('sv-SE')}
                        </p>
                        <p className={styles.aggregateMetaItem}>
                          <strong>Senast uppdaterad:</strong>{' '}
                          {new Date(aggregate.updatedAt).toLocaleString('sv-SE')}
                        </p>
                        <p className={`${styles.aggregateMetaItem} ${styles.aggregateMetaNotes}`}>
                          <strong>Notering:</strong> {aggregate.notes || 'Ingen notering'}
                        </p>
                      </div>

                      {!!aggregate.components.length && (
                        <div className={styles.componentOverview}>
                          <p className={styles.componentOverviewTitle}>
                            Komponentöversikt ({aggregate.components.length})
                          </p>
                          <ul className={styles.componentOverviewList}>
                            {aggregate.components.map((component) => {
                              const attributes = Object.entries(component.attributes).filter(
                                ([, value]) => value?.trim()
                              );

                              return (
                                <li key={component.id}>
                                  <strong>{component.componentType}</strong>
                                  <span>
                                    {component.assembly
                                      ? `${component.assembly}`
                                      : 'Ingen huvudkategori'}
                                    {component.subComponent
                                      ? ` / ${component.subComponent}`
                                      : ''}
                                  </span>
                                  <span>
                                    <strong>Värde:</strong>{' '}
                                    {component.identifiedValue || 'Ej satt'}
                                  </span>
                                  {!!attributes.length && (
                                    <div className={styles.componentAttributeList}>
                                      {attributes.map(([key, value]) => (
                                        <span key={`${component.id}-${key}`}>
                                          <strong>{formatAttributeLabel(key)}:</strong> {value}
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                  {!attributes.length && (
                                    <span>Inga attribut sparade.</span>
                                  )}
                                  <span className={styles.componentNote}>
                                    <strong>Notering:</strong>{' '}
                                    {component.notes?.trim() || 'Ingen notering'}
                                  </span>
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      )}

                      {!aggregate.components.length && (
                        <p className={styles.emptyState}>Inga komponenter sparade i detta aggregat.</p>
                      )}

                      <div className={styles.eventLogSection}>
                        <div className={styles.eventLogHeader}>
                          <p className={styles.componentOverviewTitle}>Handelselogg</p>
                          <button
                            className={styles.inlineButton}
                            onClick={() => void loadAggregateEvents(aggregate.id, true)}
                            disabled={loadingAggregateEventsId === aggregate.id}
                          >
                            {loadingAggregateEventsId === aggregate.id ? 'Laddar...' : 'Uppdatera'}
                          </button>
                        </div>

                        {!!aggregateEventErrorById[aggregate.id] && (
                          <p className={styles.emptyState}>{aggregateEventErrorById[aggregate.id]}</p>
                        )}

                        {loadingAggregateEventsId === aggregate.id &&
                          !(aggregateEventsById[aggregate.id]?.length ?? 0) && (
                            <p className={styles.emptyState}>Laddar handelser...</p>
                          )}

                        {!!(aggregateEventsById[aggregate.id]?.length ?? 0) && (
                          <ul className={styles.eventLogList}>
                            {aggregateEventsById[aggregate.id].map((event) => {
                              const metadataText = formatEventMetadata(event.metadata);

                              return (
                                <li key={event.id}>
                                  <span className={styles.eventLogTime}>
                                    {formatDateTimeSv(event.createdAt)}
                                  </span>
                                  <span>{event.message}</span>
                                  {!!metadataText && (
                                    <span className={styles.eventLogMeta}>{metadataText}</span>
                                  )}
                                </li>
                              );
                            })}
                          </ul>
                        )}

                        {loadingAggregateEventsId !== aggregate.id &&
                          !(aggregateEventsById[aggregate.id]?.length ?? 0) &&
                          !aggregateEventErrorById[aggregate.id] && (
                            <p className={styles.emptyState}>Inga handelser loggade annu.</p>
                          )}
                      </div>

                      <div className={styles.resultActions}>
                        <button
                          className={styles.openButton}
                          onClick={() => void handleOpenAggregateForEditing(aggregate)}
                        >
                          {'\u00d6ppna f\u00f6r redigering'}
                        </button>
                        <button
                          className={styles.deleteButton}
                          onClick={() => void handleDeleteAggregate(aggregate)}
                          disabled={deletingAggregateId === aggregate.id}
                        >
                          {deletingAggregateId === aggregate.id ? 'Tar bort...' : 'Ta bort aggregat'}
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}

          {!departmentFilter && !isSearching && (
            <p className={styles.emptyState}>
              Välj avdelning i listan för att visa aggregat.
            </p>
          )}

          {!!departmentFilter && !isSearching && filteredSearchResults.length === 0 && (
            <p className={styles.emptyState}>
              Inga aggregat hittades för vald avdelning.
            </p>
          )}
        </section>
      ) : mode === 'rondering' ? (
        <section className={styles.searchCard}>
          <div className={styles.cardHeader}>
            <h2>Rondering</h2>
            <span className={styles.badge}>
              {roundAggregate ? `AG ${roundAggregate.systemPositionId}` : 'Välj aggregat'}
            </span>
          </div>

          <p className={styles.heroText}>
            Fota eller fyll i manuellt under ronden och spara noteringar med åtgärdsbehov.
          </p>

          <div className={styles.libraryToolbar}>
            <label>
              Avdelning
              <select
                value={departmentFilter}
                onChange={(event) => {
                  setDepartmentFilter(event.target.value);
                  setRoundAggregateId('');
                }}
              >
                <option value=''>Välj avdelning</option>
                {DEPARTMENT_PRESETS.map((option) => (
                  <option key={`round-dept-${option}`} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>

            {!!departmentFilter && (
              <label>
                Aggregat
                <select
                  value={roundAggregateId}
                  onChange={(event) => {
                    const nextId = event.target.value;
                    setRoundAggregateId(nextId);
                    if (nextId) {
                      void loadAggregateEvents(nextId, true);
                    }
                  }}
                >
                  <option value=''>Välj aggregat</option>
                  {filteredSearchResults.map((aggregate) => (
                    <option key={`round-aggregate-${aggregate.id}`} value={aggregate.id}>
                      {aggregate.systemPositionId} · {aggregate.position || 'Utan position'}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          {!departmentFilter && (
            <p className={styles.emptyState}>Välj avdelning för att starta rondering.</p>
          )}

          {!!departmentFilter && !filteredSearchResults.length && (
            <p className={styles.emptyState}>Inga aggregat hittades för vald avdelning.</p>
          )}

          {!!roundAggregate && (
            <div className={styles.workspace}>
              <article className={styles.card}>
                <div className={styles.cardHeader}>
                  <h2>Ny ronderingsnotering</h2>
                  <span className={styles.badge}>Besöksspårad</span>
                </div>

                <div className={styles.scopeGrid}>
                  <label>
                    Huvudkategori
                    <select
                      value={roundAssembly}
                      onChange={(event) =>
                        handleRoundAssemblyChange(event.target.value as AssemblyOption)
                      }
                    >
                      {ASSEMBLY_OPTIONS.map((option) => (
                        <option key={`round-assembly-${option}`} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    Underkategori
                    <input
                      value={roundSubComponent}
                      onChange={(event) => handleRoundSubComponentChange(event.target.value)}
                      list='round-subcomponent-presets'
                      placeholder='Exempel: Lager motorsida'
                    />
                    <datalist id='round-subcomponent-presets'>
                      {roundSubComponentSuggestions.map((option) => (
                        <option key={`round-sub-${option}`} value={option} />
                      ))}
                    </datalist>
                  </label>
                </div>

                <div className={styles.scopeGrid}>
                  <label>
                    Komponenttyp
                    <select
                      value={roundComponentType}
                      onChange={(event) =>
                        setRoundComponentType(event.target.value as ComponentType)
                      }
                    >
                      {COMPONENT_TYPE_OPTIONS.map((componentType) => (
                        <option key={`round-type-${componentType}`} value={componentType}>
                          {componentType}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    Status
                    <select
                      value={roundStatus}
                      onChange={(event) => setRoundStatus(event.target.value as RoundStatus)}
                    >
                      <option value='OK'>OK</option>
                      <option value='Atgard kravs'>Åtgärd krävs</option>
                      <option value='Akut'>Akut</option>
                    </select>
                  </label>
                </div>

                <CameraCapture
                  onCapture={handleRoundPhotoCapture}
                  title='Fota komponent för rondering'
                  subtitle='Rondfoto'
                  captureLabel='Ta rondfoto'
                  uploadLabel='Ladda upp rondfoto'
                  helperText='Bilden sparas inte i molnet, bara avläsning används.'
                  disabled={isSavingRoundNote}
                />

                <div className={styles.manualGrid}>
                  <label>
                    Identifierat värde
                    <input
                      value={roundIdentifiedValue}
                      onChange={(event) => setRoundIdentifiedValue(event.target.value)}
                      placeholder='Exempel: 6205-2RS C3'
                    />
                  </label>
                  <label>
                    Åtgärd
                    <input
                      value={roundAction}
                      onChange={(event) => setRoundAction(event.target.value)}
                      placeholder='Exempel: Byt vid nästa stopp'
                    />
                  </label>
                  <label className={styles.fullRow}>
                    Notering
                    <textarea
                      value={roundNotes}
                      onChange={(event) => setRoundNotes(event.target.value)}
                      placeholder='Skriv vad som observerats under ronden.'
                    />
                  </label>
                </div>

                <div className={styles.inlineEditActions}>
                  <button
                    className={styles.manualSaveButton}
                    onClick={() => void handleSaveRoundNote()}
                    disabled={isSavingRoundNote}
                  >
                    {isSavingRoundNote ? 'Sparar...' : 'Spara ronderingsnotering'}
                  </button>
                  <button
                    className={styles.inlineButton}
                    onClick={() => void handleStartRoundVisit()}
                    disabled={isStartingVisit}
                  >
                    {isStartingVisit ? 'Startar besök...' : 'Nytt besök'}
                  </button>
                </div>
              </article>

              <article className={styles.card}>
                <div className={styles.cardHeader}>
                  <h2>Ronderingslogg</h2>
                  <button
                    className={styles.inlineButton}
                    onClick={() => void loadAggregateEvents(roundAggregate.id, true)}
                    disabled={loadingAggregateEventsId === roundAggregate.id}
                  >
                    {loadingAggregateEventsId === roundAggregate.id ? 'Laddar...' : 'Uppdatera'}
                  </button>
                </div>

                {!!roundEvents.length ? (
                  <ul className={styles.eventLogList}>
                    {roundEvents.map((event) => (
                      <li key={`round-event-${event.id}`}>
                        <span className={styles.eventLogTime}>{formatDateTimeSv(event.createdAt)}</span>
                        <span>{event.message}</span>
                        <span className={styles.eventLogMeta}>
                          {formatEventMetadata(event.metadata)}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className={styles.emptyState}>Inga ronderingshändelser loggade ännu.</p>
                )}
              </article>
            </div>
          )}
        </section>
      ) : (
        <section className={styles.searchCard}>
          <div className={styles.filterUploadCard}>
            <div className={styles.cardHeader}>
              <h2>Filterlista</h2>
              <span className={styles.badge}>
                {filteredFilterRows}/{totalFilterRows} rader
              </span>
            </div>

            <p className={styles.heroText}>
              Ladda upp Excel-fil med filterlistan. Ny import ersatter tidigare lista och blir
              direkt sokbar.
            </p>

            <div className={styles.filterUploadRow}>
              <input
                type='file'
                accept='.xlsx,.xls,.csv'
                onChange={(event) => setFilterFile(event.target.files?.[0] ?? null)}
              />
              <button
                className={styles.manualSaveButton}
                onClick={() => void handleImportFilterList()}
                disabled={!filterFile || isImportingFilterList}
              >
                {isImportingFilterList ? 'Importerar...' : 'Importera filterlista'}
              </button>
            </div>
          </div>

          <div className={styles.searchControls}>
            <input
              value={filterQuery}
              onChange={(event) => setFilterQuery(event.target.value)}
              placeholder='Sok pa filtertyp, artikel, position, aggregat, notering...'
            />
            <button
              onClick={() => void handleLoadFilterList(filterQuery)}
              disabled={isLoadingFilterList}
            >
              {isLoadingFilterList ? 'Soker...' : 'Sok'}
            </button>
            <button
              className={styles.inlineButton}
              onClick={() => {
                setFilterQuery('');
                void handleLoadFilterList('');
              }}
              disabled={isLoadingFilterList}
            >
              Rensa
            </button>
          </div>

          {!!filterRows.length && !!filterColumns.length && (
            <div className={styles.filterTableWrap}>
              <table className={styles.filterTable}>
                <thead>
                  <tr>
                    <th>Rad</th>
                    <th>Kalla</th>
                    <th>Skapad</th>
                    {filterColumns.map((column) => (
                      <th key={`filter-col-${column}`}>{column}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filterRows.map((row) => (
                    <tr key={row.id}>
                      <td>{row.rowNumber}</td>
                      <td>{row.sourceFileName || '-'}</td>
                      <td>{formatDateTimeSv(row.createdAt)}</td>
                      {filterColumns.map((column) => (
                        <td key={`${row.id}-${column}`}>{row.data[column] || '—'}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!isLoadingFilterList && !filterRows.length && (
            <p className={styles.emptyState}>
              Ingen filterdata visad annu. Importera en fil eller prova ett annat sokord.
            </p>
          )}
        </section>
      )}
    </main>
  );
}

