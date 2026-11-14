import { useEffect, useMemo, useRef, useState } from 'react';
import { db, deleteGames, GameMeta, patchGames } from '../lib/db';
import { emptyFilter, loadGames, myNames, mySide, openGame, openNewGame, setFilter, startBackground, toast, useStore } from '../lib/store';
import { buildPredicate, countActive, download, nGames, resultLabel } from '../lib/filter';
import { Field, Icon, Modal } from './ui';
import { ImportDialog } from './ImportDialog';

/** Result coloured from the owner's point of view: win green, loss red, draw grey; other people's games neutral. */
function outcome(g: GameMeta, names: string[]): 'win' | 'loss' | 'draw' | null {
  const side = mySide(g, names);
  if (!side || g.result === '*') return null;
  if (g.result === '1/2-1/2') return 'draw';
  return (g.result === '1-0') === (side === 'w') ? 'win' : 'loss';
}
const resClass = (g: GameMeta, names: string[]) => { const o = outcome(g, names); return o ? `res mine ${o}` : 'res' + (g.result === '1/2-1/2' ? ' rd' : ''); };
const resTitle = (g: GameMeta, names: string[]) => ({ win: 'Sieg', loss: 'Niederlage', draw: 'Remis' } as any)[outcome(g, names) ?? ''] ?? '';

type SortKey = 'white' | 'whiteElo' | 'black' | 'blackElo' | 'result' | 'plies' | 'eco' | 'date' | 'event' | 'tc' | 'acc' | 'added';

const COLS: { key: SortKey | null; label: string; cls?: string }[] = [
  { key: null, label: '' }, { key: null, label: '' },
  { key: 'white', label: 'Weiß' }, { key: 'whiteElo', label: 'Elo', cls: 'num' },
  { key: 'black', label: 'Schwarz' }, { key: 'blackElo', label: 'Elo', cls: 'num' },
  { key: 'result', label: 'Erg.' }, { key: 'plies', label: 'Züge', cls: 'num' },
  { key: 'eco', label: 'Eröffnung' }, { key: 'date', label: 'Datum' },
  { key: 'event', label: 'Turnier' }, { key: 'tc', label: 'Tempo' }, { key: 'acc', label: 'Genauigk.', cls: 'num' },
];

export function DatabaseView() {
  const { games, filter, loaded, settings } = useStore();
  const ROW = Math.round(36 * (window.innerWidth <= 900 ? Math.min(settings.scale, 1.1) : settings.scale));
  const names = useMemo(() => myNames(), [settings.me]);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'date', dir: -1 });
  const [showFilter, setShowFilter] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [scroll, setScroll] = useState(0);
  const [height, setHeight] = useState(600);
  const [tagOpen, setTagOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  const rows = useMemo(() => {
    const pred = buildPredicate(filter);
    const out = games.filter(pred);
    const { key, dir } = sort;
    const val = (g: GameMeta): string | number =>
      key === 'acc' ? (g.accW ?? -1) : key === 'date' ? g.date.replace(/\?/g, '0') : key === 'added' ? (g.id ?? 0) : (g[key] as any);
    out.sort((a, b) => {
      const x = val(a), y = val(b);
      const c = (typeof x === 'number' ? x - (y as number) : String(x).localeCompare(String(y), 'de')) * dir;
      return c || (b.id ?? 0) - (a.id ?? 0); // ties: most recently added first
    });
    return out;
  }, [games, filter, sort]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [loaded, games.length === 0]);
  useEffect(() => { if (box.current) box.current.scrollTop = 0; setScroll(0); }, [filter, sort]);

  const tags = useMemo(() => [...new Set(games.flatMap(g => g.tags))].sort(), [games]);
  const active = countActive(filter);
  const first = Math.max(0, Math.floor(scroll / ROW) - 8);
  const last = Math.min(rows.length, Math.ceil((scroll + height) / ROW) + 8);
  const targets = () => (sel.size ? rows.filter(g => sel.has(g.id!)) : rows);
  const targetLabel = sel.size ? `${sel.size} ausgewählte` : `alle ${rows.length.toLocaleString('de')} angezeigten`;

  const toggle = (id: number) => { const n = new Set(sel); if (n.has(id)) n.delete(id); else n.add(id); setSel(n); };
  const clickSort = (key: SortKey | null) => { if (key) setSort(s => ({ key, dir: s.key === key ? (-s.dir as 1 | -1) : key === 'white' || key === 'black' || key === 'eco' || key === 'event' ? 1 : -1 })); };

  const exportPgn = async () => {
    const t = targets();
    const pgns = await db.pgns.bulkGet(t.map(g => g.id!));
    download(`chessvault2-${new Date().toISOString().slice(0, 10)}.pgn`, pgns.filter(Boolean).map(p => p!.pgn.trim()).join('\n\n') + '\n');
    toast(`${nGames(t.length)} exportiert.`);
  };
  const remove = async () => {
    const t = targets();
    if (!t.length || !confirm(`${nGames(t.length)} wirklich löschen?`)) return;
    await deleteGames(t.map(g => g.id!));
    setSel(new Set());
    await loadGames();
    toast(`${nGames(t.length)} gelöscht.`);
  };
  const fav = async (g: GameMeta) => { await patchGames([g.id!], x => ({ fav: !x.fav })); g.fav = !g.fav; setSel(new Set(sel)); };
  const analyzeBatch = () => {
    const t = targets().filter(g => g.accW == null);
    if (t.length > 20 && !confirm(`${t.length} Partien im Hintergrund analysieren? Das dauert etwa 20–60 Sekunden pro Partie; du kannst währenddessen weiterarbeiten.`)) return;
    startBackground(t.map(g => g.id!));
  };

  const F = (k: keyof typeof filter, ph = '', w?: number) => (
    <input value={filter[k] as string} placeholder={ph} style={w ? { width: w } : undefined} onChange={e => setFilter({ [k]: e.target.value } as any)} />
  );

  if (loaded && !games.length) return (
    <div className="view">
      <div className="welcome">
        <h1>Noch keine Partien</h1>
        <p>Importiere eine PGN-Datei oder lade deine Partien von Lichess oder Chess.com. Danach kannst du sie hier durchsuchen, filtern und analysieren.</p>
        <div className="row">
          <button className="btn primary big" onClick={() => setImportOpen(true)}>Partien importieren</button>
          <button className="btn big" onClick={() => openNewGame()}>Analysebrett öffnen</button>
        </div>
        <p className="muted small">Mehrere Geräte? Den Sync richtest du unter „Einstellungen“ ein.</p>
      </div>
      {importOpen && <ImportDialog onClose={() => setImportOpen(false)} />}
    </div>
  );

  return (
    <div className="view db-view">
      <div className="toolbar">
        <div className="search">
          <Icon name="search" />
          <input value={filter.q} placeholder="Spieler, Turnier, Eröffnung, ECO, Jahr" onChange={e => setFilter({ q: e.target.value })} />
          {filter.q && <button className="icon-btn" onClick={() => setFilter({ q: '' })}>✕</button>}
        </div>
        <button className={'btn' + (showFilter || active ? ' on' : '')} onClick={() => setShowFilter(!showFilter)}>
          Filter{active ? ` (${active})` : ''}
        </button>
        {(active > 0 || filter.q) && <button className="btn" onClick={() => setFilter(emptyFilter())}>Zurücksetzen</button>}
        <span className="grow" />
        <button className="btn" onClick={() => openNewGame()}>+ Neue Partie</button>
        <button className="btn primary" onClick={() => setImportOpen(true)}>Importieren</button>
      </div>

      {showFilter && (
        <div className="filter-panel card">
          <Field label="Weiß">{F('white', 'Name')}</Field>
          <Field label="Schwarz">{F('black', 'Name')}</Field>
          <label className="check"><input type="checkbox" checked={filter.ignoreColors} onChange={e => setFilter({ ignoreColors: e.target.checked })} /> Farben ignorieren</label>
          <Field label="Ergebnis">
            <div className="seg">
              {([['w', '1–0'], ['d', '½–½'], ['b', '0–1']] as const).map(([k, l]) => (
                <button key={k} className={filter.res[k] ? 'on' : ''} onClick={() => setFilter({ res: { ...filter.res, [k]: !filter.res[k] } })}>{l}</button>
              ))}
            </div>
          </Field>
          <Field label="Jahr"><div className="range">{F('yearFrom', 'von')}–{F('yearTo', 'bis')}</div></Field>
          <Field label="Elo"><div className="range">{F('eloMin', 'min')}–{F('eloMax', 'max')}</div></Field>
          <Field label="ECO"><div className="range">{F('ecoFrom', 'B20')}–{F('ecoTo', 'B99')}</div></Field>
          <Field label="Zugzahl"><div className="range">{F('movesMin', 'min')}–{F('movesMax', 'max')}</div></Field>
          <Field label="Eröffnungsname">{F('opening', 'z. B. Sizilianisch / Sicilian')}</Field>
          <Field label="Zugfolge (Anfang)">{F('moves', '1. e4 c5 2. Nf3')}</Field>
          <Field label="Bedenkzeit">
            <select value={filter.tc} onChange={e => setFilter({ tc: e.target.value })}>
              <option value="">alle</option>{['Bullet', 'Blitz', 'Rapid', 'Klassisch', 'Fernschach'].map(t => <option key={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Schlagwort">
            <select value={filter.tag} onChange={e => setFilter({ tag: e.target.value })}>
              <option value="">alle</option>{tags.map(t => <option key={t}>{t}</option>)}
            </select>
          </Field>
          <label className="check"><input type="checkbox" checked={filter.favOnly} onChange={e => setFilter({ favOnly: e.target.checked })} /> nur Favoriten ★</label>
          <label className="check"><input type="checkbox" checked={filter.analyzedOnly} onChange={e => setFilter({ analyzedOnly: e.target.checked })} /> nur mit Report</label>
        </div>
      )}

      <div className="table card">
        <div className="trow thead">
          {COLS.map((c, i) => i === 0 ? (
            <div key={i}><input type="checkbox" title="Alle angezeigten auswählen" checked={sel.size > 0 && sel.size >= rows.length} onChange={e => setSel(e.target.checked ? new Set(rows.map(g => g.id!)) : new Set())} /></div>
          ) : (
            <div key={i} className={(c.cls ?? '') + (c.key ? ' sortable' : '')} onClick={() => clickSort(c.key)}>
              {c.label}{c.key && sort.key === c.key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
            </div>
          ))}
        </div>
        <div className="tbody" ref={box} onScroll={e => setScroll(e.currentTarget.scrollTop)}>
          <div style={{ height: rows.length * ROW, position: 'relative' }}>
            {rows.slice(first, last).map((g, i) => (
              <div key={g.id} className={'trow' + (sel.has(g.id!) ? ' selected' : '')} style={{ top: (first + i) * ROW, height: ROW }} onClick={() => openGame(g.id!)}>
                <div onClick={e => e.stopPropagation()}><input type="checkbox" checked={sel.has(g.id!)} onChange={() => toggle(g.id!)} /></div>
                <div className={'star' + (g.fav ? ' on' : '')} onClick={e => { e.stopPropagation(); fav(g); }}>{g.fav ? '★' : '☆'}</div>
                <div className="ellip strong">{g.white}</div>
                <div className="num muted">{g.whiteElo || ''}</div>
                <div className="ellip strong">{g.black}</div>
                <div className="num muted">{g.blackElo || ''}</div>
                <div><span className={resClass(g, names)} title={resTitle(g, names)}>{resultLabel(g.result)}</span></div>
                <div className="num">{Math.ceil(g.plies / 2)}</div>
                <div className="ellip" title={g.opening}><span className="eco">{g.eco}</span> {g.opening}</div>
                <div className="muted">{g.date.replace(/\.\?\?/g, '').replace('????', '')}</div>
                <div className="ellip muted" title={g.event}>{g.event}{g.tags.map(t => <span key={t} className="tag">{t}</span>)}</div>
                <div className="muted">{g.tc}</div>
                <div className="num">{g.accW != null ? `${g.accW.toFixed(0)} / ${g.accB?.toFixed(0)}` : ''}</div>
              </div>
            ))}
          </div>
          {loaded && !rows.length && <div className="muted pad center-text">Keine Partien passen zu diesen Filtern.</div>}
        </div>
      </div>

      <div className="statusbar">
        <span><b>{rows.length.toLocaleString('de')}</b> von {games.length.toLocaleString('de')} Partien{sel.size ? ` · ${sel.size} ausgewählt` : ''}</span>
        <span className="grow" />
        <span className="muted small">Aktion für {targetLabel}:</span>
        <button className="btn small" onClick={analyzeBatch}>Reports erstellen</button>
        <button className="btn small" onClick={() => setTagOpen(true)}>Schlagwort</button>
        <button className="btn small" onClick={exportPgn}>PGN-Export</button>
        <button className="btn small danger" onClick={remove}>Löschen</button>
      </div>

      {importOpen && <ImportDialog onClose={() => setImportOpen(false)} />}
      {tagOpen && <TagDialog ids={targets().map(g => g.id!)} onClose={() => setTagOpen(false)} />}
    </div>
  );
}

function TagDialog({ ids, onClose }: { ids: number[]; onClose: () => void }) {
  const [tag, setTag] = useState('');
  const apply = async (add: boolean) => {
    const t = tag.trim();
    if (!t) return;
    await patchGames(ids, g => ({ tags: add ? [...new Set([...g.tags, t])] : g.tags.filter(x => x !== t) }));
    await loadGames();
    toast(`Schlagwort „${t}“ ${add ? 'gesetzt' : 'entfernt'} (${nGames(ids.length)}).`);
    onClose();
  };
  return (
    <Modal title={`Schlagwort für ${nGames(ids.length)}`} onClose={onClose}>
      <Field label="Schlagwort"><input autoFocus value={tag} onChange={e => setTag(e.target.value)} placeholder="z. B. Repertoire, Turnier 2026 …" /></Field>
      <div className="modal-foot">
        <button className="btn" onClick={() => apply(false)}>Entfernen</button>
        <button className="btn primary" onClick={() => apply(true)}>Hinzufügen</button>
      </div>
    </Modal>
  );
}
