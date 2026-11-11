import { ReactNode, useEffect, useRef } from 'react';
import { Node, moveNumber } from '../lib/tree';
import { NAG_SYMBOL, cleanComment } from '../lib/pgn';
import { CLASS_INFO, MoveClass } from '../lib/report';

interface Props {
  root: Node;
  cur: Node;
  classes: Map<number, MoveClass>;
  onSelect: (n: Node) => void;
  onContext: (n: Node, x: number, y: number) => void;
}

export function MoveList({ root, cur, classes, onSelect, onContext }: Props) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    box.current?.querySelector('.mv.cur')?.scrollIntoView({ block: 'nearest' });
  }, [cur]);

  const move = (n: Node, force: boolean): ReactNode => {
    const cls = classes.get(n.id);
    const marked = cls && cls !== 'best' && cls !== 'excellent' && cls !== 'good' && cls !== 'book';
    const all = n.nags ?? [];
    const nags = all.filter(g => g <= 6).map(g => NAG_SYMBOL[g] ?? '').join('');
    const extra = all.filter(g => g > 6).map(g => NAG_SYMBOL[g] ?? '').filter(Boolean).join(' ');
    return (
      <span
        key={n.id}
        className={'mv' + (n === cur ? ' cur' : '')}
        style={marked ? { color: CLASS_INFO[cls!].color } : undefined}
        title={cls ? CLASS_INFO[cls].label : undefined}
        onClick={() => onSelect(n)}
        onContextMenu={e => { e.preventDefault(); onContext(n, e.clientX, e.clientY); }}
      >
        <span className="mv-no">{moveNumber(n, force)}</span>
        {n.san}{nags}
        {marked && !nags ? <sup>{CLASS_INFO[cls!].symbol}</sup> : null}
        {extra ? <span className="mv-nag">{extra}</span> : null}
      </span>
    );
  };

  const line = (from: Node, depth: number): ReactNode[] => {
    const out: ReactNode[] = [];
    let n = from;
    let force = true;
    while (n.children.length) {
      const [main, ...vars] = n.children;
      out.push(move(main, force));
      force = false;
      const c = cleanComment(main.comment);
      if (c) { out.push(<span key={'c' + main.id} className="mv-comment">{c}</span>); force = true; }
      for (const v of vars) {
        const vc = cleanComment(v.comment);
        const inner = (
          <>
            {cleanComment(v.pre) ? <span className="mv-comment">{cleanComment(v.pre)}</span> : null}
            {move(v, true)}
            {vc ? <span className="mv-comment">{vc}</span> : null}
            {line(v, depth + 1)}
          </>
        );
        out.push(depth === 0
          ? <div key={'v' + v.id} className="mv-var block">{inner}</div>
          : <span key={'v' + v.id} className="mv-var">({inner})</span>);
        force = true;
      }
      n = main;
    }
    return out;
  };

  const rc = cleanComment(root.comment);
  return (
    <div className="movelist" ref={box}>
      {rc ? <span className="mv-comment">{rc}</span> : null}
      {line(root, 0)}
      {!root.children.length && <div className="muted pad">Noch keine Züge – ziehe einfach auf dem Brett.</div>}
    </div>
  );
}
