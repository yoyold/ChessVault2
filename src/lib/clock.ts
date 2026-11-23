import type { Node } from './tree';

/** Header that holds the free-text summary of the time usage (e.g. for over-the-board games without clock data). */
export const TIME_NOTE_HEADER = 'TimeUsage';

/** One stage of a time control: `moves` moves (undefined = rest of the game) in `base` seconds, `inc` seconds per move. */
export interface TcStage { moves?: number; base: number; inc: number }

/** Parses a PGN TimeControl tag ("1800+30", "40/5400+30:1800+30", "300"). [] if unknown or untimed. */
export function parseTimeControl(tc: string | undefined): TcStage[] {
  if (!tc || tc === '?' || tc === '-') return [];
  const out: TcStage[] = [];
  for (const part of tc.split(':')) {
    const m = part.trim().match(/^(?:(\d+)\/)?(\d+)(?:\+(\d+(?:\.\d+)?))?$/);
    if (!m) return out;
    out.push({ moves: m[1] ? parseInt(m[1], 10) : undefined, base: parseInt(m[2], 10), inc: m[3] ? parseFloat(m[3]) : 0 });
  }
  return out;
}

export function formatTimeControl(stages: TcStage[]): string {
  return stages.map(s => `${s.moves ? s.moves + '/' : ''}${s.base}${s.inc ? '+' + s.inc : ''}`).join(':');
}

/** Human readable, e.g. "90 min / 40 Züge + 30 min, +30 s pro Zug" (UI text, German). */
export function describeTimeControl(stages: TcStage[]): string {
  if (!stages.length) return 'ohne Angabe';
  const min = (s: number) => (s % 60 ? fmtClock(s) : `${s / 60} min`);
  const parts = stages.map(s => min(s.base) + (s.moves ? ` / ${s.moves} Züge` : ''));
  const inc = stages[0].inc;
  return parts.join(' + ') + (inc ? `, +${inc} s pro Zug` : '');
}

/** Seconds from "h:mm:ss", "m:ss", "mm:ss.s" or a plain number of minutes. null if not parseable. */
export function parseDuration(text: string): number | null {
  const t = text.trim().replace(',', '.');
  if (!t) return null;
  if (/^\d+(\.\d+)?$/.test(t)) return Math.round(parseFloat(t) * 60);
  const m = t.match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/);
  if (!m) return null;
  return (m[1] ? parseInt(m[1], 10) * 3600 : 0) + parseInt(m[2], 10) * 60 + parseFloat(m[3]);
}

/** "1:05:03", "4:07", "0:09.4" – the format the UI shows. */
export function fmtClock(sec: number): string {
  const neg = sec < 0;
  let s = Math.abs(sec);
  const tenths = s < 10 && s % 1 ? 1 : 0;
  s = tenths ? Math.round(s * 10) / 10 : Math.round(s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const ss = (tenths ? r.toFixed(1) : String(r)).padStart(tenths ? 4 : 2, '0');
  return (neg ? '−' : '') + (h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`);
}

/** The format of [%clk] / [%emt] in PGN comments: h:mm:ss with optional tenths. */
export function pgnClock(sec: number): string {
  const s = Math.max(0, Math.round(sec * 10) / 10);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s - h * 3600 - m * 60;
  const ss = r % 1 ? r.toFixed(1).padStart(4, '0') : String(r).padStart(2, '0');
  return `${h}:${String(m).padStart(2, '0')}:${ss}`;
}

export interface MoveTime {
  node: Node;
  white: boolean;
  no: number; // move number
  used?: number; // seconds spent on this move
  clock?: number; // remaining after the move (increment included)
  bonus: number; // time added by reaching the next stage of the time control after this move
}

/**
 * Time used and remaining clock for every main-line move. A move can carry the remaining clock ([%clk]) or the
 * time spent ([%emt]); the other value is derived from the previous move of the same side and the time control.
 */
export function moveTimes(line: Node[], stages: TcStage[]): MoveTime[] {
  const out: MoveTime[] = [];
  const prev: Record<'w' | 'b', number | undefined> = { w: stages[0]?.base, b: stages[0]?.base };
  const count = { w: 0, b: 0 };
  for (const node of line) {
    const white = node.ply % 2 === 1;
    const side = white ? 'w' : 'b';
    count[side]++;
    const { inc, bonus } = stageAt(stages, count[side]);
    const p = prev[side];
    // online servers start the clock with the first move and note the untouched base time there
    const unstarted = count[side] === 1 && node.clk != null && node.clk === stages[0]?.base;
    const used = node.emt ?? (unstarted ? 0 : p != null && node.clk != null ? Math.max(0, p - node.clk + inc + bonus) : undefined);
    const clock = node.clk ?? (p != null && node.emt != null ? p - node.emt + inc + bonus : undefined);
    prev[side] = clock;
    out.push({ node, white, no: Math.floor((node.ply + 1) / 2), used, clock, bonus });
  }
  return out;
}

/** Increment for a side's n-th move and the time added when that move completes a stage. */
function stageAt(stages: TcStage[], n: number): { inc: number; bonus: number } {
  let done = 0;
  for (let i = 0; i < stages.length; i++) {
    const s = stages[i];
    if (!s.moves || n <= done + s.moves) {
      const bonus = s.moves && n === done + s.moves ? stages[i + 1]?.base ?? s.base : 0;
      return { inc: s.inc, bonus };
    }
    done += s.moves;
  }
  return { inc: stages[stages.length - 1]?.inc ?? 0, bonus: 0 };
}

export interface SideSummary {
  moves: number; // moves with a known time
  total: number;
  avg: number;
  longest?: MoveTime;
  end?: number; // last known clock
  trouble: number; // moves played with less than 10 % of the base time (at most 5 min) left
}

export function summarize(times: MoveTime[], white: boolean, stages: TcStage[]): SideSummary {
  const mine = times.filter(t => t.white === white);
  const known = mine.filter(t => t.used != null);
  const total = known.reduce((a, t) => a + t.used!, 0);
  const longest = known.reduce<MoveTime | undefined>((a, t) => (!a || t.used! > a.used! ? t : a), undefined);
  const end = [...mine].reverse().find(t => t.clock != null)?.clock;
  const limit = stages[0] ? Math.min(300, stages[0].base * 0.1) : 0;
  const trouble = limit ? mine.filter(t => t.clock != null && t.clock - t.bonus < limit).length : 0;
  return { moves: known.length, total, avg: known.length ? total / known.length : 0, longest, end, trouble };
}

export const hasTimes = (line: Node[]) => line.some(n => n.clk != null || n.emt != null);
