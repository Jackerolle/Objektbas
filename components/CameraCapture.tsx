'use client';

import type { ChangeEvent } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';

type Props = {
  onCapture: (dataUrl: string) => void | Promise<void>;
  title?: string;
  subtitle?: string;
  captureLabel?: string;
  helperText?: string;
  disabled?: boolean;
  uploadLabel?: string;
  allowBatchUpload?: boolean;
  onRegisterCameraTrigger?: ((trigger: (() => void) | null) => void) | undefined;
};

type FileSource = 'camera' | 'gallery';

const IMAGE_ACCEPT = 'image/*,image/heic,image/heif';
const MAX_IMAGE_DIMENSION = 2200;
const MAX_IMAGE_BYTES = 4_500_000;
const MAX_RAW_FILE_BYTES = 18_000_000;

function estimateDataUrlBytes(dataUrl: string): number {
  const commaIndex = dataUrl.indexOf(',');
  if (commaIndex < 0) {
    return 0;
  }

  const base64 = dataUrl.slice(commaIndex + 1);
  return Math.ceil((base64.length * 3) / 4);
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

function encodeCanvasToJpeg(canvas: HTMLCanvasElement, maxBytes: number): string {
  const encodeAtQuality = (quality: number) => canvas.toDataURL('image/jpeg', quality);

  let quality = 0.94;
  let output = encodeAtQuality(quality);

  while (estimateDataUrlBytes(output) > maxBytes && quality > 0.62) {
    quality -= 0.06;
    output = encodeAtQuality(quality);
  }

  if (estimateDataUrlBytes(output) <= maxBytes) {
    return output;
  }

  let workingCanvas = canvas;

  for (let i = 0; i < 4; i += 1) {
    const nextWidth = Math.max(1, Math.round(workingCanvas.width * 0.9));
    const nextHeight = Math.max(1, Math.round(workingCanvas.height * 0.9));

    if (nextWidth === workingCanvas.width && nextHeight === workingCanvas.height) {
      break;
    }

    const resized = document.createElement('canvas');
    resized.width = nextWidth;
    resized.height = nextHeight;
    const ctx = resized.getContext('2d');

    if (!ctx) {
      break;
    }

    ctx.drawImage(workingCanvas, 0, 0, nextWidth, nextHeight);
    workingCanvas = resized;

    quality = 0.9;
    output = workingCanvas.toDataURL('image/jpeg', quality);

    while (estimateDataUrlBytes(output) > maxBytes && quality > 0.6) {
      quality -= 0.06;
      output = workingCanvas.toDataURL('image/jpeg', quality);
    }

    if (estimateDataUrlBytes(output) <= maxBytes) {
      break;
    }
  }

  return output;
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Kunde inte läsa bildfilen.'));
    image.src = source;
  });
}

async function normalizeImageDataUrl(dataUrl: string): Promise<string> {
  const image = await loadImage(dataUrl);
  const { width, height } = fitWithinBounds(
    image.naturalWidth || image.width,
    image.naturalHeight || image.height,
    MAX_IMAGE_DIMENSION
  );

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas kunde inte initieras.');
  }

  ctx.drawImage(image, 0, 0, width, height);
  return encodeCanvasToJpeg(canvas, MAX_IMAGE_BYTES);
}

function isImageFile(file: File): boolean {
  if (file.type.startsWith('image/')) {
    return true;
  }

  return /\.(heic|heif)$/i.test(file.name);
}

function toUserErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message.trim() : '';
  if (!message) {
    return 'Kunde inte hantera bilden. Prova igen med ett nytt foto.';
  }

  if (/openai-fel \\(429\\)|resource_exhausted|quota exceeded/i.test(message)) {
    return 'OCR/AI-kvot tillfalligt slut. Vanta en stund eller komplettera manuellt.';
  }

  if (/quota|resource_exhausted|429|rate/i.test(message)) {
    return 'AI-kvoten är slut just nu. Ta bilden och använd manuell registrering tills kvoten är tillbaka.';
  }

  if (/network|failed to fetch|fetch failed/i.test(message)) {
    return 'Nätverksfel vid uppladdning. Kontrollera uppkoppling och försök igen.';
  }

  return message.slice(0, 240);
}

export function CameraCapture({
  onCapture,
  title = 'Fota objekt',
  subtitle = 'Steg',
  captureLabel = 'Ta foto med enhet',
  helperText,
  disabled = false,
  uploadLabel = 'Ladda upp foto',
  allowBatchUpload = false,
  onRegisterCameraTrigger
}: Props) {
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const deviceCameraInputRef = useRef<HTMLInputElement>(null);

  const [error, setError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [lastCaptureInfo, setLastCaptureInfo] = useState<string>('');

  const isMobileDevice = useMemo(() => {
    if (typeof navigator === 'undefined') {
      return false;
    }

    return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  }, []);

  const emitCapture = async (dataUrl: string) => {
    if (!dataUrl.trim()) {
      throw new Error('Ingen bilddata hittades.');
    }

    setIsSubmitting(true);
    try {
      await Promise.resolve(onCapture(dataUrl));
    } finally {
      setIsSubmitting(false);
    }
  };

  const openInputPicker = (input: HTMLInputElement | null) => {
    if (!input) {
      return;
    }

    input.value = '';
    try {
      const inputWithPicker = input as HTMLInputElement & {
        showPicker?: () => void;
      };

      if (typeof inputWithPicker.showPicker === 'function') {
        inputWithPicker.showPicker();
        return;
      }
    } catch {
      // Fallback to click.
    }

    input.click();
  };

  const handlePickGallery = () => {
    if (disabled || isUploading || isSubmitting) {
      return;
    }

    setError(null);
    setLastCaptureInfo('');
    openInputPicker(galleryInputRef.current);
  };

  const handlePickDeviceCamera = () => {
    if (disabled || isUploading || isSubmitting) {
      return;
    }

    setError(null);
    setLastCaptureInfo('');
    openInputPicker(deviceCameraInputRef.current);
  };

  useEffect(() => {
    if (!onRegisterCameraTrigger) {
      return;
    }

    onRegisterCameraTrigger(() => {
      if (disabled || isUploading || isSubmitting) {
        return;
      }

      setError(null);
      setLastCaptureInfo('');
      openInputPicker(deviceCameraInputRef.current);
    });

    return () => {
      onRegisterCameraTrigger(null);
    };
  }, [disabled, isSubmitting, isUploading, onRegisterCameraTrigger]);

  const readFileToDataUrl = async (file: File): Promise<string> => {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ''));
      reader.onerror = () => reject(new Error('Kunde inte läsa filen.'));
      reader.readAsDataURL(file);
    });
  };

  const processFileToDataUrl = async (file: File): Promise<string> => {
    if (!isImageFile(file)) {
      throw new Error('Filen måste vara en bild.');
    }

    if (file.size > MAX_RAW_FILE_BYTES) {
      throw new Error('Bilden är för stor. Ta en ny bild med lägre upplösning.');
    }

    const rawDataUrl = await readFileToDataUrl(file);
    if (!rawDataUrl) {
      throw new Error('Filen är tom eller ogiltig.');
    }

    try {
      return await normalizeImageDataUrl(rawDataUrl);
    } catch (normalizeError) {
      console.warn('Kunde inte normalisera bild. Faller tillbaka till originaldata.', normalizeError);

      if (estimateDataUrlBytes(rawDataUrl) > MAX_RAW_FILE_BYTES) {
        throw new Error('Kunde inte bearbeta bilden. Prova med ett nytt foto.');
      }

      return rawDataUrl;
    }
  };

  const handleFileChange = async (
    event: ChangeEvent<HTMLInputElement>,
    source: FileSource
  ) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';

    if (!files.length || disabled || isSubmitting) {
      return;
    }

    setError(null);
    setIsUploading(true);

    try {
      const selectedFiles =
        source === 'gallery' && allowBatchUpload ? files : files.slice(0, 1);

      for (let index = 0; index < selectedFiles.length; index += 1) {
        const file = selectedFiles[index];
        const dataUrl = await processFileToDataUrl(file);
        await emitCapture(dataUrl);
        const batchText =
          selectedFiles.length > 1 ? ` (${index + 1}/${selectedFiles.length})` : '';
        setLastCaptureInfo(
          source === 'camera'
            ? `Foto taget och skickat för avläsning${batchText}.`
            : `Foto uppladdat och skickat för avläsning${batchText}.`
        );
      }
    } catch (uploadError) {
      console.error(uploadError);
      setError(toUserErrorMessage(uploadError));
    } finally {
      setIsUploading(false);
    }
  };

  const actionsDisabled = disabled || isUploading || isSubmitting;

  return (
    <section
      style={{
        borderRadius: '1rem',
        background: '#0b1120',
        padding: '1rem',
        border: '1px solid rgba(248, 250, 252, 0.15)'
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '0.5rem'
        }}
      >
        <div>
          <p style={{ fontSize: '0.8rem', color: '#94a3b8', margin: 0 }}>{subtitle}</p>
          <strong>{title}</strong>
        </div>
        <button
          onClick={handlePickGallery}
          disabled={actionsDisabled}
          style={{
            minHeight: '2.15rem',
            padding: '0.45rem 0.75rem',
            borderRadius: '999px',
            border: '1px solid rgba(148,163,184,0.45)',
            background: 'rgba(15,23,42,0.65)',
            color: '#e2e8f0',
            cursor: actionsDisabled ? 'not-allowed' : 'pointer',
            opacity: actionsDisabled ? 0.55 : 1,
            fontWeight: 600,
            fontSize: '0.82rem'
          }}
        >
          {isUploading ? 'Laser fil...' : uploadLabel}
        </button>
      </header>

      {error && (
        <p style={{ margin: '0.75rem 0 0', color: '#fda4af', fontSize: '0.82rem' }}>{error}</p>
      )}

      {helperText && (
        <p style={{ margin: '0.45rem 0 0', color: '#93c5fd', fontSize: '0.82rem' }}>
          {helperText}
        </p>
      )}

      {(isSubmitting || isUploading) && (
        <p style={{ margin: '0.45rem 0 0', color: '#67e8f9', fontSize: '0.82rem' }}>
          {isUploading ? 'Laser in bild...' : 'Bearbetar bild med OCR/AI...'}
        </p>
      )}

      {!!lastCaptureInfo && !isSubmitting && !isUploading && (
        <p style={{ margin: '0.45rem 0 0', color: '#86efac', fontSize: '0.82rem' }}>
          {lastCaptureInfo}
        </p>
      )}

      {isMobileDevice && !error && !isSubmitting && !isUploading && (
        <p style={{ margin: '0.45rem 0 0', color: '#cbd5e1', fontSize: '0.8rem' }}>
          Om kameran inte oppnas direkt, anvand "Ladda upp foto" och valj "Ta bild".
        </p>
      )}

      <input
        ref={galleryInputRef}
        type='file'
        accept={IMAGE_ACCEPT}
        multiple={allowBatchUpload}
        onChange={(event) => void handleFileChange(event, 'gallery')}
        style={{
          position: 'absolute',
          width: '1px',
          height: '1px',
          opacity: 0,
          pointerEvents: 'none'
        }}
      />

      <input
        ref={deviceCameraInputRef}
        type='file'
        accept={IMAGE_ACCEPT}
        capture='environment'
        onChange={(event) => void handleFileChange(event, 'camera')}
        style={{
          position: 'absolute',
          width: '1px',
          height: '1px',
          opacity: 0,
          pointerEvents: 'none'
        }}
      />

      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
        <button
          onClick={handlePickDeviceCamera}
          disabled={actionsDisabled}
          style={{
            flex: 1,
            minHeight: '2.9rem',
            padding: '0.85rem',
            borderRadius: '999px',
            border: 'none',
            background: 'linear-gradient(120deg, rgba(94,234,212,0.8), rgba(59,130,246,0.9))',
            color: '#020617',
            fontWeight: 700,
            fontSize: '1rem',
            cursor: actionsDisabled ? 'not-allowed' : 'pointer',
            opacity: actionsDisabled ? 0.55 : 1
          }}
        >
          {captureLabel}
        </button>
      </div>
    </section>
  );
}
