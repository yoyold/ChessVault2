import { GameMeta, shardOf } from './db';
import { parseHeaders, movetextOf, quickMainline } from './pgn';
import { findOpening } from './openings';

function hashStr(s: string): string {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(36) + (h1 >>> 0).toString(36);
}

export function timeClass(tc: string | undefined, event = ''): string {
  if (!tc || tc === '?') {
    const m = event.match(/bullet|blitz|rapid|classical|correspondence/i);
    if (!m) return '';
    return ({ bullet: 'Bullet', blitz: 'Blitz', rapid: 'Rapid', classical: 'Klassisch', correspondence: 'Fernschach' } as any)[m[0].toLowerCase()];
  }
  if (tc === '-' || tc.includes('/')) {
    const m = tc.match(/^(\d+)\/(\d+)/);
    if (!m || parseInt(m[2], 10) >= 86400 || tc === '-') return 'Fernschach';
    return 'Klassisch';
  }
  const m = tc.match(/^(\d+)(?:\+(\d+))?/);
  if (!m) return '';
  const est = parseInt(m[1], 10) + 40 * parseInt(m[2] || '0', 10);
  if (est < 180) return 'Bullet';
  if (est < 480) return 'Blitz';
  if (est < 1500) return 'Rapid';
  return 'Klassisch';
}

/**
 * Brings a PGN date into the standard form YYYY.MM.DD. Files written by hand or by other tools often use
 * DD.MM.YYYY (or dashes/slashes); unparsed, those sort wrongly and yield a bogus year.
 */
export function normalizeDate(raw: string | undefined): string {
  const s = (raw ?? '').trim();
  const pad = (x: string) => (x.includes('?') ? '??' : x.padStart(2, '0'));
  let m = s.match(/^(\d{4})[.\-/](\d{1,2}|\?{1,2})[.\-/](\d{1,2}|\?{1,2})$/);
  if (m) return `${m[1]}.${pad(m[2])}.${pad(m[3])}`;
  m = s.match(/^(\d{1,2}|\?{1,2})[.\-/](\d{1,2}|\?{1,2})[.\-/](\d{4})$/); // day first
  if (m) return `${m[3]}.${pad(m[2])}.${pad(m[1])}`;
  m = s.match(/^(\d{1,2})[.\-/](\d{4})$/); // MM.YYYY
  if (m) return `${m[2]}.${pad(m[1])}.??`;
  m = s.match(/^(\d{4})(?:[.\-/](\d{1,2}))?$/);
  if (m) return `${m[1]}.${m[2] ? pad(m[2]) : '??'}.??`;
  return /^\d{4}\./.test(s) ? s : '????.??.??';
}

export function metaFromPgn(pgn: string, source: string): GameMeta {
  const h = parseHeaders(pgn);
  const sans = h.FEN ? [] : quickMainline(movetextOf(pgn));
  const sansAll = h.FEN ? quickMainline(movetextOf(pgn)) : sans;
  const op = sans.length ? findOpening(sans) : null;
  const date = normalizeDate(h.Date || h.UTCDate);
  const year = parseInt(date.slice(0, 4), 10) || 0;
  const moves = sans.join(' ');
  const white = (h.White || '?').trim();
  const black = (h.Black || '?').trim();
  const result = h.Result === '1-0' || h.Result === '0-1' || h.Result === '1/2-1/2' ? h.Result : '*';
  const hash = hashStr([white, black, date, result, h.Round || '', h.FEN || '', sansAll.join(' ')].join('|'));
  const lichessOpening = h.Opening && h.Opening !== '?' ? h.Opening : '';
  return {
    white, black,
    whiteElo: parseInt(h.WhiteElo, 10) || 0,
    blackElo: parseInt(h.BlackElo, 10) || 0,
    result, date, year,
    event: h.Event && h.Event !== '?' ? h.Event : '',
    site: h.Site && h.Site !== '?' ? h.Site : '',
    round: h.Round && h.Round !== '?' ? h.Round : '',
    eco: (h.ECO && h.ECO !== '?' ? h.ECO : op?.eco) || '',
    opening: op?.name || lichessOpening,
    moves,
    plies: sansAll.length,
    tc: timeClass(h.TimeControl, h.Event),
    source,
    fav: false,
    tags: [],
    hash, uid: hash, shard: shardOf(hash),
    added: Date.now(), updated: Date.now(), dirty: 1,
  };
}
