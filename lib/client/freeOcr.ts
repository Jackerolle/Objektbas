'use client';

import { ComponentAnalysis, SystemPositionAnalysis } from '@/lib/types';

type OcrEngine =
  | 'text-detector'
  | 'tesseract-raw'
  | 'tesseract-contrast'
  | 'tesseract-focus'
  | 'tesseract-idline'
  | 'fallback';

type OcrScanResult = {
  text: string;
  confidence: number;
  engine: OcrEngine;
  diagnostics: string[];
  candidate?: string;
  candidateScore?: number;
};

type LocalWorker = {
  setParameters: (params: Record<string, string>) => Promise<unknown>;
  recognize: (
    image: string,
    options?: Record<string, unknown>
  ) => Promise<{ data?: { text?: string; confidence?: number } }>;
  terminate: () => Promise<unknown>;
};

const SYSTEM_ID_BLACKLIST = new Set([
  'MANUELL-KRAVS',
  'UNKNOWN',
  'OKAND',
  'N/A',
  'NA'
]);
const SYSTEM_ID_PATTERN = /^\d{3}[A-Z]{2}\d{3,4}$/;
const KNOWN_SYSTEM_MIDDLES = new Set(['AG', 'FL', 'SE']);

type Variant = { value: string; penalty: number };

let workerPromise: Promise<LocalWorker> | null = null;

function sanitizeSystemId(value: string | undefined): string {
  if (!value) {
    return '';
  }

  return value
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/[^A-Z0-9]/g, '');
}

function isLikelySystemId(value: string): boolean {
  const normalized = sanitizeSystemId(value);
  if (!normalized || normalized.length < 8 || normalized.length > 9) {
    return false;
  }

  if (SYSTEM_ID_BLACKLIST.has(normalized)) {
    return false;
  }

  if (
    /(OPENAI|QUOTA|RESOURCE|EXHAUSTED|ERROR|HTTP|RATE|API)/.test(
      normalized
    )
  ) {
    return false;
  }

  return SYSTEM_ID_PATTERN.test(normalized);
}

function scoreSystemIdCandidate(value: string): number {
  const candidate = sanitizeSystemId(value);
  if (!isLikelySystemId(candidate)) {
    return -1;
  }

  const prefix = candidate.slice(0, 3);
  const middle = candidate.slice(3, 5);
  const suffix = candidate.slice(5);
  let score = 30;

  if (/^[0-9]{3}$/.test(prefix)) {
    score += 6;
  }
  if (/^[A-Z]{2}$/.test(middle)) {
    score += 6;
  }
  if (/^[0-9]{3,4}$/.test(suffix)) {
    score += 6;
  }
  if (KNOWN_SYSTEM_MIDDLES.has(middle)) {
    score += 3;
  }
  if (suffix.length === 4) {
    score -= 0.6;
  }

  return score;
}

function digitVariantsForChar(char: string): Variant[] {
  if (/^[0-9]$/.test(char)) {
    return [{ value: char, penalty: 0 }];
  }

  switch (char) {
    case 'O':
    case 'Q':
      return [{ value: '0', penalty: 0.12 }];
    case 'D':
      return [{ value: '0', penalty: 0.22 }];
    case 'I':
    case 'L':
      return [{ value: '1', penalty: 0.18 }];
    case 'Z':
      return [{ value: '2', penalty: 0.24 }];
    case 'A':
      return [{ value: '4', penalty: 0.18 }];
    case 'S':
      return [
        { value: '8', penalty: 0.12 },
        { value: '5', penalty: 0.28 }
      ];
    case 'G':
      return [{ value: '6', penalty: 0.26 }];
    case 'T':
      return [{ value: '7', penalty: 0.28 }];
    case 'B':
      return [{ value: '8', penalty: 0.2 }];
    default:
      return [];
  }
}

function letterVariantsForChar(char: string): Variant[] {
  if (/^[A-Z]$/.test(char)) {
    return [{ value: char, penalty: 0 }];
  }

  switch (char) {
    case '0':
      return [{ value: 'O', penalty: 0.2 }];
    case '1':
      return [
        { value: 'I', penalty: 0.2 },
        { value: 'L', penalty: 0.28 }
      ];
    case '2':
      return [{ value: 'Z', penalty: 0.26 }];
    case '4':
      return [{ value: 'A', penalty: 0.24 }];
    case '5':
      return [{ value: 'S', penalty: 0.24 }];
    case '6':
      return [{ value: 'G', penalty: 0.28 }];
    case '7':
      return [{ value: 'T', penalty: 0.28 }];
    case '8':
      return [{ value: 'B', penalty: 0.26 }];
    default:
      return [];
  }
}

function combineVariants(
  current: Variant[],
  nextOptions: Variant[],
  maxVariants: number
): Variant[] {
  const combined: Variant[] = [];

  for (const prefix of current) {
    for (const option of nextOptions) {
      combined.push({
        value: `${prefix.value}${option.value}`,
        penalty: prefix.penalty + option.penalty
      });
    }
  }

  combined.sort((a, b) => a.penalty - b.penalty);
  return combined.slice(0, maxVariants);
}

function normalizeToDigitsVariants(segment: string, maxVariants = 8): Variant[] {
  let variants: Variant[] = [{ value: '', penalty: 0 }];

  for (const char of segment) {
    const options = digitVariantsForChar(char);
    if (!options.length) {
      return [];
    }

    variants = combineVariants(variants, options, maxVariants);
  }

  return variants;
}

function normalizeToLettersVariants(segment: string, maxVariants = 8): Variant[] {
  let variants: Variant[] = [{ value: '', penalty: 0 }];

  for (const char of segment) {
    const options = letterVariantsForChar(char);
    if (!options.length) {
      return [];
    }

    variants = combineVariants(variants, options, maxVariants);
  }

  return variants;
}

function buildPatternCorrectedCandidates(rawCandidate: string): Variant[] {
  const compact = sanitizeSystemId(rawCandidate);
  if (!compact) {
    return [];
  }

  const results = new Map<string, number>();

  const tryPattern = (segment: string) => {
    const prefix = segment.slice(0, 3);
    const middle = segment.slice(3, 5);
    const suffix = segment.slice(5);

    const prefixVariants = normalizeToDigitsVariants(prefix);
    const middleVariants = normalizeToLettersVariants(middle);
    const suffixVariants = normalizeToDigitsVariants(suffix);

    if (!prefixVariants.length || !middleVariants.length || !suffixVariants.length) {
      return;
    }

    for (const prefixVariant of prefixVariants) {
      for (const middleVariant of middleVariants) {
        for (const suffixVariant of suffixVariants) {
          const value = `${prefixVariant.value}${middleVariant.value}${suffixVariant.value}`;
          const penalty = prefixVariant.penalty + middleVariant.penalty + suffixVariant.penalty;
          const current = results.get(value);
          if (current === undefined || penalty < current) {
            results.set(value, penalty);
          }
        }
      }
    }
  };

  for (const targetLength of [8, 9]) {
    if (compact.length < targetLength) {
      continue;
    }

    for (let offset = 0; offset <= compact.length - targetLength; offset += 1) {
      const segment = compact.slice(offset, offset + targetLength);
      tryPattern(segment);
    }
  }

  if (compact.length === 8 || compact.length === 9) {
    results.set(compact, 0);
  }

  return Array.from(results.entries()).map(([value, penalty]) => ({ value, penalty }));
}

function extractSystemIdFromText(rawText: string): string {
  const lines = rawText
    .toUpperCase()
    .split(/\r?\n/g)
    .map((line) => line.replace(/[^A-Z0-9\-\s]/g, ' ').trim())
    .filter(Boolean);

  let best = '';
  let bestScore = -1;

  const evaluate = (candidate: string, bonus = 0) => {
    for (const variant of buildPatternCorrectedCandidates(candidate)) {
      const score = scoreSystemIdCandidate(variant.value);
      if (score < 0) {
        continue;
      }

      const correctionBonus = variant.value === sanitizeSystemId(candidate) ? 0 : 4;
      const lengthPenalty = variant.value.length === 9 ? 0.75 : 0;
      const conversionPenalty = variant.penalty * 3;
      const finalScore =
        score + bonus + correctionBonus - lengthPenalty - conversionPenalty;
      if (
        finalScore > bestScore ||
        (finalScore === bestScore && variant.value.length > best.length)
      ) {
        bestScore = finalScore;
        best = variant.value;
      }
    }
  };

  for (const line of lines) {
    const words = line
      .split(/\s+/)
      .map((word) => sanitizeSystemId(word))
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
      }
    }

    evaluate(words.join(''), 1);
  }

  return best;
}

function summarizeText(text: string, max = 180): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  return compact.length > max ? `${compact.slice(0, max)}...` : compact;
}

function pickComponentValue(text: string): string {
  const lines = text
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) {
    return '';
  }

  const prioritized =
    lines.find((line) => /[A-Z].*[0-9]|[0-9].*[A-Z]/i.test(line) && line.length >= 4) ??
    lines.find((line) => line.length >= 4) ??
    lines[0];

  return prioritized.slice(0, 80);
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const response = await fetch(dataUrl);
  if (!response.ok) {
    throw new Error('Kunde inte lasa bilddata for OCR.');
  }

  return response.blob();
}

function fitWithinBounds(
  width: number,
  height: number,
  maxDimension: number
): { width: number; height: number } {
  if (!width || !height) {
    return { width: 1, height: 1 };
  }

  if (width <= maxDimension && height <= maxDimension) {
    return { width, height };
  }

  const scale = Math.min(maxDimension / width, maxDimension / height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  };
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Kunde inte lasa bild for OCR.'));
    image.src = source;
  });
}

async function createHighContrastDataUrl(dataUrl: string): Promise<string> {
  const image = await loadImage(dataUrl);
  const bounds = fitWithinBounds(
    image.naturalWidth || image.width,
    image.naturalHeight || image.height,
    2600
  );

  const canvas = document.createElement('canvas');
  canvas.width = bounds.width;
  canvas.height = bounds.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas saknas for OCR-filter.');
  }

  ctx.drawImage(image, 0, 0, bounds.width, bounds.height);

  const frame = ctx.getImageData(0, 0, bounds.width, bounds.height);
  const pixels = frame.data;

  // Simple thresholding to improve text contrast for labels.
  for (let i = 0; i < pixels.length; i += 4) {
    const gray = pixels[i] * 0.299 + pixels[i + 1] * 0.587 + pixels[i + 2] * 0.114;
    const boosted = gray > 150 ? 255 : 0;
    pixels[i] = boosted;
    pixels[i + 1] = boosted;
    pixels[i + 2] = boosted;
  }

  ctx.putImageData(frame, 0, 0);
  return canvas.toDataURL('image/jpeg', 0.95);
}

async function createFocusedPlateDataUrl(dataUrl: string): Promise<string> {
  const image = await loadImage(dataUrl);
  const bounds = fitWithinBounds(
    image.naturalWidth || image.width,
    image.naturalHeight || image.height,
    2600
  );

  const baseCanvas = document.createElement('canvas');
  baseCanvas.width = bounds.width;
  baseCanvas.height = bounds.height;
  const baseCtx = baseCanvas.getContext('2d');
  if (!baseCtx) {
    throw new Error('Canvas saknas for fokusbeskarning.');
  }

  baseCtx.drawImage(image, 0, 0, bounds.width, bounds.height);

  const cropX = Math.round(bounds.width * 0.08);
  const cropY = Math.round(bounds.height * 0.45);
  const cropW = Math.round(bounds.width * 0.84);
  const cropH = Math.round(bounds.height * 0.48);

  const focusedCanvas = document.createElement('canvas');
  focusedCanvas.width = Math.max(1, Math.round(cropW * 1.6));
  focusedCanvas.height = Math.max(1, Math.round(cropH * 1.6));
  const focusedCtx = focusedCanvas.getContext('2d');
  if (!focusedCtx) {
    throw new Error('Canvas saknas for fokuserad OCR.');
  }

  focusedCtx.drawImage(
    baseCanvas,
    cropX,
    cropY,
    cropW,
    cropH,
    0,
    0,
    focusedCanvas.width,
    focusedCanvas.height
  );

  return focusedCanvas.toDataURL('image/jpeg', 0.95);
}

async function createIdLineDataUrl(dataUrl: string): Promise<string> {
  const image = await loadImage(dataUrl);
  const bounds = fitWithinBounds(
    image.naturalWidth || image.width,
    image.naturalHeight || image.height,
    2800
  );

  const canvas = document.createElement('canvas');
  canvas.width = bounds.width;
  canvas.height = bounds.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas saknas for id-rad OCR.');
  }

  ctx.drawImage(image, 0, 0, bounds.width, bounds.height);

  const cropX = Math.round(bounds.width * 0.1);
  const cropY = Math.round(bounds.height * 0.54);
  const cropW = Math.round(bounds.width * 0.8);
  const cropH = Math.round(bounds.height * 0.22);

  const idCanvas = document.createElement('canvas');
  idCanvas.width = Math.max(1, Math.round(cropW * 2.2));
  idCanvas.height = Math.max(1, Math.round(cropH * 2.2));
  const idCtx = idCanvas.getContext('2d');
  if (!idCtx) {
    throw new Error('Canvas saknas for id-rad OCR.');
  }

  idCtx.drawImage(
    canvas,
    cropX,
    cropY,
    cropW,
    cropH,
    0,
    0,
    idCanvas.width,
    idCanvas.height
  );

  const frame = idCtx.getImageData(0, 0, idCanvas.width, idCanvas.height);
  const pixels = frame.data;
  for (let i = 0; i < pixels.length; i += 4) {
    const gray = pixels[i] * 0.299 + pixels[i + 1] * 0.587 + pixels[i + 2] * 0.114;
    const boosted = gray > 165 ? 255 : 0;
    pixels[i] = boosted;
    pixels[i + 1] = boosted;
    pixels[i + 2] = boosted;
  }
  idCtx.putImageData(frame, 0, 0);

  return idCanvas.toDataURL('image/jpeg', 0.96);
}

async function recognizeWithTextDetector(blob: Blob): Promise<OcrScanResult> {
  if (typeof window === 'undefined' || typeof createImageBitmap !== 'function') {
    return {
      text: '',
      confidence: 0,
      engine: 'fallback',
      diagnostics: ['TextDetector ar inte tillganglig i denna enhet/browser.']
    };
  }

  const maybeWindow = window as Window & {
    TextDetector?: new () => {
      detect: (image: ImageBitmap) => Promise<Array<{ rawValue?: string }>>;
    };
  };

  if (typeof maybeWindow.TextDetector !== 'function') {
    return {
      text: '',
      confidence: 0,
      engine: 'fallback',
      diagnostics: ['TextDetector finns inte i browsern.']
    };
  }

  const bitmap = await createImageBitmap(blob);
  try {
    const detector = new maybeWindow.TextDetector();
    const blocks = await detector.detect(bitmap);
    const text = blocks
      .map((block) => block.rawValue ?? '')
      .filter(Boolean)
      .join('\n')
      .trim();

    return {
      text,
      confidence: text ? 0.88 : 0,
      engine: 'text-detector',
      diagnostics: text ? [] : ['TextDetector hittade ingen text i bilden.']
    };
  } finally {
    if (typeof bitmap.close === 'function') {
      bitmap.close();
    }
  }
}

async function getTesseractWorker(): Promise<LocalWorker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const module = await import('tesseract.js');
      const createWorkerFn = (
        module as unknown as { createWorker?: (...args: unknown[]) => Promise<LocalWorker> }
      ).createWorker;

      if (typeof createWorkerFn !== 'function') {
        throw new Error('Tesseract kunde inte laddas.');
      }

      const worker = await createWorkerFn('eng', 1, {
        logger: () => {
          // No-op: avoid noisy OCR progress in console.
        }
      });

      await worker.setParameters({
        tessedit_pageseg_mode: '6',
        preserve_interword_spaces: '1',
        tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-'
      });

      return worker;
    })().catch((error) => {
      workerPromise = null;
      throw error;
    });
  }

  return workerPromise;
}

async function recognizeWithTesseract(
  imageDataUrl: string,
  engine: OcrEngine
): Promise<OcrScanResult> {
  const worker = await getTesseractWorker();
  const result = await worker.recognize(imageDataUrl, { rotateAuto: true });
  const text = result.data?.text?.trim() ?? '';
  const confidenceRaw = result.data?.confidence ?? 0;
  const confidence = Math.max(0, Math.min(1, confidenceRaw / 100));

  return {
    text,
    confidence,
    engine,
    diagnostics: text ? [] : ['Tesseract hittade ingen text i bilden.']
  };
}

function withSystemCandidate(scan: OcrScanResult): OcrScanResult {
  const candidate = extractSystemIdFromText(scan.text);
  const candidateScore = candidate ? scoreSystemIdCandidate(candidate) : -1;

  return {
    ...scan,
    candidate: candidate || undefined,
    candidateScore
  };
}

function chooseBestSystemIdScan(scans: OcrScanResult[]): OcrScanResult {
  const ranked = scans.map(withSystemCandidate);
  const engineBonus: Partial<Record<OcrEngine, number>> = {
    'tesseract-idline': 0.16,
    'tesseract-focus': 0.1,
    'tesseract-contrast': 0.07,
    'text-detector': 0.04
  };

  ranked.sort((a, b) => {
    const adjustedA =
      (a.candidateScore ?? -1) + a.confidence * 7 + (engineBonus[a.engine] ?? 0);
    const adjustedB =
      (b.candidateScore ?? -1) + b.confidence * 7 + (engineBonus[b.engine] ?? 0);
    const scoreDiff = adjustedB - adjustedA;
    if (scoreDiff !== 0) {
      return scoreDiff;
    }

    const confidenceDiff = b.confidence - a.confidence;
    if (confidenceDiff !== 0) {
      return confidenceDiff;
    }

    return b.text.length - a.text.length;
  });

  return ranked[0];
}

function chooseBestComponentScan(scans: OcrScanResult[]): OcrScanResult {
  const ranked = [...scans];
  ranked.sort((a, b) => {
    const confidenceDiff = b.confidence - a.confidence;
    if (confidenceDiff !== 0) {
      return confidenceDiff;
    }

    return b.text.length - a.text.length;
  });

  return ranked[0];
}

async function runLocalOcr(
  imageDataUrl: string,
  mode: 'system-id' | 'component' = 'component'
): Promise<OcrScanResult> {
  const diagnostics: string[] = [];
  const scans: OcrScanResult[] = [];

  try {
    const blob = await dataUrlToBlob(imageDataUrl);
    const detector = await recognizeWithTextDetector(blob);
    diagnostics.push(...detector.diagnostics);

    if (detector.text) {
      scans.push(detector);
    }
  } catch (error) {
    diagnostics.push(`TextDetector-fel: ${String(error).slice(0, 120)}`);
  }

  try {
    const raw = await recognizeWithTesseract(imageDataUrl, 'tesseract-raw');
    diagnostics.push(...raw.diagnostics);
    if (raw.text) {
      scans.push(raw);
    }
  } catch (error) {
    diagnostics.push(`Tesseract-fel: ${String(error).slice(0, 120)}`);
  }

  try {
    const enhanced = await createHighContrastDataUrl(imageDataUrl);
    const contrast = await recognizeWithTesseract(enhanced, 'tesseract-contrast');
    diagnostics.push(...contrast.diagnostics);
    if (contrast.text) {
      scans.push(contrast);
    }
  } catch (error) {
    diagnostics.push(`Kontrast-OCR-fel: ${String(error).slice(0, 120)}`);
  }

  try {
    const focused = await createFocusedPlateDataUrl(imageDataUrl);
    const focus = await recognizeWithTesseract(focused, 'tesseract-focus');
    diagnostics.push(...focus.diagnostics);
    if (focus.text) {
      scans.push(focus);
    }
  } catch (error) {
    diagnostics.push(`Fokus-OCR-fel: ${String(error).slice(0, 120)}`);
  }

  try {
    const idLine = await createIdLineDataUrl(imageDataUrl);
    const idLineResult = await recognizeWithTesseract(idLine, 'tesseract-idline');
    diagnostics.push(...idLineResult.diagnostics);
    if (idLineResult.text) {
      scans.push(idLineResult);
    }
  } catch (error) {
    diagnostics.push(`ID-rad-OCR-fel: ${String(error).slice(0, 120)}`);
  }

  if (scans.length > 0) {
    const selected =
      mode === 'system-id' ? chooseBestSystemIdScan(scans) : chooseBestComponentScan(scans);

    return {
      ...selected,
      diagnostics
    };
  }

  return {
    text: '',
    confidence: 0,
    engine: 'fallback',
    diagnostics
  };
}

export async function analyzeSystemPositionLocally(
  imageDataUrl: string
): Promise<SystemPositionAnalysis> {
  if (typeof window === 'undefined') {
    return {
      systemPositionId: 'MANUELL-KRAVS',
      confidence: 0.1,
      notes: 'Lokal OCR kan bara koras i webblasaren. Ange ID manuellt.',
      provider: 'local-fallback',
      requiresManualConfirmation: true
    };
  }

  const ocr = await runLocalOcr(imageDataUrl, 'system-id');
  const candidate = ocr.candidate || extractSystemIdFromText(ocr.text);

  if (isLikelySystemId(candidate)) {
    const scoreBoost = Math.max(0, ocr.candidateScore ?? 0);
    const confidenceFromScore = Math.min(0.94, 0.35 + scoreBoost * 0.03);
    return {
      systemPositionId: candidate,
      confidence: Math.max(0.35, ocr.confidence || 0.55, confidenceFromScore),
      notes: `Lokal OCR (${ocr.engine}). ID-kandidat: ${candidate}. OCR: ${summarizeText(
        ocr.text
      )}`,
      provider: `local-${ocr.engine}`,
      requiresManualConfirmation: true
    };
  }

  const diagnostics = ocr.diagnostics.filter(Boolean).join(' | ');
  return {
    systemPositionId: 'MANUELL-KRAVS',
    confidence: 0.1,
    notes: diagnostics
      ? `Lokal OCR kunde inte lasa ID. ${diagnostics}`
      : 'Lokal OCR kunde inte lasa ID. Ange systemposition manuellt.',
    provider: 'local-fallback',
    requiresManualConfirmation: true
  };
}

export async function analyzeComponentLocally(
  componentType: string,
  imageDataUrl: string
): Promise<ComponentAnalysis> {
  if (typeof window === 'undefined') {
    return {
      componentType,
      identifiedValue: `Manuell avlasning: ${componentType}`,
      confidence: 0.1,
      notes: 'Lokal OCR kan bara koras i webblasaren. Fyll i manuellt.',
      provider: 'local-fallback',
      requiresManualConfirmation: true,
      suggestedAttributes: {}
    };
  }

  const ocr = await runLocalOcr(imageDataUrl, 'component');
  const identifiedValue = pickComponentValue(ocr.text);

  if (!identifiedValue) {
    const diagnostics = ocr.diagnostics.filter(Boolean).join(' | ');
    return {
      componentType,
      identifiedValue: `Ej avlast (${componentType})`,
      confidence: 0.1,
      notes: diagnostics
        ? `Lokal OCR hittade ingen tydlig komponenttext. ${diagnostics}`
        : 'Lokal OCR hittade ingen tydlig komponenttext. Bekrafta manuellt.',
      provider: 'local-fallback',
      requiresManualConfirmation: true,
      suggestedAttributes: {}
    };
  }

  return {
    componentType,
    identifiedValue,
    confidence: Math.max(0.25, ocr.confidence || 0.45),
    notes: `Lokal OCR (${ocr.engine}): ${summarizeText(ocr.text)}`,
    provider: `local-${ocr.engine}`,
    requiresManualConfirmation: true,
    suggestedAttributes: {}
  };
}
