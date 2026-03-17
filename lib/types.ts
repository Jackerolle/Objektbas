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
