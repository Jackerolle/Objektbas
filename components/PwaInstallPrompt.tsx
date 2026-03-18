'use client';

import { useEffect, useMemo, useState } from 'react';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

function isStandalone(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  const iosStandalone = Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone);
  return iosStandalone || window.matchMedia('(display-mode: standalone)').matches;
}

export function PwaInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState<boolean>(false);
  const [showIosHelp, setShowIosHelp] = useState<boolean>(false);

  const isIos = useMemo(() => {
    if (typeof navigator === 'undefined') {
      return false;
    }

    return /iPhone|iPad|iPod/i.test(navigator.userAgent);
  }, []);

  useEffect(() => {
    setIsInstalled(isStandalone());

    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    };

    const onAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
      setShowIosHelp(false);
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onAppInstalled);
    };
  }, []);

  if (isInstalled) {
    return null;
  }

  const canPromptInstall = Boolean(deferredPrompt);
  if (!canPromptInstall && !isIos) {
    return null;
  }

  const handleInstall = async () => {
    if (deferredPrompt) {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === 'accepted') {
        setDeferredPrompt(null);
      }
      return;
    }

    if (isIos) {
      setShowIosHelp(true);
    }
  };

  return (
    <div
      style={{
        marginTop: '0.7rem',
        border: '1px solid rgba(56, 189, 248, 0.35)',
        background: 'rgba(15, 23, 42, 0.55)',
        borderRadius: '0.8rem',
        padding: '0.65rem'
      }}
    >
      <button
        onClick={() => void handleInstall()}
        style={{
          border: '1px solid rgba(125, 211, 252, 0.58)',
          background: 'rgba(30, 64, 175, 0.28)',
          color: '#e0f2fe',
          borderRadius: '999px',
          padding: '0.45rem 0.9rem',
          fontWeight: 700,
          cursor: 'pointer'
        }}
      >
        Installera app
      </button>
      {showIosHelp && (
        <p style={{ margin: '0.55rem 0 0', color: '#dbeafe', fontSize: '0.85rem' }}>
          iPhone: tryck på Dela i Safari och välj "Lägg till på hemskärmen".
        </p>
      )}
    </div>
  );
}

