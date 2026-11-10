import { useMemo } from 'react';
import { mySide, openGame, openNewGame, setView, startBackground, stopBackground, useStore } from '../lib/store';
import { resultLabel } from '../lib/filter';
import { buildQueue } from '../lib/training';
import { useCards } from './TrainingView';
import { WdlBar } from './ui';

const dateKey = (d: string) => d.replace(/\?/g, '0');

export function HomeView() {
  const { games, settings, bg } = useStore();
  const { cards } = useCards();

  const d = useMemo(() => {
    const recent = [...games].sort((a, b) => dateKey(b.date).localeCompare(dateKey(a.date)) || b.added - a.added).slice(0, 12);
    const mine = games.filter(g => mySide(g)).sort((a, b) => dateKey(b.date).localeCompare(dateKey(a.date)));
    const last = mine.filter(g => g.result !== '*').slice(0, 10);
    let w = 0, dr = 0, l = 0;
    const outcomes: string[] = [];
    for (const g of last) {
      const o = g.result === '1/2-1/2' ? 'd' : (g.result === '1-0') === (mySide(g) === 'w') ? 'w' : 'l';
      outcomes.push(o);
      if (o === 'w') w++; else if (o === 'd') dr++; else l++;
    }
    let run = 0;
    while (run < outcomes.length && outcomes[run] === outcomes[0]) run++;
    const elos = last.map(g => (mySide(g) === 'w' ? g.whiteElo : g.blackElo)).filter(Boolean);
    return {
      recent, mine, last, w, dr, l,
      streak: run > 1 ? { o: outcomes[0], n: run } : null,
      elo: elos[0] ?? null, eloDelta: elos.length >= 2 ? elos[0] - elos[elos.length - 1] : null,
      open: mine.filter(g => g.accW == null),
    };
  }, [games, settings.me]);

  const q = cards ? buildQueue(cards, Date.now()) : null;
  if (!games.length) return (
    <div className="view">
      <div className="welcome">
        <h1>Noch keine Partien</h1>
        <p>Importiere eine PGN-Datei oder lade deine Partien von Lichess oder Chess.com. Danach erscheinen hier deine letzten Partien, deine Form und dein Training.</p>
        <div className="row">
          <button className="btn primary big" onClick={() => setView('db')}>Zur Datenbank</button>
          <button className="btn big" onClick={() => openNewGame()}>Analysebrett öffnen</button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="view home">
      <div className="toolbar"><h1>Übersicht</h1></div>
      <div className="kpis">
        <div className="kpi"><small>Partien</small><b>{games.length.toLocaleString('de')}</b><span className="muted small">{games.filter(g => g.accW != null).length.toLocaleString('de')} mit Report</span></div>
        {d.last.length > 0 && (
          <div className="kpi">
            <small>Form (letzte {d.last.length})</small>
            <b>+{d.w} ={d.dr} −{d.l}</b>
            <span className="muted small">{d.streak ? `${d.streak.n} ${d.streak.o === 'w' ? 'Siege' : d.streak.o === 'l' ? 'Niederlagen' : 'Remis'} in Folge` : <WdlBar w={d.w} d={d.dr} b={d.l} />}</span>
          </div>
        )}
        {d.elo && (
          <div className="kpi"><small>Elo zuletzt</small><b>{d.elo}</b>
            <span className="muted small">{d.eloDelta != null ? `${d.eloDelta >= 0 ? '+' : '−'}${Math.abs(d.eloDelta)} über die letzten ${d.last.length}` : ''}</span></div>
        )}
        <div className="kpi">
          <small>Training heute</small><b>{q ? q.queue.length : '–'}</b>
          <span className="muted small">{q ? `${q.due.length} Wiederholungen, ${q.queue.length - q.due.length} neu` : ''}</span>
        </div>
      </div>

      <div className="row">
        <button className="btn primary" disabled={!q?.queue.length} onClick={() => setView('training')}>Training starten</button>
        {bg ? (
          <>
            <span className="muted">Hintergrundanalyse: {bg.done} von {bg.total}</span>
            <button className="btn small" onClick={stopBackground}>Anhalten</button>
          </>
        ) : d.open.length > 0 ? (
          <>
            <span className="muted">{d.open.length} deiner Partien ohne Report</span>
            <button className="btn small" onClick={() => startBackground(d.open.map(g => g.id!))}>Im Hintergrund analysieren</button>
          </>
        ) : null}
        {!settings.me.trim() && <button className="btn small" onClick={() => setView('settings')}>Spielernamen eintragen</button>}
      </div>

      <div className="card">
        <div className="exp-sub" style={{ borderTop: 0 }}>Letzte Partien</div>
        <div className="exp-games">
          {d.recent.map(g => (
            <div key={g.id} className="exp-game" onClick={() => openGame(g.id!)}>
              <span className="ellip"><b>{g.white}</b> – <b>{g.black}</b> <span className="muted">{g.eco} {g.opening}</span></span>
              <span className="muted">{resultLabel(g.result)} · {g.date.replace(/\.\?\?/g, '').replace('????', '?')}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
