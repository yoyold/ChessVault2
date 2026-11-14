import { useMemo } from 'react';
import { useStore, openGame } from '../lib/store';
import { findOpening } from '../lib/openings';
import { WdlBar } from './ui';
import { resultLabel } from '../lib/filter';

/** Opening tree from the user's own database: which moves were played after the current move sequence? */
export function Explorer({ sans, standard, onPlay }: { sans: string[]; standard: boolean; onPlay: (san: string) => void }) {
  const { games } = useStore();
  const prefix = sans.join(' ');
  const data = useMemo(() => {
    if (!standard) return null;
    const map = new Map<string, { n: number; w: number; d: number; b: number; elo: number; eloN: number }>();
    const hits: typeof games = [];
    const pl = prefix.length;
    for (const g of games) {
      const m = g.moves;
      if (pl && !(m === prefix || m.startsWith(prefix + ' '))) continue;
      hits.push(g);
      if (m.length <= pl) continue;
      const start = pl ? pl + 1 : 0;
      const end = m.indexOf(' ', start);
      const next = m.slice(start, end < 0 ? undefined : end);
      if (!next) continue;
      let e = map.get(next);
      if (!e) map.set(next, (e = { n: 0, w: 0, d: 0, b: 0, elo: 0, eloN: 0 }));
      e.n++;
      if (g.result === '1-0') e.w++; else if (g.result === '0-1') e.b++; else if (g.result === '1/2-1/2') e.d++;
      const avg = g.whiteElo && g.blackElo ? (g.whiteElo + g.blackElo) / 2 : 0;
      if (avg) { e.elo += avg; e.eloN++; }
    }
    const moves = [...map.entries()].sort((a, b) => b[1].n - a[1].n);
    hits.sort((a, b) => Math.max(b.whiteElo, b.blackElo) - Math.max(a.whiteElo, a.blackElo));
    return { moves, total: hits.length, top: hits.slice(0, 60) };
  }, [games, prefix, standard]);

  if (!data) return <div className="muted pad">Der Eröffnungsbaum steht nur für Partien aus der Grundstellung zur Verfügung.</div>;
  const op = findOpening(sans);
  return (
    <div className="explorer">
      <div className="exp-head">
        <strong>{op ? `${op.eco} · ${op.name}` : 'Grundstellung'}</strong>
        <span className="muted">{data.total.toLocaleString('de')} Partien in deiner Datenbank</span>
      </div>
      {data.moves.length ? (
        <table className="exp-table">
          <thead><tr><th>Zug</th><th className="num">Partien</th><th>Weiß / Remis / Schwarz</th><th className="num">⌀ Elo</th></tr></thead>
          <tbody>
            {data.moves.map(([san, e]) => (
              <tr key={san} onClick={() => onPlay(san)}>
                <td className="san">{san}</td>
                <td className="num">{e.n.toLocaleString('de')}</td>
                <td><WdlBar w={e.w} d={e.d} b={e.b} /></td>
                <td className="num">{e.eloN ? Math.round(e.elo / e.eloN) : '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <div className="muted pad">Keine weiteren Züge in der Datenbank.</div>}
      {data.top.length > 0 && <div className="exp-sub">Partien mit dieser Zugfolge</div>}
      <div className="exp-games">
        {data.top.map(g => (
          <div key={g.id} className="exp-game" onClick={() => openGame(g.id!, sans.length)}>
            <span className="ellip">{g.white} {g.whiteElo ? `(${g.whiteElo})` : ''} – {g.black} {g.blackElo ? `(${g.blackElo})` : ''}</span>
            <span className="muted">{resultLabel(g.result)} · {g.year || '?'}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
