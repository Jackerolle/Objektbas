import { ComponentType } from '@/lib/types';

export type ComponentFieldConfig = {
  key: string;
  label: string;
  placeholder: string;
};

export const COMPONENT_OPTIONS: ComponentType[] = [
  'Motor',
  'Fläkt',
  'Kilrem',
  'Remskiva',
  'Lager',
  'Filter'
];

export const COMPONENT_FIELD_CONFIG: Record<ComponentType, ComponentFieldConfig[]> = {
  Motor: [
    { key: 'motorModell', label: 'Motormodell', placeholder: 'Ex: ABB M3AA 132M' },
    { key: 'effektKw', label: 'Effekt (kW)', placeholder: 'Ex: 7,5' },
    { key: 'markstromA', label: 'Märkström (A)', placeholder: 'Ex: 14,2' }
  ],
  Fläkt: [
    { key: 'flakttyp', label: 'Fläkttyp', placeholder: 'Ex: Radial' },
    { key: 'diameterMm', label: 'Diameter (mm)', placeholder: 'Ex: 450' },
    { key: 'rotationsriktning', label: 'Rotationsriktning', placeholder: 'Ex: Medurs' }
  ],
  Kilrem: [
    { key: 'profil', label: 'Profil', placeholder: 'Ex: SPA' },
    { key: 'langd', label: 'Längd', placeholder: 'Ex: 1180' },
    { key: 'antal', label: 'Antal', placeholder: 'Ex: 2' }
  ],
  Remskiva: [
    { key: 'drivdiameterMm', label: 'Drivdiameter (mm)', placeholder: 'Ex: 125' },
    { key: 'meddiameterMm', label: 'Meddiameter (mm)', placeholder: 'Ex: 200' },
    { key: 'sparantal', label: 'Spårantal', placeholder: 'Ex: 2' }
  ],
  Lager: [
    { key: 'lagertyp', label: 'Lagertyp', placeholder: 'Ex: 6205-2RS C3' },
    { key: 'lagerplacering', label: 'Placering', placeholder: 'Ex: Motorsida NDE' },
    { key: 'antal', label: 'Antal', placeholder: 'Ex: 2' }
  ],
  Filter: [
    { key: 'filterklass', label: 'Filterklass', placeholder: 'Ex: ePM1 55% (F7)' },
    { key: 'dimension', label: 'Dimension', placeholder: 'Ex: 595x595x48' },
    { key: 'antal', label: 'Antal', placeholder: 'Ex: 4' }
  ]
};

export function isKnownComponentType(value: string): value is ComponentType {
  return COMPONENT_OPTIONS.includes(value as ComponentType);
}

export function getRequiredFieldConfigs(componentType: ComponentType): ComponentFieldConfig[] {
  return COMPONENT_FIELD_CONFIG[componentType];
}

export function createEmptyAttributes(componentType: ComponentType): Record<string, string> {
  const result: Record<string, string> = {};
  for (const field of COMPONENT_FIELD_CONFIG[componentType]) {
    result[field.key] = '';
  }

  return result;
}

export function normalizeAttributes(
  input: Record<string, unknown> | null | undefined
): Record<string, string> {
  const result: Record<string, string> = {};
  if (!input) {
    return result;
  }

  for (const [key, value] of Object.entries(input)) {
    const normalizedKey = key.trim();
    if (!normalizedKey) {
      continue;
    }

    result[normalizedKey] = typeof value === 'string' ? value.trim() : String(value ?? '').trim();
  }

  return result;
}

export function getMissingRequiredFields(
  componentType: ComponentType,
  attributes: Record<string, string>
): ComponentFieldConfig[] {
  return COMPONENT_FIELD_CONFIG[componentType].filter((field) => !attributes[field.key]?.trim());
}
