import {
  COMPONENT_FIELD_CONFIG,
  createEmptyAttributes,
  getRequiredFieldConfigs,
  normalizeAttributes,
  resolveComponentType
} from '@/lib/componentSchema';
import { ComponentAnalysis, SystemPositionAnalysis } from '@/lib/types';

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const SYSTEM_ID_PATTERN = /\b\d{3}[A-Z]{2}\d{3,4}\b/g;

type OpenAiJson = {
  systemPositionId?: string;
  confidence?: number;
  identifiedValueConfidence?: number;
  attributeConfidence?: Record<string, unknown>;
  notes?: string;
  ocrText?: string;
  componentType?: string;
  identifiedValue?: string;
  suggestedAttributes?: Record<string, unknown>;
};

class OpenAiHttpError extends Error {
  status: number;
  body: string;

  constructor(status: number, body: string) {
    super(`OpenAI-fel (${status}): ${body}`);
    this.status = status;
    this.body = body;
  }
}

function getOpenAiConfig() {
  const apiKey = process.env.OPENAI_API_KEY?.trim() ?? '';
  const model = process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini';
  return { apiKey, model };
}

function sanitizeSystemPositionId(value: string | undefined): string {
  if (!value) {
    return '';
  }

  return value
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/[^A-Z0-9]/g, '');
}

function isValidSystemPositionId(value: string): boolean {
  const normalized = sanitizeSystemPositionId(value);
  return /^\d{3}[A-Z]{2}\d{3,4}$/.test(normalized);
}

function parseJsonFromText(raw: string): OpenAiJson {
  const trimmed = raw.trim();
  if (!trimmed) {
    return {};
  }

  const withoutFence = trimmed.startsWith('```')
    ? trimmed.replace(/^```[a-z]*\n?/i, '').replace(/```$/, '').trim()
    : trimmed;

  try {
    return JSON.parse(withoutFence) as OpenAiJson;
  } catch {
    const start = withoutFence.indexOf('{');
    const end = withoutFence.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(withoutFence.slice(start, end + 1)) as OpenAiJson;
      } catch {
        return {};
      }
    }

    return {};
  }
}

function clampConfidence(value: number | undefined): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 0.5;
  }

  return Math.max(0, Math.min(1, value));
}

function normalizeConfidenceMap(
  input: Record<string, unknown> | undefined,
  fallbackConfidence: number,
  allowedKeys: string[]
): Record<string, number> {
  const result: Record<string, number> = {};
  const source = input ?? {};

  for (const key of allowedKeys) {
    const raw = source[key];
    result[key] =
      typeof raw === 'number' && Number.isFinite(raw)
        ? clampConfidence(raw)
        : fallbackConfidence;
  }

  return result;
}

function pickBestIdFromText(raw: string): string {
  const matches = Array.from(raw.matchAll(SYSTEM_ID_PATTERN)).map((match) =>
    sanitizeSystemPositionId(match[0])
  );

  for (const candidate of matches) {
    if (isValidSystemPositionId(candidate)) {
      return candidate;
    }
  }

  return '';
}

async function callOpenAiForSystemPosition(imageDataUrl: string): Promise<OpenAiJson> {
  const prompt =
    'Las av system-ID pa skylten. Formatet ar exakt: 3 siffror + 2 bokstaver + 3 eller 4 siffror (ex 408FL205 eller 408FL2057). ' +
    'Om osaker returnera systemPositionId som MANUELL-KRAVS och skriv osakerhet i notes. Inga andra format ar giltiga.';

  return callOpenAiJson(prompt, imageDataUrl);
}

async function callOpenAiJson(prompt: string, imageDataUrl: string): Promise<OpenAiJson> {
  const { apiKey, model } = getOpenAiConfig();
  if (!apiKey) {
    return {};
  }

  const response = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 280,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'Du ar OCR-assistent for ventilation. Returnera endast giltigt JSON utan markdown.'
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: prompt
            },
            {
              type: 'image_url',
              image_url: {
                url: imageDataUrl,
                detail: 'high'
              }
            }
          ]
        }
      ]
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new OpenAiHttpError(response.status, body);
  }

  const json = (await response.json()) as {
    choices?: Array<{
      message?: {
        content?: string;
      };
    }>;
  };

  const content = json.choices?.[0]?.message?.content ?? '';
  return parseJsonFromText(content);
}

export async function analyzeSystemPositionWithOpenAi(
  imageDataUrl: string
): Promise<SystemPositionAnalysis> {
  const { apiKey } = getOpenAiConfig();
  if (!apiKey) {
    return {
      systemPositionId: 'MANUELL-KRAVS',
      confidence: 0.1,
      notes: 'OPENAI_API_KEY saknas. Ange system-ID manuellt.',
      provider: 'openai-missing-key',
      requiresManualConfirmation: true
    };
  }

  try {
    const parsed = await callOpenAiForSystemPosition(imageDataUrl);
    const directId = sanitizeSystemPositionId(parsed.systemPositionId);
    const textCandidate = pickBestIdFromText(`${parsed.ocrText ?? ''}\n${parsed.notes ?? ''}`);

    let finalId = '';
    if (isValidSystemPositionId(directId)) {
      finalId = directId;
    } else if (isValidSystemPositionId(textCandidate)) {
      finalId = textCandidate;
    } else {
      finalId = 'MANUELL-KRAVS';
    }

    const noteParts: string[] = [];
    if (parsed.notes?.trim()) {
      noteParts.push(parsed.notes.trim());
    } else if (finalId !== 'MANUELL-KRAVS') {
      noteParts.push('OpenAI-avlasning klar.');
    } else {
      noteParts.push('OpenAI kunde inte lasa ett giltigt system-ID.');
    }

    if (parsed.ocrText?.trim()) {
      noteParts.push(`OCR: ${parsed.ocrText.trim().slice(0, 180)}`);
    }

    if (textCandidate) {
      noteParts.push(`Text-kandidat: ${textCandidate}`);
    }

    return {
      systemPositionId: finalId,
      confidence:
        finalId === 'MANUELL-KRAVS'
          ? Math.min(0.35, clampConfidence(parsed.confidence))
          : Math.max(0.7, clampConfidence(parsed.confidence)),
      notes: noteParts.join(' '),
      provider: 'openai',
      requiresManualConfirmation: true
    };
  } catch (error) {
    return {
      systemPositionId: 'MANUELL-KRAVS',
      confidence: 0.15,
      notes: `OpenAI-systemanalys misslyckades: ${summarizeOpenAiError(error)}`,
      provider: 'openai-error',
      requiresManualConfirmation: true
    };
  }
}

function summarizeOpenAiError(error: unknown): string {
  if (error instanceof OpenAiHttpError) {
    if (error.status === 429) {
      return 'OpenAI 429: rate-limit eller kvot uppnadd.';
    }

    if (error.status === 401) {
      return 'OpenAI 401: ogiltig API-nyckel.';
    }

    return `OpenAI ${error.status}: fel vid API-anrop.`;
  }

  return String(error).replace(/\s+/g, ' ').trim().slice(0, 180);
}

export async function analyzeComponentWithOpenAi(
  componentType: string,
  imageDataUrl: string
): Promise<ComponentAnalysis> {
  const resolvedComponentType = resolveComponentType(componentType);
  if (!resolvedComponentType) {
    throw new Error('Okand komponenttyp.');
  }

  const { apiKey } = getOpenAiConfig();
  if (!apiKey) {
    return {
      componentType: resolvedComponentType,
      identifiedValue: `Manuell avlasning: ${resolvedComponentType}`,
      confidence: 0.1,
      identifiedValueConfidence: 0.1,
      attributeConfidence: normalizeConfidenceMap(
        undefined,
        0.1,
        COMPONENT_FIELD_CONFIG[resolvedComponentType].map((field) => field.key)
      ),
      ocrText: '',
      notes: 'OPENAI_API_KEY saknas. Fyll i komponent manuellt.',
      provider: 'openai-missing-key',
      requiresManualConfirmation: true,
      suggestedAttributes: createEmptyAttributes(resolvedComponentType)
    };
  }

  const requiredFields = getRequiredFieldConfigs(resolvedComponentType).map((f) => f.key);
  const allFields = COMPONENT_FIELD_CONFIG[resolvedComponentType].map((f) => f.key);

  const prompt =
    `Analysera ventilationskomponenten "${resolvedComponentType}". ` +
    `Returnera ENDAST JSON med falten componentType, identifiedValue, confidence, identifiedValueConfidence, notes, ocrText, suggestedAttributes, attributeConfidence. ` +
    `componentType ska vara "${resolvedComponentType}". ` +
    `Alla mojliga attributnycklar: ${allFields.join(', ') || 'inga'}. ` +
    `Obligatoriska attributnycklar: ${requiredFields.join(', ') || 'inga'}. ` +
    'identifiedValue ska vara kort och praktisk (modell/beteckning/storlek). ' +
    'attributeConfidence ska vara objekt med confidence 0..1 per attributnyckel.';

  try {
    const parsed = await callOpenAiJson(prompt, imageDataUrl);
    const suggestedAttributes = {
      ...createEmptyAttributes(resolvedComponentType),
      ...normalizeAttributes(parsed.suggestedAttributes)
    };
    const confidence = clampConfidence(parsed.confidence);
    const identifiedValueConfidence = clampConfidence(
      parsed.identifiedValueConfidence
    );
    const attributeConfidence = normalizeConfidenceMap(
      parsed.attributeConfidence,
      confidence,
      allFields
    );

    const notes: string[] = [];
    if (parsed.notes?.trim()) {
      notes.push(parsed.notes.trim());
    } else {
      notes.push('Bekrafta komponentdata innan sparning.');
    }

    if (parsed.ocrText?.trim()) {
      notes.push(`OCR: ${parsed.ocrText.trim().slice(0, 180)}`);
    }

    return {
      componentType: resolvedComponentType,
      identifiedValue:
        parsed.identifiedValue?.trim() || `Okand ${resolvedComponentType}`,
      confidence,
      identifiedValueConfidence,
      attributeConfidence,
      ocrText: parsed.ocrText?.trim() ?? '',
      notes: notes.join(' '),
      provider: 'openai',
      requiresManualConfirmation: true,
      suggestedAttributes
    };
  } catch (error) {
    return {
      componentType: resolvedComponentType,
      identifiedValue: `Okand ${resolvedComponentType}`,
      confidence: 0.2,
      identifiedValueConfidence: 0.2,
      attributeConfidence: normalizeConfidenceMap(undefined, 0.2, allFields),
      ocrText: '',
      notes: `OpenAI-komponentanalys misslyckades: ${summarizeOpenAiError(error)}`,
      provider: 'openai-error',
      requiresManualConfirmation: true,
      suggestedAttributes: createEmptyAttributes(resolvedComponentType)
    };
  }
}
