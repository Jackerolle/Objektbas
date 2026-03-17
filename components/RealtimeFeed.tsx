import { FeedItem } from '@/hooks/useRealtimeFeed';

type Props = {
  items: FeedItem[];
};

export function RealtimeFeed({ items }: Props) {
  return (
    <section
      style={{
        borderRadius: '1rem',
        padding: '1rem',
        background: '#020617',
        border: '1px solid rgba(148, 163, 184, 0.3)'
      }}
    >
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '0.5rem'
        }}
      >
        <div>
          <p style={{ margin: 0, fontSize: '0.8rem', color: '#94a3b8' }}>
            Delning i realtid
          </p>
          <strong>Teamflode</strong>
        </div>
        <span style={{ fontSize: '0.75rem', color: '#22d3ee' }}>{items.length}</span>
      </header>

      <ul
        style={{
          listStyle: 'none',
          padding: 0,
          margin: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: '0.5rem'
        }}
      >
        {items.map((item) => (
          <li
            key={item.id}
            style={{
              borderRadius: '0.75rem',
              padding: '0.75rem',
              background: 'rgba(59, 130, 246, 0.08)',
              border: '1px solid rgba(59, 130, 246, 0.3)'
            }}
          >
            <p style={{ margin: 0, fontSize: '0.9rem' }}>{item.text}</p>
            <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>
              {new Date(item.timestamp).toLocaleTimeString('sv-SE', {
                hour: '2-digit',
                minute: '2-digit'
              })}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
