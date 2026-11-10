// Fehlertraining: Stellungen, in denen man selbst einen Fehler oder Patzer gespielt hat,
// werden als Aufgaben wiederholt – mit wachsenden Abständen (SM-2, tagesgenau).
import type { GameMeta } from './db';
import type { PosEval, Report } from './report';

export interface ReviewState {
  due: number;
  interval: number; // Tage
  ease: number;
  streak: number;
  reviews: number;
  lapses: number;
  first: number | null;
  last: number | null;
  removed?: boolean;
}

export type Grade = 'again' | 'good';
export const NEW_PER_DAY = 10;
const MIN_EASE = 1.3, MAX_INTERVAL = 365, RELEARN_MS = 10 * 60 * 1000;

export const newState = (): ReviewState => ({ due: 0, interval: 0, ease: 2.5, streak: 0, reviews: 0, lapses: 0, first: null, last: null });

export function startOfDayAfter(now: number, days: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return d.getTime();
}

export function review(s: ReviewState, grade: Grade, now: number): ReviewState {
  const base = { reviews: s.reviews + 1, first: s.first ?? now, last: now };
  if (grade === 'again') {
    return { ...s, ...base, due: now + RELEARN_MS, interval: 0, ease: Math.max(MIN_EASE, s.ease - 0.2), streak: 0, lapses: s.streak > 0 ? s.lapses + 1 : s.lapses };
  }
  const grown = s.streak === 0 ? 1 : s.streak === 1 ? 3 : s.interval * s.ease;
  const interval = Math.min(MAX_INTERVAL, Math.max(s.interval + 1, Math.round(grown)));
  return { ...s, ...base, due: startOfDayAfter(now, interval), interval, streak: s.streak + 1 };
}

export interface Card {
  id: string;
  gameId: number;
  idx: number; // Index des Zuges in der Hauptvariante
  fen: string;
  prev?: string;
  playedSan: string;
  bestUci: string;
  bestSan: string;
  pv: string;
  cls: 'mistake' | 'blunder';
  white: boolean;
  label: string;
  date: string;
  before: PosEval;
  state: ReviewState;
}

/** Alle Trainingskarten aus den analysierten eigenen Partien. */
export function buildCards(games: GameMeta[], reports: Map<number, Report>, side: (g: GameMeta) => 'w' | 'b' | null): Card[] {
  const cards: Card[] = [];
  const seen = new Set<string>();
  for (const g of games) {
    const mine = side(g);
    const r = reports.get(g.id!);
    if (!mine || !r) continue;
    r.moves.forEach((m, i) => {
      if ((m.cls !== 'mistake' && m.cls !== 'blunder') || !m.fen || !m.san) return;
      const white = m.fen.split(' ')[1] === 'w';
      if (white !== (mine === 'w')) return;
      const ev = r.evals[i];
      if (!ev?.best || !ev.bestSan || ev.bestSan === m.san) return;
      const st = g.train?.[i] ?? newState();
      if (st.removed) return;
      const key = m.fen.split(' ').slice(0, 4).join(' ') + m.san;
      if (seen.has(key)) return; // dieselbe Stellung mit demselben Fehler nur einmal
      seen.add(key);
      cards.push({
        id: `${g.id}:${i}`, gameId: g.id!, idx: i, fen: m.fen, prev: m.prev, playedSan: m.san, bestUci: ev.best, bestSan: ev.bestSan,
        pv: ev.pv ?? '', cls: m.cls, white, label: `${g.white} – ${g.black}`, date: g.date, before: ev, state: st,
      });
    });
  }
  return cards;
}

export interface Queue { due: Card[]; fresh: Card[]; queue: Card[]; learned: number; total: number }

/** Erst fällige Wiederholungen, dann neue Karten bis zum Tageslimit (Patzer und jüngere Partien zuerst). */
export function buildQueue(cards: Card[], now: number): Queue {
  const today = startOfDayAfter(now, 0);
  const due = cards.filter(c => c.state.reviews > 0 && c.state.due <= now).sort((a, b) => a.state.due - b.state.due);
  const introduced = cards.filter(c => c.state.first !== null && c.state.first >= today).length;
  const fresh = cards.filter(c => c.state.reviews === 0)
    .sort((a, b) => (a.cls !== b.cls ? (a.cls === 'blunder' ? -1 : 1) : b.date.localeCompare(a.date)));
  const allowance = Math.max(0, NEW_PER_DAY - introduced);
  return { due, fresh, queue: [...due, ...fresh.slice(0, allowance)], learned: cards.filter(c => c.state.streak >= 2).length, total: cards.length };
}
