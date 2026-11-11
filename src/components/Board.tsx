import { useEffect, useRef } from 'react';
import { Chessground } from 'chessground';
import type { Api } from 'chessground/api';
import type { DrawShape } from 'chessground/draw';
import type { Key } from 'chessground/types';
import 'chessground/assets/chessground.base.css';
import 'chessground/assets/chessground.brown.css';
import 'chessground/assets/chessground.cburnett.css';

export interface BoardProps {
  fen: string;
  orientation: 'white' | 'black';
  turn: 'white' | 'black';
  dests: Map<Key, Key[]>;
  lastMove?: [Key, Key];
  check: boolean;
  shapes: DrawShape[];
  badge?: { square: string; color: string; symbol: string } | null;
  /** Vom Nutzer gezeichnete Pfeile/Felder der aktuellen Stellung; shapesKey wechselt mit der Stellung. */
  userShapes?: DrawShape[];
  shapesKey?: number | string;
  onShapes?: (shapes: DrawShape[]) => void;
  onMove: (from: string, to: string) => void;
}

export function Board(p: BoardProps) {
  const el = useRef<HTMLDivElement>(null);
  const api = useRef<Api | null>(null);
  const onMove = useRef(p.onMove);
  onMove.current = p.onMove;
  const onShapes = useRef(p.onShapes);
  onShapes.current = p.onShapes;

  useEffect(() => {
    const cg = Chessground(el.current!, {
      animation: { duration: 180 },
      movable: { free: false, showDests: true, rookCastle: false, events: { after: (o, d) => onMove.current(o, d) } },
      premovable: { enabled: false },
      drawable: {
        enabled: true, eraseOnClick: false,
        onChange: shapes => onShapes.current?.(shapes),
        brushes: {
          engine: { key: 'engine', color: '#2f8f88', opacity: 0.6, lineWidth: 9 },
          better: { key: 'better', color: '#4c8a50', opacity: 0.75, lineWidth: 9 },
        } as any,
      },
      highlight: { lastMove: true, check: true },
    });
    api.current = cg;
    const ro = new ResizeObserver(() => cg.redrawAll());
    ro.observe(el.current!);
    return () => { ro.disconnect(); cg.destroy(); };
  }, []);

  useEffect(() => {
    api.current?.set({
      fen: p.fen,
      orientation: p.orientation,
      turnColor: p.turn,
      lastMove: p.lastMove,
      check: p.check,
      movable: { color: p.turn, dests: p.dests },
      // Chessground verwirft gezeichnete Pfeile, sobald eine Stellung gesetzt wird – deshalb immer mitgeben.
      drawable: { shapes: p.userShapes ?? [] },
    });
    api.current?.setAutoShapes(p.shapes);
  });

  let badge = null;
  if (p.badge) {
    const f = p.badge.square.charCodeAt(0) - 97, r = parseInt(p.badge.square[1], 10) - 1;
    const x = p.orientation === 'white' ? f : 7 - f, y = p.orientation === 'white' ? 7 - r : r;
    badge = (
      <div className="move-badge" style={{ left: `${(x + 1) * 12.5}%`, top: `${y * 12.5}%`, background: p.badge.color }}>
        {p.badge.symbol}
      </div>
    );
  }
  return (
    <div className="board-box">
      <div ref={el} className="cg-host" />
      {badge}
    </div>
  );
}
