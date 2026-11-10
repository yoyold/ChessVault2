// Geräteübergreifender Sync über ein privates GitHub-Repository.
// Die Datenbank liegt dort als 64 JSON-Pakete (shards/00.json … 3f.json) auf einem eigenen Branch.
// Jeder Sync schreibt einen Commit OHNE Vorgänger und setzt den Branch hart um – so wächst das Repo nicht an.
// Konflikte: pro Partie gewinnt die jüngste Änderung; Löschungen werden als Löschmarken übertragen.
import { db, GameMeta, kvGet, kvSet, SHARDS } from './db';
import type { Report } from './report';

export interface SyncConfig { repo: string; token: string; branch: string }
export interface SyncRecord { uid: string; updated: number; deleted?: boolean; meta?: Omit<GameMeta, 'id' | 'dirty'>; pgn?: string; report?: Report }
export interface SyncResult { pulled: number; pushed: number }

const CFG_KEY = 'caissa.sync';
const API = 'https://api.github.com';

export function getSyncConfig(): SyncConfig | null {
  try {
    const c = JSON.parse(localStorage.getItem(CFG_KEY) || 'null');
    return c && c.repo && c.token ? { branch: 'caissa-data', ...c } : null;
  } catch { return null; }
}
export function setSyncConfig(c: SyncConfig | null) {
  if (c) localStorage.setItem(CFG_KEY, JSON.stringify(c)); else localStorage.removeItem(CFG_KEY);
}

class HttpError extends Error { constructor(public status: number, msg: string) { super(msg); } }

async function gh(cfg: SyncConfig, path: string, init: RequestInit & { raw?: boolean } = {}): Promise<any> {
  const res = await fetch(`${API}/repos/${cfg.repo}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      Accept: init.raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = (await res.json()).message || msg; } catch { /* leer */ }
    throw new HttpError(res.status, msg);
  }
  return init.raw ? res.text() : res.json();
}

function explain(e: any): Error {
  if (e instanceof HttpError) {
    if (e.status === 401) return new Error('Token ungültig oder abgelaufen (401).');
    if (e.status === 403) return new Error('Zugriff verweigert (403) – hat das Token Schreibrechte auf „Contents“?');
    if (e.status === 404) return new Error('Repository nicht gefunden (404) – Name und Token-Berechtigung prüfen.');
    if (e.status === 409) return new Error('Das Repository ist leer – bitte einmalig mit einer README anlegen.');
    return new Error(`GitHub-Fehler ${e.status}: ${e.message}`);
  }
  return e instanceof Error ? e : new Error(String(e));
}

export async function testSync(cfg: SyncConfig): Promise<string> {
  try {
    const r = await gh(cfg, '');
    if (!r.permissions?.push) throw new Error('Das Token hat keine Schreibrechte auf dieses Repository.');
    return r.private ? 'Verbindung ok (privates Repository).' : 'Verbindung ok – Achtung: Das Repository ist öffentlich!';
  } catch (e) { throw explain(e); }
}

const shardPath = (s: number) => `shards/${s.toString(16).padStart(2, '0')}.json`;

async function mergeRemote(records: SyncRecord[], dirty: 0 | 1 = 0): Promise<number> {
  let applied = 0;
  await db.transaction('rw', db.games, db.pgns, db.reports, async () => {
    const local = await db.games.where('uid').anyOf(records.map(r => r.uid)).toArray();
    const byUid = new Map(local.map(g => [g.uid, g]));
    for (const r of records) {
      const l = byUid.get(r.uid);
      if (l && l.updated >= r.updated) continue;
      if (!r.meta) continue;
      const row: GameMeta = { ...(r.meta as GameMeta), uid: r.uid, updated: r.updated, deleted: !!r.deleted, dirty };
      delete row.id;
      let id: number;
      if (l) { id = l.id!; await db.games.put({ ...row, id }); }
      else id = (await db.games.add(row)) as number;
      if (r.deleted) { await db.pgns.delete(id); await db.reports.delete(id); }
      else {
        await db.pgns.put({ id, pgn: r.pgn || '' });
        if (r.report) await db.reports.put({ ...r.report, id }); else await db.reports.delete(id);
      }
      if (!(r.deleted && !l)) applied++;
    }
  });
  return applied;
}

async function buildShard(s: number): Promise<SyncRecord[]> {
  const rows = await db.games.where('shard').equals(s).toArray();
  const ids = rows.map(r => r.id!);
  const pgns = await db.pgns.bulkGet(ids);
  const reps = await db.reports.bulkGet(ids);
  return rows.map((g, i) => {
    const { id: _id, dirty: _d, ...meta } = g;
    const rec: SyncRecord = { uid: g.uid, updated: g.updated, meta };
    if (g.deleted) rec.deleted = true;
    else {
      rec.pgn = pgns[i]?.pgn || '';
      if (reps[i]) { const { id: _rid, ...rep } = reps[i] as any; rec.report = rep; }
    }
    return rec;
  }).sort((a, b) => (a.uid < b.uid ? -1 : 1));
}

let running: Promise<SyncResult> | null = null;

export function syncNow(onStatus: (s: string) => void = () => {}): Promise<SyncResult> {
  if (running) return running;
  running = doSync(onStatus).catch(e => { throw explain(e); }).finally(() => { running = null; });
  return running;
}

async function doSync(onStatus: (s: string) => void): Promise<SyncResult> {
  const cfg = getSyncConfig();
  if (!cfg) throw new Error('Sync ist nicht eingerichtet.');
  const refPath = `/git/ref/heads/${cfg.branch}`;
  let pulled = 0, pushed = 0;

  for (let attempt = 0; attempt < 4; attempt++) {
    // 1. Stand im Repo lesen
    onStatus('Prüfe Cloud-Stand …');
    let headSha: string | null = null;
    try { headSha = (await gh(cfg, refPath)).object.sha; }
    catch (e) { if (!(e instanceof HttpError && (e.status === 404 || e.status === 409))) throw e; }
    const remote: Record<string, string> = {};
    let baseTree: string | null = null;
    if (headSha) {
      const commit = await gh(cfg, `/git/commits/${headSha}`);
      baseTree = commit.tree.sha;
      const tree = await gh(cfg, `/git/trees/${baseTree}?recursive=1`);
      for (const t of tree.tree) if (t.type === 'blob' && t.path.startsWith('shards/')) remote[t.path] = t.sha;
    }

    // 2. Geänderte Pakete herunterladen und einmischen
    const state = await kvGet<{ repo: string; tree: Record<string, string> }>('syncState', { repo: '', tree: {} });
    const last = state.repo === `${cfg.repo}#${cfg.branch}` ? state.tree : {};
    const toPull = Object.keys(remote).filter(p => last[p] !== remote[p]);
    for (let i = 0; i < toPull.length; i++) {
      onStatus(`Lade Paket ${i + 1}/${toPull.length} …`);
      const txt = await gh(cfg, `/git/blobs/${remote[toPull[i]]}`, { raw: true });
      pulled += await mergeRemote(JSON.parse(txt));
      last[toPull[i]] = remote[toPull[i]];
      await kvSet('syncState', { repo: `${cfg.repo}#${cfg.branch}`, tree: last });
    }
    // Neues Repo/Branch: alles Lokale gilt als noch nicht hochgeladen
    if (state.repo !== `${cfg.repo}#${cfg.branch}` && !toPull.length) {
      await db.games.toCollection().modify({ dirty: 1 });
      await kvSet('syncState', { repo: `${cfg.repo}#${cfg.branch}`, tree: last });
    }

    // 3. Lokale Änderungen hochladen
    const dirty = await db.games.where('dirty').equals(1).toArray();
    if (!dirty.length) break;
    const shards = [...new Set(dirty.map(g => g.shard))].filter(s => s >= 0 && s < SHARDS);
    const snapshot = Date.now();
    const entries: { path: string; mode: string; type: string; sha: string }[] = [];
    for (let i = 0; i < shards.length; i++) {
      onStatus(`Lade hoch ${i + 1}/${shards.length} …`);
      const recs = await buildShard(shards[i]);
      const blob = await gh(cfg, '/git/blobs', { method: 'POST', body: JSON.stringify({ content: JSON.stringify(recs), encoding: 'utf-8' }) });
      entries.push({ path: shardPath(shards[i]), mode: '100644', type: 'blob', sha: blob.sha });
    }
    const tree = await gh(cfg, '/git/trees', { method: 'POST', body: JSON.stringify({ ...(baseTree ? { base_tree: baseTree } : {}), tree: entries }) });
    const commit = await gh(cfg, '/git/commits', {
      method: 'POST',
      body: JSON.stringify({ message: `Caissa Sync ${new Date().toISOString()}`, tree: tree.sha, parents: [] }),
    });
    // Hat inzwischen ein anderes Gerät geschrieben? Dann von vorn.
    let nowSha: string | null = null;
    try { nowSha = (await gh(cfg, refPath)).object.sha; }
    catch (e) { if (!(e instanceof HttpError && (e.status === 404 || e.status === 409))) throw e; }
    if (nowSha !== headSha) continue;
    if (headSha) await gh(cfg, `/git/refs/heads/${cfg.branch}`, { method: 'PATCH', body: JSON.stringify({ sha: commit.sha, force: true }) });
    else await gh(cfg, '/git/refs', { method: 'POST', body: JSON.stringify({ ref: `refs/heads/${cfg.branch}`, sha: commit.sha }) });

    for (const e of entries) last[e.path] = e.sha;
    await kvSet('syncState', { repo: `${cfg.repo}#${cfg.branch}`, tree: last });
    await db.games.where('dirty').equals(1).and(g => g.updated <= snapshot).modify({ dirty: 0 });
    pushed += dirty.length;
    break;
  }
  await kvSet('lastSync', Date.now());
  onStatus('');
  return { pulled, pushed };
}

/** Vollständige Sicherung (Partien, Varianten, Reports, Lernstand, Schlagwörter) als eine JSON-Datei. */
export async function exportBackup(): Promise<string> {
  const records: SyncRecord[] = [];
  for (let s = 0; s < SHARDS; s++) records.push(...(await buildShard(s)));
  return JSON.stringify({ app: 'caissa', format: 1, created: new Date().toISOString(), records });
}

/** Spielt eine Sicherung ein. Pro Partie gewinnt die jüngere Fassung; nichts wird gelöscht. */
export async function importBackup(text: string): Promise<number> {
  const data = JSON.parse(text);
  if (data?.app !== 'caissa' || !Array.isArray(data.records)) throw new Error('Das ist keine Caissa-Sicherungsdatei.');
  let n = 0;
  for (let i = 0; i < data.records.length; i += 500) n += await mergeRemote(data.records.slice(i, i + 500), 1);
  return n;
}
