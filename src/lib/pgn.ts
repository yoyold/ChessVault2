import { Game, Node, Shape, addMove, newRoot, START_FEN } from './tree';

/** Splits a PGN text into individual games. */
export function splitPgn(text: string): string[] {
  const games: string[] = [];
  const lines = text.replace(/\r/g, '').replace(/^\uFEFF/, '').split('\n');
  let cur: string[] = [];
  let seenMoves = false;
  let inComment = false;
  const flush = () => {
    const s = cur.join('\n').trim();
    if (s) games.push(s);
    cur = []; seenMoves = false;
  };
  for (const line of lines) {
    const isHeader = !inComment && /^\s*\[[A-Za-z0-9_]+\s+"/.test(line);
    if (isHeader && seenMoves) flush();
    if (!isHeader && line.trim()) {
      seenMoves = true;
      for (const ch of line) { if (ch === '{') inComment = true; else if (ch === '}') inComment = false; }
    }
    cur.push(line);
  }
  flush();
  return games;
}

const HEADER_RE = /^\s*\[([A-Za-z0-9_]+)\s+"((?:[^"\\]|\\.)*)"\]\s*$/gm;

export function parseHeaders(pgn: string): Record<string, string> {
  const h: Record<string, string> = {};
  HEADER_RE.lastIndex = 0;
  let m;
  while ((m = HEADER_RE.exec(pgn))) h[m[1]] = m[2].replace(/\\(["\\])/g, '$1');
  return h;
}

export function movetextOf(pgn: string): string {
  return pgn.replace(HEADER_RE, '').trim();
}

/** Fast extraction of the main line (no legality check) – for bulk import. */
export function quickMainline(movetext: string): string[] {
  let s = movetext.replace(/\{[^}]*\}/g, ' ').replace(/;[^\n]*/g, ' ');
  let prev;
  do { prev = s; s = s.replace(/\([^()]*\)/g, ' '); } while (s !== prev);
  const out: string[] = [];
  for (let t of s.split(/\s+/)) {
    t = t.replace(/^\d+\.+/, '');
    if (!t || t[0] === '$' || /^(1-0|0-1|1\/2-1\/2|\*|\d+\.*)$/.test(t)) continue;
    t = t.replace(/0/g, 'O').replace(/[+#!?]/g, '');
    if (/^([KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](=[QRBN])?|O-O(-O)?)$/.test(t)) out.push(t);
    else break;
  }
  return out;
}

const SUFFIX_NAG: Record<string, number> = { '!': 1, '?': 2, '!!': 3, '??': 4, '!?': 5, '?!': 6 };
export const NAG_SYMBOL: Record<number, string> = {
  1: '!', 2: '?', 3: '!!', 4: '??', 5: '!?', 6: '?!', 7: '□', 146: 'N',
  10: '=', 13: '∞', 14: '⩲', 15: '⩱', 16: '±', 17: '∓', 18: '+−', 19: '−+', 44: '=/∞',
  22: '⊙', 32: '⟳', 26: '○', 36: '↑', 40: '→', 132: '⇆', 138: '⊕', 140: '∆', 142: '⌓',
};

/** Selection as in ChessBase: at most one symbol per group and move. (Labels are UI text and stay German.) */
export const NAG_GROUPS: { title: string; items: [number, string][] }[] = [
  { title: 'Zug', items: [[1, 'Guter Zug'], [2, 'Fehler'], [3, 'Glänzender Zug'], [4, 'Grober Fehler'], [5, 'Interessanter Zug'], [6, 'Zweifelhafter Zug'], [7, 'Einziger Zug'], [146, 'Neuerung']] },
  { title: 'Stellung', items: [[18, 'Weiß steht auf Gewinn'], [16, 'Weiß steht klar besser'], [14, 'Weiß steht etwas besser'], [10, 'Ausgeglichen'], [13, 'Unklar'], [44, 'Mit Kompensation'], [15, 'Schwarz steht etwas besser'], [17, 'Schwarz steht klar besser'], [19, 'Schwarz steht auf Gewinn']] },
  { title: 'Motiv', items: [[36, 'Mit Initiative'], [40, 'Mit Angriff'], [132, 'Mit Gegenspiel'], [22, 'Zugzwang'], [32, 'Entwicklungsvorsprung'], [26, 'Raumvorteil'], [138, 'Zeitnot'], [140, 'Mit der Idee'], [142, 'Besser ist']] },
];

const BRUSH_LETTER: Record<string, string> = { green: 'G', red: 'R', blue: 'B', yellow: 'Y' };
const LETTER_BRUSH: Record<string, string> = { G: 'green', R: 'red', B: 'blue', Y: 'yellow', O: 'yellow', C: 'blue' };

/** Separates graphical annotations ([%cal …] arrows, [%csl …] squares) from the comment text. */
function splitShapes(c: string): { text: string; shapes: Shape[] } {
  const shapes: Shape[] = [];
  const text = c.replace(/\[%c(al|sl)\s+([^\]]*)\]/g, (_m, _k, list: string) => {
    for (const t of list.split(',')) {
      const m = t.trim().match(/^([A-Z])([a-h][1-8])([a-h][1-8])?$/);
      if (m) shapes.push({ brush: LETTER_BRUSH[m[1]] ?? 'green', orig: m[2], ...(m[3] ? { dest: m[3] } : {}) });
    }
    return '';
  }).replace(/\s+/g, ' ').trim();
  return { text, shapes };
}

function shapeTags(shapes?: Shape[]): string {
  if (!shapes?.length) return '';
  const sq = shapes.filter(s => !s.dest).map(s => (BRUSH_LETTER[s.brush] ?? 'G') + s.orig);
  const ar = shapes.filter(s => s.dest).map(s => (BRUSH_LETTER[s.brush] ?? 'G') + s.orig + s.dest);
  return (sq.length ? `[%csl ${sq.join(',')}]` : '') + (ar.length ? `[%cal ${ar.join(',')}]` : '');
}

/** Full parser with variations, comments and NAGs. */
export function parseGame(pgn: string): Game {
  const headers = parseHeaders(pgn);
  const text = movetextOf(pgn);
  const root = newRoot(headers.FEN && headers.FEN.split(' ').length >= 4 ? headers.FEN : START_FEN);
  let cur: Node = root;
  const stack: Node[] = [];
  let i = 0;
  const n = text.length;
  let broken = false;
  let pendingPre = ''; // a comment right after "(" belongs before the first move of the variation
  let afterOpen = false;
  while (i < n && !broken) {
    const ch = text[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === '{') {
      const end = text.indexOf('}', i);
      const raw = text.slice(i + 1, end < 0 ? n : end).replace(/\s+/g, ' ').trim();
      const { text: c, shapes } = splitShapes(raw);
      if (afterOpen) { if (c) pendingPre = pendingPre ? pendingPre + ' ' + c : c; }
      else {
        if (c) cur.comment = cur.comment ? cur.comment + ' ' + c : c;
        if (shapes.length) cur.shapes = [...(cur.shapes ?? []), ...shapes];
      }
      i = end < 0 ? n : end + 1; continue;
    }
    if (ch === ';' || (ch === '%' && (i === 0 || text[i - 1] === '\n'))) {
      const end = text.indexOf('\n', i);
      i = end < 0 ? n : end + 1; continue;
    }
    if (ch === '(') { stack.push(cur); if (cur.parent) cur = cur.parent; i++; afterOpen = true; pendingPre = ''; continue; }
    if (ch === ')') { const p = stack.pop(); if (p) cur = p; i++; afterOpen = false; continue; }
    let j = i;
    while (j < n && !/[\s{}()]/.test(text[j])) j++;
    let tok = text.slice(i, j);
    i = j;
    if (tok[0] === '$') { const v = parseInt(tok.slice(1), 10); if (v) (cur.nags ??= []).push(v); continue; }
    if (/^(1-0|0-1|1\/2-1\/2|\*)$/.test(tok)) continue;
    tok = tok.replace(/^\d+\.+/, '');
    if (!tok || /^\.+$/.test(tok)) continue;
    const sm = tok.match(/[!?]+$/);
    if (sm) tok = tok.slice(0, -sm[0].length);
    if (!tok) { if (sm && SUFFIX_NAG[sm[0]]) (cur.nags ??= []).push(SUFFIX_NAG[sm[0]]); continue; }
    tok = tok.replace(/0-0-0/g, 'O-O-O').replace(/0-0/g, 'O-O');
    const child = addMove(cur, tok);
    if (!child) { broken = true; break; }
    if (afterOpen && pendingPre && !child.pre) child.pre = pendingPre;
    afterOpen = false; pendingPre = '';
    if (sm && SUFFIX_NAG[sm[0]] && !(child.nags ?? []).includes(SUFFIX_NAG[sm[0]])) (child.nags ??= []).push(SUFFIX_NAG[sm[0]]);
    cur = child;
  }
  return { headers, root };
}

const SEVEN = ['Event', 'Site', 'Date', 'Round', 'White', 'Black', 'Result'];

export function serializeGame(g: Game): string {
  const h = { ...g.headers };
  for (const k of SEVEN) if (!h[k]) h[k] = k === 'Date' ? '????.??.??' : k === 'Result' ? '*' : '?';
  const keys = [...SEVEN, ...Object.keys(h).filter(k => !SEVEN.includes(k))];
  const head = keys.map(k => `[${k} "${String(h[k]).replace(/(["\\])/g, '\\$1')}"]`).join('\n');
  const out: string[] = [];
  { const c = [g.root.comment, shapeTags(g.root.shapes)].filter(Boolean).join(' '); if (c) out.push(`{${c.replace(/}/g, ')')}}`); }
  writeLine(g.root, out, true);
  out.push(h.Result);
  // wrap lines at ~80 characters
  const lines: string[] = [];
  let line = '';
  for (const t of out) {
    if (line.length + t.length + 1 > 80 && line) { lines.push(line); line = t; }
    else line = line ? line + ' ' + t : t;
  }
  if (line) lines.push(line);
  return head + '\n\n' + lines.join('\n').replace(/\( /g, '(').replace(/ \)/g, ')') + '\n';
}

function moveTok(n: Node, force: boolean): string {
  const no = Math.floor((n.ply + 1) / 2);
  const pre = n.ply % 2 === 1 ? `${no}. ` : force ? `${no}... ` : '';
  return pre + n.san;
}

function annot(n: Node, out: string[]): boolean {
  for (const g of n.nags ?? []) out.push('$' + g);
  const c = [n.comment, shapeTags(n.shapes)].filter(Boolean).join(' ');
  if (c) { out.push(`{${c.replace(/}/g, ')')}}`); return true; }
  return false;
}

function writeLine(from: Node, out: string[], force: boolean) {
  let cur = from;
  while (cur.children.length) {
    const [main, ...vars] = cur.children;
    out.push(moveTok(main, force));
    force = annot(main, out);
    for (const v of vars) {
      out.push('(');
      if (v.pre) out.push(`{${v.pre.replace(/}/g, ')')}}`);
      out.push(moveTok(v, true));
      writeLine(v, out, annot(v, out));
      out.push(')');
      force = true;
    }
    cur = main;
  }
}

/** Strips Lichess/Chess.com control tags such as [%clk …] for display. */
export const cleanComment = (c?: string) => (c ?? '').replace(/\[%[^\]]*\]/g, '').replace(/\s+/g, ' ').trim();
