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

export type AppMode = 'lagg-till' | 'sok' | 'importera';

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
