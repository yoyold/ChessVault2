import { addGames, db, GameMeta } from './db';
import { metaFromPgn } from './meta';
import { splitPgn } from './pgn';

export interface ImportResult { added: number; duplicates: number; failed: number }

export async function importPgnText(text: string, source: string, onProgress?: (done: number, total: number) => void): Promise<ImportResult> {
  const parts = splitPgn(text);
  const known = new Set<string>();
  await db.games.each(g => { if (!g.deleted) known.add(g.hash); });
  const res: ImportResult = { added: 0, duplicates: 0, failed: 0 };
  let batch: { meta: GameMeta; pgn: string }[] = [];
  for (let i = 0; i < parts.length; i++) {
    try {
      const meta = metaFromPgn(parts[i], source);
      if (!meta.plies && meta.white === '?' && meta.black === '?') res.failed++;
      else if (known.has(meta.hash)) res.duplicates++;
      else { known.add(meta.hash); batch.push({ meta, pgn: parts[i] }); res.added++; }
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
