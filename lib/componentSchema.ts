import { ComponentType } from '@/lib/types';

export type ComponentFieldConfig = {
  key: string;
  label: string;
  placeholder: string;
  required?: boolean;
};

export const COMPONENT_OPTIONS: ComponentType[] = [
  'Motor',
  'Fl\u00e4kt',
  'Kilrem',
  'Remskiva',
  'Bussning',
  'Axeldiameter',
  'Lager',
  'Filter',
  'Kolfilter',
  'Motorskylt',
  '\u00d6vrigt'
];

export const COMPONENT_FIELD_CONFIG: Record<ComponentType, ComponentFieldConfig[]> = {
  Motor: [
    { key: 'motorModell', label: 'Motormodell', placeholder: 'Ex: ABB M3AA 132M' },
    { key: 'effektKw', label: 'Effekt (kW)', placeholder: 'Ex: 7,5' },
    { key: 'volt', label: 'Volt (V)', placeholder: 'Ex: 400' }
  ],
  Fl\u00e4kt: [
    { key: 'flakttyp', label: 'Flakttyp', placeholder: 'Ex: Radial' },
    { key: 'diameterMm', label: 'Diameter (mm)', placeholder: 'Ex: 450' },
    {
      key: 'rotationsriktning',
      label: 'Rotationsriktning',
      placeholder: 'Ex: Medurs'
    }
  ],
  Kilrem: [
    { key: 'profil', label: 'Profil', placeholder: 'Ex: SPA' },
    { key: 'langd', label: 'Langd', placeholder: 'Ex: 1180' },
    { key: 'antal', label: 'Antal', placeholder: 'Ex: 2' }
  ],
  Remskiva: [
    { key: 'remskivaNamn', label: 'Remskiva namn', placeholder: 'Ex: SPA 2-spa' }
  ],
  Bussning: [
    { key: 'bussningStorlek', label: 'Bussning storlek', placeholder: 'Ex: 2012' },
    { key: 'axeldiameterMm', label: 'Axeldiameter (mm)', placeholder: 'Ex: 24' }
  ],
  Axeldiameter: [
    { key: 'axeldiameterMm', label: 'Axeldiameter (mm)', placeholder: 'Ex: 24' }
  ],
  Lager: [
    {
      key: 'lagerFram',
      label: 'Lager fram',
      placeholder: 'Ex: 6205-2RS C3',
      required: true
    },
    {
      key: 'lagerBak',
      label: 'Lager bak',
      placeholder: 'Ex: 6204-2RS C3',
      required: false
    }
  ],
  Filter: [
    { key: 'filterNamn', label: 'Filter namn', placeholder: 'Ex: Tilluft F7 595x595x48' },
    { key: 'filterklass', label: 'Filterklass', placeholder: 'Ex: ePM1 55% (F7)' },
    { key: 'dimension', label: 'Dimension', placeholder: 'Ex: 595x595x48' },
    { key: 'antal', label: 'Antal', placeholder: 'Ex: 4' }
  ],
  Kolfilter: [
    { key: 'filterNamn', label: 'Kolfilter namn', placeholder: 'Ex: Kolfilter kassett 287x592' },
    { key: 'dimension', label: 'Dimension', placeholder: 'Ex: 287x592x48' },
    { key: 'antal', label: 'Antal', placeholder: 'Ex: 2' }
  ],
  Motorskylt: [
    { key: 'motorModell', label: 'Motormodell', placeholder: 'Ex: ABB M3AA 132M' },
    { key: 'effektKw', label: 'Effekt (kW)', placeholder: 'Ex: 7,5' },
    { key: 'volt', label: 'Volt (V)', placeholder: 'Ex: 400' },
    { key: 'varvtalRpm', label: 'Varvtal (rpm)', placeholder: 'Ex: 1450' }
  ],
  \u00d6vrigt: []
};

const ATTRIBUTE_KEY_LOOKUP = new Map<string, string>();

for (const field of Object.values(COMPONENT_FIELD_CONFIG).flat()) {
  ATTRIBUTE_KEY_LOOKUP.set(normalizeAttributeToken(field.key), field.key);
}

const ATTRIBUTE_ALIASES: Record<string, string> = {
  lagertyp: 'lagerFram',
  markstroma: 'volt',
  bussningstorlekmm: 'bussningStorlek'
};

function normalizeAttributeToken(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

const COMPONENT_TYPE_ALIAS_MAP: Record<string, ComponentType> = {
  motor: 'Motor',
  motorskylt: 'Motorskylt',
  motorbricka: 'Motorskylt',
  flakt: 'Fl\u00e4kt',
  kilrem: 'Kilrem',
  remskiva: 'Remskiva',
  bussning: 'Bussning',
  axeldiameter: 'Axeldiameter',
  lager: 'Lager',
  filter: 'Filter',
  kolfilter: 'Kolfilter',
  ovrigt: '\u00d6vrigt',
  notering: '\u00d6vrigt'
};

export function isKnownComponentType(value: string): value is ComponentType {
  return resolveComponentType(value) !== null;
}

export function resolveComponentType(value: string): ComponentType | null {
  const token = normalizeAttributeToken(value.trim());
  if (!token) {
    return null;
  }

  if (token in COMPONENT_TYPE_ALIAS_MAP) {
    return COMPONENT_TYPE_ALIAS_MAP[token];
  }

  const match = COMPONENT_OPTIONS.find(
    (componentType) => normalizeAttributeToken(componentType) === token
  );

  return match ?? null;
}

export function getRequiredFieldConfigs(componentType: ComponentType): ComponentFieldConfig[] {
  return COMPONENT_FIELD_CONFIG[componentType].filter((field) => field.required);
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

    const token = normalizeAttributeToken(normalizedKey);
    const alias = ATTRIBUTE_ALIASES[token];
    const canonical = ATTRIBUTE_KEY_LOOKUP.get(token) ?? alias ?? normalizedKey;

    result[canonical] =
      typeof value === 'string' ? value.trim() : String(value ?? '').trim();
  }

  return result;
}

export function getMissingRequiredFields(
  componentType: ComponentType,
  attributes: Record<string, string>
): ComponentFieldConfig[] {
  return getRequiredFieldConfigs(componentType).filter(
    (field) => !attributes[field.key]?.trim()
  );
}
