import { ReactNode, useEffect } from 'react';

const ICONS: Record<string, string> = {
  db: 'M4 5c0-1.1 2.7-2 6-2s6 .9 6 2v10c0 1.1-2.7 2-6 2s-6-.9-6-2V5zM4 5c0 1.1 2.7 2 6 2s6-.9 6-2M4 10c0 1.1 2.7 2 6 2s6-.9 6-2',
  board: 'M3 3h14v14H3zM10 3v14M3 10h14',
  trophy: 'M6.5 3h7v4a3.5 3.5 0 0 1-7 0zM6.5 4.5H4V6a2.5 2.5 0 0 0 2.6 2.5M13.5 4.5H16V6a2.5 2.5 0 0 1-2.6 2.5M10 10.5V14M7 17h6M8 14h4v3H8z',
  chart: 'M3 17h14M5 13.5l3.5-4 3 2.5L16 6',
  settings: 'M3 6h7m5 0h2M3 14h2m5 0h7M12.5 4v4M7.5 12v4',
  home: 'M3 9.5L10 4l7 5.5V17h-4.5v-4.5h-5V17H3z',
  target: 'M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0zM13 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM10 10h.01',
  search: 'M13 8.5a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0zM12 12l5 5',
};
export function Icon({ name }: { name: string }) {
  return (
    <svg className="icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICONS[name]} />
    </svg>
  );
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={'modal' + (wide ? ' wide' : '')} role="dialog" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Schließen">✕</button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}

export function WdlBar({ w, d, b }: { w: number; d: number; b: number }) {
  const t = w + d + b || 1;
  const pc = (x: number) => `${(100 * x) / t}%`;
  const lab = (x: number) => (x / t >= 0.14 ? Math.round((100 * x) / t) + '%' : '');
  return (
    <div className="wdl" title={`+${w} =${d} −${b}`}>
      <div className="wdl-w" style={{ width: pc(w) }}>{lab(w)}</div>
      <div className="wdl-d" style={{ width: pc(d) }}>{lab(d)}</div>
      <div className="wdl-b" style={{ width: pc(b) }}>{lab(b)}</div>
    </div>
  );
}
