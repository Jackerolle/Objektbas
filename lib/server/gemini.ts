import {
  COMPONENT_FIELD_CONFIG,
  createEmptyAttributes,
  getRequiredFieldConfigs,
  normalizeAttributes,
  resolveComponentType
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

class GeminiHttpError extends Error {
  status: number;
  body: string;
  retryDelayMs: number;

  constructor(status: number, body: string) {
    super(`Gemini-fel (${status}): ${body}`);
    this.status = status;
    this.body = body;
    this.retryDelayMs = parseRetryDelayMs(body);
  }
}

function getGeminiConfig() {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL ?? 'gemini-2.0-flash';
  const fallbackModels = (process.env.GEMINI_FALLBACK_MODELS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  return { apiKey, model, fallbackModels };
}

function getCandidateModels(): string[] {
  const { model, fallbackModels } = getGeminiConfig();
  return Array.from(new Set([model, ...fallbackModels]));
}

function clampConfidence(value: number | undefined): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 0.5;
  }

  return Math.min(1, Math.max(0, value));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryDelayMs(body: string): number {
  const match = body.match(/"retryDelay"\s*:\s*"([0-9.]+)s"/i);
  if (!match) {
    return 0;
  }

  const seconds = Number(match[1]);
  if (Number.isNaN(seconds) || seconds <= 0) {
    return 0;
  }

  return Math.min(Math.round(seconds * 1000), 4000);
}

function sanitizeSystemPositionId(value: string | undefined): string {
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

function isLikelySystemPositionId(value: string): boolean {
  if (!value) {
    return false;
  }

  const normalized = sanitizeSystemPositionId(value);
  if (!normalized || normalized.length < 4) {
    return false;
  }

  if (['OKAND', 'UNKNOWN', 'NA', 'N/A', 'MANUELL-KRAVS'].includes(normalized)) {
    return false;
  }

  return /[A-Z]/.test(normalized) && /[0-9]/.test(normalized);
}

function extractSystemPositionFromText(rawText: string): string {
  const normalizedWords = rawText
    .toUpperCase()
    .replace(/[^A-Z0-9\-\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => sanitizeSystemPositionId(word));

  let best = '';
  let bestScore = -1;

  for (const candidate of normalizedWords) {
    if (!isLikelySystemPositionId(candidate)) {
      continue;
    }

    let score = 0;
    if (candidate.includes('-')) {
      score += 3;
    }
    if (/^[A-Z]{1,6}-?[0-9]{2,8}[A-Z0-9-]*$/.test(candidate)) {
      score += 4;
    }
    if (candidate.length >= 6 && candidate.length <= 14) {
      score += 2;
    }

    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  return best;
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

  return (
    root.candidates?.[0]?.content?.parts?.find(
      (part) => typeof part.text === 'string'
    )?.text ?? ''
  );
}

function parseGeminiJson(raw: string): GeminiTextJson {
  const trimmed = raw.trim();
  if (!trimmed) {
    return {};
  }

  const withoutFence = trimmed.startsWith('```')
    ? trimmed.replace(/^```[a-z]*\n?/i, '').replace(/```$/, '').trim()
    : trimmed;

  try {
    return JSON.parse(withoutFence) as GeminiTextJson;
  } catch {
    const start = withoutFence.indexOf('{');
    const end = withoutFence.lastIndexOf('}');

    if (start >= 0 && end > start) {
      const candidate = withoutFence.slice(start, end + 1);
      try {
        return JSON.parse(candidate) as GeminiTextJson;
      } catch {
        return {};
      }
    }

    return {};
  }
}

async function requestGeminiText(
  prompt: string,
  imageDataUrl: string,
  model: string,
  expectJson: boolean
): Promise<string> {
  const { apiKey } = getGeminiConfig();
  if (!apiKey) {
    return '';
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
            parts: [{ text: prompt }, { inline_data: { mime_type: mimeType, data } }]
          }
        ],
        generationConfig: {
          temperature: 0.1,
          ...(expectJson ? { response_mime_type: 'application/json' } : {})
        }
      })
    }
  );

  if (!response.ok) {
    const body = await response.text();
    throw new GeminiHttpError(response.status, body);
  }

  const json = (await response.json()) as unknown;
  return extractGeminiText(json).trim();
}

async function callGeminiJson(prompt: string, imageDataUrl: string): Promise<GeminiTextJson> {
  const models = getCandidateModels();
  let lastError: unknown;

  for (const model of models) {
    try {
      const raw = await requestGeminiText(prompt, imageDataUrl, model, true);
      const parsed = parseGeminiJson(raw);
      if (Object.keys(parsed).length > 0) {
        return parsed;
      }
    } catch (error) {
      lastError = error;

      if (error instanceof GeminiHttpError && error.status === 429) {
        await delay(error.retryDelayMs || 1200);
        continue;
      }
    }
  }

  if (lastError) {
    throw lastError;
  }

  return {};
}

async function callGeminiText(prompt: string, imageDataUrl: string): Promise<string> {
  const models = getCandidateModels();
  let lastError: unknown;

  for (const model of models) {
    try {
      const raw = await requestGeminiText(prompt, imageDataUrl, model, false);
      if (raw) {
        return raw;
      }
    } catch (error) {
      lastError = error;

      if (error instanceof GeminiHttpError && error.status === 429) {
        await delay(error.retryDelayMs || 1200);
        continue;
      }
    }
  }

  if (lastError) {
    throw lastError;
  }

  return '';
}

async function transcribeImageWithGemini(imageDataUrl: string): Promise<string> {
  const prompt =
    'Transkribera all tydlig text i bilden rad-for-rad. Returnera bara text utan forklaringar.';

  const text = await callGeminiText(prompt, imageDataUrl);
  return text.slice(0, 2000);
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

  const ocrText = await transcribeImageWithGemini(imageDataUrl).catch(() => '');
  const ocrCandidate = extractSystemPositionFromText(ocrText);

  const prompt =
    'Du ar OCR-assistent for objektskyltar. Returnera ENDAST JSON med falten systemPositionId, confidence och notes. ' +
    'Om osakert: systemPositionId = "MANUELL-KRAVS". ' +
    `OCR-text (kan innehalla fel): ${ocrText || 'saknas'}`;

  const parsed = await callGeminiJson(prompt, imageDataUrl).catch(
    () => ({}) as GeminiTextJson
  );
  const geminiCandidate = sanitizeSystemPositionId(parsed.systemPositionId);

  let finalId = '';
  let confidence = clampConfidence(parsed.confidence);
  let source = 'gemini';

  if (isLikelySystemPositionId(geminiCandidate)) {
    finalId = geminiCandidate;
  } else if (isLikelySystemPositionId(ocrCandidate)) {
    finalId = ocrCandidate;
    confidence = Math.max(0.62, confidence);
    source = 'ocr-fallback';
  } else {
    finalId = 'MANUELL-KRAVS';
    confidence = Math.min(confidence, 0.35);
    source = 'fallback';
  }

  const noteParts = [parsed.notes?.trim() || 'Kontrollera ID innan du sparar.'];
  if (ocrText) {
    noteParts.push(`OCR: ${ocrText.slice(0, 160)}`);
  }

  return {
    systemPositionId: finalId,
    confidence,
    notes: noteParts.join(' '),
    provider: source,
    requiresManualConfirmation: true
  };
}

export async function analyzeComponentWithGemini(
  componentType: string,
  imageDataUrl: string
): Promise<ComponentAnalysis> {
  const resolvedComponentType = resolveComponentType(componentType);
  if (!resolvedComponentType) {
    throw new Error('Okand komponenttyp.');
  }

  const { apiKey } = getGeminiConfig();

  if (!apiKey) {
    return {
      componentType: resolvedComponentType,
      identifiedValue: `Manuell avlasning: ${resolvedComponentType}`,
      confidence: 0.1,
      notes: 'GEMINI_API_KEY saknas. Fyll i falt manuellt.',
      provider: 'fallback',
      requiresManualConfirmation: true,
      suggestedAttributes: createEmptyAttributes(resolvedComponentType)
    };
  }

  const requiredFields = getRequiredFieldConfigs(resolvedComponentType).map(
    (field) => field.key
  );
  const allFields = COMPONENT_FIELD_CONFIG[resolvedComponentType].map(
    (field) => field.key
  );
  const ocrText = await transcribeImageWithGemini(imageDataUrl).catch(() => '');

  const prompt =
    `Du analyserar ventilationskomponenten '${resolvedComponentType}'. ` +
    `Fyll sa manga falt som mojligt. Alla falt: ${allFields.join(', ') || 'inga'}. ` +
    `Obligatoriska falt: ${requiredFields.join(', ') || 'inga'}. ` +
    'Returnera ENDAST JSON med falten componentType, identifiedValue, confidence, notes och suggestedAttributes. ' +
    'suggestedAttributes ska vara ett objekt med nyckel/varde. Inga markdown-block. ' +
    `OCR-text (kan innehalla fel): ${ocrText || 'saknas'}`;

  const parsed = await callGeminiJson(prompt, imageDataUrl);

  const suggestedAttributes = {
    ...createEmptyAttributes(resolvedComponentType),
    ...normalizeAttributes(parsed.suggestedAttributes)
  };

  const notes = [parsed.notes?.trim() || 'Bekrafta komponentdata innan sparning.'];
  if (ocrText) {
    notes.push(`OCR: ${ocrText.slice(0, 160)}`);
  }

  return {
    componentType: resolvedComponentType,
    identifiedValue:
      parsed.identifiedValue?.trim() || `Okand ${resolvedComponentType}`,
    confidence: clampConfidence(parsed.confidence),
    notes: notes.join(' '),
    provider: 'gemini',
    requiresManualConfirmation: true,
    suggestedAttributes
  };
}
