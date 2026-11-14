import { DatabaseView } from './components/DatabaseView';
import { AnalysisView } from './components/AnalysisView';
import { StatsView } from './components/StatsView';
import { SettingsView } from './components/SettingsView';
import { HomeView } from './components/HomeView';
import { TrainingView } from './components/TrainingView';
import { TournamentsView } from './components/TournamentsView';
import { Icon } from './components/ui';
import { runSync, setView, stopBackground, useStore, View } from './lib/store';

const NAV: { id: View; icon: string; label: string }[] = [
  { id: 'home', icon: 'home', label: 'Übersicht' },
  { id: 'db', icon: 'db', label: 'Datenbank' },
  { id: 'analysis', icon: 'board', label: 'Analyse' },
  { id: 'training', icon: 'target', label: 'Training' },
  { id: 'tournaments', icon: 'trophy', label: 'Turniere' },
  { id: 'stats', icon: 'chart', label: 'Statistik' },
  { id: 'settings', icon: 'settings', label: 'Einstellungen' },
];

export function App() {
  const { view, toast, sync, games, bg } = useStore();
  return (
    <div className="app">
      <nav className="sidebar">
        <div className="brand">ChessVault<span>2</span></div>
        {NAV.map(n => (
          <button key={n.id} className={'nav-item' + (view === n.id ? ' on' : '')} onClick={() => setView(n.id)}>
            <Icon name={n.icon} /><span className="nav-label">{n.label}</span>
            {n.id === 'db' && games.length > 0 && <span className="nav-count">{games.length.toLocaleString('de')}</span>}
          </button>
        ))}
        <span className="grow" />
        {bg && (
          <button className="bg-chip" title={`${bg.label} – klicken zum Anhalten`} onClick={() => { if (confirm('Hintergrundanalyse anhalten?')) stopBackground(); }}>
            <span className="nav-label">Analyse {bg.done}/{bg.total}</span>
            <span className="progress"><span style={{ width: `${(100 * bg.done) / bg.total}%` }} /></span>
          </button>
        )}
        <button
          className={'sync-chip ' + sync.state}
          title={sync.state === 'off' ? 'Geräte-Sync einrichten' : sync.state === 'error' ? sync.msg : sync.last ? 'Zuletzt synchronisiert: ' + new Date(sync.last).toLocaleString('de') : 'Jetzt synchronisieren'}
          onClick={() => (sync.state === 'off' ? setView('settings') : runSync(false))}
        >
          <span className="sync-dot" />
          <span className="nav-label">{sync.state === 'off' ? 'Sync einrichten' : sync.state === 'busy' ? sync.msg || 'Sync …' : sync.state === 'error' ? 'Sync-Fehler' : 'Synchron'}</span>
        </button>
      </nav>
      <main className="main">
        {view === 'home' && <HomeView />}
        {view === 'db' && <DatabaseView />}
        {view === 'training' && <TrainingView />}
        {view === 'analysis' && <AnalysisView />}
        {view === 'tournaments' && <TournamentsView />}
        {view === 'stats' && <StatsView />}
        {view === 'settings' && <SettingsView />}
      </main>
      {toast && <div className={'toast ' + toast.kind}>{toast.msg}</div>}
    </div>
  );
}
