import { useEffect, useMemo, useState } from 'react';
import { Chess } from 'chess.js';
import type { Key } from 'chessground/types';
import type { DrawShape } from 'chessground/draw';
import { Board } from './Board';
import { MoveList } from './MoveList';
import { patchGames } from '../lib/db';
import { loadGames, openGame, setView, toast, useStore } from '../lib/store';
import {
  addLines, countMoves, ensureRep, gaps, loadRep, OpeningCard, openingCards, prefixStats, Side, sideName, suggestions,
} from '../lib/repertoire';
import { NEW_PER_DAY, queueOf, review } from '../lib/training';
import type { Game } from '../lib/tree';

/** "1. e4 c5 2. Nf3" from a list of SAN moves. */
export function lineText(sans: string[], from = 0): string {
  return sans.map((s, i) => (i % 2 === 0 ? `${i / 2 + 1}. ${s}` : i === from ? `${(i + 1) / 2}… ${s}` : s)).slice(from).join(' ');
}

/** The end of a long line: "… 7. Bg5 h6 8. Bh4". */
function tailText(sans: string[], keep = 7): string {
  if (sans.length <= keep) return lineText(sans);
  const from = sans.length - keep;
  return '… ' + lineText(sans, from);
}

/** Loads one colour's repertoire tree and derives its training cards. */
export function useRepertoire(side: Side) {
  const { reps } = useStore();
  const meta = reps.find(r => r.rep === side);
  const [game, setGame] = useState<Game | null>(null);
  useEffect(() => {
    let alive = true;
    setGame(null);
    if (meta) loadRep(side).then(r => { if (alive) setGame(r?.game ?? null); });
    return () => { alive = false; };
  }, [side, meta?.id, meta?.updated]);
  const cards = useMemo(() => (game ? openingCards(game.root, side, meta?.train) : []), [game, meta?.train, side]);
  const queue = useMemo(() => queueOf(cards, Date.now(), (a, b) => a.ply - b.ply), [cards]);
  return { meta, game, cards, queue, loading: !!meta && !game };
}

export function RepertoireView() {
  const { games, settings } = useStore();
  const [side, setSide] = useState<Side>('w');
  const [min, setMin] = useState(2);
  const [session, setSession] = useState<OpeningCard[] | null>(null);
  const { meta, game, queue, loading } = useRepertoire(side);

  const stats = useMemo(() => prefixStats(games, side), [games, side, settings.me]);
  const emptyRoot = useMemo(() => ({ id: -1, ply: 0, san: '', uci: '', fen: '', parent: null, children: [] }), []);
  const root = game?.root ?? emptyRoot;
  const sugg = useMemo(() => suggestions(stats, side, min, root), [stats, side, min, root, meta?.updated]);
  const gapList = useMemo(() => (game ? gaps(game.root, stats, side, min) : []), [game, stats, side, min]);
  const count = useMemo(() => (game ? countMoves(game.root, side) : { own: 0, lines: 0 }), [game, side]);

  if (session && meta) return <OpeningSession repId={meta.id!} cards={session} onDone={async () => { await loadGames(); setSession(null); }} />;

  const add = async (lines: string[][]) => {
    const n = await addLines(side, lines);
    toast(n ? `${n} ${n === 1 ? 'Zug' : 'Züge'} ins Repertoire übernommen.` : 'Diese Züge sind schon im Repertoire.');
  };
  const edit = async (path?: string[]) => openGame(await ensureRep(side), undefined, path);
  const hasNames = settings.me.trim().length > 0;

  return (
    <div className="view repertoire">
      <div className="toolbar">
        <h1>Repertoire</h1>
        <div className="seg">
          <button className={side === 'w' ? 'on' : ''} onClick={() => setSide('w')}>Weiß</button>
          <button className={side === 'b' ? 'on' : ''} onClick={() => setSide('b')}>Schwarz</button>
        </div>
        <span className="grow" />
        <button className="btn" onClick={() => edit()}>Am Brett bearbeiten</button>
        <button className="btn primary" disabled={!queue.queue.length} onClick={() => setSession(queue.queue)}>
          {queue.queue.length ? `Trainieren (${queue.queue.length})` : 'Training erledigt'}
        </button>
      </div>

      {loading ? <div className="muted">Lade …</div> : (
        <>
          {count.own > 0 ? (
            <div className="kpis">
              <div className="kpi"><small>Eigene Züge</small><b>{count.own}</b><span className="muted small">in {count.lines} {count.lines === 1 ? 'Variante' : 'Varianten'}</span></div>
              <div className="kpi"><small>Heute fällig</small><b>{queue.due.length}</b><span className="muted small">Wiederholungen</span></div>
              <div className="kpi"><small>Neu</small><b>{queue.fresh.length}</b><span className="muted small">höchstens {NEW_PER_DAY} pro Tag</span></div>
              <div className="kpi"><small>Gelernt</small><b>{queue.learned}</b><span className="muted small">von {queue.total} Stellungen</span></div>
            </div>
          ) : (
            <p className="muted" style={{ maxWidth: 'calc(680 * var(--u))' }}>
              Dein {sideName(side)}-Repertoire ist noch leer. Übernimm unten Vorschläge aus deinen eigenen Partien, baue es am Brett auf
              oder füge im Analysebrett über das Menü „⋯“ die aktuelle Variante hinzu. Der Trainer fragt danach deine Züge ab.
            </p>
          )}

          <div className="grid2">
            <div className="card rep-tree">
              <div className="exp-sub" style={{ borderTop: 0 }}>Repertoire mit {sideName(side)}</div>
              {game && game.root.children.length
                ? <MoveList root={game.root} cur={game.root} classes={new Map()} onSelect={n => { const p: string[] = []; let x: any = n; while (x.parent) { p.unshift(x.san.replace(/[+#!?]/g, '')); x = x.parent; } edit(p); }} onContext={() => {}} />
                : <div className="muted pad">Noch keine Züge.</div>}
            </div>

            <div className="col">
              {gapList.length > 0 && (
                <div className="card">
                  <div className="exp-sub" style={{ borderTop: 0 }}>Lücken – das wurde gegen dich gespielt, ohne Antwort im Repertoire</div>
                  {gapList.map((g, i) => (
                    <div key={i} className="rep-line">
                      <span className="ellip" title={lineText([...g.sans, g.reply])}><span className="muted">{tailText(g.sans, 6)}</span> <b>{lineText([...g.sans, g.reply], g.sans.length)}</b></span>
                      <span className="num muted">{g.games}×</span>
                      {g.answer
                        ? <button className="btn small" title={`Deinen häufigsten Zug ${g.answer} übernehmen`} onClick={() => add([[...g.sans, g.reply, g.answer!]])}>+ {g.answer}</button>
                        : <button className="btn small" onClick={async () => { await addLines(side, [[...g.sans, g.reply]]); edit([...g.sans, g.reply]); }}>Am Brett</button>}
                    </div>
                  ))}
                </div>
              )}

              <div className="card">
                <div className="exp-sub rep-head" style={{ borderTop: 0 }}>
                  <span>Vorschläge aus deinen Partien mit {sideName(side)}</span>
                  <select value={min} onChange={e => setMin(+e.target.value)} title="Mindestens so oft gespielt">
                    {[1, 2, 3, 5, 10].map(n => <option key={n} value={n}>ab {n} {n === 1 ? 'Partie' : 'Partien'}</option>)}
                  </select>
                  {sugg.length > 1 && <button className="btn small" onClick={() => add(sugg.map(s => s.sans))}>Alle übernehmen</button>}
                </div>
                {sugg.map((s, i) => (
                  <div key={i} className="rep-line">
                    <span className="ellip" title={lineText(s.sans)}>{lineText(s.sans)}</span>
                    <span className="num muted">{s.games}×</span>
                    <button className="btn small" onClick={() => add([s.sans])}>Übernehmen</button>
                  </div>
                ))}
                {!sugg.length && (
                  <div className="muted pad">
                    {!hasNames ? <>Trage zuerst deine <span className="link" onClick={() => setView('settings')}>Spielernamen</span> ein, damit deine Partien erkannt werden.</>
                      : stats.size ? 'Keine weiteren Vorschläge – dein Repertoire deckt deine häufigsten Varianten ab.'
                        : `Keine eigenen Partien mit ${sideName(side)} gefunden.`}
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

type Phase = { step: 'ask'; tries: number; hint?: string } | { step: 'done'; correct: boolean };

/** Opening trainer: the position after the opponent's move is shown, the owner plays their repertoire move. */
export function OpeningSession({ repId, cards, onDone }: { repId: number; cards: OpeningCard[]; onDone: () => void }) {
  const [i, setI] = useState(0);
  const [phase, setPhase] = useState<Phase>({ step: 'ask', tries: 0 });
  const [fen, setFen] = useState(cards[0].fen);
  const [last, setLast] = useState<[Key, Key] | undefined>();
  const [score, setScore] = useState({ right: 0, wrong: 0 });
  const card = cards[i];
  const white = card.side === 'w';

  useEffect(() => {
    setFen(card.fen);
    setLast(card.prev ? [card.prev.slice(0, 2) as Key, card.prev.slice(2, 4) as Key] : undefined);
    setPhase({ step: 'ask', tries: 0 });
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

  const finish = async (correct: boolean) => {
    setPhase({ step: 'done', correct });
    setScore(s => (correct ? { ...s, right: s.right + 1 } : { ...s, wrong: s.wrong + 1 }));
    const next = review(card.state, correct ? 'good' : 'again', Date.now());
    card.state = next;
    await patchGames([repId], g => ({ train: { ...(g.train ?? {}), [card.id]: next } }));
  };

  const onMove = (from: string, to: string) => {
    if (phase.step !== 'ask') return;
    const hit = card.answers.find(a => a.uci.slice(0, 4) === from + to);
    const c = new Chess(card.fen);
    let mv;
    try { mv = c.move({ from, to, promotion: hit?.uci[4] || 'q' }); } catch { return; }
    if (hit) { setFen(c.fen()); setLast([from as Key, to as Key]); finish(phase.tries === 0); return; }
    if (phase.tries >= 1) { setFen(card.fen); finish(false); return; }
    setFen(card.fen);
    setPhase({ step: 'ask', tries: 1, hint: `${mv.san} steht nicht in deinem Repertoire. Ein Versuch noch.` });
  };

  const next = () => { if (i + 1 < cards.length) setI(i + 1); else onDone(); };
  const shapes: DrawShape[] = phase.step === 'done'
    ? card.answers.map((a, k) => ({ orig: a.uci.slice(0, 2) as Key, dest: a.uci.slice(2, 4) as Key, brush: k === 0 ? 'better' : 'engine' })) : [];

  return (
    <div className="analysis">
      <div className="board-col">
        <div className="player-bar"><strong>{white ? 'Weiß' : 'Schwarz'} am Zug</strong><span className="muted">Zug {card.fen.split(' ')[5]}</span></div>
        <div className="board-row">
          <div className="board-wrap">
            <Board fen={fen} orientation={white ? 'white' : 'black'} turn={chess.turn() === 'w' ? 'white' : 'black'} dests={dests}
              lastMove={last} check={chess.isCheck()} shapes={shapes} onMove={onMove} />
          </div>
        </div>
      </div>
      <div className="side-col train-side">
        <div className="card game-head">
          <div className="gh-main">
            <div className="gh-title">Stellung {i + 1} von {cards.length}</div>
            <div className="muted ellip">Repertoire {sideName(card.side)}</div>
          </div>
          <button className="btn" onClick={onDone}>Beenden</button>
        </div>
        <div className="pad train-body">
          <p className="muted small">{card.sans.length ? lineText(card.sans) : 'Grundstellung'}</p>
          {phase.step === 'ask' && (
            <>
              <p>Was spielst du hier laut deinem Repertoire?</p>
              {phase.hint && <div className="error">{phase.hint}</div>}
              <div className="row" style={{ marginTop: 'calc(14 * var(--u))' }}>
                <button className="btn" onClick={() => finish(false)}>Lösung zeigen</button>
              </div>
            </>
          )}
          {phase.step === 'done' && (
            <>
              <div className={phase.correct ? 'okmsg' : 'error'} style={{ marginTop: 0 }}>
                {phase.correct ? 'Richtig.' : 'Die Stellung kommt in zehn Minuten wieder.'}
              </div>
              <p style={{ marginTop: 'calc(12 * var(--u))' }}>
                Dein Repertoire: <b>{card.answers[0].san}</b>
                {card.answers.length > 1 && <span className="muted"> (auch {card.answers.slice(1).map(a => a.san).join(', ')})</span>}
              </p>
              <div className="row" style={{ marginTop: 'calc(14 * var(--u))' }}>
                <button className="btn primary" autoFocus onClick={next}>{i + 1 < cards.length ? 'Weiter' : 'Fertig'}</button>
                <button className="btn" onClick={() => openGame(repId, undefined, card.sans)}>Im Repertoire öffnen</button>
              </div>
            </>
          )}
        </div>
        <div className="pad muted small train-foot">{score.right} richtig · {score.wrong} falsch</div>
      </div>
    </div>
  );
}
