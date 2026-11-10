import { winPct } from '../lib/engine';
import { CLASS_INFO, Report } from '../lib/report';

export function EvalGraph({ report, current, onPick }: { report: Report; current: number; onPick: (i: number) => void }) {
  const n = report.evals.length;
  const W = 600, H = 120;
  const x = (i: number) => (n > 1 ? (i / (n - 1)) * W : 0);
  const y = (i: number) => H - (winPct(report.evals[i]) / 100) * H;
  let d = `M0,${H}`;
  for (let i = 0; i < n; i++) d += ` L${x(i).toFixed(1)},${y(i).toFixed(1)}`;
  d += ` L${W},${H} Z`;
  return (
    <svg
      className="evalgraph" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"
      onClick={e => {
        const r = e.currentTarget.getBoundingClientRect();
        onPick(Math.round(((e.clientX - r.left) / r.width) * (n - 1)));
      }}
    >
      <rect width={W} height={H} className="eg-black" />
      <path d={d} className="eg-white" />
      <line x1={0} x2={W} y1={H / 2} y2={H / 2} className="eg-mid" />
      {report.moves.map((m, i) =>
        m.cls === 'blunder' || m.cls === 'mistake' || m.cls === 'great' ? (
          <circle key={i} cx={x(i + 1)} cy={y(i + 1)} r={4} fill={CLASS_INFO[m.cls].color} stroke="#0008" vectorEffect="non-scaling-stroke" />
        ) : null)}
      {current >= 0 && <line x1={x(current)} x2={x(current)} y1={0} y2={H} className="eg-cur" vectorEffect="non-scaling-stroke" />}
    </svg>
  );
}
