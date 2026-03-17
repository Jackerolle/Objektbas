'use client';

import { ReactNode, useEffect } from 'react';

type Props = {
  children: ReactNode;
};

const SW_PATH = '/sw.js';

export function Providers({ children }: Props) {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      const register = async () => {
        try {
          const registration = await navigator.serviceWorker.register(SW_PATH, {
            scope: '/'
          });
          if (registration.installing) {
            console.info('Installerar PWA-service worker...');
          }
        } catch (error) {
          console.error('Misslyckades att registrera service worker', error);
        }
      };

      if (document.readyState === 'complete') {
        register();
      } else {
        window.addEventListener('load', register, { once: true });
      }
    }
  }, []);

  return <>{children}</>;
}
