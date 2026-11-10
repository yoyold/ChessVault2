import { useMemo, useState } from 'react';
import { emptyFilter, myNames, mySide, setFilter, setView, useStore } from '../lib/store';
import { WdlBar } from './ui';
import type { GameMeta } from '../lib/db';

interface Agg { n: number; w: number; d: number; l: number }
const agg = (): Agg => ({ n: 0, w: 0, d: 0, l: 0 });
const score = (a: Agg) => (a.n ? Math.round((100 * (a.w + a.d / 2)) / a.n) : 0);

export function StatsView() {
  const { games, settings } = useStore();
  const [tc, setTc] = useState('');
  const [who, setWho] = useState('');
  const [period, setPeriod] = useState('');

  const players = useMemo(() => {
    const m = new Map<string, number>();
    for (const g of games) { m.set(g.white, (m.get(g.white) ?? 0) + 1); m.set(g.black, (m.get(g.black) ?? 0) + 1); }
    return [...m.entries()].filter(([n]) => n !== '?').sort((a, b) => b[1] - a[1]).slice(0, 200);
  }, [games]);
  const own = myNames();
  const names = who ? [who.toLowerCase()] : own.length ? own : players[0] ? [players[0][0].toLowerCase()] : [];
  const me = who || (own.length ? settings.me.split(';')[0].trim() : players[0]?.[0] || '');
  const namesKey = names.join(';');
  const since = period ? Date.now() - +period * 86400000 : 0;

  const st = useMemo(() => {
    const total = agg(), white = agg(), black = agg();
    const byTc = new Map<string, Agg>(), years = new Map<string, Agg>(), events = new Map<string, Agg & { last: string }>(), opW = new Map<string, Agg>(), opB = new Map<string, Agg>(), opp = new Map<string, Agg>();
    const rating: { t: number; elo: number }[] = [];
    let accSum = 0, accN = 0;
    const bands = [agg(), agg(), agg(), agg(), agg()];
    const err = [0, 0, 0];
    const opAcc = new Map<string, { s: number; n: number }>();
    const add = (a: Agg, r: number) => { a.n++; if (r === 1) a.w++; else if (r === 0) a.l++; else a.d++; };
    const bump = (m: Map<string, Agg>, k: string, r: number) => { let a = m.get(k); if (!a) m.set(k, (a = agg())); add(a, r); };
    for (const g of games) {
      const side = mySide(g, names);
      if (!side) continue;
      const isW = side === 'w';
      const t = Date.parse(g.date.replace(/\./g, '-'));
      if (since && !(t >= since)) continue;
      if (g.tc) { if (!byTc.has(g.tc)) byTc.set(g.tc, agg()); }
      if (tc && g.tc !== tc) continue;
      if (g.result === '*') continue;
      const r = g.result === '1/2-1/2' ? 0.5 : (g.result === '1-0') === isW ? 1 : 0;
      add(total, r); add(isW ? white : black, r);
      if (g.tc) add(byTc.get(g.tc)!, r);
      const fam = (g.opening || g.eco || 'Unbekannt').split(':')[0].trim();
      bump(isW ? opW : opB, fam, r);
      bump(opp, isW ? g.black : g.white, r);
      const elo = isW ? g.whiteElo : g.blackElo, oppElo = isW ? g.blackElo : g.whiteElo;
      if (elo && !isNaN(t)) rating.push({ t, elo });
      if (elo && oppElo) { const diff = oppElo - elo; add(bands[diff <= -200 ? 0 : diff < -50 ? 1 : diff <= 50 ? 2 : diff < 200 ? 3 : 4], r); }
      if (g.year) bump(years, String(g.year), r);
      if (g.event && !/^(rated|casual|live|let's)/i.test(g.event)) {
        let e = events.get(g.event);
        if (!e) events.set(g.event, (e = { ...agg(), last: g.date }));
        add(e, r); if (g.date > e.last) e.last = g.date;
      }
      const acc = isW ? g.accW : g.accB;
      if (acc != null) {
        accSum += acc; accN++;
        const er = isW ? g.errW : g.errB;
        if (er) { err[0] += er[0]; err[1] += er[1]; err[2] += er[2]; }
        const k = (isW ? 'w' : 'b') + fam;
        const oa = opAcc.get(k) ?? { s: 0, n: 0 }; oa.s += acc; oa.n++; opAcc.set(k, oa);
      }
    }
    rating.sort((a, b) => a.t - b.t);
    const top = (m: Map<string, Agg>, k = 10) => [...m.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, k);
    return {
      total, white, black, byTc: [...byTc.entries()], opW: top(opW), opB: top(opB), opp: top(opp, 8), rating, acc: accN ? accSum / accN : null, accN,
      bands, err, opAcc,
      years: [...years.entries()].sort((a, b) => b[0].localeCompare(a[0])),
      events: [...events.entries()].sort((a, b) => b[1].last.localeCompare(a[1].last)).slice(0, 12),
    };
  }, [games, namesKey, tc, since]);

  const drill = (p: Partial<ReturnType<typeof emptyFilter>>) => { setFilter({ ...emptyFilter(), tc, ...p }); setView('db'); };

  if (!games.length) return <div className="view"><div className="welcome"><h1>Statistik</h1><p className="muted">Importiere zuerst Partien, dann erscheinen hier deine Auswertungen.</p></div></div>;

  const opTable = (title: string, list: [string, Agg][], color: 'white' | 'black') => (
    <div className="card pad">
      <h3>{title}</h3>
      <table className="exp-table">
        <thead><tr><th>Eröffnung</th><th className="num">Partien</th><th>Sieg / Remis / Niederlage</th><th className="num">Score</th><th className="num" title="Durchschnittliche Genauigkeit in Partien mit Report">Gen.</th></tr></thead>
        <tbody>
          {list.map(([k, a]) => (
            <tr key={k} onClick={() => drill({ [color]: me, ignoreColors: false, opening: k === 'Unbekannt' ? '' : k })}>
              <td className="ellip">{k}</td><td className="num">{a.n}</td>
              <td><WdlBar w={a.w} d={a.d} b={a.l} /></td><td className="num">{score(a)} %</td>
              <td className="num">{(o => (o ? (o.s / o.n).toFixed(0) : ''))(st.opAcc.get((color === 'white' ? 'w' : 'b') + k))}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!list.length && <div className="muted">Keine Partien.</div>}
    </div>
  );

  return (
    <div className="view stats">
      <div className="toolbar">
        <h1>Statistik</h1>
        <span className="grow" />
        <label className="muted small">Spieler</label>
        <select value={who} onChange={e => setWho(e.target.value)}>
          <option value="">{own.length ? `Ich (${settings.me.split(';').map(x => x.trim()).filter(Boolean).join(', ')})` : `${me} (häufigster Spieler)`}</option>
          {players.map(([n, c]) => <option key={n} value={n}>{n} ({c})</option>)}
        </select>
        <select value={period} onChange={e => setPeriod(e.target.value)}>
          <option value="">gesamter Zeitraum</option><option value="30">letzte 30 Tage</option><option value="90">letzte 90 Tage</option>
          <option value="365">letzte 12 Monate</option><option value="1095">letzte 3 Jahre</option>
        </select>
        <select value={tc} onChange={e => setTc(e.target.value)}>
          <option value="">alle Bedenkzeiten</option>
          {st.byTc.map(([k]) => <option key={k}>{k}</option>)}
        </select>
      </div>
      <div className="kpis">
        <div className="kpi"><small>Partien</small><b>{st.total.n.toLocaleString('de')}</b><WdlBar w={st.total.w} d={st.total.d} b={st.total.l} /></div>
        <div className="kpi"><small>Score gesamt</small><b>{score(st.total)} %</b><span className="muted small">+{st.total.w} ={st.total.d} −{st.total.l}</span></div>
        <div className="kpi"><small>Mit Weiß</small><b>{score(st.white)} %</b><WdlBar w={st.white.w} d={st.white.d} b={st.white.l} /></div>
        <div className="kpi"><small>Mit Schwarz</small><b>{score(st.black)} %</b><WdlBar w={st.black.w} d={st.black.d} b={st.black.l} /></div>
        <div className="kpi"><small>⌀ Genauigkeit</small><b>{st.acc != null ? st.acc.toFixed(1) + ' %' : '–'}</b><span className="muted small">{st.accN ? `aus ${st.accN} Reports` : 'noch keine Reports'}</span></div>
        {st.accN > 0 && <div className="kpi"><small>Fehler pro Partie</small><b>{((st.err[1] + st.err[2]) / st.accN).toFixed(1)}</b>
          <span className="muted small">{(st.err[2] / st.accN).toFixed(1)} Patzer · {(st.err[0] / st.accN).toFixed(1)} Ungenauigk.</span></div>}
      </div>
      {st.rating.length > 2 && <div className="card pad"><h3>Elo-Verlauf{tc ? ` · ${tc}` : ''}</h3><RatingChart pts={st.rating} /></div>}
      <div className="grid2">
        {opTable('Eröffnungen mit Weiß', st.opW, 'white')}
        {opTable('Eröffnungen mit Schwarz', st.opB, 'black')}
      </div>
      <div className="grid2">
        <div className="card pad">
          <h3>Nach Gegnerstärke</h3>
          <table className="exp-table static">
            <tbody>
              {['200+ schwächer', '50–199 schwächer', 'gleich stark (±50)', '50–199 stärker', '200+ stärker'].map((l, i) => (
                <tr key={l}><td>{l}</td><td className="num">{st.bands[i].n}</td><td><WdlBar w={st.bands[i].w} d={st.bands[i].d} b={st.bands[i].l} /></td><td className="num">{st.bands[i].n ? score(st.bands[i]) + ' %' : '–'}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card pad">
          <h3>Nach Jahr</h3>
          <table className="exp-table">
            <tbody>
              {st.years.map(([k, a]) => (
                <tr key={k} onClick={() => drill({ white: me, yearFrom: k, yearTo: k })}><td>{k}</td><td className="num">{a.n}</td><td><WdlBar w={a.w} d={a.d} b={a.l} /></td><td className="num">{score(a)} %</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {st.events.length > 0 && (
        <div className="card pad">
          <h3>Turniere</h3>
          <table className="exp-table">
            <tbody>
              {st.events.map(([k, a]) => (
                <tr key={k} onClick={() => drill({ q: k })}><td className="ellip">{k}</td><td className="num">{a.last.slice(0, 4)}</td><td className="num">{a.n}</td><td><WdlBar w={a.w} d={a.d} b={a.l} /></td><td className="num">{score(a)} %</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="grid2">
        <div className="card pad">
          <h3>Häufigste Gegner</h3>
          <table className="exp-table">
            <tbody>
              {st.opp.map(([k, a]) => (
                <tr key={k} onClick={() => drill({ white: me, black: k, ignoreColors: true })}>
                  <td className="ellip">{k}</td><td className="num">{a.n}</td><td><WdlBar w={a.w} d={a.d} b={a.l} /></td><td className="num">{score(a)} %</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card pad">
          <h3>Nach Bedenkzeit</h3>
          <table className="exp-table">
            <tbody>
              {st.byTc.filter(([, a]) => a.n).map(([k, a]) => (
                <tr key={k} onClick={() => drill({ white: me, tc: k })}>
                  <td>{k}</td><td className="num">{a.n}</td><td><WdlBar w={a.w} d={a.d} b={a.l} /></td><td className="num">{score(a)} %</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!st.byTc.length && <div className="muted">Keine Bedenkzeit-Angaben in den Partien.</div>}
        </div>
      </div>
    </div>
  );
}

function RatingChart({ pts }: { pts: { t: number; elo: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 900, H = 200, P = 6;
  const min = Math.min(...pts.map(p => p.elo)), max = Math.max(...pts.map(p => p.elo));
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t;
  const x = (p: { t: number }, i: number) => (t1 > t0 ? P + ((p.t - t0) / (t1 - t0)) * (W - 2 * P) : P + (i / (pts.length - 1)) * (W - 2 * P));
  const y = (e: number) => (max > min ? H - P - ((e - min) / (max - min)) * (H - 2 * P) : H / 2);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p, i).toFixed(1)},${y(p.elo).toFixed(1)}`).join(' ');
  const h = hover != null ? pts[hover] : null;
  return (
    <div className="rating">
      <div className="rating-y"><span>{max}</span><span>{min}</span></div>
      <div className="rating-plot">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"
          onMouseMove={e => {
            const r = e.currentTarget.getBoundingClientRect();
            const px = ((e.clientX - r.left) / r.width) * W;
            let best = 0, bd = Infinity;
            pts.forEach((p, i) => { const dd = Math.abs(x(p, i) - px); if (dd < bd) { bd = dd; best = i; } });
            setHover(best);
          }}
          onMouseLeave={() => setHover(null)}>
          <path d={d} className="rating-line" vectorEffect="non-scaling-stroke" />
          {h && <line x1={x(h, hover!)} x2={x(h, hover!)} y1={0} y2={H} className="eg-cur" vectorEffect="non-scaling-stroke" />}
        </svg>
        <div className="rating-x">
          <span>{new Date(t0).toLocaleDateString('de')}</span>
          <span className="strong">{h ? `${new Date(h.t).toLocaleDateString('de')}: ${h.elo}` : `aktuell ${pts[pts.length - 1].elo}`}</span>
          <span>{new Date(t1).toLocaleDateString('de')}</span>
        </div>
      </div>
    </div>
  );
}

export type { GameMeta };
