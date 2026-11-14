// Position notes: free text and tags attached to a position (not to a game), so the note shows up in every
// game that reaches the position. Each note is its own record in the games table (flag `note`) and
// therefore syncs and backs up through the same path as games.
import { addGames, deleteGames, GameMeta, shardOf, updateGame } from './db';
import { keyHash, posKey } from './posindex';
import { loadGames, state } from './store';

export function noteFor(fen: string): GameMeta | undefined {
  const key = posKey(fen);
  return state.notes.find(n => n.note!.key === key);
}

/** Creates, updates or (when text and tags are both empty) removes the note for a position. */
export async function saveNote(fen: string, text: string, tags: string[]) {
  const key = posKey(fen);
  const have = state.notes.find(n => n.note!.key === key);
  const empty = !text.trim() && !tags.length;
  if (have) {
    if (empty) await deleteGames([have.id!]);
    else if (have.note!.text === text && have.note!.tags.join('|') === tags.join('|')) return;
    else await updateGame(have.id!, { note: { key, fen, text, tags } });
  } else {
    if (empty) return;
    const uid = `note-${keyHash(key).toString(36)}`; // same position => same record on every device
    const now = Date.now();
    const meta: GameMeta = {
      white: '', black: '', whiteElo: 0, blackElo: 0, result: '*', date: '????.??.??', year: 0, event: '', site: '', round: '',
      eco: '', opening: '', moves: '', plies: 0, tc: '', source: 'Notiz', fav: false, tags: [], hash: uid, added: now,
      uid, shard: shardOf(uid), updated: now, dirty: 1, note: { key, fen, text, tags },
    };
    await addGames([{ meta, pgn: '' }]);
  }
  await loadGames();
}

export async function deleteNote(id: number) {
  await deleteGames([id]);
  await loadGames();
}

export const parseTags = (s: string) => [...new Set(s.split(/[,;]/).map(t => t.trim()).filter(Boolean))];
