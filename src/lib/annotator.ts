// Who wrote a comment: the owner, or a machine (an engine, an AI agent such as Hermes, an online analysis).
// Machine-made comments and variations are stored with the PGN command [%bot] and shown in a different
// colour, so they never mix with the owner's own words.
//
// A game whose `Annotator` header names a bot is treated as entirely machine-annotated the first time it is
// read (as long as it carries no [%bot] markers yet); from then on the markers written by the app decide.

export const DEFAULT_BOTS = 'Hermes, Stockfish, Engine, lichess.org, Chess.com, Komodo, Leela, Lc0, Dragon, ChessVault2';
export const BOT_MARK = '[%bot]';
export const BOT_RE = /\[%bot\]/g;

/** Bot names from the settings (read directly from storage, so this module has no dependency on the store). */
export function botNames(): string[] {
  let raw = DEFAULT_BOTS;
  try {
    const s = JSON.parse(localStorage.getItem('caissa.settings') || '{}');
    if (typeof s.bots === 'string') raw = s.bots;
  } catch { /* no storage (tests) – defaults */ }
  return raw.split(/[,;]/).map(s => s.trim().toLowerCase()).filter(Boolean);
}

export function isBotAnnotator(annotator: string | undefined): boolean {
  const a = (annotator ?? '').trim().toLowerCase();
  if (!a || a === '?') return false;
  return botNames().some(b => a.includes(b));
}

// ---------- Author badges ----------
// A comment may start with its author's name, e.g. "Hermes: White is better." or "Stockfish: +0.4".
// For display, a known machine author is replaced by a symbol; the stored text keeps the name.
const ENGINE_BADGES: [RegExp, string][] = [[/^stockfish\b/i, '🐟']];
const BOT_BADGE = '🤖';

/** Splits a leading "Name:" off a comment if the name belongs to an engine or bot. */
export function authorBadge(text: string): { badge: string; author: string; rest: string } | null {
  const m = text.match(/^\s*([\p{L}\p{N}][\p{L}\p{N} ._-]{0,29}?)\s*:\s+(.*)$/su);
  if (!m) return null;
  const author = m[1].trim();
  for (const [re, badge] of ENGINE_BADGES) if (re.test(author)) return { badge, author, rest: m[2] };
  const a = author.toLowerCase();
  if (botNames().some(b => a === b || a.startsWith(b + ' ') || a.startsWith(b + '.'))) return { badge: BOT_BADGE, author, rest: m[2] };
  return null;
}
