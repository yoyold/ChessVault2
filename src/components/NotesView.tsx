import { useEffect, useMemo, useRef, useState } from 'react';
import { Chessground } from 'chessground';
import { deleteNote, noteFor, parseTags, saveNote } from '../lib/notes';
import { findPosition, indexState } from '../lib/posindex';
import { openGame, openNewGame, useStore } from '../lib/store';
import { nGames } from '../lib/filter';

/** Small, non-interactive diagram of a position. */
export function MiniBoard({ fen }: { fen: string }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const cg = Chessground(el.current!, { fen, viewOnly: true, coordinates: false, orientation: fen.split(' ')[1] === 'b' ? 'black' : 'white' });
    const ro = new ResizeObserver(() => cg.redrawAll());
    ro.observe(el.current!);
    return () => { ro.disconnect(); cg.destroy(); };
  }, [fen]);
  return <div className="mini-board"><div ref={el} className="cg-host" /></div>;
}

/** Editor for the note on one position; saves by itself shortly after typing stops and when the position changes. */
export function PositionNote({ fen }: { fen: string }) {
  const { notes } = useStore();
  const stored = useMemo(() => noteFor(fen)?.note, [fen, notes]);
  const [text, setText] = useState(stored?.text ?? '');
  const [tags, setTags] = useState((stored?.tags ?? []).join(', '));
  const latest = useRef({ fen, text, tags, dirty: false });
  latest.current.text = text; latest.current.tags = tags;
  const timer = useRef<any>(null);
  const flush = () => {
    clearTimeout(timer.current);
    const l = latest.current;
    if (l.dirty) { l.dirty = false; saveNote(l.fen, l.text, parseTags(l.tags)); }
  };
  useEffect(() => {
    // a different position: write what was typed for the previous one, then show this one's note
    flush();
    const n = noteFor(fen)?.note;
    latest.current = { fen, text: n?.text ?? '', tags: (n?.tags ?? []).join(', '), dirty: false };
    setText(n?.text ?? ''); setTags((n?.tags ?? []).join(', '));
    return flush;
  }, [fen]);
  const edit = (apply: () => void) => { apply(); latest.current.dirty = true; clearTimeout(timer.current); timer.current = setTimeout(flush, 900); };
  const hits = useMemo(() => findPosition(fen).length, [fen, indexState.version]);
  return (
    <div className="pos-note">
      <p className="muted small">
        Die Notiz gehört zur Stellung, nicht zur Partie: Sie erscheint in jeder Partie, die diese Stellung erreicht
        {hits ? ` (derzeit ${nGames(hits)})` : ''}, und wird automatisch gespeichert.
      </p>
      <textarea value={text} placeholder="Notiz zu dieser Stellung: Pläne, typische Motive, Merksätze …" onChange={e => edit(() => setText(e.target.value))} />
      <input value={tags} placeholder="Schlagwörter, mit Komma getrennt (z. B. Isolani, Turmendspiel)" onChange={e => edit(() => setTags(e.target.value))} />
    </div>
  );
}

export function NotesView() {
  const { notes, games } = useStore();
  const [q, setQ] = useState('');
  const [tag, setTag] = useState('');
  const tags = useMemo(() => [...new Set(notes.flatMap(n => n.note!.tags))].sort((a, b) => a.localeCompare(b, 'de')), [notes]);
  const list = useMemo(() => {
    const w = q.trim().toLowerCase();
    return notes
      .filter(n => (!tag || n.note!.tags.includes(tag)) && (!w || `${n.note!.text} ${n.note!.tags.join(' ')}`.toLowerCase().includes(w)))
      .sort((a, b) => b.updated - a.updated);
  }, [notes, q, tag]);

  const open = (fen: string) => {
    // prefer a real game that reaches the position, most recent first
    const byId = new Map(games.map(g => [g.id!, g]));
    const hit = findPosition(fen).filter(h => byId.has(h.id)).sort((a, b) => byId.get(b.id)!.date.localeCompare(byId.get(a.id)!.date))[0];
    if (hit) openGame(hit.id, hit.ply); else openNewGame(fen);
  };

  return (
    <div className="view notes">
      <div className="toolbar">
        <h1>Notizen</h1>
        <span className="grow" />
        <div className="search" style={{ flex: '0 1 calc(280 * var(--u))' }}><input value={q} placeholder="In Notizen suchen" onChange={e => setQ(e.target.value)} /></div>
        {tags.length > 0 && (
          <select value={tag} onChange={e => setTag(e.target.value)}>
            <option value="">alle Schlagwörter</option>{tags.map(t => <option key={t}>{t}</option>)}
          </select>
        )}
      </div>
      {!notes.length ? (
        <div className="welcome">
          <p>Noch keine Notizen. Im Analysebrett kannst du unter „Notiz“ zu jeder Stellung Text und Schlagwörter festhalten.
            Die Notiz taucht dann in jeder Partie auf, die diese Stellung erreicht – auch über eine andere Zugfolge.</p>
        </div>
      ) : (
        <div className="note-grid">
          {list.map(n => {
            const hits = findPosition(n.note!.fen).length;
            return (
              <div key={n.id} className="card note-card">
                <div className="note-board" onClick={() => open(n.note!.fen)} title="Stellung am Analysebrett öffnen"><MiniBoard fen={n.note!.fen} /></div>
                <div className="note-body">
                  <div className="note-text">{n.note!.text || <span className="muted">(nur Schlagwörter)</span>}</div>
                  <div className="note-meta">
                    {n.note!.tags.map(t => <span key={t} className="tag link" onClick={() => setTag(t)}>{t}</span>)}
                    <span className="muted small grow">{hits ? nGames(hits) : 'in keiner Partie'} · {n.note!.fen.split(' ')[1] === 'w' ? 'Weiß' : 'Schwarz'} am Zug</span>
                    <button className="btn small" onClick={() => open(n.note!.fen)}>Öffnen</button>
                    <button className="btn small danger" onClick={() => { if (confirm('Diese Notiz löschen?')) deleteNote(n.id!); }}>Löschen</button>
                  </div>
                </div>
              </div>
            );
          })}
          {!list.length && <div className="muted">Keine Notiz passt zur Suche.</div>}
        </div>
      )}
    </div>
  );
}
