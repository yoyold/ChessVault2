import { useState } from 'react';
import { formatScore, winPct } from '../lib/engine';
import { CLASS_INFO, Report } from '../lib/report';
import type { Node } from '../lib/tree';

/** Evaluation graph: one point per ply, hover shows move and evaluation, click jumps to the position. */
export function EvalGraph({ report, line, current, onPick }: { report: Report; line: Node[]; current: number; onPick: (i: number) => void }) {
  const [hover, setHover] = useState<number | null>(null);
  const n = report.evals.length;
  const W = 1000, H = 300;
  const fx = (i: number) => (n > 1 ? i / (n - 1) : 0); // 0..1
  const fy = (i: number) => 1 - winPct(report.evals[i]) / 100; // 0 top (White wins) .. 1 bottom
  let d = '';
  for (let i = 0; i < n; i++) d += `${i ? ' L' : 'M'}${(fx(i) * W).toFixed(1)},${(fy(i) * H).toFixed(1)}`;
  const pct = (v: number) => `${(v * 100).toFixed(2)}%`;
  const idxAt = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return Math.max(0, Math.min(n - 1, Math.round(((e.clientX - r.left) / r.width) * (n - 1))));
  };
  const label = (i: number) => {
    if (i === 0) return 'Ausgangsstellung';
    const nd = line[i - 1];
    if (!nd) return '';
    return `${Math.floor((nd.ply + 1) / 2)}${nd.ply % 2 ? '.' : '…'} ${nd.san}`;
  };
  const hm = hover != null && hover > 0 ? report.moves[hover - 1] : null;
  const notable = hm && ['inaccuracy', 'mistake', 'blunder', 'great'].includes(hm.cls);
  return (
    <div className="evalgraph" onMouseMove={e => setHover(idxAt(e))} onMouseLeave={() => setHover(null)} onClick={e => onPick(idxAt(e))}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <rect width={W} height={H} className="eg-black" />
        <path d={`${d} L${W},${H} L0,${H} Z`} className="eg-white" />
        <line x1={0} x2={W} y1={H / 2} y2={H / 2} className="eg-mid" vectorEffect="non-scaling-stroke" />
        <path d={d} className="eg-line" vectorEffect="non-scaling-stroke" />
      </svg>
      {report.moves.map((m, i) =>
        m.cls === 'blunder' || m.cls === 'mistake' || m.cls === 'inaccuracy' || m.cls === 'great' ? (
          <span key={i} className={'eg-dot' + (m.cls === 'inaccuracy' ? ' sm' : '')} style={{ left: pct(fx(i + 1)), top: pct(fy(i + 1)), background: CLASS_INFO[m.cls].color }} />
        ) : null)}
      {current >= 0 && current < n && <span className="eg-cur" style={{ left: pct(fx(current)) }} />}
      {hover != null && (
        <>
          <span className="eg-hover" style={{ left: pct(fx(hover)) }} />
          <span className="eg-dot hv" style={{ left: pct(fx(hover)), top: pct(fy(hover)) }} />
          <span className="eg-tip" style={{ left: `clamp(calc(90 * var(--u)), ${pct(fx(hover))}, calc(100% - 90 * var(--u)))` }}>
            {label(hover)}<b>{formatScore(report.evals[hover])}</b>{notable ? ` · ${CLASS_INFO[hm!.cls].label}` : ''}
          </span>
        </>
      )}
    </div>
  );
}
