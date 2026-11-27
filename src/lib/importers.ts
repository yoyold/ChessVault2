import { addGames, db, GameMeta, updateGame } from './db';
import { metaFromPgn } from './meta';
import { parseGame, serializeGame, splitPgn } from './pgn';
import { addMove, Node } from './tree';

export interface ImportResult { added: number; duplicates: number; failed: number; online: number; merged: number }

export async function importPgnText(text: string, source: string, onProgress?: (done: number, total: number) => void, tags: string[] = [], merge = false): Promise<ImportResult> {
  const parts = splitPgn(text);
  const known = new Set<string>();
  const idOf = new Map<string, number>();
  await db.games.each(g => { if (!g.deleted) { known.add(g.hash); idOf.set(g.hash, g.id!); } });
  const res: ImportResult = { added: 0, duplicates: 0, failed: 0, online: 0, merged: 0 };
  let batch: { meta: GameMeta; pgn: string }[] = [];
  for (let i = 0; i < parts.length; i++) {
    try {
      const meta = metaFromPgn(parts[i], source);
      if (tags.length) meta.tags = [...tags];
      if (!meta.plies && meta.white === '?' && meta.black === '?') res.failed++;
      else if (known.has(meta.hash)) {
        if (merge && idOf.has(meta.hash) && await mergeInto(idOf.get(meta.hash)!, parts[i])) res.merged++;
        else res.duplicates++;
      }
      else { known.add(meta.hash); batch.push({ meta, pgn: parts[i] }); res.added++; if (meta.online) res.online++; }
    } catch { res.failed++; }
    if (batch.length >= 500 || i === parts.length - 1) {
      await addGames(batch);
      batch = [];
      onProgress?.(i + 1, parts.length);
      await new Promise(r => setTimeout(r));
    }
  }
  return res;
}

export async function fetchLichess(user: string, max: number, perf: string, onStatus: (s: string) => void): Promise<string> {
  const p = new URLSearchParams({ max: String(max), opening: 'true', clocks: 'false', evals: 'false' });
  if (perf) p.set('perfType', perf);
  onStatus('Lade Partien von Lichess …');
  const res = await fetch(`https://lichess.org/api/games/user/${encodeURIComponent(user.trim())}?${p}`, { headers: { Accept: 'application/x-chess-pgn' } });
  if (res.status === 404) throw new Error(`Lichess-Benutzer „${user}“ nicht gefunden.`);
  if (res.status === 429) throw new Error('Lichess meldet zu viele Anfragen – bitte eine Minute warten.');
  if (!res.ok) throw new Error(`Lichess-Fehler ${res.status}`);
  // read the stream so progress can be shown
  const reader = res.body?.getReader();
  if (!reader) return res.text();
  const dec = new TextDecoder();
  let text = '';
  let count = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = dec.decode(value, { stream: true });
    count += (chunk.match(/\[Event "/g) || []).length;
    text += chunk;
    onStatus(`Lade Partien von Lichess … ${count}`);
  }
  return text;
}

export async function fetchChessCom(user: string, months: number, onStatus: (s: string) => void): Promise<string> {
  const u = encodeURIComponent(user.trim().toLowerCase());
  onStatus('Lade Archivliste von Chess.com …');
  const res = await fetch(`https://api.chess.com/pub/player/${u}/games/archives`);
  if (res.status === 404) throw new Error(`Chess.com-Benutzer „${user}“ nicht gefunden.`);
  if (!res.ok) throw new Error(`Chess.com-Fehler ${res.status}`);
  const archives: string[] = (await res.json()).archives || [];
  const take = archives.slice(-months).reverse();
  const out: string[] = [];
  for (let i = 0; i < take.length; i++) {
    onStatus(`Lade Monat ${i + 1}/${take.length} von Chess.com …`);
    const r = await fetch(take[i]);
    if (!r.ok) continue;
    const j = await r.json();
    for (const g of j.games || []) if (g.pgn && (!g.rules || g.rules === 'chess')) out.push(g.pgn);
  }
  return out.join('\n\n');
}

const hasAnnotations = (n: Node): boolean =>
  !!(n.comment || n.botComment || n.pre || n.nags?.length || n.shapes?.length || n.children.length > 1) || n.children.some(hasAnnotations);

/**
 * Lays the comments, symbols, arrows and variations of `incoming` over the stored version of the same game.
 * Bot comments replace older bot comments (the newest analysis wins); the owner's text is never removed.
 * Returns false when there was nothing to add.
 */
async function mergeInto(id: number, incoming: string): Promise<boolean> {
  const src = parseGame(incoming);
  if (!hasAnnotations(src.root)) return false;
  const row = await db.pgns.get(id);
  if (!row) return false;
  const dst = parseGame(row.pgn);
  let changed = false;
  const copy = (d: Node, s: Node) => {
    if (s.comment && !(d.comment ?? '').includes(s.comment)) { d.comment = [d.comment, s.comment].filter(Boolean).join(' '); changed = true; }
    if (s.botComment && d.botComment !== s.botComment) { d.botComment = s.botComment; changed = true; }
    if (s.pre && !d.pre) { d.pre = s.pre; changed = true; }
    if (s.nags?.length && !d.nags?.length) { d.nags = [...s.nags]; changed = true; }
    for (const sh of s.shapes ?? []) {
      if (!(d.shapes ?? []).some(x => x.orig === sh.orig && x.dest === sh.dest && x.brush === sh.brush)) { (d.shapes ??= []).push(sh); changed = true; }
    }
  };
  const walk = (d: Node, s: Node) => {
    copy(d, s);
    for (const sc of s.children) {
      let dc = d.children.find(c => c.uci === sc.uci);
      if (!dc) {
        dc = addMove(d, sc.san) ?? undefined;
        if (!dc) continue;
        if (sc.vBot && d.children[0] !== dc) dc.vBot = true;
        changed = true;
      }
      walk(dc, sc);
    }
  };
  walk(dst.root, src.root);
  if (src.headers.Annotator && !dst.headers.Annotator) { dst.headers.Annotator = src.headers.Annotator; changed = true; }
  if (!changed) return false;
  await updateGame(id, {}, serializeGame(dst));
  return true;
}
