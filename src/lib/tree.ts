import { Chess } from 'chess.js';

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export interface Node {
  id: number;
  ply: number;
  san: string;
  uci: string;
  fen: string;
  parent: Node | null;
  children: Node[];
  comment?: string;
  nags?: number[];
}

export interface Game {
  headers: Record<string, string>;
  root: Node;
}

let nextId = 1;

export function newRoot(fen = START_FEN): Node {
  const parts = fen.split(' ');
  const full = parseInt(parts[5] || '1', 10) || 1;
  const ply = (full - 1) * 2 + (parts[1] === 'b' ? 1 : 0);
  return { id: nextId++, ply, san: '', uci: '', fen, parent: null, children: [] };
}

export function newGame(fen = START_FEN): Game {
  const headers: Record<string, string> = {
    Event: '?', Site: '?', Date: '????.??.??', Round: '?', White: '?', Black: '?', Result: '*',
  };
  if (fen !== START_FEN) { headers.SetUp = '1'; headers.FEN = fen; }
  return { headers, root: newRoot(fen) };
}

export type MoveInput = string | { from: string; to: string; promotion?: string };

/** Fügt einen Zug an (oder liefert das bestehende Kind). null = illegal. */
export function addMove(parent: Node, move: MoveInput): Node | null {
  const c = new Chess(parent.fen);
  let m;
  try { m = c.move(move as any, { strict: false }); } catch { return null; }
  if (!m) return null;
  const uci = m.from + m.to + (m.promotion ?? '');
  const ex = parent.children.find(ch => ch.uci === uci);
  if (ex) return ex;
  const n: Node = { id: nextId++, ply: parent.ply + 1, san: m.san, uci, fen: c.fen(), parent, children: [] };
  parent.children.push(n);
  return n;
}

export function mainline(root: Node): Node[] {
  const out: Node[] = [];
  let n = root;
  while (n.children.length) { n = n.children[0]; out.push(n); }
  return out;
}

/** Pfad von der Wurzel (exklusive) bis zum Knoten (inklusive). */
export function pathTo(node: Node): Node[] {
  const out: Node[] = [];
  let n: Node | null = node;
  while (n && n.parent) { out.push(n); n = n.parent; }
  return out.reverse();
}

export function isMainline(node: Node): boolean {
  let n = node;
  while (n.parent) { if (n.parent.children[0] !== n) return false; n = n.parent; }
  return true;
}

export function lastOfLine(node: Node): Node {
  let n = node;
  while (n.children.length) n = n.children[0];
  return n;
}

export function deleteNode(node: Node): Node {
  const p = node.parent;
  if (!p) { node.children = []; return node; }
  p.children = p.children.filter(c => c !== node);
  return p;
}

/** Variante eine Stufe nach vorne holen (bis zur Hauptvariante). */
export function promote(node: Node) {
  let n: Node = node;
  while (n.parent) {
    const p: Node = n.parent;
    const i = p.children.indexOf(n);
    if (i > 0) { p.children.splice(i, 1); p.children.unshift(n); return; }
    n = p;
  }
}

export const stripSan = (san: string) => san.replace(/[+#!?]/g, '');

export function moveNumber(n: Node, force = false): string {
  const no = Math.floor((n.ply + 1) / 2);
  if (n.ply % 2 === 1) return no + '.';
  return force ? no + '…' : '';
}
