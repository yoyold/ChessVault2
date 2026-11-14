import Dexie, { Table } from 'dexie';
import type { Report } from './report';

export interface GameMeta {
  id?: number;
  white: string;
  black: string;
  whiteElo: number;
  blackElo: number;
  result: string;
  date: string;
  year: number;
  event: string;
  site: string;
  round: string;
  eco: string;
  opening: string;
  moves: string; // main line, SAN without +/#, space-separated
  plies: number;
  tc: string; // Bullet | Blitz | Rapid | Klassisch | Fernschach | '' (stored values are German)
  source: string;
  fav: boolean;
  tags: string[];
  accW?: number;
  accB?: number;
  errW?: [number, number, number]; // White's inaccuracies, mistakes, blunders
  errB?: [number, number, number];
  train?: Record<string, import('./training').ReviewState>; // review state of this game's training cards
  hash: string;
  added: number;
  // sync fields
  uid: string; // identifier that is stable across devices
  shard: number; // sync shard (0–63)
  updated: number; // last change (ms) – last write wins
  dirty: 0 | 1; // changed locally, not uploaded yet
  deleted?: boolean; // tombstone
  rep?: 'w' | 'b'; // this record is the owner's opening repertoire for that colour, not a game
}

export const SHARDS = 64;
export function shardOf(uid: string): number {
  let h = 0;
  for (let i = 0; i < uid.length; i++) h = (h * 31 + uid.charCodeAt(i)) >>> 0;
  return h % SHARDS;
}

class CaissaDB extends Dexie {
  games!: Table<GameMeta, number>;
  pgns!: Table<{ id: number; pgn: string }, number>;
  reports!: Table<Report & { id: number }, number>;
  kv!: Table<{ key: string; value: any }, string>;
  constructor() {
    super('caissa');
    this.version(1).stores({ games: '++id, uid, dirty, shard', pgns: 'id', reports: 'id', kv: 'key' });
  }
}

export const db = new CaissaDB();

let changeListener: (() => void) | null = null;
/** Called after every local change (triggers the automatic sync). */
export function onLocalChange(fn: () => void) { changeListener = fn; }
const changed = () => changeListener?.();

/** Adds new games; existing tombstones with the same uid are replaced. */
export async function addGames(items: { meta: GameMeta; pgn: string }[]): Promise<void> {
  if (!items.length) return;
  await db.transaction('rw', db.games, db.pgns, async () => {
    const old = await db.games.where('uid').anyOf(items.map(i => i.meta.uid)).toArray();
    if (old.length) await db.games.bulkDelete(old.map(o => o.id!));
    const now = Date.now();
    const ids = (await db.games.bulkAdd(items.map(i => ({ ...i.meta, updated: now, dirty: 1 as const })), { allKeys: true })) as number[];
    await db.pgns.bulkPut(items.map((it, i) => ({ id: ids[i], pgn: it.pgn })));
  });
  changed();
}

export async function updateGame(id: number, patch: Partial<GameMeta>, pgn?: string, report?: Report | null) {
  await db.transaction('rw', db.games, db.pgns, db.reports, async () => {
    await db.games.update(id, { ...patch, updated: Date.now(), dirty: 1 });
    if (pgn !== undefined) await db.pgns.put({ id, pgn });
    if (report === null) await db.reports.delete(id);
    else if (report) await db.reports.put({ ...report, id });
  });
  changed();
}

export async function patchGames(ids: number[], fn: (g: GameMeta) => Partial<GameMeta>) {
  await db.transaction('rw', db.games, async () => {
    const now = Date.now();
    const rows = await db.games.bulkGet(ids);
    await db.games.bulkPut(rows.filter(Boolean).map(g => ({ ...g!, ...fn(g!), updated: now, dirty: 1 as const })));
  });
  changed();
}

/** Deletes games (as tombstones, so the deletion syncs to other devices). */
export async function deleteGames(ids: number[]) {
  await db.transaction('rw', db.games, db.pgns, db.reports, async () => {
    const now = Date.now();
    const rows = await db.games.bulkGet(ids);
    await db.games.bulkPut(rows.filter(Boolean).map(g => ({
      ...g!, deleted: true, moves: '', opening: '', tags: [], updated: now, dirty: 1 as const,
    })));
    await db.pgns.bulkDelete(ids);
    await db.reports.bulkDelete(ids);
  });
  changed();
}

export async function kvGet<T>(key: string, def: T): Promise<T> {
  const r = await db.kv.get(key);
  return r ? (r.value as T) : def;
}
export const kvSet = (key: string, value: any) => db.kv.put({ key, value });
