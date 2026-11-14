import type { GameMeta } from './db';
import type { Filter } from './store';

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Normalises a typed move sequence ("1. e4 c5 2. Nf3") to the storage format. */
export function normMoves(s: string): string {
  return s.replace(/\d+\.+/g, ' ').replace(/[+#!?]/g, '').replace(/0/g, 'O').trim().split(/\s+/).filter(Boolean).join(' ');
}

export function buildPredicate(f: Filter, positionHits?: Set<number>): (g: GameMeta) => boolean {
  const tests: ((g: GameMeta) => boolean)[] = [];
  if (f.fen.trim() && positionHits) tests.push(g => positionHits.has(g.id!));
  const words = norm(f.q).split(/\s+/).filter(Boolean);
  if (words.length) tests.push(g => {
    const hay = norm(`${g.white} ${g.black} ${g.event} ${g.site} ${g.opening} ${g.eco} ${g.date} ${g.tags.join(' ')} ${g.source}`);
    return words.every(w => hay.includes(w));
  });
  const w = norm(f.white.trim()), b = norm(f.black.trim());
  if (w || b) tests.push(g => {
    const gw = norm(g.white), gb = norm(g.black);
    const straight = (!w || gw.includes(w)) && (!b || gb.includes(b));
    if (straight) return true;
    return f.ignoreColors && (!w || gb.includes(w)) && (!b || gw.includes(b));
  });
  if (!(f.res.w && f.res.d && f.res.b)) tests.push(g =>
    (f.res.w && g.result === '1-0') || (f.res.d && g.result === '1/2-1/2') || (f.res.b && g.result === '0-1'));
  const num = (s: string) => (s.trim() ? parseInt(s, 10) : NaN);
  const yf = num(f.yearFrom), yt = num(f.yearTo);
  if (!isNaN(yf)) tests.push(g => g.year >= yf);
  if (!isNaN(yt)) tests.push(g => g.year > 0 && g.year <= yt);
  const emin = num(f.eloMin), emax = num(f.eloMax);
  if (!isNaN(emin)) tests.push(g => Math.max(g.whiteElo, g.blackElo) >= emin && Math.min(g.whiteElo || g.blackElo, g.blackElo || g.whiteElo) >= emin);
  if (!isNaN(emax)) tests.push(g => Math.max(g.whiteElo, g.blackElo) > 0 && Math.max(g.whiteElo, g.blackElo) <= emax);
  const ef = f.ecoFrom.trim().toUpperCase(), et = (f.ecoTo.trim() || f.ecoFrom.trim()).toUpperCase();
  const pad = (x: string, c: string) => (x + c + c).slice(0, 3);
  if (ef) { const from = pad(ef, '0'), to = pad(et, '9'); tests.push(g => !!g.eco && g.eco >= from && g.eco <= to); }
  const op = norm(f.opening.trim());
  if (op) tests.push(g => norm(g.opening).includes(op));
  const mv = normMoves(f.moves);
  if (mv) tests.push(g => g.moves === mv || g.moves.startsWith(mv + ' '));
  const mmin = num(f.movesMin), mmax = num(f.movesMax);
  if (!isNaN(mmin)) tests.push(g => Math.ceil(g.plies / 2) >= mmin);
  if (!isNaN(mmax)) tests.push(g => Math.ceil(g.plies / 2) <= mmax);
  if (f.tc) tests.push(g => g.tc === f.tc);
  if (f.tag) tests.push(g => g.tags.includes(f.tag));
  if (f.favOnly) tests.push(g => g.fav);
  if (f.analyzedOnly) tests.push(g => g.accW != null);
  return g => tests.every(t => t(g));
}

export function countActive(f: Filter): number {
  let n = 0;
  for (const k of ['white', 'black', 'yearFrom', 'yearTo', 'eloMin', 'eloMax', 'ecoFrom', 'ecoTo', 'opening', 'moves', 'movesMin', 'movesMax', 'tc', 'tag', 'fen'] as const) if (f[k].trim()) n++;
  if (!(f.res.w && f.res.d && f.res.b)) n++;
  if (f.favOnly) n++;
  if (f.analyzedOnly) n++;
  return n;
}

export function download(name: string, text: string, type = 'application/x-chess-pgn') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/** German singular/plural: "1 Partie" / "3 Partien" */
export const nGames = (n: number) => `${n.toLocaleString('de')} ${n === 1 ? 'Partie' : 'Partien'}`;

export const resultLabel = (r: string) => (r === '1/2-1/2' ? '½–½' : r === '*' ? '*' : r.replace('-', '–'));
