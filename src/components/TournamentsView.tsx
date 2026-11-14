import { useMemo, useState } from 'react';
import type { GameMeta } from '../lib/db';
import { mySide, openGame, setView, useStore } from '../lib/store';
import { resultLabel } from '../lib/filter';

interface Row { g: GameMeta; white: boolean; opp: string; oppElo: number; myElo: number; pts: number | null }
interface Tournament {
  key: string; name: string; site: string; first: string; last: string;
  rows: Row[]; played: number; points: number; w: number; d: number; l: number;
  avgOpp: number | null; myElo: number | null; perf: number | null; rated: number;
}

const ONLINE = /^(rated|casual|live|let'?s|hourly|daily|weekly|monthly|yearly|.*\b(arena|bullet|blitz|rapid|classical|correspondence) game\b)/i;
const dateKey = (d: string) => d.replace(/\?/g, '0');
const fmtDate = (d: string) => {
  const [y, m, day] = d.split('.');
  if (!y || y.includes('?')) return '';
  if (!m || m.includes('?')) return y;
  return day && !day.includes('?') ? `${day}.${m}.${y}` : `${m}.${y}`;
};
const fmtPts = (p: number) => (p % 1 ? (Math.floor(p) ? Math.floor(p) : '') + '½' : String(p));

/** Tournament performance: average opponent rating + difference derived from the score (capped at ±800, as FIDE does). */
function performance(points: number, games: number, avgOpp: number): number {
  const p = Math.min(0.99, Math.max(0.01, points / games));
  return Math.round(avgOpp + Math.max(-800, Math.min(800, -400 * Math.log10(1 / p - 1))));
}

function build(games: GameMeta[], names: string[], online: boolean): Tournament[] {
  const map = new Map<string, Row[]>();
  for (const g of games) {
    const side = mySide(g, names);
    if (!side || !g.event) continue;
    if (!online && (ONLINE.test(g.event) || /lichess\.org|chess\.com/i.test(g.site))) continue;
    const white = side === 'w';
    const pts = g.result === '*' ? null : g.result === '1/2-1/2' ? 0.5 : (g.result === '1-0') === white ? 1 : 0;
    // same event name in different years = different tournaments
    const key = g.event.trim().toLowerCase() + '|' + (g.year || '');
    const row: Row = { g, white, opp: white ? g.black : g.white, oppElo: white ? g.blackElo : g.whiteElo, myElo: white ? g.whiteElo : g.blackElo, pts };
    const list = map.get(key);
    if (list) list.push(row); else map.set(key, [row]);
  }
  const out: Tournament[] = [];
  for (const [key, rows] of map) {
    const rnd = (r: Row) => parseFloat(r.g.round) || 999;
    rows.sort((a, b) => rnd(a) - rnd(b) || dateKey(a.g.date).localeCompare(dateKey(b.g.date)) || (a.g.id ?? 0) - (b.g.id ?? 0));
    const done = rows.filter(r => r.pts !== null);
    const rated = done.filter(r => r.oppElo > 0);
    const avgOpp = rated.length ? rated.reduce((s, r) => s + r.oppElo, 0) / rated.length : null;
    const elos = rows.map(r => r.myElo).filter(Boolean);
    const dates = rows.map(r => r.g.date).filter(d => !d.startsWith('?')).sort((a, b) => dateKey(a).localeCompare(dateKey(b)));
    out.push({
      key, name: rows[0].g.event, site: rows.find(r => r.g.site)?.g.site ?? '',
      first: dates[0] ?? '', last: dates[dates.length - 1] ?? '',
      rows, played: done.length, points: done.reduce((s, r) => s + r.pts!, 0),
      w: done.filter(r => r.pts === 1).length, d: done.filter(r => r.pts === 0.5).length, l: done.filter(r => r.pts === 0).length,
      avgOpp: avgOpp ? Math.round(avgOpp) : null,
      myElo: elos.length ? Math.round(elos.reduce((a, b) => a + b, 0) / elos.length) : null,
      perf: avgOpp && rated.length ? performance(rated.reduce((s, r) => s + r.pts!, 0), rated.length, avgOpp) : null,
      rated: rated.length,
    });
  }
  return out.sort((a, b) => dateKey(b.last || '0').localeCompare(dateKey(a.last || '0')));
}

export function TournamentsView() {
  const { games, settings } = useStore();
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [online, setOnline] = useState(false);
  const [q, setQ] = useState('');
  const names = useMemo(() => settings.me.split(';').map(s => s.trim().toLowerCase()).filter(Boolean), [settings.me]);
  const all = useMemo(() => build(games, names, online), [games, names, online]);
  const list = useMemo(() => {
    const w = q.trim().toLowerCase();
    return w ? all.filter(t => `${t.name} ${t.site} ${t.last}`.toLowerCase().includes(w)) : all;
  }, [all, q]);
  const toggle = (k: string) => { const n = new Set(open); if (n.has(k)) n.delete(k); else n.add(k); setOpen(n); };

  const tot = list.reduce((s, t) => ({ g: s.g + t.played, p: s.p + t.points }), { g: 0, p: 0 });
  const perfs = list.filter(t => t.perf != null);
  const best = perfs.length ? perfs.reduce((a, b) => (b.perf! > a.perf! ? b : a)) : null;

  return (
    <div className="view tournaments">
      <div className="toolbar">
        <h1>Turniere</h1>
        <span className="grow" />
        <div className="search" style={{ flex: '0 1 calc(260 * var(--u))' }}>
          <input value={q} placeholder="Turnier suchen" onChange={e => setQ(e.target.value)} />
        </div>
        <label className="check" style={{ paddingBottom: 0 }}><input type="checkbox" checked={online} onChange={e => setOnline(e.target.checked)} /> Online-Partien einbeziehen</label>
      </div>

      {!names.length ? (
        <div className="welcome">
          <p>Für die Turnierübersicht muss ChessVault2 wissen, welcher Spieler du bist.</p>
          <div className="row"><button className="btn primary" onClick={() => setView('settings')}>Spielernamen eintragen</button></div>
        </div>
      ) : !all.length ? (
        <div className="welcome">
          <p>Keine Turniere gefunden. Turniere werden aus dem Feld „Event“ deiner eigenen Partien gebildet{online ? '' : '; Online-Partien sind ausgeblendet'}.</p>
        </div>
      ) : (
        <>
          <div className="kpis">
            <div className="kpi"><small>Turniere</small><b>{list.length}</b><span className="muted small">{tot.g} Partien</span></div>
            <div className="kpi"><small>Punkte gesamt</small><b>{fmtPts(tot.p)} / {tot.g}</b><span className="muted small">{tot.g ? Math.round((100 * tot.p) / tot.g) : 0} %</span></div>
            {best && <div className="kpi"><small>Beste Leistung</small><b>{best.perf}</b><span className="muted small ellip">{best.name} {best.last.slice(0, 4)}</span></div>}
          </div>

          <div className="card tour-list">
            <div className="tour-row tour-head">
              <span />
              <span>Turnier</span><span>Zeitraum</span><span className="num">Partien</span><span className="num">Punkte</span>
              <span className="num">+ = −</span><span className="num" title="Durchschnittliche Elo der Gegner">⌀ Gegner</span>
              <span className="num" title="Turnierleistung (Performance)">Leistung</span><span className="num" title="Leistung minus eigene Elo">± Elo</span>
            </div>
            {list.map(t => {
              const isOpen = open.has(t.key);
              const diff = t.perf != null && t.myElo ? t.perf - t.myElo : null;
              return (
                <div key={t.key} className={'tour' + (isOpen ? ' open' : '')}>
                  <div className="tour-row tour-main" onClick={() => toggle(t.key)}>
                    <span className="chev">{isOpen ? '▾' : '▸'}</span>
                    <span className="ellip"><b>{t.name}</b>{t.site && t.site !== t.name ? <span className="muted"> · {t.site}</span> : null}</span>
                    <span className="muted nowrap">{t.first && t.last && t.first !== t.last ? `${fmtDate(t.first)} – ${fmtDate(t.last)}` : fmtDate(t.last)}</span>
                    <span className="num">{t.played}</span>
                    <span className="num strong">{fmtPts(t.points)} / {t.played}</span>
                    <span className="num muted">{t.w} {t.d} {t.l}</span>
                    <span className="num">{t.avgOpp ?? '–'}</span>
                    <span className="num strong" title={t.perf != null && t.rated < t.played ? `aus ${t.rated} Partien mit Gegner-Elo` : undefined}>{t.perf ?? '–'}</span>
                    <span className={'num ' + (diff == null ? 'muted' : diff >= 0 ? 'pos' : 'neg')}>{diff == null ? '–' : (diff >= 0 ? '+' : '−') + Math.abs(diff)}</span>
                  </div>
                  {isOpen && (
                    <div className="tour-games">
                      {t.rows.map(r => (
                        <div key={r.g.id} className="tour-game" onClick={() => openGame(r.g.id!)} title="Partie am Analysebrett öffnen">
                          <span className="num muted">{r.g.round || '–'}</span>
                          <span className={'dot ' + (r.white ? 'w' : 'b')} title={r.white ? 'Weiß' : 'Schwarz'} />
                          <span className="ellip"><b>{r.opp}</b></span>
                          <span className="num muted">{r.oppElo || ''}</span>
                          <span><span className={r.pts === null ? 'res' : `res mine ${r.pts === 1 ? 'win' : r.pts === 0 ? 'loss' : 'draw'}`}>{r.pts === null ? '*' : r.pts === 0.5 ? '½' : r.pts}</span></span>
                          <span className="ellip muted"><span className="eco">{r.g.eco}</span> {r.g.opening}</span>
                          <span className="num muted">{resultLabel(r.g.result)} · {Math.ceil(r.g.plies / 2)} Züge</span>
                          <span className="num muted">{r.g.accW != null ? `${(r.white ? r.g.accW : r.g.accB)?.toFixed(0)} %` : ''}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            {!list.length && <div className="muted pad">Kein Turnier passt zur Suche.</div>}
          </div>
        </>
      )}
    </div>
  );
}
