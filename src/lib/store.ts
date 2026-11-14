import { useSyncExternalStore } from 'react';
import { db, GameMeta, onLocalChange, updateGame, addGames, kvGet, patchGames } from './db';
import { Game, Node, newGame, mainline, stripSan } from './tree';
import { parseGame, serializeGame } from './pgn';
import { metaFromPgn, normalizeDate } from './meta';
import { analyzeGame, errorCounts, Report } from './report';
import type { Job } from './engine';
import { getSyncConfig, syncNow } from './sync';
import { onIndexChange, syncIndex } from './posindex';

export type View = 'home' | 'db' | 'analysis' | 'repertoire' | 'training' | 'notes' | 'tournaments' | 'stats' | 'settings';

export interface Settings {
  theme: 'dark' | 'light';
  reportDepth: number;
  multipv: number;
  me: string;
  engineOn: boolean;
  scale: number;
}

export interface Filter {
  q: string; white: string; black: string; ignoreColors: boolean;
  res: { w: boolean; d: boolean; b: boolean };
  yearFrom: string; yearTo: string; eloMin: string; eloMax: string;
  ecoFrom: string; ecoTo: string; opening: string; moves: string;
  movesMin: string; movesMax: string; tc: string; tag: string;
  fen: string; // games that reach this position
  favOnly: boolean; analyzedOnly: boolean;
}

export const emptyFilter = (): Filter => ({
  q: '', white: '', black: '', ignoreColors: true, res: { w: true, d: true, b: true },
  yearFrom: '', yearTo: '', eloMin: '', eloMax: '', ecoFrom: '', ecoTo: '', opening: '', moves: '',
  movesMin: '', movesMax: '', tc: '', tag: '', fen: '', favOnly: false, analyzedOnly: false,
});

export interface Session {
  gameId: number | null;
  game: Game;
  cur: Node;
  report: Report | null;
  dirty: boolean;
  orientation: 'white' | 'black';
  rep?: 'w' | 'b'; // editing the repertoire of that colour
}

export interface SyncStatus { state: 'off' | 'idle' | 'busy' | 'error'; msg: string; last: number }

interface State {
  view: View;
  games: GameMeta[];
  reps: GameMeta[]; // repertoire records (kept out of the game list)
  notes: GameMeta[]; // position notes (records with `note`)
  loaded: boolean;
  settings: Settings;
  filter: Filter;
  session: Session;
  sync: SyncStatus;
  toast: { msg: string; kind: 'ok' | 'err' } | null;
  bg: { done: number; total: number; label: string } | null;
}

const defaultSettings: Settings = { theme: 'dark', reportDepth: 14, multipv: 3, me: '', engineOn: true, scale: 1.3 };

function loadSettings(): Settings {
  try { return { ...defaultSettings, ...JSON.parse(localStorage.getItem('caissa.settings') || '{}') }; }
  catch { return defaultSettings; }
}

function freshSession(): Session {
  const game = newGame();
  return { gameId: null, game, cur: game.root, report: null, dirty: false, orientation: 'white' };
}

export const state: State = {
  view: 'home', games: [], reps: [], notes: [], loaded: false, settings: loadSettings(), filter: emptyFilter(),
  session: freshSession(), sync: { state: getSyncConfig() ? 'idle' : 'off', msg: '', last: 0 }, toast: null, bg: null,
};

let version = 0;
const subs = new Set<() => void>();
export function bump() {
  version++; subs.forEach(f => f());
  // Autosave: every change to a game that already lives in the database is written shortly afterwards.
  if (state.session.dirty && state.session.gameId != null) {
    clearTimeout(autoTimer);
    autoTimer = setTimeout(() => { flushSession(); }, 2500);
  }
}
let autoTimer: any;

/** Writes pending changes of a stored game now (used by the autosave timer and when leaving the game). */
export async function flushSession() {
  clearTimeout(autoTimer);
  const s = state.session;
  if (s.dirty && s.gameId != null && s.game.root.children.length) await saveSession(true);
}
export function useStore(): State {
  useSyncExternalStore(cb => { subs.add(cb); return () => subs.delete(cb); }, () => version);
  return state;
}

let toastTimer: any;
export function toast(msg: string, kind: 'ok' | 'err' = 'ok') {
  state.toast = { msg, kind };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { state.toast = null; bump(); }, kind === 'err' ? 7000 : 3500);
  bump();
}

export function setView(v: View) { if (state.view === 'analysis' && v !== 'analysis') flushSession(); state.view = v; bump(); }
export function setSettings(p: Partial<Settings>) {
  state.settings = { ...state.settings, ...p };
  localStorage.setItem('caissa.settings', JSON.stringify(state.settings));
  applyLook();
  bump();
}
export function setFilter(p: Partial<Filter>) { state.filter = { ...state.filter, ...p }; bump(); }

export async function loadGames() {
  const all = await db.games.toArray();
  // Repair dates stored before non-standard formats (e.g. DD.MM.YYYY) were normalised.
  const fix = all.filter(g => !g.deleted && g.date !== normalizeDate(g.date));
  if (fix.length) {
    for (const g of fix) { g.date = normalizeDate(g.date); g.year = parseInt(g.date.slice(0, 4), 10) || 0; }
    await patchGames(fix.map(g => g.id!), g => { const date = normalizeDate(g.date); return { date, year: parseInt(date.slice(0, 4), 10) || 0 }; });
  }
  state.games = all.filter(g => !g.deleted && !g.rep && !g.note);
  state.reps = all.filter(g => !g.deleted && g.rep);
  state.notes = all.filter(g => !g.deleted && g.note);
  syncIndex(state.games); // background; views re-render through onIndexChange
  state.loaded = true;
  bump();
}

export function reportMatches(report: Report | null | undefined, game: Game): Report | null {
  if (!report) return null;
  // The report stays valid as long as the analysed moves are still the start of the main line
  // (moves appended at the end do not invalidate it).
  const line = mainline(game.root);
  if (line.length < report.sans.length) return null;
  for (let i = 0; i < report.sans.length; i++) if (stripSan(line[i].san) !== report.sans[i]) return null;
  return report;
}

/** Before the session is replaced: stored games are saved automatically, a new unsaved game asks. */
async function leaveOk(): Promise<boolean> {
  const s = state.session;
  if (s.gameId != null) { await flushSession(); return true; }
  return !(s.dirty && s.game.root.children.length) || confirm('Die neue Partie ist noch nicht gespeichert. Änderungen verwerfen?');
}

export async function openGame(id: number, ply?: number, path?: string[]) {
  if (state.session.gameId !== id && !(await leaveOk())) return;
  if (state.session.gameId === id) await flushSession();
  const row = await db.pgns.get(id);
  if (!row) { toast('Partie nicht gefunden.', 'err'); return; }
  const game = parseGame(row.pgn);
  const rep = (await db.reports.get(id)) ?? null;
  const meta = state.games.find(g => g.id === id) ?? state.reps.find(g => g.id === id);
  let cur = game.root;
  if (ply) { const line = mainline(game.root); cur = line[Math.min(ply, line.length) - 1] ?? game.root; }
  if (path) for (const san of path) { const n = cur.children.find(c => stripSan(c.san) === san); if (!n) break; cur = n; }
  state.session = {
    gameId: id, game, cur, report: reportMatches(rep, game), dirty: false, rep: meta?.rep,
    orientation: meta?.rep ? (meta.rep === 'b' ? 'black' : 'white') : meta && mySide(meta) === 'b' ? 'black' : 'white',
  };
  state.view = 'analysis';
  bump();
}

export async function openNewGame(fen?: string) {
  if (!(await leaveOk())) return;
  const s = freshSession();
  if (fen) { s.game = newGame(fen); s.cur = s.game.root; }
  state.session = s;
  state.view = 'analysis';
  bump();
}

export async function openPgn(pgn: string) {
  if (!(await leaveOk())) return;
  const game = parseGame(pgn);
  state.session = { gameId: null, game, cur: game.root, report: null, dirty: true, orientation: 'white' };
  state.view = 'analysis';
  bump();
}

/** Saves the current game (new or as an update) including variations, comments and report. */
export async function saveSession(silent = false) {
  const s = state.session;
  clearTimeout(autoTimer);
  if (!s.game.root.children.length && !s.rep) { if (!silent) toast('Die Partie enthält noch keine Züge.', 'err'); return; }
  const pgn = serializeGame(s.game);
  s.dirty = false; // edits made while the write is in flight set it again and trigger the next autosave
  try {
  const meta = metaFromPgn(pgn, 'Eingabe');
  const rep = reportMatches(s.report, s.game);
  if (s.gameId == null) {
    await addGames([{ meta, pgn }]);
    const row = await db.games.where('uid').equals(meta.uid).first();
    s.gameId = row!.id!;
    if (rep) await updateGame(s.gameId, reportPatch(rep, s.game.root.fen.split(' ')[1] === 'w'), undefined, rep);
  } else {
    const { hash: _h, uid: _u, shard: _s, added: _a, fav: _f, tags: _t, source: _src, updated: _up, dirty: _d, ...rest } = meta;
    await updateGame(s.gameId, { ...rest, ...(rep ? reportPatch(rep, s.game.root.fen.split(' ')[1] === 'w') : { accW: undefined, accB: undefined, errW: undefined, errB: undefined }) }, pgn, rep ?? null);
  }
  } catch (e: any) { s.dirty = true; toast('Speichern fehlgeschlagen: ' + e.message, 'err'); return; }
  await loadGames();
  if (!silent) toast(s.rep ? 'Repertoire gespeichert.' : 'Partie gespeichert.');
}

function reportPatch(report: Report, startsWhite = true) {
  const e = errorCounts(report, startsWhite);
  return { accW: report.accW, accB: report.accB, errW: e.w, errB: e.b };
}

export async function saveReport(id: number, report: Report, startsWhite = true) {
  const patch = reportPatch(report, startsWhite);
  await updateGame(id, patch, undefined, report);
  const g = state.games.find(x => x.id === id);
  if (g) Object.assign(g, patch);
  bump();
}

// ---------- The owner's player names ----------
/** Several names (e.g. Lichess, Chess.com and over-the-board name) are separated by semicolons. */
export function myNames(): string[] {
  return state.settings.me.split(';').map(s => s.trim().toLowerCase()).filter(Boolean);
}
export function mySide(g: { white: string; black: string }, names = myNames()): 'w' | 'b' | null {
  const w = names.includes(g.white.toLowerCase()), b = names.includes(g.black.toLowerCase());
  return w === b ? null : w ? 'w' : 'b';
}

// ---------- Background analysis ----------
// Creates reports for many games while the user keeps working. The engine processes jobs
// one after another; interactive analysis gets its turn between two positions.
const bgCtl: { cancelled: boolean; job?: Job } = { cancelled: false };
export async function startBackground(ids: number[]) {
  if (state.bg) { toast('Es läuft bereits eine Hintergrundanalyse.', 'err'); return; }
  if (!ids.length) { toast('Alle diese Partien haben bereits einen Report.'); return; }
  bgCtl.cancelled = false;
  state.bg = { done: 0, total: ids.length, label: '' };
  bump();
  try {
    for (let i = 0; i < ids.length && !bgCtl.cancelled; i++) {
      const meta = state.games.find(g => g.id === ids[i]);
      state.bg = { done: i, total: ids.length, label: meta ? `${meta.white} – ${meta.black}` : '' };
      bump();
      const row = await db.pgns.get(ids[i]);
      if (!row) continue;
      const game = parseGame(row.pgn);
      const line = mainline(game.root);
      if (!line.length) continue;
      const rep = await analyzeGame(game.root.fen, line, state.settings.reportDepth, () => {}, bgCtl);
      if (rep) await saveReport(ids[i], rep, game.root.fen.split(' ')[1] === 'w');
    }
    toast(bgCtl.cancelled ? 'Hintergrundanalyse angehalten.' : 'Hintergrundanalyse abgeschlossen.');
  } catch (e: any) { toast('Hintergrundanalyse fehlgeschlagen: ' + e.message, 'err'); }
  state.bg = null;
  bump();
}
export function stopBackground() { bgCtl.cancelled = true; bgCtl.job?.cancel(); }

// ---------- Sync ----------
let syncTimer: any;
export async function runSync(silent = true) {
  if (!getSyncConfig()) { state.sync = { state: 'off', msg: '', last: 0 }; bump(); return; }
  state.sync = { ...state.sync, state: 'busy', msg: 'Synchronisiere …' };
  bump();
  try {
    const r = await syncNow(msg => { if (msg) { state.sync = { ...state.sync, msg }; bump(); } });
    state.sync = { state: 'idle', msg: '', last: Date.now() };
    if (r.pulled) await loadGames();
    if (!silent || r.pulled) toast(r.pulled || r.pushed ? `Sync: ${r.pulled} empfangen, ${r.pushed} gesendet.` : 'Alles synchron.');
  } catch (e: any) {
    state.sync = { ...state.sync, state: 'error', msg: e.message };
    if (!silent) toast('Sync fehlgeschlagen: ' + e.message, 'err');
  }
  bump();
}

export function scheduleSync(delay = 4000) {
  if (!getSyncConfig()) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => runSync(true), delay);
}

function applyLook() {
  document.documentElement.dataset.theme = state.settings.theme;
  document.documentElement.style.setProperty('--scale', String(state.settings.scale));
}

export async function initApp() {
  applyLook();
  onIndexChange(() => bump());
  await loadGames();
  if (!state.games.length) { state.view = 'db'; bump(); }
  onLocalChange(() => scheduleSync());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushSession(); });
  if (getSyncConfig()) {
    state.sync.last = await kvGet('lastSync', 0);
    runSync(true);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && Date.now() - state.sync.last > 60_000) runSync(true);
    });
  }
}
