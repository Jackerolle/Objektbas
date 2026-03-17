import { SyncState } from '@/lib/types';

type Props = {
  state: SyncState;
  queued: number;
  onSync: () => void;
};

const stateConfig: Record<
  SyncState,
  { text: string; color: string; bg: string }
> = {
  idle: {
    text: 'Synkad',
    color: '#34d399',
    bg: 'rgba(52, 211, 153, 0.1)'
  },
  syncing: {
    text: 'Synkar...',
    color: '#60a5fa',
    bg: 'rgba(96, 165, 250, 0.1)'
  },
  offline: {
    text: 'Offline',
    color: '#fb7185',
    bg: 'rgba(251, 113, 133, 0.1)'
  }
};

export function SyncStatus({ state, queued, onSync }: Props) {
  const { text, color, bg } = stateConfig[state];
  return (
    <div
      style={{
        display: 'flex',
        gap: '0.75rem',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderRadius: '999px',
        padding: '0.25rem 0.75rem',
        backgroundColor: '#020617',
        border: '1px solid rgba(148, 163, 184, 0.2)'
      }}
    >
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.35rem',
          color,
          fontSize: '0.85rem',
          fontWeight: 600,
          background: bg,
          padding: '0.25rem 0.75rem',
          borderRadius: '999px'
        }}
      >
        <span
          style={{
            width: '8px',
            height: '8px',
            borderRadius: '999px',
            backgroundColor: color
          }}
        />
        {text}
      </span>
      <span style={{ fontSize: '0.8rem', color: '#cbd5f5' }}>
        {queued ? `${queued} observation(er) i kö` : 'Inga väntande'}
      </span>
      <button
        onClick={onSync}
        style={{
          fontSize: '0.8rem',
          borderRadius: '999px',
          border: '1px solid rgba(148,163,184,0.6)',
          background: 'transparent',
          color: '#f1f5f9',
          padding: '0.35rem 0.85rem',
          cursor: 'pointer'
        }}
      >
        Synka nu
      </button>
    </div>
  );
}
