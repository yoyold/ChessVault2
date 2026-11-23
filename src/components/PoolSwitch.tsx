import { useMemo } from 'react';
import { setPool, useStore } from '../lib/store';
import { isOnline } from '../lib/meta';

/** Switches every game-based view between the over-the-board and the online database. */
export function PoolSwitch() {
  const { allGames, pool } = useStore();
  const online = useMemo(() => allGames.filter(isOnline).length, [allGames]);
  return (
    <div className="seg pool-switch" title="OTB- und Online-Partien getrennt anzeigen">
      <button className={pool === 'otb' ? 'on' : ''} onClick={() => setPool('otb')}>OTB <span className="muted">{(allGames.length - online).toLocaleString('de')}</span></button>
      <button className={pool === 'online' ? 'on' : ''} onClick={() => setPool('online')}>Online <span className="muted">{online.toLocaleString('de')}</span></button>
    </div>
  );
}
