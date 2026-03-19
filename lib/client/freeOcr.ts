'use client';

import { ComponentAnalysis, SystemPositionAnalysis } from '@/lib/types';

type OcrEngine = 'text-detector' | 'tesseract-raw' | 'tesseract-contrast' | 'fallback';

type OcrScanResult = {
  text: string;
  confidence: number;
  engine: OcrEngine;
  diagnostics: string[];
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

let workerPromise: Promise<LocalWorker> | null = null;

function sanitizeSystemId(value: string | undefined): string {
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

function isLikelySystemId(value: string): boolean {
  const normalized = sanitizeSystemId(value);
  if (!normalized || normalized.length < 4 || normalized.length > 20) {
    return false;
  }

  if (SYSTEM_ID_BLACKLIST.has(normalized)) {
    return false;
  }

  if (
    /(GEMINI|QUOTA|RESOURCE|EXHAUSTED|ERROR|HTTP|RATE|GOOGLE|GENERATIVELANGUAGE|API)/.test(
      normalized
    )
  ) {
    return false;
  }

  return /[A-Z]/.test(normalized) && /[0-9]/.test(normalized);
}

function scoreSystemIdCandidate(value: string): number {
  const candidate = sanitizeSystemId(value);
  if (!isLikelySystemId(candidate)) {
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
  }

  const transitions = candidate.match(/[0-9][A-Z]|[A-Z][0-9]/g)?.length ?? 0;
  score += Math.min(3, transitions);
  return score;
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
    const normalized = sanitizeSystemId(candidate);
    if (!normalized) {
      return;
    }

    const score = scoreSystemIdCandidate(normalized);
    if (score < 0) {
      return;
    }

    const finalScore = score + bonus;
    if (finalScore > bestScore || (finalScore === bestScore && normalized.length > best.length)) {
      bestScore = finalScore;
      best = normalized;
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
        evaluate(slice.join('-'), 1);
      }
    }
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

async function runLocalOcr(imageDataUrl: string): Promise<OcrScanResult> {
  const diagnostics: string[] = [];

  try {
    const blob = await dataUrlToBlob(imageDataUrl);
    const detector = await recognizeWithTextDetector(blob);
    diagnostics.push(...detector.diagnostics);

    if (detector.text) {
      return detector;
    }
  } catch (error) {
    diagnostics.push(`TextDetector-fel: ${String(error).slice(0, 120)}`);
  }

  try {
    const raw = await recognizeWithTesseract(imageDataUrl, 'tesseract-raw');
    diagnostics.push(...raw.diagnostics);
    if (raw.text) {
      return { ...raw, diagnostics };
    }
  } catch (error) {
    diagnostics.push(`Tesseract-fel: ${String(error).slice(0, 120)}`);
  }

  try {
    const enhanced = await createHighContrastDataUrl(imageDataUrl);
    const contrast = await recognizeWithTesseract(enhanced, 'tesseract-contrast');
    diagnostics.push(...contrast.diagnostics);
    return { ...contrast, diagnostics };
  } catch (error) {
    diagnostics.push(`Kontrast-OCR-fel: ${String(error).slice(0, 120)}`);
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

  const ocr = await runLocalOcr(imageDataUrl);
  const candidate = extractSystemIdFromText(ocr.text);

  if (isLikelySystemId(candidate)) {
    return {
      systemPositionId: candidate,
      confidence: Math.max(0.35, ocr.confidence || 0.55),
      notes: `Lokal OCR (${ocr.engine}). OCR: ${summarizeText(ocr.text)}`,
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

  const ocr = await runLocalOcr(imageDataUrl);
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
