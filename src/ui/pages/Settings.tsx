import { useState } from 'react';
import { TIMEFRAMES } from '../../core/timeframes';
import type { Lab } from '../useLab';
import { Badge, Card, fmtNum, KV } from '../ui';

export function Settings({ lab }: { lab: Lab }) {
  const { state } = lab;
  const s = state.settings;
  const running = state.live.running;
  const [confirmReset, setConfirmReset] = useState(false);
  const [backupText, setBackupText] = useState<string | null>(null);

  const download = () => {
    const json = lab.exportBackup();
    try {
      const blob = new Blob([json], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `trading-lab-backup-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      lab.notify('Backup-Datei erstellt');
    } catch {
      setBackupText(json);
    }
  };

  const copy = async () => {
    const json = lab.exportBackup();
    try {
      await navigator.clipboard.writeText(json);
      lab.notify('Backup in die Zwischenablage kopiert');
    } catch {
      setBackupText(json);
    }
  };

  const importFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      lab.importBackup(await f.text());
      lab.notify('Backup geladen – Bot ist gestoppt');
    } catch (e) {
      lab.notify(`Import fehlgeschlagen: ${(e as Error).message}`);
    }
  };

  return (
    <div className="stack">
      <Card title="Simulation">
        <div className="form">
          <label htmlFor="set-tf">Zeitrahmen der Live-Simulation</label>
          <select
            id="set-tf"
            value={s.timeframe}
            disabled={running}
            onChange={(e) =>
              lab.commit((st) => {
                st.settings.timeframe = e.target.value;
                st.live.lastProcessed = {};
                st.live.gaps = [];
              })
            }
          >
            {TIMEFRAMES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
          {running && <p className="fine">Zum Ändern zuerst den Bot stoppen. Nach einem Wechsel startet die Simulation ab der nächsten Kerze neu.</p>}
          <label htmlFor="set-lev">Hebel (simuliert): {s.leverage}x</label>
          <input id="set-lev" type="range" min={1} max={s.maxLeverage} step={0.5} value={s.leverage} onChange={(e) => lab.commit((st) => (st.settings.leverage = parseFloat(e.target.value)))} />
          <label htmlFor="set-slip">Slippage (Basispunkte, Annahme)</label>
          <input id="set-slip" type="number" min={0} max={100} step={1} value={s.slippageBps} onChange={(e) => lab.commit((st) => (st.settings.slippageBps = Math.max(0, parseFloat(e.target.value) || 0)))} />
          <label htmlFor="set-taker">Bybit Taker-Gebühr Derivate (%)</label>
          <input
            id="set-taker"
            type="number"
            step={0.001}
            min={0}
            value={+(s.fees.linear.takerRate * 100).toFixed(4)}
            onChange={(e) => lab.commit((st) => (st.settings.fees = { ...st.settings.fees, linear: { ...st.settings.fees.linear, takerRate: (parseFloat(e.target.value) || 0) / 100, label: 'Eigene Einstellung' } }))}
          />
          <label htmlFor="set-maker">Bybit Maker-Gebühr Derivate (%)</label>
          <input
            id="set-maker"
            type="number"
            step={0.001}
            min={0}
            value={+(s.fees.linear.makerRate * 100).toFixed(4)}
            onChange={(e) => lab.commit((st) => (st.settings.fees = { ...st.settings.fees, linear: { ...st.settings.fees.linear, makerRate: (parseFloat(e.target.value) || 0) / 100, label: 'Eigene Einstellung' } }))}
          />
        </div>
        <div className="grid2">
          <KV k="Startkapital">{s.startCapitalChf} CHF je Konto</KV>
          <KV k="Risiko je Trade">{s.riskPct * 100} % des aktuellen Kontostands (fest)</KV>
          <KV k="Max. Instrumente">{s.maxInstruments}</KV>
          <KV k="Wechselkurs">
            {state.fx ? `1 CHF = ${fmtNum(state.fx.usdPerChf, 4)} USD (EZB ${state.fx.date})` : 'nicht geladen'} <Badge tone="warn">1 USDT = 1 USD angenommen</Badge>
          </KV>
        </div>
      </Card>

      <Card title="Datenzugang">
        <div className="form">
          <label htmlFor="set-proxy">Eigener Proxy (optional, nur falls der Browser Bybit blockiert)</label>
          <input
            id="set-proxy"
            type="url"
            placeholder="https://dein-name.workers.dev"
            value={s.endpoints.proxy ?? ''}
            onChange={(e) => lab.commit((st) => (st.settings.endpoints = { ...st.settings.endpoints, proxy: e.target.value.trim() || undefined }))}
          />
        </div>
        <p className="fine">Leer lassen = direkte Abfrage bei Binance/Bybit. Anleitung für einen kostenlosen Proxy steht im README.</p>
      </Card>

      <Card title="Backup">
        <p className="fine">Sichert Konten, Trades, Journal, Einstellungen und Strategie-Versionen als JSON. Dieselbe Datei kann später der 24/7-Server übernehmen.</p>
        <div className="row wrap">
          <button className="btn" onClick={download}>
            Backup herunterladen
          </button>
          <button className="btn ghost" onClick={() => void copy()}>
            Kopieren
          </button>
          <label className="btn ghost" htmlFor="set-import">
            Backup laden
          </label>
          <input id="set-import" type="file" accept="application/json,.json" hidden onChange={(e) => void importFile(e.target.files?.[0])} />
        </div>
        {backupText && (
          <>
            <p className="fine">Download hier nicht möglich – Text markieren und kopieren:</p>
            <textarea id="set-backup-text" readOnly value={backupText} rows={6} onFocus={(e) => e.target.select()} />
          </>
        )}
      </Card>

      <Card title="Alles zurücksetzen" tone="warn">
        {!confirmReset ? (
          <button className="btn ghost" onClick={() => setConfirmReset(true)}>
            Alle Konten und Einstellungen löschen …
          </button>
        ) : (
          <div className="row wrap">
            <span>Wirklich alles löschen? Vorher ein Backup machen.</span>
            <button
              className="btn stop"
              onClick={() => {
                lab.resetAll();
                setConfirmReset(false);
              }}
            >
              Ja, löschen
            </button>
            <button className="btn ghost" onClick={() => setConfirmReset(false)}>
              Abbrechen
            </button>
          </div>
        )}
      </Card>

      <p className="fine center">Trading Strategy Lab v0.1 · nur Simulation, kein echtes Geld, keine API-Schlüssel.</p>
    </div>
  );
}
