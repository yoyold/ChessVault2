// Opening repertoire. Each colour's repertoire is stored as one PGN tree in the games table (flag `rep`),
// so it is edited on the normal analysis board and travels through sync and backups like any game.
// Statistics from the owner's games are keyed by move sequence (no transposition detection).
import { addGames, db, GameMeta, shardOf, updateGame } from './db';
import { metaFromPgn } from './meta';
import { parseGame, serializeGame } from './pgn';
import { addMove, deleteNode, Game, newGame, Node, START_FEN, stripSan } from './tree';
import { newState, ReviewState } from './training';
import { loadGames, mySide, state } from './store';

export type Side = 'w' | 'b';
export const sideName = (s: Side) => (s === 'w' ? 'Weiß' : 'Schwarz');

function emptyRepPgn(side: Side): string {
  const g = newGame();
  g.headers = { Event: 'Repertoire', Site: '?', Date: '????.??.??', Round: '?', White: `Repertoire ${sideName(side)}`, Black: '?', Result: '*' };
  return serializeGame(g);
}

/** Returns the repertoire record for a colour, creating it on first use. */
export async function ensureRep(side: Side): Promise<number> {
  const have = state.reps.find(r => r.rep === side);
  if (have) return have.id!;
  const pgn = emptyRepPgn(side);
  const uid = `repertoire-${side}`; // fixed, so two devices end up with the same record
  const meta: GameMeta = { ...metaFromPgn(pgn, 'Repertoire'), uid, hash: uid, shard: shardOf(uid), rep: side };
  await addGames([{ meta, pgn }]);
  await loadGames();
  return state.reps.find(r => r.rep === side)!.id!;
}

export async function loadRep(side: Side): Promise<{ id: number; game: Game } | null> {
  const meta = state.reps.find(r => r.rep === side);
  if (!meta) return null;
  const row = await db.pgns.get(meta.id!);
  return { id: meta.id!, game: parseGame(row?.pgn ?? emptyRepPgn(side)) };
}

/** Merges move sequences into the repertoire tree and saves it. Returns the number of moves that were new. */
export async function addLines(side: Side, lines: string[][]): Promise<number> {
  const id = await ensureRep(side);
  const rep = (await loadRep(side))!;
  let added = 0;
  for (const sans of lines) {
    let n = rep.game.root;
    for (const san of sans) {
      const before = n.children.length;
      const next = addMove(n, san);
      if (!next) break;
      if (n.children.length !== before) added++;
      n = next;
    }
  }
  if (added) {
    const pgn = serializeGame(rep.game);
    const { white, black, event, moves, plies, eco, opening } = metaFromPgn(pgn, 'Repertoire');
    await updateGame(id, { white, black, event, moves, plies, eco, opening }, pgn);
    // an open board session of this repertoire must not overwrite the merge with its older tree
    if (state.session.gameId === id) { state.session.game = rep.game; state.session.cur = rep.game.root; state.session.dirty = false; }
    await loadGames();
  }
  return added;
}

/** Removes the move at the end of `path` together with everything after it. */
export async function removeLine(side: Side, path: string[]): Promise<boolean> {
  const rep = await loadRep(side);
  if (!rep || !path.length) return false;
  let n = rep.game.root;
  for (const san of path) { const c = n.children.find(ch => stripSan(ch.san) === san); if (!c) return false; n = c; }
  deleteNode(n);
  const pgn = serializeGame(rep.game);
  const { white, black, event, moves, plies, eco, opening } = metaFromPgn(pgn, 'Repertoire');
  await updateGame(rep.id, { white, black, event, moves, plies, eco, opening }, pgn);
  if (state.session.gameId === rep.id) { state.session.game = rep.game; state.session.cur = rep.game.root; state.session.dirty = false; }
  await loadGames();
  return true;
}

const mine = (ply: number, side: Side) => (ply % 2 === 0) === (side === 'w'); // ply = number of moves already played

// ---------- statistics from the owner's games ----------
export type Stats = Map<string, Map<string, number>>; // move sequence -> next move -> games

export function prefixStats(games: GameMeta[], side: Side, maxPly = 30): Stats {
  const stats: Stats = new Map();
  for (const g of games) {
    if (mySide(g) !== side || !g.moves) continue;
    const toks = g.moves.split(' ');
    let prefix = '';
    for (let i = 0; i < toks.length && i < maxPly; i++) {
      let m = stats.get(prefix);
      if (!m) stats.set(prefix, (m = new Map()));
      m.set(toks[i], (m.get(toks[i]) ?? 0) + 1);
      prefix = prefix ? prefix + ' ' + toks[i] : toks[i];
    }
  }
  return stats;
}

function has(root: Node, sans: string[]): boolean {
  let n = root;
  for (const san of sans) { const c = n.children.find(ch => stripSan(ch.san) === san); if (!c) return false; n = c; }
  return true;
}

export interface Suggestion { sans: string[]; games: number }

/** Lines the owner actually plays: their most frequent move in each position, against every reply seen often enough. */
export function suggestions(stats: Stats, side: Side, min: number, root: Node, maxPly = 20): Suggestion[] {
  const out: Suggestion[] = [];
  const emit = (sans: string[], games: number) => {
    let end = sans.length;
    if (end && !mine(end - 1, side)) end--; // a line ends with the owner's move
    const line = sans.slice(0, end);
    if (line.length && !has(root, line)) out.push({ sans: line, games });
  };
  const walk = (sans: string[], games: number) => {
    const next = stats.get(sans.join(' '));
    if (!next || sans.length >= maxPly) { emit(sans, games); return; }
    if (mine(sans.length, side)) {
      const [san, n] = [...next.entries()].sort((a, b) => b[1] - a[1])[0];
      if (n < min) { emit(sans, games); return; }
      walk([...sans, san], n);
    } else {
      const replies = [...next.entries()].filter(([, n]) => n >= min);
      if (!replies.length) { emit(sans, games); return; }
      for (const [san, n] of replies) walk([...sans, san], n);
    }
  };
  walk([], 0);
  const seen = new Set<string>();
  return out.filter(s => { const k = s.sans.join(' '); if (seen.has(k)) return false; seen.add(k); return true; }).sort((a, b) => b.games - a.games).slice(0, 60);
}

export interface Gap { sans: string[]; reply: string; games: number; answer?: string }

/** Opponent moves from the owner's games that the repertoire has no answer to. */
export function gaps(root: Node, stats: Stats, side: Side, min: number, maxPly = 16): Gap[] {
  const out: Gap[] = [];
  const walk = (n: Node, sans: string[]) => {
    if (sans.length >= maxPly) return; // deeper than this it is no longer opening preparation
    if (!mine(sans.length, side)) {
      const seen = stats.get(sans.join(' '));
      if (seen) for (const [reply, games] of seen) {
        if (games < min) continue;
        const child = n.children.find(c => stripSan(c.san) === reply);
        if (child && child.children.length) continue;
        const mineNext = stats.get([...sans, reply].join(' '));
        const answer = mineNext ? [...mineNext.entries()].sort((a, b) => b[1] - a[1])[0][0] : undefined;
        out.push({ sans, reply, games, answer });
      }
    }
    for (const c of n.children) walk(c, [...sans, stripSan(c.san)]);
  };
  if (root.children.length) walk(root, []);
  return out.sort((a, b) => b.games - a.games).slice(0, 40);
}

// ---------- opening trainer ----------
export interface OpeningCard {
  id: string; // position key – transpositions share one card
  side: Side;
  fen: string;
  prev?: string; // the opponent's move into the position
  answers: { uci: string; san: string }[];
  sans: string[]; // path, to open the position on the board
  ply: number;
  state: ReviewState;
}

export const posKey = (fen: string) => fen.split(' ').slice(0, 4).join(' ');

export function openingCards(root: Node, side: Side, train: Record<string, ReviewState> | undefined): OpeningCard[] {
  const byKey = new Map<string, OpeningCard>();
  const walk = (n: Node, sans: string[]) => {
    if (mine(sans.length, side) && n.children.length) {
      const id = posKey(n.fen);
      let c = byKey.get(id);
      if (!c) byKey.set(id, (c = { id, side, fen: n.fen, prev: n.uci || undefined, answers: [], sans, ply: sans.length, state: train?.[id] ?? newState() }));
      for (const ch of n.children) if (!c.answers.some(a => a.uci === ch.uci)) c.answers.push({ uci: ch.uci, san: ch.san });
    }
    for (const c of n.children) walk(c, [...sans, stripSan(c.san)]);
  };
  walk(root, []);
  return [...byKey.values()].filter(c => !c.state.removed);
}

export function countMoves(root: Node, side: Side): { own: number; lines: number } {
  let own = 0, lines = 0;
  const walk = (n: Node, ply: number) => {
    if (!n.children.length && ply > 0) lines++;
    for (const c of n.children) { if (mine(ply, side)) own++; walk(c, ply + 1); }
  };
  walk(root, 0);
  return { own, lines };
}

export const isStandard = (g: Game) => g.root.fen === START_FEN;
