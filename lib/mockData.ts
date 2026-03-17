import { Objekt } from './types';

export const mockObjects: Objekt[] = [
  {
    id: 'lift-23',
    name: 'SkyLift 23',
    category: 'Lift',
    location: 'Verkstad Nord',
    tags: ['hydraulik', 'besiktigad'],
    lastService: '2024-05-04',
    updatedAt: '2024-05-15T07:12:00Z',
    thumbnail: '/sample/lift.jpg',
    equipment: [
      { id: 'bat-1', name: 'Batteripack 48V', quantity: 2, status: 'ok' },
      { id: 'selar', name: 'Fallskyddssele', quantity: 2, status: 'saknas' }
    ]
  },
  {
    id: 'borrlag-11',
    name: 'Borraggregat 11',
    category: 'Borr',
    location: 'Site A',
    tags: ['ute', 'service'],
    lastService: '2024-04-12',
    updatedAt: '2024-05-12T16:45:00Z',
    equipment: [
      { id: 'borrkrona', name: 'Borrkrona 35mm', quantity: 3, status: 'ok' },
      { id: 'coolant', name: 'Kylmedel', quantity: 1, status: 'trasig' }
    ]
  },
  {
    id: 'generator-07',
    name: 'Generator 07',
    category: 'Energi',
    location: 'Region Syd',
    tags: ['kritisk', 'service'],
    lastService: '2024-02-28',
    updatedAt: '2024-05-10T09:30:00Z',
    equipment: [
      { id: 'olja', name: 'Oljefilter', quantity: 2, status: 'ok' },
      { id: 'sensor', name: 'Vibrationssensor', quantity: 4, status: 'saknas' }
    ]
  }
];
