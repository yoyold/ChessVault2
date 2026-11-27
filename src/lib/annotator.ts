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
