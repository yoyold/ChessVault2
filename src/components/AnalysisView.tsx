import { useEffect, useMemo, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import type { Key } from 'chessground/types';
import type { DrawShape } from 'chessground/draw';
import { Board } from './Board';
import { MoveList } from './MoveList';
import { EvalGraph } from './EvalGraph';
import { Explorer } from './Explorer';
import { Field, Modal } from './ui';
import { bump, saveReport, saveSession, setSettings, state, toast, useStore, openNewGame, openPgn } from '../lib/store';
import { Node, START_FEN, addMove, deleteNode, isMainline, lastOfLine, mainline, pathTo, promote, stripSan } from '../lib/tree';
import { engine, formatScore, Job, PV, winPct } from '../lib/engine';
import { analyzeGame, CLASS_INFO, CLASS_ORDER, countClasses, MoveClass } from '../lib/report';
import { NAG_GROUPS, NAG_SYMBOL, serializeGame } from '../lib/pgn';
import { resultLabel } from '../lib/filter';
import { validateFen } from 'chess.js';

type Tab = 'moves' | 'report' | 'explorer';

function pvSan(fen: string, pv: string[], max = 12): { text: string; first?: string } {
  const c = new Chess(fen);
  const parts: string[] = [];
  let first: string | undefined;
  let ply = (parseInt(fen.split(' ')[5] || '1', 10) - 1) * 2 + (c.turn() === 'b' ? 1 : 0);
  for (const u of pv.slice(0, max)) {
    let m;
    try { m = c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }); } catch { break; }
    first ??= m.san;
    const no = Math.floor(ply / 2) + 1;
    parts.push((ply % 2 === 0 ? `${no}. ` : parts.length === 0 ? `${no}… ` : '') + m.san);
    ply++;
  }
  return { text: parts.join(' '), first };
}

export function AnalysisView() {
  const { session: s, settings } = useStore();
  const [tab, setTab] = useState<Tab>('moves');
  const [lines, setLines] = useState<PV[]>([]);
  const [promo, setPromo] = useState<{ from: string; to: string } | null>(null);
  const [menu, setMenu] = useState<{ node: Node; x: number; y: number } | null>(null);
  const [editHeaders, setEditHeaders] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const ctl = useRef<{ cancelled: boolean; job?: Job } | null>(null);
  const [engineError, setEngineError] = useState(false);
  const [shapeTick, setShapeTick] = useState(0);
  const toggleNag = (nag: number, group: number[]) => {
    const c = state.session.cur;
    const had = c.nags?.includes(nag);
    const rest = (c.nags ?? []).filter(x => !group.includes(x));
    c.nags = had ? rest : [...rest, nag].sort((a, b) => a - b);
    if (!c.nags.length) c.nags = undefined;
    state.session.dirty = true; bump();
  };
  const walk = (n: Node, f: (x: Node) => void) => { f(n); n.children.forEach(ch => walk(ch, f)); };
  const stripAll = (what: 'comments' | 'variations') => {
    if (!confirm(what === 'comments' ? 'Alle Kommentare, Symbole und Markierungen dieser Partie entfernen?' : 'Alle Varianten dieser Partie entfernen?')) return;
    const sess = state.session;
    if (what === 'comments') walk(sess.game.root, x => { x.comment = undefined; x.pre = undefined; x.nags = undefined; x.shapes = undefined; });
    else { walk(sess.game.root, x => { if (x.children.length > 1) x.children = [x.children[0]]; }); if (!isMainline(sess.cur)) sess.cur = sess.game.root; }
    sess.dirty = true; setShapeTick(t => t + 1); bump();
  };

  const cur = s.cur;
  const root = s.game.root;
  const chess = useMemo(() => new Chess(cur.fen), [cur.fen]);
  const turn = chess.turn() === 'w' ? 'white' : 'black';
  const dests = useMemo(() => {
    const m = new Map<Key, Key[]>();
    for (const mv of chess.moves({ verbose: true })) {
      const l = m.get(mv.from as Key);
      if (l) l.push(mv.to as Key); else m.set(mv.from as Key, [mv.to as Key]);
    }
    return m;
  }, [chess]);

  const line = mainline(root);
  const mainIdx = useMemo(() => new Map(line.map((n, i) => [n.id, i])), [line.length, root, s.report]);
  const report = s.report;
  const classes = useMemo(() => {
    const m = new Map<number, MoveClass>();
    if (report) line.forEach((n, i) => { if (report.moves[i]) m.set(n.id, report.moves[i].cls); });
    return m;
  }, [report, line.length, root]);
  // Index der aktuellen Stellung in der Hauptvariante (0 = Ausgangsstellung, -1 = Nebenvariante)
  const posIdx = cur === root ? 0 : mainIdx.has(cur.id) ? mainIdx.get(cur.id)! + 1 : -1;
  const curMove = report && posIdx > 0 ? report.moves[posIdx - 1] : null;

  // ----- Navigation -----
  const go = (n: Node | null | undefined) => { if (n) { s.cur = n; setMenu(null); bump(); } };
  const play = (mv: string | { from: string; to: string; promotion?: string }) => {
    const before = cur.children.length;
    const n = addMove(cur, mv);
    if (!n) return;
    if (cur.children.length !== before) s.dirty = true;
    go(n);
  };
  const onBoardMove = (from: string, to: string) => {
    const piece = chess.get(from as any);
    if (piece?.type === 'p' && (to[1] === '8' || to[1] === '1')) setPromo({ from, to });
    else play({ from, to });
  };

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return;
      const c = state.session.cur;
      if (e.key === 'ArrowLeft') go(c.parent);
      else if (e.key === 'ArrowRight') go(c.children[0]);
      else if (e.key === 'ArrowUp' || e.key === 'Home') go(state.session.game.root);
      else if (e.key === 'ArrowDown' || e.key === 'End') go(lastOfLine(c));
      else if (e.key === 'f') { state.session.orientation = state.session.orientation === 'white' ? 'black' : 'white'; bump(); }
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  // ----- Live-Engine -----
  const gameOver = chess.isGameOver();
  useEffect(() => {
    setLines([]);
    if (!settings.engineOn || progress || gameOver) return;
    let last = 0;
    let timer: any;
    const { job, done } = engine.analyze(cur.fen, { depth: 26, multipv: settings.multipv }, ls => {
      const apply = () => { last = Date.now(); setLines(ls.slice()); };
      clearTimeout(timer);
      if (Date.now() - last > 150) apply(); else timer = setTimeout(apply, 150);
    });
    done.catch(() => setEngineError(true));
    return () => { clearTimeout(timer); job.cancel(); };
  }, [cur.fen, settings.engineOn, settings.multipv, !!progress, gameOver]);

  // ----- Report -----
  const runReport = async () => {
    if (!line.length) { toast('Die Partie enthält noch keine Züge.', 'err'); return; }
    const c = { cancelled: false } as { cancelled: boolean; job?: Job };
    ctl.current = c;
    setProgress({ done: 0, total: line.length + 1 });
    setTab('report');
    try {
      const sess = s;
      const rep = await analyzeGame(root.fen, line, settings.reportDepth, (done, total) => setProgress({ done, total }), c);
      if (rep) {
        sess.report = rep;
        if (sess.gameId != null) await saveReport(sess.gameId, rep, root.fen.split(' ')[1] === 'w');
        bump();
      }
    } catch (e: any) { toast('Analyse fehlgeschlagen: ' + e.message, 'err'); }
    setProgress(null);
  };
  const cancelReport = () => { if (ctl.current) { ctl.current.cancelled = true; ctl.current.job?.cancel(); } };
  useEffect(() => () => cancelReport(), []);

  // ----- Bewertung, Pfeile, Badge -----
  const evalNow = lines[0] ?? (report && posIdx >= 0 ? report.evals[posIdx] : undefined);
  const terminal = chess.isCheckmate() ? { mate: turn === 'white' ? -0.5 : 0.5 } : gameOver ? { cp: 0 } : undefined;
  const shown = terminal ?? evalNow;
  const whitePct = winPct(shown);
  const shapes: DrawShape[] = [];
  if (lines[0]?.pv[0]) shapes.push({ orig: lines[0].pv[0].slice(0, 2) as Key, dest: lines[0].pv[0].slice(2, 4) as Key, brush: 'engine' });
  const better = report && posIdx > 0 && curMove && ['inaccuracy', 'mistake', 'blunder'].includes(curMove.cls) ? report.evals[posIdx - 1] : null;
  if (better?.best) shapes.push({ orig: better.best.slice(0, 2) as Key, dest: better.best.slice(2, 4) as Key, brush: 'better' });
  const badge = curMove && cur.uci ? { square: cur.uci.slice(2, 4), color: CLASS_INFO[curMove.cls].color, symbol: CLASS_INFO[curMove.cls].symbol } : null;

  const h = s.game.headers;
  const name = (side: 'White' | 'Black') => (h[side] && h[side] !== '?' ? h[side] : side === 'White' ? 'Weiß' : 'Schwarz');
  const elo = (side: 'White' | 'Black') => (parseInt(h[side + 'Elo'], 10) ? ` (${h[side + 'Elo']})` : '');
  const top = s.orientation === 'white' ? 'Black' : 'White';
  const bottom = s.orientation === 'white' ? 'White' : 'Black';
  const standard = root.fen === START_FEN;
  const sans = pathTo(cur).map(n => stripSan(n.san));
  const counts = report ? countClasses(report, root.fen.split(' ')[1] === 'w') : null;

  const jumpToClass = (cls: MoveClass, side: 0 | 1) => {
    if (!report) return;
    const startsWhite = root.fen.split(' ')[1] === 'w';
    const idxs = report.moves.map((m, i) => ({ m, i })).filter(({ m, i }) => m.cls === cls && ((i % 2 === 0) === startsWhite ? 0 : 1) === side).map(x => x.i);
    if (!idxs.length) return;
    const next = idxs.find(i => i + 1 > posIdx) ?? idxs[0];
    go(line[next]);
  };

  const playerBar = (side: 'White' | 'Black') => (
    <div className="player-bar">
      <span className={'dot ' + (side === 'White' ? 'w' : 'b')} />
      <strong className="ellip">{name(side)}</strong><span className="muted">{elo(side)}</span>
      {report && <span className="acc-chip" title="Genauigkeit">{(side === 'White' ? report.accW : report.accB).toFixed(1)} %</span>}
    </div>
  );

  return (
    <div className="analysis">
      <div className="board-col">
        {playerBar(top)}
        <div className="board-row">
          <div className={'evalbar ' + s.orientation} title={formatScore(shown)}>
            <div className="evalbar-white" style={{ height: `${whitePct}%` }} />
            <span className={'evalbar-num ' + (whitePct >= 50 ? 'onwhite' : 'onblack')}>{formatScore(shown)}</span>
          </div>
          <div className="board-wrap">
            <Board
              fen={cur.fen} orientation={s.orientation} turn={turn} dests={dests}
              lastMove={cur.uci ? [cur.uci.slice(0, 2) as Key, cur.uci.slice(2, 4) as Key] : undefined}
              check={chess.isCheck()} shapes={shapes} badge={badge} onMove={onBoardMove}
              userShapes={(cur.shapes ?? []) as DrawShape[]} shapesKey={cur.id + ':' + shapeTick}
              onShapes={sh => {
                const next = sh.filter(x => ['green', 'red', 'blue', 'yellow'].includes(x.brush ?? '')).map(x => ({ orig: x.orig as string, ...(x.dest ? { dest: x.dest as string } : {}), brush: x.brush! }));
                if (JSON.stringify(next) === JSON.stringify(cur.shapes ?? [])) return;
                cur.shapes = next.length ? next : undefined; s.dirty = true; bump();
              }}
            />
            {promo && (
              <div className="promo" onClick={() => setPromo(null)}>
                <div className="promo-box">
                  {(['q', 'r', 'b', 'n'] as const).map(p => (
                    <button key={p} onClick={e => { e.stopPropagation(); play({ ...promo, promotion: p }); setPromo(null); }}>
                      {{ q: turn === 'white' ? '♕' : '♛', r: turn === 'white' ? '♖' : '♜', b: turn === 'white' ? '♗' : '♝', n: turn === 'white' ? '♘' : '♞' }[p]}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
        {playerBar(bottom)}
        <div className="nav-row">
          <button className="btn" onClick={() => go(root)} title="Anfang (↑)">⏮</button>
          <button className="btn" onClick={() => go(cur.parent)} title="Zurück (←)">◀</button>
          <button className="btn" onClick={() => go(cur.children[0])} title="Vor (→)">▶</button>
          <button className="btn" onClick={() => go(lastOfLine(cur))} title="Ende (↓)">⏭</button>
          <span className="grow" />
          <button className="btn" onClick={() => { s.orientation = s.orientation === 'white' ? 'black' : 'white'; bump(); }} title="Brett drehen (F)">⇅ Drehen</button>
        </div>
      </div>

      <div className="side-col">
        <div className="card game-head">
          <div className="gh-main">
            <div className="gh-title ellip">{name('White')} – {name('Black')} <span className="muted">{resultLabel(h.Result || '*')}</span></div>
            <div className="muted ellip">
              {[h.Event !== '?' && h.Event, h.Date && !h.Date.startsWith('?') && h.Date, h.ECO, s.dirty && 'ungespeichert'].filter(Boolean).join(' · ') || 'Neue Partie'}
            </div>
          </div>
          <button className="btn primary" onClick={() => saveSession()} disabled={!s.dirty && s.gameId != null}>Speichern</button>
          <details className="menu">
            <summary className="btn">⋯</summary>
            <div className="menu-pop" onClick={e => (e.currentTarget.parentElement as HTMLDetailsElement).removeAttribute('open')}>
              <button onClick={() => setEditHeaders(true)}>Partiedaten bearbeiten</button>
              <button onClick={() => stripAll('comments')}>Alle Kommentare entfernen</button>
              <button onClick={() => stripAll('variations')}>Alle Varianten entfernen</button>
              <button onClick={() => openNewGame()}>Neue Partie / leeres Brett</button>
              <button onClick={() => setPasteOpen(true)}>PGN oder FEN einfügen …</button>
              <button onClick={() => { navigator.clipboard.writeText(serializeGame(s.game)); toast('PGN kopiert.'); }}>PGN kopieren</button>
              <button onClick={() => { navigator.clipboard.writeText(cur.fen); toast('FEN kopiert.'); }}>FEN kopieren</button>
            </div>
          </details>
        </div>

        <div className="card engine">
          <div className="engine-head">
            <label className="switch">
              <input type="checkbox" checked={settings.engineOn} onChange={e => setSettings({ engineOn: e.target.checked })} />
              <span>Stockfish</span>
            </label>
            <span className="engine-score">{progress ? '…' : formatScore(shown)}</span>
            <span className="muted">{progress ? 'Report läuft' : engineError ? 'Engine konnte nicht geladen werden' : lines[0] ? `Tiefe ${lines[0].depth}` : settings.engineOn && !gameOver ? 'rechnet …' : ''}</span>
            <span className="grow" />
            <select value={settings.multipv} onChange={e => setSettings({ multipv: +e.target.value })} title="Anzahl Varianten">
              {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n} {n === 1 ? 'Variante' : 'Varianten'}</option>)}
            </select>
          </div>
          {settings.engineOn && !progress && lines.map((l, i) => {
            const pv = pvSan(cur.fen, l.pv);
            return (
              <div key={i} className="pv" onClick={() => l.pv[0] && play({ from: l.pv[0].slice(0, 2), to: l.pv[0].slice(2, 4), promotion: l.pv[0][4] })} title="Klicken, um den ersten Zug auszuführen">
                <span className="pv-score">{formatScore(l)}</span>
                <span className="pv-moves">{pv.text}</span>
              </div>
            );
          })}
        </div>

        <div className="card tabs-card">
          <div className="tabs">
            <button className={tab === 'moves' ? 'on' : ''} onClick={() => setTab('moves')}>Notation</button>
            <button className={tab === 'report' ? 'on' : ''} onClick={() => setTab('report')}>Report</button>
            <button className={tab === 'explorer' ? 'on' : ''} onClick={() => setTab('explorer')}>Eröffnungsbaum</button>
          </div>

          {tab === 'moves' && (
            <>
              <MoveList root={root} cur={cur} classes={classes} onSelect={go} onContext={(node, x, y) => setMenu({ node, x, y })} />
              {curMove && (
                <div className="move-verdict" style={{ borderColor: CLASS_INFO[curMove.cls].color }}>
                  <strong style={{ color: CLASS_INFO[curMove.cls].color }}>{cur.san}: {CLASS_INFO[curMove.cls].label}</strong>
                  {better?.bestSan && <span> · besser war <b>{better.bestSan}</b></span>}
                </div>
              )}
              <div className="annot">
                {cur !== root && NAG_GROUPS.map(g => (
                  <div className="annot-row" key={g.title}>
                    <small>{g.title}</small>
                    {g.items.map(([nag, label]) => (
                      <button key={nag} title={label} className={cur.nags?.includes(nag) ? 'on' : ''} onClick={() => toggleNag(nag, g.items.map(i => i[0]))}>{NAG_SYMBOL[nag]}</button>
                    ))}
                  </div>
                ))}
                {cur.parent && cur.parent.children[0] !== cur && (
                  <textarea className="pre" placeholder={`Text vor ${cur.san} …`} value={cur.pre ?? ''} onChange={e => { cur.pre = e.target.value || undefined; s.dirty = true; bump(); }} />
                )}
                <textarea
                  placeholder={cur === root ? 'Kommentar zur Partie …' : `Kommentar nach ${cur.san} …`}
                  value={cur.comment ?? ''} onChange={e => { cur.comment = e.target.value || undefined; s.dirty = true; bump(); }}
                />
                <div className="hint">
                  Pfeile und Felder: Rechtsklick (ziehen) auf dem Brett – grün, mit Umschalt rot, mit Alt blau, mit beiden gelb.
                  {cur.shapes?.length ? <> · <span className="link" onClick={() => { cur.shapes = undefined; s.dirty = true; setShapeTick(t => t + 1); bump(); }}>Markierungen löschen</span></> : null}
                </div>
              </div>
            </>
          )}

          {tab === 'report' && (
            <div className="report">
              {progress ? (
                <div className="pad">
                  <div>Stockfish analysiert jeden Zug … {progress.done}/{progress.total}</div>
                  <div className="progress"><div style={{ width: `${(100 * progress.done) / progress.total}%` }} /></div>
                  <button className="btn" onClick={cancelReport}>Abbrechen</button>
                </div>
              ) : !report ? (
                <div className="pad empty">
                  <p>Der Report bewertet jeden Zug, berechnet die Genauigkeit beider Seiten und zeigt die entscheidenden Momente.</p>
                  <div className="row">
                    <select value={settings.reportDepth} onChange={e => setSettings({ reportDepth: +e.target.value })}>
                      <option value={10}>Schnell (Tiefe 10)</option>
                      <option value={14}>Standard (Tiefe 14)</option>
                      <option value={18}>Gründlich (Tiefe 18)</option>
                      <option value={22}>Sehr tief (Tiefe 22)</option>
                    </select>
                    <button className="btn primary" onClick={runReport}>Report erstellen</button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="acc-row">
                    <div className="acc-card w"><span>{name('White')}</span><b>{report.accW.toFixed(1)}</b><small>Genauigkeit</small></div>
                    <div className="acc-card b"><span>{name('Black')}</span><b>{report.accB.toFixed(1)}</b><small>Genauigkeit</small></div>
                  </div>
                  <EvalGraph report={report} line={line} current={posIdx} onPick={i => go(i === 0 ? root : line[i - 1])} />
                  <table className="class-table">
                    <tbody>
                      {CLASS_ORDER.map(c => (
                        <tr key={c}>
                          <td className="num link" onClick={() => jumpToClass(c, 0)}>{counts![c][0]}</td>
                          <td><span className="cls-dot" style={{ background: CLASS_INFO[c].color }}>{CLASS_INFO[c].symbol}</span>{CLASS_INFO[c].label}</td>
                          <td className="num link" onClick={() => jumpToClass(c, 1)}>{counts![c][1]}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="exp-sub">Schlüsselmomente</div>
                  <div className="moments">
                    {!report.moves.some(m => m.cls === 'blunder' || m.cls === 'mistake' || m.cls === 'inaccuracy') && <div className="muted pad small">Keine Ungenauigkeiten oder Fehler gefunden.</div>}
                    {report.moves.map((m, i) => ({ m, i })).filter(x => x.m.cls === 'blunder' || x.m.cls === 'mistake' || x.m.cls === 'inaccuracy').map(({ m, i }) => (
                      <div key={i} className={'moment' + (posIdx === i + 1 ? ' on' : '')} onClick={() => go(line[i])}>
                        <span className="cls-dot" style={{ background: CLASS_INFO[m.cls].color }}>{CLASS_INFO[m.cls].symbol}</span>
                        <span><b>{Math.floor(line[i].ply / 2) + (line[i].ply % 2)}{line[i].ply % 2 ? '.' : '…'} {line[i].san}</b> – {CLASS_INFO[m.cls].label}
                          {m.cls !== 'great' && report.evals[i].bestSan ? <span className="muted"> · besser: {report.evals[i].bestSan}</span> : null}
                        </span>
                        <span className="muted">{formatScore(report.evals[i + 1])}</span>
                      </div>
                    ))}
                  </div>
                  <div className="row pad muted small">
                    <span>Tiefe {report.depth} · Stockfish</span><span className="grow" />
                    <button className="btn small" onClick={runReport}>Neu berechnen</button>
                  </div>
                </>
              )}
            </div>
          )}

          {tab === 'explorer' && <Explorer sans={sans} standard={standard} onPlay={san => play(san)} />}
        </div>
      </div>

      {menu && (
        <div className="ctx-back" onClick={() => setMenu(null)} onContextMenu={e => { e.preventDefault(); setMenu(null); }}>
          <div className="menu-pop fixed" style={{ left: Math.min(menu.x, window.innerWidth - 230), top: Math.min(menu.y, window.innerHeight - 190) }}>
            {!isMainline(menu.node) && <button onClick={() => { promote(menu.node); s.dirty = true; s.report = null; go(menu.node); }}>Variante hochstufen</button>}
            <button onClick={() => { const p = deleteNode(menu.node); s.dirty = true; go(p); }}>Ab hier löschen</button>
          </div>
        </div>
      )}
      {editHeaders && <HeaderDialog onClose={() => setEditHeaders(false)} />}
      {pasteOpen && <PasteDialog onClose={() => setPasteOpen(false)} />}
    </div>
  );
}

function HeaderDialog({ onClose }: { onClose: () => void }) {
  const s = state.session;
  const [h, setH] = useState({ ...s.game.headers });
  const inp = (k: string, ph = '') => (
    <input value={h[k] && h[k] !== '?' ? h[k] : ''} placeholder={ph} onChange={e => setH({ ...h, [k]: e.target.value })} />
  );
  return (
    <Modal title="Partiedaten" onClose={onClose}>
      <div className="form-grid">
        <Field label="Weiß">{inp('White')}</Field><Field label="Elo Weiß">{inp('WhiteElo')}</Field>
        <Field label="Schwarz">{inp('Black')}</Field><Field label="Elo Schwarz">{inp('BlackElo')}</Field>
        <Field label="Turnier / Event">{inp('Event')}</Field><Field label="Ort">{inp('Site')}</Field>
        <Field label="Datum">{inp('Date', 'JJJJ.MM.TT')}</Field><Field label="Runde">{inp('Round')}</Field>
        <Field label="Ergebnis">
          <select value={h.Result || '*'} onChange={e => setH({ ...h, Result: e.target.value })}>
            <option value="1-0">1–0</option><option value="1/2-1/2">½–½</option><option value="0-1">0–1</option><option value="*">* (offen)</option>
          </select>
        </Field>
      </div>
      <div className="modal-foot">
        <button className="btn" onClick={onClose}>Abbrechen</button>
        <button className="btn primary" onClick={() => {
          for (const k of Object.keys(h)) if (!h[k]) h[k] = '?';
          s.game.headers = h; s.dirty = true; bump(); onClose();
        }}>Übernehmen</button>
      </div>
    </Modal>
  );
}

function PasteDialog({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState('');
  const load = () => {
    const t = text.trim();
    if (!t) return;
    if (validateFen(t).ok) openNewGame(t);
    else openPgn(t);
    onClose();
  };
  return (
    <Modal title="PGN oder FEN einfügen" onClose={onClose}>
      <textarea className="paste" autoFocus value={text} onChange={e => setText(e.target.value)} placeholder="1. e4 e5 2. Nf3 …  oder eine FEN-Stellung" />
      <div className="modal-foot">
        <button className="btn" onClick={onClose}>Abbrechen</button>
        <button className="btn primary" onClick={load}>Laden</button>
      </div>
    </Modal>
  );
}
