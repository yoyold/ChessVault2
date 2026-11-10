import { Game, Node, addMove, newRoot, START_FEN } from './tree';

/** Zerlegt einen PGN-Text in einzelne Partien. */
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

/** Schnelle Extraktion der Hauptvariante (ohne Legalitätsprüfung) – für den Massenimport. */
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
  1: '!', 2: '?', 3: '!!', 4: '??', 5: '!?', 6: '?!', 10: '=', 13: '∞', 14: '⩲', 15: '⩱', 16: '±', 17: '∓', 18: '+−', 19: '−+',
};

/** Vollständiger Parser mit Varianten, Kommentaren und NAGs. */
export function parseGame(pgn: string): Game {
  const headers = parseHeaders(pgn);
  const text = movetextOf(pgn);
  const root = newRoot(headers.FEN && headers.FEN.split(' ').length >= 4 ? headers.FEN : START_FEN);
  let cur: Node = root;
  const stack: Node[] = [];
  let i = 0;
  const n = text.length;
  let broken = false;
  while (i < n && !broken) {
    const ch = text[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === '{') {
      const end = text.indexOf('}', i);
      const c = text.slice(i + 1, end < 0 ? n : end).replace(/\s+/g, ' ').trim();
      if (c) cur.comment = cur.comment ? cur.comment + ' ' + c : c;
      i = end < 0 ? n : end + 1; continue;
    }
    if (ch === ';' || (ch === '%' && (i === 0 || text[i - 1] === '\n'))) {
      const end = text.indexOf('\n', i);
      i = end < 0 ? n : end + 1; continue;
    }
    if (ch === '(') { stack.push(cur); if (cur.parent) cur = cur.parent; i++; continue; }
    if (ch === ')') { const p = stack.pop(); if (p) cur = p; i++; continue; }
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
  if (g.root.comment) out.push(`{${g.root.comment}}`);
  writeLine(g.root, out, true);
  out.push(h.Result);
  // Zeilenumbruch bei ~80 Zeichen
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
  if (n.comment) { out.push(`{${n.comment.replace(/}/g, ')')}}`); return true; }
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
      out.push(moveTok(v, true));
      writeLine(v, out, annot(v, out));
      out.push(')');
      force = true;
    }
    cur = main;
  }
}

/** Entfernt Lichess/Chess.com-Steuertags wie [%clk …] für die Anzeige. */
export const cleanComment = (c?: string) => (c ?? '').replace(/\[%[^\]]*\]/g, '').replace(/\s+/g, ' ').trim();
