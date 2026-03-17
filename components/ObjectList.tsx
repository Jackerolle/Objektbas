import { Objekt } from '@/lib/types';

type Props = {
  objects: Objekt[];
  selectedId?: string;
  onSelect: (obj: Objekt) => void;
};

export function ObjectList({ objects, selectedId, onSelect }: Props) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      {objects.map((obj) => {
        const isSelected = selectedId === obj.id;
        return (
          <article
            key={obj.id}
            onClick={() => onSelect(obj)}
            style={{
              borderRadius: '1rem',
              padding: '1rem',
              background: isSelected ? '#172554' : '#0f172a',
              border: isSelected
                ? '1px solid rgba(96, 165, 250, 0.8)'
                : '1px solid rgba(148, 163, 184, 0.2)',
              cursor: 'pointer',
              transition: 'border 0.2s'
            }}
          >
            <header style={{ display: 'flex', justifyContent: 'space-between' }}>
              <div>
                <strong style={{ fontSize: '1.1rem' }}>{obj.name}</strong>
                <p style={{ margin: 0, color: '#94a3b8', fontSize: '0.85rem' }}>
                  {obj.category} · {obj.location}
                </p>
              </div>
              <span style={{ fontSize: '0.75rem', color: '#cbd5f5' }}>
                Senast uppdat.: {new Date(obj.updatedAt).toLocaleDateString('sv-SE')}
              </span>
            </header>

            <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
              {obj.tags.map((tag) => (
                <span
                  key={tag}
                  style={{
                    fontSize: '0.7rem',
                    padding: '0.15rem 0.5rem',
                    borderRadius: '999px',
                    background: 'rgba(59, 130, 246, 0.15)',
                    color: '#93c5fd'
                  }}
                >
                  {tag}
                </span>
              ))}
            </div>

            <ul style={{ listStyle: 'none', padding: 0, margin: '0.5rem 0 0', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
              {obj.equipment.map((eq) => (
                <li
                  key={eq.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: '0.85rem',
                    color: '#e2e8f0',
                    borderBottom: '1px dashed rgba(148,163,184,0.2)',
                    paddingBottom: '0.25rem'
                  }}
                >
                  <span>
                    {eq.name}{' '}
                    <em style={{ color: '#94a3b8', fontStyle: 'normal' }}>
                      ×{eq.quantity}
                    </em>
                  </span>
                  <span
                    style={{
                      color:
                        eq.status === 'ok'
                          ? '#34d399'
                          : eq.status === 'saknas'
                          ? '#fbbf24'
                          : '#fb7185',
                      fontWeight: 600
                    }}
                  >
                    {eq.status}
                  </span>
                </li>
              ))}
            </ul>
          </article>
        );
      })}
    </section>
  );
}
