// Position index: for every game the list of positions it passes through, so "which games reached this
// position?" is answered regardless of move order (transpositions). The index is derived data – it is
// rebuilt from the moves, kept only on this device and never synced.
import { Chess } from 'chess.js';
import { db, GameMeta } from './db';
import { parseGame } from './pgn';
import { mainline } from './tree';

/** Identity of a position: piece placement, side to move, castling rights, en-passant square. */
export const posKey = (fen: string) => fen.split(' ').slice(0, 4).join(' ');

/** 53-bit hash of a position key (fits a double exactly, so a game's positions pack into a Float64Array). */
export function keyHash(key: string): number {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < key.length; i++) {
    const ch = key.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}
export const fenHash = (fen: string) => keyHash(posKey(fen));

interface Entry { sig: string; keys: Float64Array } // keys[i] = position after i moves
const index = new Map<number, Entry>();
let loaded = false;
let running = false;
let pending: GameMeta[] | null = null; // a newer game list arrived while a run was in progress

export const indexState = { done: 0, total: 0, building: false, version: 0 };
let notify: () => void = () => {};
export function onIndexChange(fn: () => void) { notify = fn; }

const sigOf = (g: GameMeta) => `${g.plies}:${g.moves.length}:${g.moves.slice(-16)}`;

function keysFromMoves(moves: string): Float64Array {
  const toks = moves ? moves.split(' ') : [];
  const out = new Float64Array(toks.length + 1);
  const c = new Chess();
  out[0] = fenHash(c.fen());
  let n = 1;
  for (const san of toks) {
    try { c.move(san, { strict: false }); } catch { break; }
    out[n++] = fenHash(c.fen());
  }
  return n === out.length ? out : out.slice(0, n);
}

async function keysFromPgn(id: number): Promise<Float64Array> {
  const row = await db.pgns.get(id);
  if (!row?.pgn) return new Float64Array(0);
  const game = parseGame(row.pgn);
  return Float64Array.from([game.root.fen, ...mainline(game.root).map(n => n.fen)].map(fenHash));
}

/** Brings the index in line with the given games: indexes new or changed ones, forgets deleted ones. */
export async function syncIndex(games: GameMeta[]) {
  if (running) { pending = games; return; }
  running = true;
  try {
    if (!loaded) {
      for (const r of await db.posidx.toArray()) index.set(r.id, { sig: r.sig, keys: r.keys });
      loaded = true;
      indexState.version++;
    }
    const ids = new Set(games.map(g => g.id!));
    const gone = [...index.keys()].filter(id => !ids.has(id));
    if (gone.length) { gone.forEach(id => index.delete(id)); await db.posidx.bulkDelete(gone); indexState.version++; }
    const todo = games.filter(g => index.get(g.id!)?.sig !== sigOf(g));
    if (todo.length) {
      indexState.building = true; indexState.done = 0; indexState.total = todo.length; notify();
      let batch: { id: number; sig: string; keys: Float64Array }[] = [];
      let slice = performance.now();
      for (const g of todo) {
        // games from a set-up position store no move list in their metadata – replay those from the PGN
        const keys = g.moves ? keysFromMoves(g.moves) : g.plies ? await keysFromPgn(g.id!) : keysFromMoves('');
        const e = { sig: sigOf(g), keys };
        index.set(g.id!, e);
        batch.push({ id: g.id!, ...e });
        indexState.done++;
        if (performance.now() - slice > 14) { // keep the page responsive
          if (batch.length >= 200) { await db.posidx.bulkPut(batch); batch = []; }
          indexState.version++; notify();
          await new Promise(r => setTimeout(r));
          slice = performance.now();
        }
      }
      if (batch.length) await db.posidx.bulkPut(batch);
      indexState.building = false; indexState.version++; notify();
    } else if (gone.length) notify();
  } finally {
    running = false;
    if (pending) { const next = pending; pending = null; syncIndex(next); }
  }
}

export interface Hit { id: number; ply: number }

/** All games whose main line reaches the position (first occurrence per game). */
export function findPosition(fen: string): Hit[] {
  const h = fenHash(fen);
  const out: Hit[] = [];
  for (const [id, e] of index) {
    const i = e.keys.indexOf(h);
    if (i >= 0) out.push({ id, ply: i });
  }
  return out;
}
