import {
  createEmptyAttributes,
  isKnownComponentType,
  normalizeAttributes
} from '@/lib/componentSchema';
import { ComponentAnalysis, SystemPositionAnalysis } from '@/lib/types';

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

type GeminiTextJson = {
  confidence?: number;
  notes?: string;
  systemPositionId?: string;
  componentType?: string;
  identifiedValue?: string;
  suggestedAttributes?: Record<string, unknown>;
};

function getGeminiConfig() {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL ?? 'gemini-2.0-flash';
  return { apiKey, model };
}

function clampConfidence(value: number | undefined): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 0.5;
  }

  return Math.min(1, Math.max(0, value));
}

function sanitizeSystemPositionId(value: string | undefined): string {
  if (!value) {
    return '';
  }

  return value.toUpperCase().replace(/[^A-Z0-9-]/g, '').replace(/^-+|-+$/g, '');
}

function parseDataUrl(imageDataUrl: string): { mimeType: string; data: string } {
  if (!imageDataUrl.startsWith('data:')) {
    return { mimeType: 'image/jpeg', data: imageDataUrl.trim() };
  }

  const comma = imageDataUrl.indexOf(',');
  if (comma < 0) {
    throw new Error('Ogiltigt data-url format.');
  }

  const header = imageDataUrl.slice(0, comma);
  const data = imageDataUrl.slice(comma + 1);
  const match = header.match(/^data:([^;]+);base64$/i);

  return {
    mimeType: match?.[1] ?? 'image/jpeg',
    data
  };
}

function extractGeminiText(responseJson: unknown): string {
  const root = responseJson as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
    }>;
  };

  return root.candidates?.[0]?.content?.parts?.find((part) => typeof part.text === 'string')?.text ?? '';
}

function parseGeminiJson(raw: string): GeminiTextJson {
  const trimmed = raw.trim();
  if (!trimmed) {
    return {};
  }

  const withoutFence = trimmed.startsWith('```')
    ? trimmed.replace(/^```[a-z]*\n?/i, '').replace(/```$/, '').trim()
    : trimmed;

  const direct = withoutFence;

  try {
    return JSON.parse(direct) as GeminiTextJson;
  } catch {
    const start = direct.indexOf('{');
    const end = direct.lastIndexOf('}');

    if (start >= 0 && end > start) {
      const candidate = direct.slice(start, end + 1);
      try {
        return JSON.parse(candidate) as GeminiTextJson;
      } catch {
        return {};
      }
    }

    return {};
  }
}

async function callGemini(prompt: string, imageDataUrl: string): Promise<GeminiTextJson> {
  const { apiKey, model } = getGeminiConfig();

  if (!apiKey) {
    return {};
  }

  const { mimeType, data } = parseDataUrl(imageDataUrl);

  const response = await fetch(
    `${GEMINI_BASE_URL}/models/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: prompt },
              { inline_data: { mime_type: mimeType, data } }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.1
        }
      })
    }
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Gemini-fel (${response.status}): ${body}`);
  }

  const json = (await response.json()) as unknown;
  const text = extractGeminiText(json);

  if (!text) {
    return {};
  }

  return parseGeminiJson(text);
}

export async function analyzeSystemPositionWithGemini(
  imageDataUrl: string
): Promise<SystemPositionAnalysis> {
  const { apiKey } = getGeminiConfig();

  if (!apiKey) {
    return {
      systemPositionId: 'MANUELL-KRAVS',
      confidence: 0.15,
      notes: 'GEMINI_API_KEY saknas. Bekrafta ID manuellt.',
      provider: 'fallback',
      requiresManualConfirmation: true
    };
  }

  const prompt =
    'Du ar OCR-assistent. Las endast systempositionens ID fran bilden. ' +
    'Returnera ENDAST JSON med falten systemPositionId, confidence och notes. Inga markdown-block.';

  const parsed = await callGemini(prompt, imageDataUrl);
  const systemPositionId = sanitizeSystemPositionId(parsed.systemPositionId) || 'OKAND';

  return {
    systemPositionId,
    confidence: clampConfidence(parsed.confidence),
    notes: parsed.notes?.trim() || 'Kontrollera ID innan du sparar.',
    provider: 'gemini',
    requiresManualConfirmation: true
  };
}

export async function analyzeComponentWithGemini(
  componentType: string,
  imageDataUrl: string
): Promise<ComponentAnalysis> {
  if (!isKnownComponentType(componentType)) {
    throw new Error('Okand komponenttyp.');
  }

  const { apiKey } = getGeminiConfig();

  if (!apiKey) {
    return {
      componentType,
      identifiedValue: `Manuell avlasning: ${componentType}`,
      confidence: 0.1,
      notes: 'GEMINI_API_KEY saknas. Fyll i falt manuellt.',
      provider: 'fallback',
      requiresManualConfirmation: true,
      suggestedAttributes: createEmptyAttributes(componentType)
    };
  }

  const requiredFields = Object.keys(createEmptyAttributes(componentType));

  const prompt =
    `Du analyserar ventilationskomponenten '${componentType}'. ` +
    `Obligatoriska falt ar: ${requiredFields.join(', ')}. ` +
    'Returnera ENDAST JSON med falten componentType, identifiedValue, confidence, notes och suggestedAttributes. ' +
    'suggestedAttributes ska vara ett objekt med nyckel/varde. Inga markdown-block.';

  const parsed = await callGemini(prompt, imageDataUrl);

  const suggestedAttributes = {
    ...createEmptyAttributes(componentType),
    ...normalizeAttributes(parsed.suggestedAttributes)
  };

  return {
    componentType,
    identifiedValue: parsed.identifiedValue?.trim() || `Okand ${componentType}`,
    confidence: clampConfidence(parsed.confidence),
    notes: parsed.notes?.trim() || 'Bekrafta komponentdata innan sparning.',
    provider: 'gemini',
    requiresManualConfirmation: true,
    suggestedAttributes
  };
}
