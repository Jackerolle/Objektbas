'use client';

import { useEffect, useRef, useState } from 'react';
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

export function CameraCapture({
  onCapture,
  title = 'Fota objekt',
  subtitle = 'Kameraläge',
  captureLabel = 'Ta bild',
  helperText,
  disabled = false,
  uploadLabel = 'Ladda upp foto'
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const deviceCameraInputRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [isActive, setIsActive] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  useEffect(() => {
    if (disabled && isActive) {
      stopCamera();
    }
  }, [disabled, isActive]);

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setIsActive(false);
  };

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

  const startCamera = async () => {
    if (disabled || isActive || isStarting) {
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Den här webbläsaren stöder inte livekamera. Använd uppladdning istället.');
      return;
    }

    setError(null);
    setIsStarting(true);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        },
        audio: false
      });

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      setIsActive(true);
    } catch (err) {
      console.error(err);
      setError('Kan inte starta kameran. Kontrollera behörighet i webbläsaren.');
      stopCamera();
    } finally {
      setIsStarting(false);
    }
  };

  const handleCaptureFromLiveVideo = async () => {
    const video = videoRef.current;
    if (!video || !isActive || disabled || isSubmitting) {
      return;
    }

    const width = video.videoWidth;
    const height = video.videoHeight;

    if (!width || !height) {
      setError('Kameran är inte redo än. Vänta en sekund och försök igen.');
      return;
    }

    try {
      const normalizedSize = fitWithinBounds(width, height, MAX_IMAGE_DIMENSION);
      const canvas = document.createElement('canvas');
      canvas.width = normalizedSize.width;
      canvas.height = normalizedSize.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new Error('Canvas kunde inte initieras.');
      }

      ctx.drawImage(video, 0, 0, normalizedSize.width, normalizedSize.height);
      const dataUrl = encodeCanvasToJpeg(canvas, MAX_IMAGE_BYTES);
      await emitCapture(dataUrl);
      stopCamera();
    } catch (captureError) {
      console.error(captureError);
      setError('Kunde inte ta bilden från livekameran. Försök igen.');
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
      reader.onerror = () => reject(new Error('Kunde inte läsa filen.'));
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
        throw new Error('Filen är tom eller ogiltig.');
      }

      const normalizedDataUrl = await normalizeImageDataUrl(rawDataUrl);
      if (!normalizedDataUrl) {
        throw new Error('Kunde inte bearbeta bilden.');
      }

      stopCamera();
      await emitCapture(normalizedDataUrl);
    } catch (uploadError) {
      console.error(uploadError);
      setError('Kunde inte läsa bilden. Prova ett annat foto eller ta nytt med kameran.');
    } finally {
      setIsUploading(false);
    }
  };

  const actionsDisabled = disabled || isUploading || isStarting || isSubmitting;

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
        <span
          style={{
            fontSize: '0.75rem',
            color: isActive ? '#34d399' : '#f87171'
          }}
        >
          {isActive ? 'Live aktiv' : 'Live av'}
        </span>
      </header>

      <div
        style={{
          aspectRatio: '16 / 9',
          borderRadius: '0.75rem',
          overflow: 'hidden',
          position: 'relative',
          background: '#020617',
          border: '1px solid rgba(148, 163, 184, 0.2)'
        }}
      >
        {!isActive ? (
          <div
            style={{
              display: 'grid',
              placeItems: 'center',
              height: '100%',
              textAlign: 'center',
              padding: '1rem',
              color: '#cbd5f5',
              gap: '0.5rem'
            }}
          >
            <p style={{ margin: 0 }}>
              Livekamera är avstängd. Du kan starta livekamera eller ladda upp en bild.
            </p>
            <button
              onClick={startCamera}
              disabled={actionsDisabled}
              style={{
                border: '1px solid rgba(56, 189, 248, 0.5)',
                background: 'rgba(14, 165, 233, 0.16)',
                color: '#e0f2fe',
                borderRadius: '999px',
                padding: '0.45rem 0.9rem',
                cursor: actionsDisabled ? 'not-allowed' : 'pointer',
                fontWeight: 600,
                opacity: actionsDisabled ? 0.6 : 1
              }}
            >
              {isStarting ? 'Startar livekamera...' : 'Starta livekamera'}
            </button>
          </div>
        ) : (
          <video
            ref={videoRef}
            playsInline
            autoPlay
            muted
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        )}
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
          onClick={handleCaptureFromLiveVideo}
          disabled={!isActive || actionsDisabled}
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
            cursor: !isActive || actionsDisabled ? 'not-allowed' : 'pointer',
            opacity: !isActive || actionsDisabled ? 0.55 : 1
          }}
        >
          {captureLabel}
        </button>

        <button
          onClick={handlePickDeviceCamera}
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
          Ta foto med enhet
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
          {isUploading ? 'Läser fil...' : uploadLabel}
        </button>

        <button
          onClick={stopCamera}
          disabled={!isActive || actionsDisabled}
          style={{
            padding: '0.85rem 1rem',
            borderRadius: '999px',
            border: '1px solid rgba(148,163,184,0.45)',
            background: 'transparent',
            color: '#e2e8f0',
            cursor: !isActive || actionsDisabled ? 'not-allowed' : 'pointer',
            opacity: !isActive || actionsDisabled ? 0.55 : 1
          }}
        >
          Stäng live
        </button>
      </div>
    </section>
  );
}
