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
  /** Arrows/squares the user drew for the current position; shapesKey changes with the position. */
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
    const host = el.current!;
    const ro = new ResizeObserver(() => {
      // While the host is detached or hidden it measures 0×0; redrawing then would place every arrow
      // at NaN (chessground divides by the board size). Skip it and redraw once the board has a size again.
      if (!hasSize(host)) return;
      cg.redrawAll();
      apply.current();
    });
    ro.observe(host);
    return () => {
      ro.disconnect();
      // A redraw may still be pending (debounced redraw, end of a move animation) and would run on the
      // detached, size-less board: drop the shapes so it has no arrows to place.
      cg.state.drawable.shapes = [];
      cg.state.drawable.autoShapes = [];
      cg.state.drawable.current = undefined;
      cg.destroy();
      api.current = null;
    };
  }, []);

  const apply = useRef(() => {});
  apply.current = () => {
    const cg = api.current;
    if (!cg) return;
    // Arrows need a measurable board; without one they are left out and restored by the resize observer.
    const sized = !!el.current && hasSize(el.current);
    cg.set({
      fen: p.fen,
      orientation: p.orientation,
      turnColor: p.turn,
      lastMove: p.lastMove,
      check: p.check,
      movable: { color: p.turn, dests: p.dests },
      // Chessground drops drawn arrows whenever a position is set, so always pass them along.
      drawable: { shapes: sized ? p.userShapes ?? [] : [] },
    });
    cg.setAutoShapes(sized ? p.shapes : []);
  };
  useEffect(() => apply.current());

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

function hasSize(e: HTMLElement): boolean {
  return e.isConnected && e.clientWidth > 0 && e.clientHeight > 0;
}
