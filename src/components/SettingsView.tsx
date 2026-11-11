import { useState } from 'react';
import { db } from '../lib/db';
import { download, nGames } from '../lib/filter';
import { exportBackup, getSyncConfig, importBackup, setSyncConfig, testSync } from '../lib/sync';
import { bump, loadGames, runSync, setSettings, state, toast, useStore } from '../lib/store';
import { Field } from './ui';

export function SettingsView() {
  const { settings, games, sync } = useStore();
  const cfg = getSyncConfig();
  const [repo, setRepo] = useState(cfg?.repo ?? '');
  const [token, setToken] = useState(cfg?.token ?? '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const connect = async () => {
    const c = { repo: repo.trim().replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/$/, ''), token: token.trim(), branch: 'caissa-data' };
    if (!/^[^/\s]+\/[^/\s]+$/.test(c.repo)) { setMsg({ ok: false, text: 'Bitte das Repository als „benutzer/name“ angeben.' }); return; }
    setBusy(true); setMsg(null);
    try {
      const text = await testSync(c);
      setSyncConfig(c);
      setMsg({ ok: true, text });
      state.sync = { state: 'idle', msg: '', last: 0 };
      await runSync(false);
    } catch (e: any) { setMsg({ ok: false, text: e.message }); }
    setBusy(false);
  };
  const disconnect = () => {
    if (!confirm('Sync auf diesem Gerät trennen? Die lokalen Partien bleiben erhalten.')) return;
    setSyncConfig(null); setToken('');
    state.sync = { state: 'off', msg: '', last: 0 };
    bump();
  };
  const exportAll = async () => {
    const pgns = await db.pgns.toArray();
    download(`chessvault2-partien-${new Date().toISOString().slice(0, 10)}.pgn`, pgns.map(p => p.pgn.trim()).join('\n\n') + '\n');
  };
  const backup = async () => download(`chessvault2-sicherung-${new Date().toISOString().slice(0, 10)}.json`, await exportBackup(), 'application/json');
  const restore = async (file?: File) => {
    if (!file) return;
    try {
      const n = await importBackup(await file.text());
      await loadGames();
      toast(`Sicherung eingespielt: ${nGames(n)} übernommen.`);
      runSync(true);
    } catch (e: any) { toast('Wiederherstellen fehlgeschlagen: ' + e.message, 'err'); }
  };
  const wipeLocal = async () => {
    if (!confirm('Alle Daten NUR auf diesem Gerät entfernen? (Die Cloud-Kopie bleibt bestehen und wird beim nächsten Sync wieder geladen.)')) return;
    await Promise.all([db.games.clear(), db.pgns.clear(), db.reports.clear(), db.kv.clear()]);
    await loadGames();
    toast('Lokale Daten entfernt.');
  };

  return (
    <div className="view settings">
      <div className="toolbar"><h1>Einstellungen</h1></div>

      <div className="card pad">
        <h3>Allgemein</h3>
        <div className="form-grid">
          <Field label="Design">
            <div className="seg">
              <button className={settings.theme === 'dark' ? 'on' : ''} onClick={() => setSettings({ theme: 'dark' })}>Dunkel</button>
              <button className={settings.theme === 'light' ? 'on' : ''} onClick={() => setSettings({ theme: 'light' })}>Hell</button>
            </div>
          </Field>
          <Field label="Darstellungsgröße">
            <select value={settings.scale} onChange={e => setSettings({ scale: +e.target.value })}>
              <option value={1}>Klein (100 %)</option><option value={1.15}>Mittel (115 %)</option><option value={1.3}>Groß (130 %)</option>
              <option value={1.45}>Sehr groß (145 %)</option><option value={1.6}>Riesig (160 %)</option>
            </select>
          </Field>
          <Field label="Meine Spielernamen (mehrere mit Semikolon trennen)">
            <input value={settings.me} onChange={e => setSettings({ me: e.target.value })} placeholder="lichessname; Nachname, Vorname" />
          </Field>
          <Field label="Analysetiefe für Partie-Reports">
            <select value={settings.reportDepth} onChange={e => setSettings({ reportDepth: +e.target.value })}>
              <option value={10}>Schnell (Tiefe 10)</option><option value={14}>Standard (Tiefe 14)</option>
              <option value={18}>Gründlich (Tiefe 18)</option><option value={22}>Sehr tief (Tiefe 22)</option>
            </select>
          </Field>
        </div>
      </div>

      <div className="card pad">
        <h3>Geräte-Sync <span className={'pill ' + sync.state}>{sync.state === 'off' ? 'nicht eingerichtet' : sync.state === 'busy' ? 'läuft …' : sync.state === 'error' ? 'Fehler' : 'aktiv'}</span></h3>
        <p className="muted">
          Damit du von jedem Gerät und Browser auf dieselbe Datenbank zugreifst, synchronisiert ChessVault2 alle Partien, Reports, Favoriten und
          Schlagwörter über ein <b>privates GitHub-Repository</b>, das nur dir gehört. Kostenlos, ohne eigenen Server.
        </p>
        <ol className="steps">
          <li>Auf GitHub ein <b>privates</b> Repository anlegen (z. B. <code>caissa-data</code>) und dabei „Add a README file“ anhaken.</li>
          <li>Unter <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noreferrer">Settings → Developer settings → Fine-grained tokens</a> ein
            Token erzeugen: „Only select repositories“ → dein Daten-Repo, Berechtigung <b>Contents: Read and write</b>.</li>
          <li>Repository und Token hier eintragen – auf jedem Gerät einmal. Danach läuft der Sync automatisch.</li>
        </ol>
        <div className="form-grid">
          <Field label="Repository (benutzer/name)"><input value={repo} onChange={e => setRepo(e.target.value)} placeholder="meinname/caissa-data" /></Field>
          <Field label="Zugriffstoken"><input type="password" value={token} onChange={e => setToken(e.target.value)} placeholder="github_pat_…" autoComplete="off" /></Field>
        </div>
        <div className="row">
          <button className="btn primary" disabled={busy || !repo.trim() || !token.trim()} onClick={connect}>{cfg ? 'Speichern & synchronisieren' : 'Verbinden'}</button>
          {cfg && <button className="btn" disabled={sync.state === 'busy'} onClick={() => runSync(false)}>Jetzt synchronisieren</button>}
          {cfg && <button className="btn" onClick={disconnect}>Trennen</button>}
          {sync.last > 0 && <span className="muted small">Zuletzt: {new Date(sync.last).toLocaleString('de')}</span>}
        </div>
        {msg && <div className={msg.ok ? 'okmsg' : 'error'}>{msg.text}</div>}
        {sync.state === 'error' && <div className="error">{sync.msg}</div>}
        <p className="muted small">Das Token wird nur in diesem Browser gespeichert und ausschließlich an api.github.com gesendet. Bei gleichzeitigen Änderungen gewinnt pro Partie die jüngste.</p>
      </div>

      <div className="card pad">
        <h3>Daten</h3>
        <p className="muted">{games.length.toLocaleString('de')} Partien in der Datenbank. Die vollständige Sicherung enthält auch Reports, Lernstand, Favoriten und Schlagwörter; beim Einspielen wird nichts gelöscht.</p>
        <div className="row">
          <button className="btn" onClick={backup}>Vollständige Sicherung herunterladen</button>
          <label className="btn">Sicherung einspielen<input type="file" accept=".json" hidden onChange={e => { restore(e.target.files?.[0]); e.target.value = ''; }} /></label>
          <button className="btn" onClick={exportAll}>Nur Partien als PGN</button>
          <button className="btn danger" onClick={wipeLocal}>Lokale Daten auf diesem Gerät entfernen</button>
        </div>
      </div>

      <div className="card pad">
        <h3>Über ChessVault2</h3>
        <p className="muted small">
          Freie Software (GPL-3.0). Gebaut mit Stockfish (GPL-3.0), Chessground (GPL-3.0), chess.js (BSD-2), Dexie (Apache-2.0), React (MIT), Vite (MIT).
          Eröffnungsnamen: lichess-org/chess-openings (CC0). Alle Analysen laufen lokal in deinem Browser.
        </p>
      </div>
    </div>
  );
}
