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

function scoreSystemPositionCandidate(value: string): number {
  const candidate = sanitizeSystemPositionId(value);
  if (!isLikelySystemPositionId(candidate)) {
    return -1;
  }

  let score = 0;

  if (/^\d{2,6}[A-Z]{1,4}\d{2,8}[A-Z0-9-]*$/.test(candidate)) {
    score += 9;
  }

  if (/^[A-Z]{1,6}-?\d{2,8}[A-Z0-9-]*$/.test(candidate)) {
    score += 7;
  }

  if (candidate.includes('-')) {
    score += 2;
  }

  if (candidate.length >= 6 && candidate.length <= 12) {
    score += 3;
  } else if (candidate.length >= 4 && candidate.length <= 16) {
    score += 1;
  }

  const transitions = candidate.match(/[0-9][A-Z]|[A-Z][0-9]/g)?.length ?? 0;
  score += Math.min(3, transitions);

  return score;
}

function extractSystemPositionFromText(rawText: string): string {
  let best = '';
  let bestScore = -1;

  const evaluate = (candidate: string, bonus = 0) => {
    const normalized = sanitizeSystemPositionId(candidate);
    if (!normalized || normalized.length > 18) {
      return;
    }

    const baseScore = scoreSystemPositionCandidate(normalized);
    if (baseScore < 0) {
      return;
    }

    const score = baseScore + bonus;
    if (score > bestScore || (score === bestScore && normalized.length > best.length)) {
      bestScore = score;
      best = normalized;
    }
  };

  const lines = rawText
    .toUpperCase()
    .split(/\r?\n/g)
    .map((line) => line.replace(/[^A-Z0-9\-\s]/g, ' ').trim())
    .filter(Boolean);

  for (const line of lines) {
    const words = line
      .split(/\s+/)
      .map((word) => sanitizeSystemPositionId(word))
      .filter(Boolean);

    for (const word of words) {
      evaluate(word);
    }

    for (let i = 0; i < words.length; i += 1) {
      for (let size = 2; size <= 3; size += 1) {
        const slice = words.slice(i, i + size);
        if (slice.length !== size) {
          continue;
        }

        evaluate(slice.join(''), 2);
        evaluate(slice.join('-'), 1);
      }
    }

    evaluate(words.join(''), 1);
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

function summarizeError(error: unknown): string {
  if (error instanceof GeminiHttpError) {
    if (error.status === 429) {
      return 'Gemini 429: kvot/rate-limit overskriden.';
    }

    return `Gemini ${error.status}: fel vid API-anrop.`;
  }

  const message = (error instanceof Error ? error.message : String(error))
    .replace(/\s+/g, ' ')
    .trim();

  if (/quota|resource_exhausted|rate limit|429/i.test(message)) {
    return 'Gemini 429: kvot/rate-limit overskriden.';
  }

  return message.slice(0, 180);
}

function isQuotaError(error: unknown): boolean {
  const message = summarizeError(error).toLowerCase();
  return (
    message.includes('quota') ||
    message.includes('resource_exhausted') ||
    message.includes('429') ||
    message.includes('rate limit')
  );
}

async function callGeminiTextNonEmpty(
  prompt: string,
  imageDataUrl: string
): Promise<string> {
  const text = await callGeminiText(prompt, imageDataUrl);
  if (!text.trim()) {
    throw new Error('Gemini returnerade tom OCR-text.');
  }

  return text;
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

      lastError = new Error(`Tomt eller ogiltigt JSON-svar fran Gemini-modell ${model}.`);
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

  throw new Error('Gemini returnerade inget JSON-svar.');
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
    'Transkribera all tydlig text i bilden rad-for-rad. Behall bokstaver och siffror exakt, inklusive separata block som "408 FL205". Returnera bara text utan forklaringar.';

  const text = await callGeminiTextNonEmpty(prompt, imageDataUrl);
  return text.slice(0, 2000);
}

async function extractSystemPositionDirectWithGemini(
  imageDataUrl: string
): Promise<string> {
  const prompt =
    'Las objektskylten och returnera ENDAST systemPositionId som en token utan extra text. ' +
    'Tillat format som 408FL205, VP-1024, AHU12. Om osaker, returnera MANUELL-KRAVS.';

  const text = await callGeminiTextNonEmpty(prompt, imageDataUrl);
  return extractSystemPositionFromText(text);
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

  let ocrText = '';
  let ocrError = '';
  try {
    ocrText = await transcribeImageWithGemini(imageDataUrl);
  } catch (error) {
    ocrError = summarizeError(error);
  }

  const ocrCandidate = extractSystemPositionFromText(ocrText);

  let directCandidate = '';
  let directError = '';
  if (!isLikelySystemPositionId(ocrCandidate)) {
    try {
      directCandidate = await extractSystemPositionDirectWithGemini(imageDataUrl);
    } catch (error) {
      directError = summarizeError(error);
    }
  }

  const prompt =
    'Du ar OCR-assistent for objektskyltar. Returnera ENDAST JSON med falten systemPositionId, confidence och notes. ' +
    'Om osakert: systemPositionId = "MANUELL-KRAVS". Prioritera stora ID-koder pa skylten (exempel: 408FL205, VP-1024). Om OCR visar "408 FL205", kombinera till "408FL205". ' +
    `OCR-text (kan innehalla fel): ${ocrText || 'saknas'}`;

  let parsed = {} as GeminiTextJson;
  let jsonError = '';
  try {
    parsed = await callGeminiJson(prompt, imageDataUrl);
  } catch (error) {
    jsonError = summarizeError(error);
  }
  const geminiCandidate = sanitizeSystemPositionId(parsed.systemPositionId);
  const directNormalized = sanitizeSystemPositionId(directCandidate);

  let finalId = '';
  let confidence = clampConfidence(parsed.confidence);
  let source = 'gemini';

  if (isLikelySystemPositionId(geminiCandidate)) {
    finalId = geminiCandidate;
  } else if (isLikelySystemPositionId(directNormalized)) {
    finalId = directNormalized;
    confidence = Math.max(0.58, confidence);
    source = 'direct-fallback';
  } else if (isLikelySystemPositionId(ocrCandidate)) {
    finalId = ocrCandidate;
    confidence = Math.max(0.62, confidence);
    source = 'ocr-fallback';
  } else {
    finalId = 'MANUELL-KRAVS';
    confidence = Math.min(confidence, 0.35);
    source = 'fallback';
  }

  const noteParts: string[] = [];
  if (parsed.notes?.trim()) {
    noteParts.push(parsed.notes.trim());
  }
  if (ocrError) {
    noteParts.push(`OCR-fel: ${ocrError}`);
  }
  if (directError) {
    noteParts.push(`Direkt-ID-fel: ${directError}`);
  }
  if (jsonError) {
    noteParts.push(`JSON-fel: ${jsonError}`);
  }
  if (ocrCandidate) {
    noteParts.push(`OCR-kandidat: ${ocrCandidate}`);
  }
  if (directNormalized) {
    noteParts.push(`Direkt-kandidat: ${directNormalized}`);
  }
  if (ocrText) {
    noteParts.push(`OCR: ${ocrText.slice(0, 160)}`);
  }
  if (!noteParts.length) {
    noteParts.push('Kontrollera ID innan du sparar.');
  }
  if (
    noteParts.length === 1 &&
    noteParts[0] === 'Kontrollera ID innan du sparar.' &&
    (isQuotaError(ocrError) || isQuotaError(jsonError) || isQuotaError(directError))
  ) {
    noteParts[0] = 'Gemini kvot/rate-limit blockerade avlasningen. Ange ID manuellt tills kvoten ater ar tillganglig.';
  }

  if (finalId === 'MANUELL-KRAVS') {
    console.warn('[systemposition] ID detection fallback', {
      source,
      ocrError,
      directError,
      jsonError,
      ocrCandidate,
      directCandidate: directNormalized,
      geminiCandidate,
      ocrTextPreview: ocrText.slice(0, 120)
    });
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
