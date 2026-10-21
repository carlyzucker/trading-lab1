import { useState } from 'react';
import { STRATEGIES } from '../../core/strategies/registry';
import type { Params, StrategyDef } from '../../core/strategies/types';
import type { Lab } from '../useLab';
import { Badge, Card, fmtDate, Toggle } from '../ui';

const KIND: Record<StrategyDef['kind'], { label: string; tone: 'warn' | 'accent' | 'ok' | 'plain' }> = {
  demo: { label: 'DEMO – nur Engine-Prüfung', tone: 'warn' },
  experimental: { label: 'Experimentell', tone: 'accent' },
  validated: { label: 'Validiert', tone: 'ok' },
  meta: { label: 'Meta', tone: 'plain' },
};

export function Strategies({ lab }: { lab: Lab }) {
  return (
    <div className="stack">
      <p className="lead">Jede Strategie hat ein eigenes virtuelles Vergleichskonto. Neue Strategien kommen als eigene Datei in die Bibliothek.</p>
      {STRATEGIES.map((def) => (
        <StrategyCard key={def.id} lab={lab} def={def} />
      ))}
    </div>
  );
}

function StrategyCard({ lab, def }: { lab: Lab; def: StrategyDef }) {
  const st = lab.state.strategies[def.id];
  const meta = lab.state.accountMeta[def.id];
  const [draft, setDraft] = useState<Params>({ ...st.params });
  const [open, setOpen] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(st.params);
  const mismatch = meta && (meta.strategyConfigVersion !== st.configVersion || meta.strategyCodeVersion !== def.version);
  const acc = lab.state.accounts[def.id];
  const hasOpen = acc && (Object.keys(acc.positions).length > 0 || Object.keys(acc.pending).length > 0);

  const save = () =>
    lab.commit((s) => {
      const x = s.strategies[def.id];
      x.configVersion++;
      x.params = { ...draft };
      x.history.push({ configVersion: x.configVersion, codeVersion: def.version, params: { ...draft }, changedAt: Date.now() });
    });

  return (
    <Card
      title={def.name}
      right={<Toggle id={`en-${def.id}`} checked={st.enabled} onChange={(v) => lab.commit((s) => (s.strategies[def.id].enabled = v))} label={st.enabled ? 'Aktiv' : 'Aus'} />}
    >
      <div className="row wrap">
        <Badge tone={KIND[def.kind].tone}>{KIND[def.kind].label}</Badge>
        <Badge>Code v{def.version}</Badge>
        <Badge>Einstellungen v{st.configVersion}</Badge>
      </div>
      <p>{def.description}</p>
      {def.source && (
        <p className="fine">
          Referenz:{' '}
          <a href={def.source} target="_blank" rel="noreferrer">
            {def.source}
          </a>
        </p>
      )}
      {!st.enabled && hasOpen && <p className="hint">Deaktiviert: keine neuen Signale, offene Positionen werden aber weiter mit Stop/Ziel verwaltet.</p>}
      {mismatch && (
        <div className="hint">
          Das Vergleichskonto läuft seit {fmtDate(meta.createdAt)} mit Einstellungen v{meta.strategyConfigVersion} (Code v{meta.strategyCodeVersion}). Für saubere Vergleichbarkeit Konto neu starten.
          {!confirmReset ? (
            <button className="btn small ghost" onClick={() => setConfirmReset(true)}>
              Konto neu starten …
            </button>
          ) : (
            <div className="row">
              <span>Alle Trades dieses Kontos löschen?</span>
              <button
                className="btn small stop"
                onClick={() => {
                  try {
                    lab.resetAcc(def.id);
                  } catch (e) {
                    lab.notify((e as Error).message);
                  }
                  setConfirmReset(false);
                }}
              >
                Ja, neu starten
              </button>
              <button className="btn small ghost" onClick={() => setConfirmReset(false)}>
                Abbrechen
              </button>
            </div>
          )}
        </div>
      )}
      <button className="btn ghost small" onClick={() => setOpen(!open)} aria-expanded={open}>
        {open ? 'Einstellungen schliessen' : 'Einstellungen & Annahmen'}
      </button>
      {open && (
        <div className="params">
          <h3>Annahmen</h3>
          <ul className="assumptions">
            {def.assumptions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
          <h3>Parameter</h3>
          {def.params.map((p) => (
            <div key={p.key} className="param">
              <label htmlFor={`p-${def.id}-${p.key}`}>
                {p.label} {p.assumption && <Badge tone="warn">Annahme</Badge>}
                {p.help && <span className="fine"> {p.help}</span>}
              </label>
              {p.type === 'bool' ? (
                <input id={`p-${def.id}-${p.key}`} type="checkbox" checked={!!draft[p.key]} onChange={(e) => setDraft({ ...draft, [p.key]: e.target.checked })} />
              ) : (
                <input
                  id={`p-${def.id}-${p.key}`}
                  type="number"
                  inputMode="decimal"
                  min={p.min}
                  max={p.max}
                  step={p.step}
                  value={String(draft[p.key])}
                  onChange={(e) => {
                    const v = p.type === 'int' ? parseInt(e.target.value, 10) : parseFloat(e.target.value);
                    if (Number.isFinite(v)) setDraft({ ...draft, [p.key]: Math.min(p.max ?? v, Math.max(p.min ?? v, v)) });
                  }}
                />
              )}
            </div>
          ))}
          <div className="row">
            <button className="btn" disabled={!dirty} onClick={save}>
              Als v{st.configVersion + 1} speichern
            </button>
            <button className="btn ghost" onClick={() => setDraft({ ...def.defaults })}>
              Standardwerte
            </button>
          </div>
          <details>
            <summary>Versionsverlauf ({st.history.length})</summary>
            <ul className="history">
              {[...st.history].reverse().map((h) => (
                <li key={h.configVersion}>
                  v{h.configVersion} · Code {h.codeVersion} · {fmtDate(h.changedAt)}
                  <code>{JSON.stringify(h.params)}</code>
                </li>
              ))}
            </ul>
            <p className="fine">Code-Änderungen: {def.changelog.map((c) => `${c.version}: ${c.note}`).join(' · ')}</p>
          </details>
        </div>
      )}
    </Card>
  );
}
