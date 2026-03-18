'use client';

import { useEffect, useRef, useState } from 'react';

type Props = {
  onCapture: (dataUrl: string) => void;
  title?: string;
  subtitle?: string;
  captureLabel?: string;
  helperText?: string;
  disabled?: boolean;
};

export function CameraCapture({
  onCapture,
  title = 'Fota objekt',
  subtitle = 'Kameraläge',
  captureLabel = 'Ta bild',
  helperText,
  disabled = false
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isActive, setIsActive] = useState(false);
  const [isStarting, setIsStarting] = useState(false);

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  const startCamera = async () => {
    if (disabled || isActive || isStarting) {
      return;
    }

    setError(null);
    setIsStarting(true);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false
      });

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      setIsActive(true);
    } catch (err) {
      setError('Kan inte starta kameran. Kontrollera behörighet i webbläsaren.');
      console.error(err);
    } finally {
      setIsStarting(false);
    }
  };

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

  const handleCapture = () => {
    const video = videoRef.current;
    if (!video || !isActive || disabled) {
      return;
    }

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 1080;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
    onCapture(dataUrl);
    stopCamera();
  };

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
          {isActive ? 'Aktiv' : 'Av'}
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
        {error ? (
          <div
            style={{
              display: 'grid',
              placeItems: 'center',
              height: '100%',
              textAlign: 'center',
              padding: '1rem',
              color: '#f87171'
            }}
          >
            {error}
          </div>
        ) : !isActive ? (
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
              Kameran är avstängd tills du väljer att starta den.
            </p>
            <button
              onClick={startCamera}
              disabled={disabled || isStarting}
              style={{
                border: '1px solid rgba(56, 189, 248, 0.5)',
                background: 'rgba(14, 165, 233, 0.16)',
                color: '#e0f2fe',
                borderRadius: '999px',
                padding: '0.45rem 0.9rem',
                cursor: disabled || isStarting ? 'not-allowed' : 'pointer',
                fontWeight: 600
              }}
            >
              {isStarting ? 'Startar kamera...' : 'Starta kamera'}
            </button>
          </div>
        ) : (
          <video
            ref={videoRef}
            playsInline
            muted
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        )}
      </div>

      {helperText && (
        <p style={{ margin: '0.75rem 0 0', color: '#93c5fd', fontSize: '0.82rem' }}>
          {helperText}
        </p>
      )}

      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
        <button
          onClick={handleCapture}
          disabled={!isActive || disabled}
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
            cursor: !isActive || disabled ? 'not-allowed' : 'pointer',
            opacity: !isActive || disabled ? 0.55 : 1
          }}
        >
          {captureLabel}
        </button>
        <button
          onClick={stopCamera}
          disabled={!isActive}
          style={{
            padding: '0.85rem 1rem',
            borderRadius: '999px',
            border: '1px solid rgba(148,163,184,0.45)',
            background: 'transparent',
            color: '#e2e8f0',
            cursor: !isActive ? 'not-allowed' : 'pointer',
            opacity: !isActive ? 0.55 : 1
          }}
        >
          Stäng
        </button>
      </div>
    </section>
  );
}
