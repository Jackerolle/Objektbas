'use client';

import { useRef, useState } from 'react';
import type { ChangeEvent } from 'react';

type Props = {
  onCapture: (dataUrl: string) => void | Promise<void>;
  title?: string;
  subtitle?: string;
  captureLabel?: string;
  helperText?: string;
  disabled?: boolean;
  uploadLabel?: string;
};

const MAX_IMAGE_DIMENSION = 1600;
const MAX_IMAGE_BYTES = 2_400_000;

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

  let quality = 0.88;
  let output = encodeAtQuality(quality);

  while (estimateDataUrlBytes(output) > maxBytes && quality > 0.5) {
    quality -= 0.08;
    output = encodeAtQuality(quality);
  }

  if (estimateDataUrlBytes(output) <= maxBytes) {
    return output;
  }

  let workingCanvas = canvas;

  for (let i = 0; i < 4; i += 1) {
    const nextWidth = Math.max(1, Math.round(workingCanvas.width * 0.82));
    const nextHeight = Math.max(1, Math.round(workingCanvas.height * 0.82));

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

    quality = 0.84;
    output = workingCanvas.toDataURL('image/jpeg', quality);

    while (estimateDataUrlBytes(output) > maxBytes && quality > 0.45) {
      quality -= 0.08;
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
    image.onerror = () => reject(new Error('Kunde inte lÃ¤sa bildfilen.'));
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

export function CameraCapture({
  onCapture,
  title = 'Fota objekt',
  subtitle = 'Steg',
  captureLabel = 'Ta foto med enhet',
  helperText,
  disabled = false,
  uploadLabel = 'Ladda upp foto'
}: Props) {
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const deviceCameraInputRef = useRef<HTMLInputElement>(null);

  const [error, setError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

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

  const handlePickGallery = () => {
    if (disabled || isUploading || isSubmitting) {
      return;
    }

    if (galleryInputRef.current) {
      galleryInputRef.current.value = '';
      galleryInputRef.current.click();
    }
  };

  const handlePickDeviceCamera = () => {
    if (disabled || isUploading || isSubmitting) {
      return;
    }

    if (deviceCameraInputRef.current) {
      deviceCameraInputRef.current.value = '';
      deviceCameraInputRef.current.click();
    }
  };

  const readFileToDataUrl = async (file: File): Promise<string> => {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ''));
      reader.onerror = () => reject(new Error('Kunde inte lÃ¤sa filen.'));
      reader.readAsDataURL(file);
    });
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';

    if (!file || disabled || isSubmitting) {
      return;
    }

    setError(null);
    setIsUploading(true);

    try {
      const rawDataUrl = await readFileToDataUrl(file);
      if (!rawDataUrl) {
        throw new Error('Filen Ã¤r tom eller ogiltig.');
      }

      const normalizedDataUrl = await normalizeImageDataUrl(rawDataUrl);
      if (!normalizedDataUrl) {
        throw new Error('Kunde inte bearbeta bilden.');
      }

      await emitCapture(normalizedDataUrl);
    } catch (uploadError) {
      console.error(uploadError);
      setError('Kunde inte lÃ¤sa bilden. Prova ett annat foto eller ta nytt med kameran.');
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
          <p style={{ fontSize: '0.8rem', color: '#94a3b8', margin: 0 }}>
            {subtitle}
          </p>
          <strong>{title}</strong>
        </div>
      </header>

      <div
        style={{
          borderRadius: '0.75rem',
          textAlign: 'center',
          padding: '1rem',
          color: '#cbd5f5',
          background: '#020617',
          border: '1px solid rgba(148, 163, 184, 0.2)'
        }}
      >
        VÃ¤lj hur du vill lÃ¤gga till bild fÃ¶r momentet.
      </div>

      {error && (
        <p style={{ margin: '0.75rem 0 0', color: '#fda4af', fontSize: '0.82rem' }}>{error}</p>
      )}

      {helperText && (
        <p style={{ margin: '0.45rem 0 0', color: '#93c5fd', fontSize: '0.82rem' }}>
          {helperText}
        </p>
      )}

      {isSubmitting && (
        <p style={{ margin: '0.45rem 0 0', color: '#67e8f9', fontSize: '0.82rem' }}>
          Sparar bild...
        </p>
      )}

      <input
        ref={galleryInputRef}
        type='file'
        accept='image/*'
        onChange={handleFileChange}
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
        accept='image/*'
        capture='environment'
        onChange={handleFileChange}
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
            padding: '0.85rem',
            borderRadius: '999px',
            border: 'none',
            background:
              'linear-gradient(120deg, rgba(94,234,212,0.8), rgba(59,130,246,0.9))',
            color: '#020617',
            fontWeight: 700,
            fontSize: '1rem',
            cursor: actionsDisabled ? 'not-allowed' : 'pointer',
            opacity: actionsDisabled ? 0.55 : 1
          }}
        >
          {captureLabel}
        </button>

        <button
          onClick={handlePickGallery}
          disabled={actionsDisabled}
          style={{
            padding: '0.85rem 1rem',
            borderRadius: '999px',
            border: '1px solid rgba(148,163,184,0.45)',
            background: 'rgba(15,23,42,0.65)',
            color: '#e2e8f0',
            cursor: actionsDisabled ? 'not-allowed' : 'pointer',
            opacity: actionsDisabled ? 0.55 : 1
          }}
        >
          {isUploading ? 'LÃ¤ser fil...' : uploadLabel}
        </button>
      </div>
    </section>
  );
}
