import { Chess } from 'chess.js';
import { engine, Job, PV, winPct } from './engine';
import { Node, stripSan } from './tree';
import { findOpening } from './openings';

export type MoveClass = 'book' | 'great' | 'best' | 'excellent' | 'good' | 'inaccuracy' | 'mistake' | 'blunder';

export const CLASS_INFO: Record<MoveClass, { label: string; symbol: string; color: string }> = {
  great: { label: 'Starker Zug', symbol: '!', color: '#2f8f88' },
  best: { label: 'Bester Zug', symbol: '★', color: '#4c8a50' },
  excellent: { label: 'Ausgezeichnet', symbol: '✓', color: '#6a9a62' },
  good: { label: 'Gut', symbol: '·', color: '#8a9a80' },
  book: { label: 'Theorie', symbol: 'T', color: '#8a8073' },
  inaccuracy: { label: 'Ungenauigkeit', symbol: '?!', color: '#c98a2b' },
  mistake: { label: 'Fehler', symbol: '?', color: '#cf6a34' },
  blunder: { label: 'Patzer', symbol: '??', color: '#bf4334' },
};
export const CLASS_ORDER: MoveClass[] = ['great', 'best', 'excellent', 'good', 'book', 'inaccuracy', 'mistake', 'blunder'];

export interface PosEval { cp?: number; mate?: number; best?: string; bestSan?: string; pv?: string }
export interface MoveReport {
  cls: MoveClass; loss: number; acc: number;
  // only for mistakes/blunders – the basis of the training cards:
  fen?: string; prev?: string; san?: string;
}
export interface Report {
  depth: number;
  sans: string[]; // main line the report belongs to
  evals: PosEval[]; // n+1 positions
  moves: MoveReport[]; // n moves
  accW: number;
  accB: number;
  created: number;
}

function terminalEval(c: Chess): PosEval | null {
  if (c.isCheckmate()) return { mate: c.turn() === 'w' ? -0.5 : 0.5 };
  if (c.isGameOver()) return { cp: 0 };
  return null;
}

function pvToSan(fen: string, pv: string[], max = 6): string[] {
  const c = new Chess(fen);
  const out: string[] = [];
  for (const u of pv.slice(0, max)) {
    try { out.push(c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }).san); } catch { break; }
  }
  return out;
}

function accuracyOf(list: number[]): number {
  if (!list.length) return 0;
  const mean = list.reduce((a, b) => a + b, 0) / list.length;
  const harm = list.length / list.reduce((a, b) => a + 1 / Math.max(b, 1), 0);
  return Math.round(((mean + harm) / 2) * 10) / 10;
}

/** Analyses the main line move by move and builds the game report. */
export async function analyzeGame(
  rootFen: string,
  line: Node[],
  depth: number,
  onProgress: (done: number, total: number) => void,
  ctl: { cancelled: boolean; job?: Job },
): Promise<Report | null> {
  const fens = [rootFen, ...line.map(n => n.fen)];
  const evals: PosEval[] = [];
  const seconds: (PV | undefined)[] = [];
  for (let i = 0; i < fens.length; i++) {
    if (ctl.cancelled) return null;
    const c = new Chess(fens[i]);
    const term = terminalEval(c);
    if (term) { evals.push(term); seconds.push(undefined); }
    else {
      const { job, done } = engine.analyze(fens[i], { depth, multipv: 2 });
      ctl.job = job;
      const pvs = await done;
      if (ctl.cancelled) return null;
      const p = pvs[0];
      const sans = p ? pvToSan(fens[i], p.pv) : [];
      evals.push({ cp: p?.cp, mate: p?.mate, best: p?.pv[0], bestSan: sans[0], pv: sans.join(' ') });
      seconds.push(pvs[1]);
    }
    onProgress(i + 1, fens.length);
  }

  const sans = line.map(n => stripSan(n.san));
  const standard = rootFen.startsWith('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w');
  const bookPly = standard ? findOpening(sans)?.ply ?? 0 : 0;
  const moves: MoveReport[] = [];
  const accs: { w: number[]; b: number[] } = { w: [], b: [] };
  for (let i = 0; i < line.length; i++) {
    const white = fens[i].split(' ')[1] === 'w';
    const pov = (e: { cp?: number; mate?: number } | undefined) => (white ? winPct(e) : 100 - winPct(e));
    const before = pov(evals[i]);
    const after = pov(evals[i + 1]);
    const loss = Math.max(0, before - after);
    const acc = Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * loss) - 3.1669));
    const isBest = line[i].uci === evals[i].best;
    let cls: MoveClass;
    if (i < bookPly && loss < 10) cls = 'book';
    else if (isBest || loss < 0.5) {
      const second = seconds[i];
      const gap = second ? before - pov(second) : 0;
      // "Great move": the only good move – but not a plain recapture and not a forced reply to a check
      const recapture = i > 0 && line[i].san.includes('x') && line[i].uci.slice(2, 4) === line[i - 1].uci.slice(2, 4);
      const inCheck = i > 0 && /[+#]/.test(line[i - 1].san);
      cls = isBest && gap >= 25 && after >= 35 && before <= 95 && !recapture && !inCheck ? 'great' : 'best';
    } else if (loss < 2) cls = 'excellent';
    else if (loss < 5) cls = 'good';
    else if (loss < 10) cls = 'inaccuracy';
    else if (loss < 20) cls = 'mistake';
    else cls = 'blunder';
    const mr: MoveReport = { cls, loss: Math.round(loss * 10) / 10, acc: Math.round(acc * 10) / 10 };
    if (cls === 'mistake' || cls === 'blunder') { mr.fen = fens[i]; mr.prev = i > 0 ? line[i - 1].uci : undefined; mr.san = line[i].san; }
    moves.push(mr);
    (white ? accs.w : accs.b).push(acc);
  }
  return { depth, sans, evals, moves, accW: accuracyOf(accs.w), accB: accuracyOf(accs.b), created: Date.now() };
}

export function countClasses(r: Report, startsWhite: boolean): Record<MoveClass, [number, number]> {
  const out = Object.fromEntries(CLASS_ORDER.map(c => [c, [0, 0]])) as Record<MoveClass, [number, number]>;
  r.moves.forEach((m, i) => { out[m.cls][(i % 2 === 0) === startsWhite ? 0 : 1]++; });
  return out;
}

/** Inaccuracies / mistakes / blunders per side – for statistics without loading the reports. */
export function errorCounts(r: Report, startsWhite: boolean): { w: [number, number, number]; b: [number, number, number] } {
  const c = countClasses(r, startsWhite);
  return { w: [c.inaccuracy[0], c.mistake[0], c.blunder[0]], b: [c.inaccuracy[1], c.mistake[1], c.blunder[1]] };
}
