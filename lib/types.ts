export type EquipmentStatus = 'ok' | 'saknas' | 'trasig';

export type Equipment = {
  id: string;
  name: string;
  quantity: number;
  status: EquipmentStatus;
};

export type Objekt = {
  id: string;
  name: string;
  category: string;
  location: string;
  tags: string[];
  lastService: string;
  updatedAt: string;
  thumbnail?: string;
  equipment: Equipment[];
};

export type ObservationPayload = {
  objectId: string;
  notes: string;
  imageDataUrl?: string;
  timestamp: string;
};

export type SyncState = 'idle' | 'syncing' | 'offline';

export type AppMode = 'lagg-till' | 'sok' | 'rondering' | 'filterlista';

export type ComponentType =
  | 'Motor'
  | 'Fl\u00e4kt'
  | 'Kilrem'
  | 'Remskiva'
  | 'Bussning'
  | 'Axeldiameter'
  | 'Lager'
  | 'Filter'
  | 'Kolfilter'
  | 'Motorskylt'
  | '\u00d6vrigt';

export type SystemPositionAnalysis = {
  systemPositionId: string;
  confidence: number;
  notes: string;
  provider: string;
  requiresManualConfirmation: boolean;
};

export type ComponentAnalysis = {
  componentType: string;
  identifiedValue: string;
  confidence: number;
  identifiedValueConfidence?: number;
  attributeConfidence?: Record<string, number>;
  ocrText?: string;
  notes: string;
  provider: string;
  requiresManualConfirmation: boolean;
  suggestedAttributes: Record<string, string>;
};

export type CreateAggregatePayload = {
  systemPositionId: string;
  flSystemPositionId?: string;
  seSystemPositionId?: string;
  position?: string;
  department?: string;
  notes?: string;
  systemPositionImageDataUrl?: string;
};

export type CreateAggregateComponentPayload = {
  componentType: string;
  identifiedValue: string;
  notes?: string;
  assembly?: string;
  subComponent?: string;
  visitId?: string;
  imageDataUrl?: string;
  attributes?: Record<string, string>;
};

export type AggregateComponent = {
  id: string;
  componentType: string;
  identifiedValue: string;
  notes?: string;
  assembly?: string;
  subComponent?: string;
  attributes: Record<string, string>;
  createdAt: string;
};

export type AggregateRecord = {
  id: string;
  systemPositionId: string;
  flSystemPositionId?: string;
  seSystemPositionId?: string;
  position?: string;
  department?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  components: AggregateComponent[];
};

export type ImportAggregatesResult = {
  totalRows: number;
  importedAggregates: number;
  createdAggregates: number;
  updatedAggregates: number;
  importedComponents: number;
  skippedRows: number;
  warnings: string[];
};

export type ImportPreviewAggregate = {
  systemPositionId: string;
  flSystemPositionId?: string;
  seSystemPositionId?: string;
  position?: string;
  department?: string;
  notes?: string;
  componentsCount: number;
  sampleComponents: Array<{
    componentType: string;
    identifiedValue: string;
    notes?: string;
    attributes: Record<string, string>;
  }>;
};

export type ImportPreviewResult = {
  totalRows: number;
  skippedRows: number;
  parsedAggregates: number;
  parsedComponents: number;
  warnings: string[];
  previewAggregates: ImportPreviewAggregate[];
};

export type CreateAggregateEventPayload = {
  aggregateId?: string;
  eventType: string;
  message: string;
  metadata?: Record<string, unknown>;
};

export type AggregateEvent = {
  id: string;
  aggregateId: string;
  eventType: string;
  message: string;
  metadata: Record<string, string>;
  createdAt: string;
};

export type FilterListRow = {
  id: string;
  rowNumber: number;
  sourceFileName?: string;
  data: Record<string, string>;
  createdAt: string;
};

export type FilterListSearchResult = {
  totalRows: number;
  filteredRows: number;
  columns: string[];
  rows: FilterListRow[];
};

export type ImportFilterListResult = {
  sourceFileName: string;
  totalRows: number;
  skippedRows: number;
  importedRows: number;
  columns: string[];
  warnings: string[];
  syncedAggregates: number;
  insertedFilterComponents: number;
  skippedNoObjectMatch: number;
  skippedNoFilterData: number;
  skippedExistingFilter: number;
};

export type RoundStatus = 'ongoing' | 'completed';

export type RoundSeverity = 'info' | 'atgard' | 'akut';

export type RoundItemRecord = {
  id: string;
  roundId: string;
  aggregateId?: string;
  systemPositionId: string;
  componentArea?: string;
  title: string;
  observation: string;
  recommendedAction: string;
  severity: RoundSeverity;
  photos: string[];
  createdAt: string;
  updatedAt: string;
};

export type RoundRecord = {
  id: string;
  title: string;
  department?: string;
  customerName?: string;
  performedBy?: string;
  status: RoundStatus;
  summaryText: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  items: RoundItemRecord[];
};

export type CreateRoundPayload = {
  title?: string;
  department?: string;
  customerName?: string;
  performedBy?: string;
  status?: RoundStatus;
};

export type UpdateRoundPayload = {
  title?: string;
  department?: string;
  customerName?: string;
  performedBy?: string;
  status?: RoundStatus;
  summaryText?: string;
};

export type CreateRoundItemPayload = {
  aggregateId?: string;
  systemPositionId: string;
  componentArea?: string;
  title: string;
  observation: string;
  recommendedAction: string;
  severity: RoundSeverity;
  photos?: string[];
};

export type UpdateRoundItemPayload = {
  aggregateId?: string;
  systemPositionId?: string;
  componentArea?: string;
  title?: string;
  observation?: string;
  recommendedAction?: string;
  severity?: RoundSeverity;
  photos?: string[];
};
