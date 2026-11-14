import { useEffect, useMemo, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import type { Key } from 'chessground/types';
import type { DrawShape } from 'chessground/draw';
import { Board } from './Board';
import { db, patchGames } from '../lib/db';
import { engine, formatScore, Job, winPct } from '../lib/engine';
import type { Report } from '../lib/report';
import { buildCards, buildQueue, Card, Grade, NEW_PER_DAY, review } from '../lib/training';
import { loadGames, mySide, openGame, setView, startBackground, useStore } from '../lib/store';
import { OpeningSession, useRepertoire } from './RepertoireView';
import type { OpeningCard } from '../lib/repertoire';

/** Loads all reports and builds the training cards from them. */
export function useCards(): { cards: Card[] | null; reload: () => void } {
  const { games, settings } = useStore();
  const [reports, setReports] = useState<Map<number, Report> | null>(null);
  const [tick, setTick] = useState(0);
  const analyzed = games.filter(g => g.accW != null).length;
  useEffect(() => {
    let alive = true;
    db.reports.toArray().then(rows => { if (alive) setReports(new Map(rows.map(r => [r.id, r]))); });
    return () => { alive = false; };
  }, [analyzed, tick]);
  const cards = useMemo(() => (reports ? buildCards(games, reports, g => mySide(g)) : null), [games, reports, settings.me]);
  return { cards, reload: () => setTick(t => t + 1) };
}

async function saveState(card: Card, grade: Grade | 'remove') {
  const next = grade === 'remove' ? { ...card.state, removed: true } : review(card.state, grade, Date.now());
  card.state = next;
  await patchGames([card.gameId], g => ({ train: { ...(g.train ?? {}), [card.idx]: next } }));
}

export function TrainingView() {
  const { games, settings } = useStore();
  const { cards } = useCards();
  const [session, setSession] = useState<Card[] | null>(null);

  const repW = useRepertoire('w'), repB = useRepertoire('b');
  const [opening, setOpening] = useState<{ id: number; cards: OpeningCard[] } | null>(null);
  if (opening) return <OpeningSession repId={opening.id} cards={opening.cards} onDone={async () => { await loadGames(); setOpening(null); }} />;
  if (session) return <Session cards={session} onDone={() => setSession(null)} />;
  const openingDeck = (label: string, r: ReturnType<typeof useRepertoire>) => (
    <div className="kpi">
      <small>{label}</small><b>{r.queue.queue.length}</b>
      <span className="muted small">{r.queue.due.length} Wiederholungen, {r.queue.queue.length - r.queue.due.length} neu · {r.queue.learned}/{r.queue.total} gelernt</span>
      <span><button className="btn small" disabled={!r.queue.queue.length || !r.meta} onClick={() => setOpening({ id: r.meta!.id!, cards: r.queue.queue })}>Starten</button></span>
    </div>
  );

  const names = settings.me.trim();
  const mine = games.filter(g => mySide(g));
  const open = mine.filter(g => g.accW == null);
  const q = cards ? buildQueue(cards, Date.now()) : null;
  return (
    <div className="view training">
      <div className="toolbar"><h1>Training</h1></div>
      <h3>Eröffnungen</h3>
      {repW.queue.total + repB.queue.total > 0 ? (
        <div className="kpis">{openingDeck('Repertoire Weiß', repW)}{openingDeck('Repertoire Schwarz', repB)}</div>
      ) : (
        <p className="muted">Noch kein Repertoire angelegt. <span className="link" onClick={() => setView('repertoire')}>Zum Repertoire</span></p>
      )}
      <h3 style={{ marginTop: 'calc(8 * var(--u))' }}>Eigene Fehler</h3>
      {!names ? (
        <div className="welcome">
          <p>Das Training nimmt die Stellungen, in denen du selbst einen Fehler oder Patzer gespielt hast, und lässt dich den besseren Zug finden.
            Dafür muss ChessVault2 wissen, welcher Spieler du bist.</p>
          <div className="row"><button className="btn primary" onClick={() => setView('settings')}>Spielernamen eintragen</button></div>
        </div>
      ) : !q ? <div className="muted">Lade …</div> : (
        <>
          <div className="kpis">
            <div className="kpi"><small>Heute fällig</small><b>{q.due.length}</b><span className="muted small">Wiederholungen</span></div>
            <div className="kpi"><small>Neu</small><b>{q.fresh.length}</b><span className="muted small">höchstens {NEW_PER_DAY} pro Tag</span></div>
            <div className="kpi"><small>Gelernt</small><b>{q.learned}</b><span className="muted small">von {q.total} Stellungen</span></div>
          </div>
          <div className="row">
            <button className="btn primary big" disabled={!q.queue.length} onClick={() => setSession(q.queue)}>
              {q.queue.length ? `Training starten (${q.queue.length})` : 'Für heute erledigt'}
            </button>
            {q.fresh.length > 0 && !q.queue.length && <span className="muted small">Neue Stellungen kommen morgen dazu.</span>}
          </div>
          <p className="muted" style={{ maxWidth: 620 }}>
            Die Aufgaben stammen aus deinen eigenen Partien mit Report: jede Stellung, in der du einen Fehler oder Patzer gespielt hast.
            Richtig gelöste Stellungen kommen nach 1, 3 und dann immer mehr Tagen wieder, falsch gelöste nach zehn Minuten.
          </p>
          {open.length > 0 && (
            <div className="row">
              <span className="muted">{open.length} deiner {mine.length} Partien haben noch keinen Report.</span>
              <button className="btn small" onClick={() => startBackground(open.map(g => g.id!))}>Im Hintergrund analysieren</button>
            </div>
          )}
          {!mine.length && <p className="muted">Unter dem Namen „{names}“ wurden keine Partien gefunden. Prüfe den Namen in den Einstellungen.</p>}
        </>
      )}
    </div>
  );
}

type Phase = { step: 'ask'; tries: number; hint?: string } | { step: 'checking' } | { step: 'done'; correct: boolean; played?: string };

function Session({ cards, onDone }: { cards: Card[]; onDone: () => void }) {
  const [i, setI] = useState(0);
  const [phase, setPhase] = useState<Phase>({ step: 'ask', tries: 0 });
  const [fen, setFen] = useState(cards[0].fen);
  const [last, setLast] = useState<[Key, Key] | undefined>();
  const [score, setScore] = useState({ right: 0, wrong: 0 });
  const job = useRef<Job | null>(null);
  const card = cards[i];

  useEffect(() => {
    setFen(card.fen);
    setLast(card.prev ? [card.prev.slice(0, 2) as Key, card.prev.slice(2, 4) as Key] : undefined);
    setPhase({ step: 'ask', tries: 0 });
    return () => job.current?.cancel();
  }, [card]);

  const chess = useMemo(() => new Chess(fen), [fen]);
  const dests = useMemo(() => {
    const m = new Map<Key, Key[]>();
    if (phase.step !== 'ask') return m;
    for (const mv of chess.moves({ verbose: true })) {
      const l = m.get(mv.from as Key);
      if (l) l.push(mv.to as Key); else m.set(mv.from as Key, [mv.to as Key]);
    }
    return m;
  }, [chess, phase.step]);

  const finish = async (correct: boolean, played?: string) => {
    setPhase({ step: 'done', correct, played });
    setScore(s => (correct ? { ...s, right: s.right + 1 } : { ...s, wrong: s.wrong + 1 }));
    await saveState(card, correct ? 'good' : 'again');
  };

  const onMove = async (from: string, to: string) => {
    if (phase.step !== 'ask') return;
    const c = new Chess(card.fen);
    const piece = c.get(from as any);
    const promo = piece?.type === 'p' && (to[1] === '8' || to[1] === '1') ? (card.bestUci.slice(0, 4) === from + to ? card.bestUci[4] || 'q' : 'q') : undefined;
    let mv;
    try { mv = c.move({ from, to, promotion: promo }); } catch { return; }
    const uci = from + to + (promo ?? '');
    setFen(c.fen());
    setLast([from as Key, to as Key]);
    if (uci === card.bestUci) { finish(phase.tries === 0, mv.san); return; }
    if (mv.san === card.playedSan) {
      setFen(card.fen); setLast(undefined);
      setPhase({ step: 'ask', tries: phase.tries + 1, hint: `${mv.san} hast du in der Partie gespielt – gesucht ist etwas Besseres.` });
      return;
    }
    // A different move: let the engine check briefly whether it is nearly as good as the best one.
    setPhase({ step: 'checking' });
    const tries = phase.tries;
    let after: { cp?: number; mate?: number } | undefined;
    if (c.isCheckmate()) after = { mate: card.white ? 1 : -1 };
    else if (c.isGameOver()) after = { cp: 0 };
    else {
      const run = engine.analyze(c.fen(), { depth: 13, multipv: 1 });
      job.current = run.job;
      after = (await run.done)[0];
      if (run.job.cancelled) return;
    }
    const pov = (e: { cp?: number; mate?: number } | undefined) => (card.white ? winPct(e) : 100 - winPct(e));
    if (pov(card.before) - pov(after) < 4) finish(tries === 0, mv.san);
    else if (tries >= 1) finish(false, mv.san);
    else { setFen(card.fen); setLast(undefined); setPhase({ step: 'ask', tries: tries + 1, hint: `${mv.san} ist nicht gut genug. Ein Versuch noch.` }); }
  };

  const next = () => { if (i + 1 < cards.length) setI(i + 1); else onDone(); };
  const shapes: DrawShape[] = phase.step === 'done' ? [{ orig: card.bestUci.slice(0, 2) as Key, dest: card.bestUci.slice(2, 4) as Key, brush: 'green' }] : [];
  const no = card.fen.split(' ')[5];

  return (
    <div className="analysis">
      <div className="board-col">
        <div className="player-bar"><strong>{card.white ? 'Weiß' : 'Schwarz'} am Zug</strong><span className="muted">Zug {no}</span></div>
        <div className="board-row">
          <div className="board-wrap">
            <Board fen={fen} orientation={card.white ? 'white' : 'black'} turn={chess.turn() === 'w' ? 'white' : 'black'} dests={dests}
              lastMove={last} check={chess.isCheck()} shapes={shapes} onMove={onMove} />
          </div>
        </div>
      </div>
      <div className="side-col train-side">
        <div className="card game-head">
          <div className="gh-main">
            <div className="gh-title">Aufgabe {i + 1} von {cards.length}</div>
            <div className="muted ellip">{card.label} · {card.date.replace(/\.\?\?/g, '')}</div>
          </div>
          <button className="btn" onClick={onDone}>Beenden</button>
        </div>
        <div className="pad train-body">
          {phase.step === 'ask' && (
            <>
              <p>Hier hast du <b>{card.playedSan}</b> gespielt ({card.cls === 'blunder' ? 'Patzer' : 'Fehler'}). Finde einen besseren Zug.</p>
              {phase.hint && <div className="error">{phase.hint}</div>}
              <div className="row" style={{ marginTop: 14 }}>
                <button className="btn" onClick={() => { setFen(card.fen); finish(false); }}>Lösung zeigen</button>
              </div>
            </>
          )}
          {phase.step === 'checking' && <p className="muted">Prüfe den Zug …</p>}
          {phase.step === 'done' && (
            <>
              <div className={phase.correct ? 'okmsg' : 'error'} style={{ marginTop: 0 }}>
                {phase.correct ? 'Richtig.' : phase.played ? 'Gelöst, aber nicht im ersten Versuch – die Stellung kommt bald wieder.' : 'Die Stellung kommt in zehn Minuten wieder.'}
              </div>
              <p style={{ marginTop: 12 }}>Bester Zug: <b>{card.bestSan}</b> <span className="muted">({formatScore(card.before)})</span></p>
              {card.pv && <p className="muted small">{card.pv}</p>}
              <div className="row" style={{ marginTop: 14 }}>
                <button className="btn primary" autoFocus onClick={next}>{i + 1 < cards.length ? 'Weiter' : 'Fertig'}</button>
                <button className="btn" onClick={() => openGame(card.gameId, card.idx)}>Partie öffnen</button>
                <button className="btn" title="Diese Stellung nicht mehr abfragen" onClick={async () => { await saveState(card, 'remove'); next(); }}>Karte entfernen</button>
              </div>
            </>
          )}
        </div>
        <div className="pad muted small train-foot">{score.right} richtig · {score.wrong} falsch</div>
      </div>
    </div>
  );
}
