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

/** Comments of one node: the owner's in the normal style, an engine's/agent's in the bot style. */
function comments(n: Node, bot: boolean): ReactNode[] {
  const out: ReactNode[] = [];
  const c = cleanComment(n.comment);
  if (c) out.push(<span key={'c' + n.id} className={'mv-comment' + (bot ? ' bot' : '')}>{c}</span>);
  const b = cleanComment(n.botComment);
  if (b) out.push(<span key={'b' + n.id} className="mv-comment bot" title="Kommentar von Engine / Bot">{b}</span>);
  return out;
}

export function MoveList({ root, cur, classes, onSelect, onContext }: Props) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    box.current?.querySelector('.mv.cur')?.scrollIntoView({ block: 'nearest' });
  }, [cur]);

  const move = (n: Node, force: boolean, bot: boolean): ReactNode => {
    const cls = classes.get(n.id);
    const marked = cls && cls !== 'best' && cls !== 'excellent' && cls !== 'good' && cls !== 'book';
    const all = n.nags ?? [];
    const nags = all.filter(g => g <= 6).map(g => NAG_SYMBOL[g] ?? '').join('');
    const extra = all.filter(g => g > 6).map(g => NAG_SYMBOL[g] ?? '').filter(Boolean).join(' ');
    return (
      <span
        key={n.id}
        className={'mv' + (n === cur ? ' cur' : '') + (bot ? ' bot' : '')}
        style={marked && !bot ? { color: CLASS_INFO[cls!].color } : undefined}
        title={cls ? CLASS_INFO[cls].label : bot ? 'Engine- / Bot-Variante' : undefined}
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

  // `bot`: the line being drawn is an engine/agent variation (inherited by everything inside it)
  const line = (from: Node, depth: number, bot: boolean): ReactNode[] => {
    const out: ReactNode[] = [];
    let n = from;
    let force = true;
    while (n.children.length) {
      const [main, ...vars] = n.children;
      out.push(move(main, force, bot));
      force = false;
      const cm = comments(main, bot);
      if (cm.length) { out.push(...cm); force = true; }
      for (const v of vars) {
        const vb = bot || !!v.vBot;
        const inner = (
          <>
            {cleanComment(v.pre) ? <span className={'mv-comment' + (vb ? ' bot' : '')}>{cleanComment(v.pre)}</span> : null}
            {move(v, true, vb)}
            {comments(v, vb)}
            {line(v, depth + 1, vb)}
          </>
        );
        const cls = 'mv-var' + (vb ? ' bot' : '');
        out.push(depth === 0
          ? <div key={'v' + v.id} className={cls + ' block'}>{inner}</div>
          : <span key={'v' + v.id} className={cls}>({inner})</span>);
        force = true;
      }
      n = main;
    }
    return out;
  };

  return (
    <div className="movelist" ref={box}>
      {comments(root, false)}
      {line(root, 0, false)}
      {!root.children.length && <div className="muted pad">Noch keine Züge – ziehe einfach auf dem Brett.</div>}
    </div>
  );
}
