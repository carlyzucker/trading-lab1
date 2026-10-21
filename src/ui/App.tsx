import { useEffect, useState } from 'react';
import { Backtest } from './pages/Backtest';
import { Dashboard } from './pages/Dashboard';
import { Markets } from './pages/Markets';
import { Paper } from './pages/Paper';
import { Settings } from './pages/Settings';
import { Strategies } from './pages/Strategies';
import { Super } from './pages/Super';
import { useLab } from './useLab';
import { fmtNum, toChf } from './ui';
import { accountEquity } from '../core/account';
import { SUPER_ID } from '../core/live';

const TABS = [
  { id: 'start', label: 'Start' },
  { id: 'markets', label: 'Märkte' },
  { id: 'strategies', label: 'Strategien' },
  { id: 'backtest', label: 'Backtest' },
  { id: 'paper', label: 'Paper' },
  { id: 'super', label: 'Super' },
] as const;

type TabId = (typeof TABS)[number]['id'] | 'settings';

export function App() {
  const lab = useLab();
  const initial = (typeof location !== 'undefined' && location.hash.slice(1)) as TabId;
  const [tab, setTab] = useState<TabId>([...TABS.map((t) => t.id), 'settings'].includes(initial) ? initial : 'start');

  useEffect(() => {
    try {
      history.replaceState(null, '', `#${tab}`);
    } catch {
      /* in manchen Umgebungen nicht erlaubt */
    }
    window.scrollTo(0, 0);
  }, [tab]);

  if (!lab) return <div className="loading">Lade gespeicherten Zustand …</div>;
  const sup = lab.state.accounts[SUPER_ID];
  const running = lab.state.live.running;

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <span className={`dot ${running ? (lab.visible ? 'on' : 'paused') : ''}`} aria-hidden="true" />
          <div>
            <div className="title">Trading Strategy Lab</div>
            <div className="sub">Paper-Trading · Bybit-Simulation · v0.1</div>
          </div>
        </div>
        <div className="top-right">
          {sup && (
            <div className="top-eq num" title="Superstrategie-Portfolio">
              {fmtNum(toChf(lab.state, accountEquity(sup, {})), 2)} CHF
            </div>
          )}
          <button className={`icon-btn${tab === 'settings' ? ' on' : ''}`} onClick={() => setTab('settings')} aria-label="Einstellungen">
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
              <circle cx="15" cy="7" r="2" />
              <circle cx="9" cy="17" r="2" />
            </svg>
          </button>
        </div>
      </header>

      {lab.busy && <div className="busy">{lab.busy}</div>}

      <main>
        {tab === 'start' && <Dashboard lab={lab} go={(t) => setTab(t as TabId)} />}
        {tab === 'markets' && <Markets lab={lab} />}
        {tab === 'strategies' && <Strategies lab={lab} />}
        {tab === 'backtest' && <Backtest lab={lab} />}
        {tab === 'paper' && <Paper lab={lab} />}
        {tab === 'super' && <Super lab={lab} />}
        {tab === 'settings' && <Settings lab={lab} />}
      </main>

      {lab.toast && (
        <div className="toast" role="status">
          {lab.toast}
        </div>
      )}

      <nav className="tabs" aria-label="Bereiche">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)} aria-current={tab === t.id ? 'page' : undefined}>
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
