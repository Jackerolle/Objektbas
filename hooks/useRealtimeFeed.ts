'use client';

import { useEffect, useState } from 'react';

export type FeedItem = {
  id: string;
  text: string;
  timestamp: string;
};

const seedMessages = [
  'Johan markerade en saknad sele',
  'Lisa laddade upp foto for Generator 07',
  'Anna uppdaterade sensorstatus',
  'Patrik lade till kommentar om kylsystem'
];

export function useRealtimeFeed() {
  const [feed, setFeed] = useState<FeedItem[]>([]);

  useEffect(() => {
    const pushMessage = () => {
      const text =
        seedMessages[Math.floor(Math.random() * seedMessages.length)];
      setFeed((items) => [
        { id: crypto.randomUUID(), text, timestamp: new Date().toISOString() },
        ...items
      ]);
    };

    pushMessage();
    const interval = window.setInterval(pushMessage, 12000);
    return () => window.clearInterval(interval);
  }, []);

  return feed.slice(0, 5);
}
