import { useState } from 'react';
import { Field, Modal } from './ui';
import { nGames } from '../lib/filter';
import { fetchChessCom, fetchLichess, importPgnText } from '../lib/importers';
import { loadGames, myNames, setSettings, state, toast } from '../lib/store';

type Src = 'file' | 'paste' | 'lichess' | 'chesscom';

export function ImportDialog({ onClose }: { onClose: () => void }) {
  const [src, setSrc] = useState<Src>('file');
  const [busy, setBusy] = useState('');
  const [text, setText] = useState('');
  const [user, setUser] = useState(localStorage.getItem('caissa.lastUser') || '');
  const [max, setMax] = useState(200);
  const [perf, setPerf] = useState('');
  const [months, setMonths] = useState(3);
  const [err, setErr] = useState('');

  const run = async (label: string, get: () => Promise<string>, player?: string) => {
    setErr('');
    try {
      const pgn = await get();
      setBusy('Verarbeite Partien …');
      const r = await importPgnText(pgn, label, (d, t) => setBusy(`Importiere ${d.toLocaleString('de')} / ${t.toLocaleString('de')} …`));
      await loadGames();
      if (player && !myNames().includes(player.toLowerCase())) setSettings({ me: state.settings.me.trim() ? `${state.settings.me.trim()}; ${player}` : player });
      toast(`${nGames(r.added)} importiert` + (r.duplicates ? `, ${r.duplicates} Duplikate übersprungen` : '') + (r.failed ? `, ${r.failed} fehlerhaft` : '') + '.');
      if (r.added || r.duplicates) onClose();
      else setErr('Keine Partien gefunden.');
    } catch (e: any) { setErr(e.message || String(e)); }
    setBusy('');
  };

  const files = async (list: FileList | null) => {
    if (!list?.length) return;
    const arr = [...list];
    run(arr.length === 1 ? arr[0].name : 'PGN-Dateien', async () => {
      setBusy('Lese Dateien …');
      return (await Promise.all(arr.map(f => f.text()))).join('\n\n');
    });
  };
  const saveUser = () => localStorage.setItem('caissa.lastUser', user.trim());

  return (
    <Modal title="Partien importieren" onClose={busy ? () => {} : onClose}>
      <div className="seg wide">
        {([['file', 'PGN-Datei'], ['paste', 'Einfügen'], ['lichess', 'Lichess'], ['chesscom', 'Chess.com']] as const).map(([k, l]) => (
          <button key={k} className={src === k ? 'on' : ''} onClick={() => { setSrc(k); setErr(''); }} disabled={!!busy}>{l}</button>
        ))}
      </div>
      {busy ? <div className="pad center-text"><div className="spinner" />{busy}</div> : (
        <>
          {src === 'file' && (
            <label className="drop" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); files(e.dataTransfer.files); }}>
              <input type="file" accept=".pgn,.txt" multiple hidden onChange={e => files(e.target.files)} />
              <div><b>PGN-Dateien hierher ziehen</b> oder klicken zum Auswählen</div>
              <div className="muted small">Auch große Sammlungen mit vielen tausend Partien</div>
            </label>
          )}
          {src === 'paste' && (
            <>
              <textarea className="paste" value={text} onChange={e => setText(e.target.value)} placeholder={'[Event "…"]\n\n1. e4 e5 2. Nf3 …'} />
              <div className="modal-foot"><button className="btn primary" disabled={!text.trim()} onClick={() => run('Eingefügt', async () => text)}>Importieren</button></div>
            </>
          )}
          {src === 'lichess' && (
            <>
              <div className="form-grid">
                <Field label="Lichess-Benutzername"><input autoFocus value={user} onChange={e => setUser(e.target.value)} /></Field>
                <Field label="Anzahl (neueste zuerst)">
                  <select value={max} onChange={e => setMax(+e.target.value)}>{[50, 200, 500, 1000, 3000].map(n => <option key={n} value={n}>{n}</option>)}</select>
                </Field>
                <Field label="Spielart">
                  <select value={perf} onChange={e => setPerf(e.target.value)}>
                    <option value="">alle</option><option value="bullet">Bullet</option><option value="blitz">Blitz</option>
                    <option value="rapid">Rapid</option><option value="classical">Klassisch</option><option value="correspondence">Fernschach</option>
                  </select>
                </Field>
              </div>
              <div className="modal-foot"><button className="btn primary" disabled={!user.trim()} onClick={() => { saveUser(); run('Lichess', () => fetchLichess(user, max, perf, setBusy), user.trim()); }}>Von Lichess laden</button></div>
            </>
          )}
          {src === 'chesscom' && (
            <>
              <div className="form-grid">
                <Field label="Chess.com-Benutzername"><input autoFocus value={user} onChange={e => setUser(e.target.value)} /></Field>
                <Field label="Zeitraum">
                  <select value={months} onChange={e => setMonths(+e.target.value)}>
                    <option value={1}>letzter Monat</option><option value={3}>letzte 3 Monate</option><option value={12}>letzte 12 Monate</option><option value={36}>letzte 3 Jahre</option><option value={999}>alles</option>
                  </select>
                </Field>
              </div>
              <div className="modal-foot"><button className="btn primary" disabled={!user.trim()} onClick={() => { saveUser(); run('Chess.com', () => fetchChessCom(user, months, setBusy), user.trim()); }}>Von Chess.com laden</button></div>
            </>
          )}
          {err && <div className="error">{err}</div>}
        </>
      )}
    </Modal>
  );
}
