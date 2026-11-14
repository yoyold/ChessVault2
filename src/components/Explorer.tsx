import { useMemo } from 'react';
import { useStore, openGame, setFilter, setView, emptyFilter } from '../lib/store';
import { findOpening } from '../lib/openings';
import { findPosition, indexState } from '../lib/posindex';
import { WdlBar } from './ui';
import { nGames, resultLabel } from '../lib/filter';

/**
 * Opening tree from the user's own database, by position: which moves were played from the current
 * position, whatever move order led to it?
 */
export function Explorer({ fen, sans, standard, onPlay }: { fen: string; sans: string[]; standard: boolean; onPlay: (san: string) => void }) {
  const { games } = useStore();
  const data = useMemo(() => {
    const byId = new Map(games.map(g => [g.id!, g]));
    const map = new Map<string, { n: number; w: number; d: number; b: number; elo: number; eloN: number }>();
    const hits: { g: (typeof games)[number]; ply: number }[] = [];
    for (const h of findPosition(fen)) {
      const g = byId.get(h.id);
      if (!g) continue;
      hits.push({ g, ply: h.ply });
      const next = g.moves ? g.moves.split(' ', h.ply + 1)[h.ply] : undefined;
      if (!next) continue;
      let e = map.get(next);
      if (!e) map.set(next, (e = { n: 0, w: 0, d: 0, b: 0, elo: 0, eloN: 0 }));
      e.n++;
      if (g.result === '1-0') e.w++; else if (g.result === '0-1') e.b++; else if (g.result === '1/2-1/2') e.d++;
      const avg = g.whiteElo && g.blackElo ? (g.whiteElo + g.blackElo) / 2 : 0;
      if (avg) { e.elo += avg; e.eloN++; }
    }
    const moves = [...map.entries()].sort((a, b) => b[1].n - a[1].n);
    hits.sort((a, b) => b.g.date.replace(/\?/g, '0').localeCompare(a.g.date.replace(/\?/g, '0')));
    return { moves, total: hits.length, top: hits.slice(0, 80) };
  }, [games, fen, indexState.version]);

  const op = standard ? findOpening(sans) : null;
  return (
    <div className="explorer">
      <div className="exp-head">
        <strong>{op ? `${op.eco} · ${op.name}` : standard && !sans.length ? 'Grundstellung' : 'Stellung'}</strong>
        <span className="muted">
          {nGames(data.total)} in deiner Datenbank
          {data.total > 0 && <> · <span className="link" onClick={() => { setFilter({ ...emptyFilter(), fen }); setView('db'); }}>in der Datenbank zeigen</span></>}
        </span>
        {indexState.building && <span className="muted small">Stellungsindex wird aufgebaut ({indexState.done}/{indexState.total}) …</span>}
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
      {data.top.length > 0 && <div className="exp-sub">Partien mit dieser Stellung</div>}
      <div className="exp-games">
        {data.top.map(({ g, ply }) => (
          <div key={g.id} className="exp-game" onClick={() => openGame(g.id!, ply)}>
            <span className="ellip">{g.white} {g.whiteElo ? `(${g.whiteElo})` : ''} – {g.black} {g.blackElo ? `(${g.blackElo})` : ''}</span>
            <span className="muted">{resultLabel(g.result)} · {g.year || '?'}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
