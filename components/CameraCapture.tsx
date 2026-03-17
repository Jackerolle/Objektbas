'use client';

import { useEffect, useRef, useState } from 'react';

type Props = {
  onCapture: (dataUrl: string) => void;
};

export function CameraCapture({ onCapture }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [isActive, setIsActive] = useState(false);

  useEffect(() => {
    let currentStream: MediaStream | null = null;

    const start = async () => {
      try {
        currentStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false
        });

        if (videoRef.current) {
          videoRef.current.srcObject = currentStream;
          await videoRef.current.play();
          setIsActive(true);
        }
      } catch (err) {
        setError('Kan inte starta kameran. Kontrollera behorighet.');
        console.error(err);
      }
    };

    start();

    return () => {
      currentStream?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  const handleCapture = () => {
    const video = videoRef.current;
    if (!video) {
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
            Kameralage
          </p>
          <strong>Fota objekt</strong>
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
        ) : (
          <video
            ref={videoRef}
            playsInline
            muted
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        )}
      </div>

      <button
        onClick={handleCapture}
        style={{
          marginTop: '0.75rem',
          width: '100%',
          padding: '0.85rem',
          borderRadius: '999px',
          border: 'none',
          background:
            'linear-gradient(120deg, rgba(94,234,212,0.8), rgba(59,130,246,0.9))',
          color: '#020617',
          fontWeight: 600,
          fontSize: '1rem',
          cursor: 'pointer'
        }}
      >
        Ta bild
      </button>
    </section>
  );
}
