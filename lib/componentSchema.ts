import { ComponentType } from '@/lib/types';

export type ComponentFieldConfig = {
  key: string;
  label: string;
  placeholder: string;
};

export const COMPONENT_OPTIONS: ComponentType[] = [
  'Motorbricka',
  'Flakt',
  'Kilrep',
  'Remskivor',
  'Filter'
];

export const COMPONENT_FIELD_CONFIG: Record<ComponentType, ComponentFieldConfig[]> = {
  Motorbricka: [
    { key: 'motorModell', label: 'Motormodell', placeholder: 'Ex: ABB M3AA 132M' },
    { key: 'lagerTyp', label: 'Lagertyp', placeholder: 'Ex: 6205-2RS C3' },
    { key: 'lagerAntal', label: 'Lagerantal', placeholder: 'Ex: 2' }
  ],
  Flakt: [
    { key: 'flaktTyp', label: 'Flakttyp', placeholder: 'Ex: Radial' },
    { key: 'diameterMm', label: 'Diameter (mm)', placeholder: 'Ex: 450' },
    { key: 'rotationsriktning', label: 'Rotationsriktning', placeholder: 'Ex: Medurs' }
  ],
  Kilrep: [
    { key: 'profil', label: 'Profil', placeholder: 'Ex: SPA' },
    { key: 'langd', label: 'Langd', placeholder: 'Ex: 1180' },
    { key: 'antal', label: 'Antal', placeholder: 'Ex: 2' }
  ],
  Remskivor: [
    { key: 'drivskiva', label: 'Drivskiva', placeholder: 'Ex: 125-2SPZ' },
    { key: 'medskiva', label: 'Medskiva', placeholder: 'Ex: 200-2SPZ' },
    { key: 'diameterMm', label: 'Diameter (mm)', placeholder: 'Ex: 125/200' }
  ],
  Filter: [
    { key: 'filterklass', label: 'Filterklass', placeholder: 'Ex: F7' },
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
