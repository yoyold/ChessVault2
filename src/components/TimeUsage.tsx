import { useEffect, useMemo, useState } from 'react';
import type { Node } from '../lib/tree';
import { bump, state } from '../lib/store';
import {
  MoveTime, TIME_NOTE_HEADER, TcStage, describeTimeControl, fmtClock, formatTimeControl, hasTimes, moveTimes,
  parseDuration, parseTimeControl, summarize,
} from '../lib/clock';

type Mode = 'used' | 'clock';

/** Time usage of a game: clock and per-move charts, entry of times per move, and a free-text summary. */
export function TimeUsage({ line, cur, onSelect }: { line: Node[]; cur: Node; onSelect: (n: Node) => void }) {
  const s = state.session;
  const h = s.game.headers;
  const stages = useMemo(() => parseTimeControl(h.TimeControl), [h.TimeControl]);
  const times = moveTimes(line, stages);
  const any = hasTimes(line);
  const [mode, setMode] = useState<Mode>(() => (line.some(n => n.clk != null) ? 'clock' : 'used'));
  const [entry, setEntry] = useState(!any);
  const changed = () => { s.dirty = true; bump(); };

  const setHeader = (k: string, v: string) => {
    if (v) h[k] = v; else delete h[k];
    changed();
  };

  const commit = (t: MoveTime, sec: number | null) => {
    const n = t.node;
    if (mode === 'used') { n.emt = sec ?? undefined; if (sec != null) n.clk = undefined; }
    else { n.clk = sec ?? undefined; if (sec != null) n.emt = undefined; }
    changed();
  };
  const clearAll = () => {
    if (!confirm('Alle Zeitangaben dieser Partie löschen?')) return;
    for (const n of line) { n.clk = undefined; n.emt = undefined; }
    changed();
  };

  const rows: { no: number; w?: MoveTime; b?: MoveTime }[] = [];
  for (const t of times) {
    let r = rows[rows.length - 1];
    if (!r || r.no !== t.no) rows.push(r = { no: t.no });
    if (t.white) r.w = t; else r.b = t;
  }

  const sw = summarize(times, true, stages);
  const sb = summarize(times, false, stages);
  const name = (side: 'White' | 'Black') => (h[side] && h[side] !== '?' ? h[side] : side === 'White' ? 'Weiß' : 'Schwarz');

  if (!line.length) return <div className="muted pad">Die Partie enthält noch keine Züge.</div>;

  return (
    <div className="timeuse">
      <TimeControlEditor stages={stages} onChange={st => setHeader('TimeControl', formatTimeControl(st))} />

      {any && (
        <>
          <div className="acc-row">
            <SideCard name={name('White')} sum={sw} onSelect={onSelect} />
            <SideCard name={name('Black')} sum={sb} onSelect={onSelect} />
          </div>
          <div className="exp-sub">Restzeit pro Zug</div>
          <ClockChart times={times} stages={stages} cur={cur} onSelect={onSelect} />
          <div className="exp-sub">Zeitverbrauch pro Zug</div>
          <UsedBars rows={rows} cur={cur} onSelect={onSelect} />
        </>
      )}

      <div className="exp-sub row">
        <span className="link" onClick={() => setEntry(!entry)}>{entry ? '▾' : '▸'} Zeiten eingeben</span>
        <span className="grow" />
        {any && <button className="btn small danger" onClick={clearAll}>Zeiten löschen</button>}
      </div>
      {entry && (
        <div className="tu-entry">
          <div className="row">
            <div className="seg">
              <button className={mode === 'used' ? 'on' : ''} onClick={() => setMode('used')}>Verbrauch pro Zug</button>
              <button className={mode === 'clock' ? 'on' : ''} onClick={() => setMode('clock')}>Restzeit auf der Uhr</button>
            </div>
            <span className="muted small">Eingabe als m:ss, h:mm:ss oder in Minuten</span>
          </div>
          {mode === 'clock' && !stages.length && <div className="muted small">Ohne Bedenkzeit lässt sich aus der Restzeit der Verbrauch nur ab dem zweiten Zug berechnen.</div>}
          <table className="tu-table">
            <tbody>
              {rows.map(r => (
                <tr key={r.no}>
                  <td className="muted num">{r.no}.</td>
                  {[r.w, r.b].map((t, i) => t ? (
                    <td key={i} className={t.node === cur ? 'cur' : ''}>
                      <span className="tu-san link" onClick={() => onSelect(t.node)}>{t.node.san}</span>
                      <TimeInput
                        value={mode === 'used' ? t.used : t.clock} derived={mode === 'used' ? t.node.emt == null : t.node.clk == null} onCommit={v => commit(t, v)}
                        title={mode === 'used' ? (t.clock != null ? `Restzeit danach: ${fmtClock(t.clock)}` : '') : (t.used != null ? `Verbrauch: ${fmtClock(t.used)}` : '')}
                      />
                    </td>
                  ) : <td key={i} />)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="exp-sub">Zusammenfassung Zeitverbrauch</div>
      <div className="pad tu-note">
        <textarea
          value={h[TIME_NOTE_HEADER] ?? ''}
          placeholder={any ? 'Wo habe ich zu lange nachgedacht, wo zu schnell gespielt?' : 'Am Brett ohne Zeitnotiz gespielt? Hier festhalten, wie die Zeit verlief – z. B. „Nach der Eröffnung 25 Min. für 12. Te1, ab Zug 30 in Zeitnot“.'}
          onChange={e => setHeader(TIME_NOTE_HEADER, e.target.value)}
        />
      </div>
    </div>
  );
}

function SideCard({ name, sum, onSelect }: { name: string; sum: ReturnType<typeof summarize>; onSelect: (n: Node) => void }) {
  const l = sum.longest;
  return (
    <div className="acc-card">
      <span>{name}</span>
      <b>{sum.moves ? fmtClock(sum.total) : '–'}</b>
      <small>verbraucht{sum.moves ? ` · Ø ${fmtClock(sum.avg)} pro Zug` : ''}</small>
      {l && <small className="link" onClick={() => onSelect(l.node)}>Längster Zug: {l.no}{l.white ? '.' : '…'} {l.node.san} ({fmtClock(l.used!)})</small>}
      {sum.end != null && <small>Restzeit am Ende: {fmtClock(sum.end)}</small>}
      {sum.trouble > 0 && <small style={{ color: 'var(--warn)' }}>{sum.trouble} {sum.trouble === 1 ? 'Zug' : 'Züge'} in Zeitnot</small>}
    </div>
  );
}

/** Controlled text field that only writes on blur/Enter, so typing "1:2" does not commit 1:02 halfway. */
function TimeInput({ value, derived, title, onCommit }: { value?: number; derived: boolean; title: string; onCommit: (v: number | null) => void }) {
  const shown = value != null && !derived ? fmtClock(value) : '';
  const [text, setText] = useState(shown);
  const [bad, setBad] = useState(false);
  useEffect(() => { setText(shown); setBad(false); }, [shown]);
  const done = () => {
    if (text === shown) return;
    const v = parseDuration(text);
    if (text.trim() && v == null) { setBad(true); return; }
    onCommit(v);
  };
  return (
    <input
      className={'tu-input' + (bad ? ' bad' : '')} value={text} title={title || undefined}
      placeholder={derived && value != null ? fmtClock(value) : 'm:ss'}
      onChange={e => { setText(e.target.value); setBad(false); }}
      onBlur={done} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
    />
  );
}

function TimeControlEditor({ stages, onChange }: { stages: TcStage[]; onChange: (s: TcStage[]) => void }) {
  const first = stages[0];
  const [base, setBase] = useState(first ? String(first.base / 60) : '');
  const [inc, setInc] = useState(first?.inc ? String(first.inc) : '');
  const [moves, setMoves] = useState(first?.moves ? String(first.moves) : '');
  const [extra, setExtra] = useState(stages[1] ? String(stages[1].base / 60) : '');
  const [second, setSecond] = useState(!!first?.moves);
  const key = formatTimeControl(stages);
  useEffect(() => {
    setBase(first ? String(first.base / 60) : ''); setInc(first?.inc ? String(first.inc) : '');
    setMoves(first?.moves ? String(first.moves) : ''); setExtra(stages[1] ? String(stages[1].base / 60) : '');
    if (first?.moves) setSecond(true);
  }, [key]);
  const apply = (o: { base?: string; inc?: string; moves?: string; extra?: string; second?: boolean }) => {
    const b = parseFloat((o.base ?? base).replace(',', '.'));
    const i = parseFloat((o.inc ?? inc).replace(',', '.')) || 0;
    const m = parseInt(o.moves ?? moves, 10);
    const x = parseFloat((o.extra ?? extra).replace(',', '.'));
    const sec = o.second ?? second;
    if (!(b > 0)) { if (!(o.base ?? base).trim()) onChange([]); return; }
    const st: TcStage[] = sec && m > 0 && x > 0
      ? [{ moves: m, base: Math.round(b * 60), inc: i }, { base: Math.round(x * 60), inc: i }]
      : [{ base: Math.round(b * 60), inc: i }];
    if (formatTimeControl(st) !== key) onChange(st);
  };
  const num = (v: string, set: (v: string) => void, k: 'base' | 'inc' | 'moves' | 'extra', w = 54) => (
    <input className="tu-num" style={{ width: `calc(${w} * var(--u))` }} inputMode="decimal" value={v}
      onChange={e => set(e.target.value)} onBlur={() => apply({ [k]: v })} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
  );
  return (
    <div className="pad tu-tc">
      <div className="row">
        <strong>Bedenkzeit</strong>
        <span className="tu-grp">{num(base, setBase, 'base')}<span className="muted">min</span></span>
        <span className="tu-grp">+ {num(inc, setInc, 'inc', 44)}<span className="muted">s pro Zug</span></span>
        <label className="row small muted"><input type="checkbox" checked={second} onChange={e => { setSecond(e.target.checked); apply({ second: e.target.checked }); }} /> zweite Periode</label>
      </div>
      {second && (
        <div className="row">
          <span className="tu-grp"><span className="muted">nach Zug</span>{num(moves, setMoves, 'moves', 44)}</span>
          <span className="tu-grp">+ {num(extra, setExtra, 'extra')}<span className="muted">min</span></span>
        </div>
      )}
      <div className="muted small">{describeTimeControl(stages)}</div>
    </div>
  );
}

function ClockChart({ times, stages, cur, onSelect }: { times: MoveTime[]; stages: TcStage[]; cur: Node; onSelect: (n: Node) => void }) {
  const [hover, setHover] = useState<number | null>(null);
  const maxNo = times.length ? times[times.length - 1].no : 1;
  const top = Math.max(stages[0]?.base ?? 0, ...times.map(t => t.clock ?? 0), 60);
  const W = 1000, H = 240;
  const fx = (no: number) => (maxNo > 1 ? (no - 1) / (maxNo - 1) : 0.5);
  const fy = (v: number) => 1 - Math.max(0, v) / top;
  const path = (white: boolean) => {
    let d = '', pen = false;
    for (const t of times) {
      if (t.white !== white) continue;
      if (t.clock == null) { pen = false; continue; }
      d += `${pen ? ' L' : 'M'}${(fx(t.no) * W).toFixed(1)},${(fy(t.clock) * H).toFixed(1)}`;
      pen = true;
    }
    return d;
  };
  const pct = (v: number) => `${(v * 100).toFixed(2)}%`;
  const noAt = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return Math.max(1, Math.min(maxNo, Math.round(((e.clientX - r.left) / r.width) * (maxNo - 1)) + 1));
  };
  const curT = times.find(t => t.node === cur);
  const hw = hover != null ? times.find(t => t.no === hover && t.white) : undefined;
  const hb = hover != null ? times.find(t => t.no === hover && !t.white) : undefined;
  const ticks = [top, top / 2, 0];
  return (
    <div className="tu-chart-wrap">
      <div className="tu-yaxis">{ticks.map(v => <span key={v} style={{ top: pct(fy(v)) }}>{fmtClock(Math.round(v))}</span>)}</div>
      <div className="tu-chart" onMouseMove={e => setHover(noAt(e))} onMouseLeave={() => setHover(null)}
        onClick={e => { const no = noAt(e); const t = times.find(x => x.no === no && (curT ? x.white === curT.white : true)) ?? times.find(x => x.no === no); if (t) onSelect(t.node); }}>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
          <line x1={0} x2={W} y1={H / 2} y2={H / 2} className="eg-mid" vectorEffect="non-scaling-stroke" />
          {stages[0] && <line x1={0} x2={W} y1={fy(Math.min(300, stages[0].base * 0.1)) * H} y2={fy(Math.min(300, stages[0].base * 0.1)) * H} className="tu-trouble" vectorEffect="non-scaling-stroke" />}
          <path d={path(true)} className="tu-line w" vectorEffect="non-scaling-stroke" />
          <path d={path(false)} className="tu-line b" vectorEffect="non-scaling-stroke" />
        </svg>
        {curT && <span className="eg-cur" style={{ left: pct(fx(curT.no)) }} />}
        {hover != null && (
          <>
            <span className="eg-hover" style={{ left: pct(fx(hover)) }} />
            <span className="eg-tip" style={{ left: `clamp(calc(110 * var(--u)), ${pct(fx(hover))}, calc(100% - 110 * var(--u)))` }}>
              Zug {hover}<b>{hw?.clock != null ? fmtClock(hw.clock) : '–'}</b><b>{hb?.clock != null ? fmtClock(hb.clock) : '–'}</b>
            </span>
          </>
        )}
      </div>
      <div className="tu-legend small muted">
        <span><i className="tu-sw w" />Weiß</span><span><i className="tu-sw b" />Schwarz</span>
        {stages[0] && <span><i className="tu-sw t" />Zeitnot-Grenze</span>}
      </div>
    </div>
  );
}

function UsedBars({ rows, cur, onSelect }: { rows: { no: number; w?: MoveTime; b?: MoveTime }[]; cur: Node; onSelect: (n: Node) => void }) {
  const max = Math.max(1, ...rows.flatMap(r => [r.w?.used ?? 0, r.b?.used ?? 0]));
  const bar = (t?: MoveTime) => t ? (
    <div className={'tu-bar ' + (t.white ? 'w' : 'b') + (t.node === cur ? ' cur' : '')} onClick={() => onSelect(t.node)}
      title={`${t.no}${t.white ? '.' : '…'} ${t.node.san}: ${t.used != null ? fmtClock(t.used) : 'keine Angabe'}`}>
      <i style={{ width: `${((t.used ?? 0) / max) * 100}%` }} />
      <span>{t.used != null ? fmtClock(t.used) : ''}</span>
    </div>
  ) : <div className="tu-bar" />;
  return (
    <div className="tu-bars">
      {rows.map(r => (
        <div key={r.no} className="tu-bar-row">
          <span className="muted num">{r.no}</span>
          <div>{bar(r.w)}{bar(r.b)}</div>
        </div>
      ))}
    </div>
  );
}
