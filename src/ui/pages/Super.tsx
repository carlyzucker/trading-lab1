import { superComponents } from '../../core/live';
import { STRATEGIES } from '../../core/strategies/registry';
import type { Lab } from '../useLab';
import { Badge, Card, Empty, fmtDate, fmtNum, KV, Side, Toggle } from '../ui';

export function Super({ lab }: { lab: Lab }) {
  const { state } = lab;
  const cfg = state.settings.superConfig;
  const comps = superComponents(state);
  const enabled = STRATEGIES.filter((s) => state.strategies[s.id]?.enabled);
  const setCfg = (k: keyof typeof cfg, v: number | boolean) => lab.commit((s) => ((s.settings.superConfig as unknown as Record<string, number | boolean>)[k] = v));
  const groups = new Set(comps.map((c) => c.group));

  return (
    <div className="stack">
      <Card title="Signalkonsens je Instrument">
        {Object.keys(state.consensus).length === 0 && <Empty>Erscheint nach dem ersten Scan mit neuen Kerzen.</Empty>}
        {Object.entries(state.consensus).map(([sym, c]) => (
          <div key={sym} className="consensus">
            <div className="row wrap">
              <b>{sym}</b> <span className="fine">Kerze {fmtDate(c.t)}</span>
              <span className="push">{c.decision ? <Side side={c.decision} /> : <Badge>Kein Trade</Badge>}</span>
            </div>
            <div className="table-wrap">
              <table>
                <tbody>
                  {enabled.map((s) => {
                    const v = c.votes.find((x) => x.strategyId === s.id);
                    return (
                      <tr key={s.id}>
                        <td>
                          {s.name} {s.kind === 'demo' && <Badge tone="warn">DEMO</Badge>}
                        </td>
                        <td className="r">{v ? <Side side={v.side} /> : <span className="fine">neutral</span>}</td>
                        <td className="r fine">{v ? (v.ageBars === 0 ? 'jetzt' : `vor ${v.ageBars} Kerze(n)`) : ''}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="fine">{c.explanation}</p>
          </div>
        ))}
      </Card>

      <Card title="Regeln der Superstrategie">
        <div className="grid2">
          <KV k="Teilnehmende Strategien">{comps.length ? comps.map((c) => c.def.name).join(', ') : 'keine'}</KV>
          <KV k="Unabhängige Gruppen">{groups.size}</KV>
          <KV k="Gewichtung">{state.superWeights.origin}</KV>
        </div>
        {groups.size < cfg.minAgreeingGroups && (
          <p className="hint">
            Die Superstrategie braucht mindestens {cfg.minAgreeingGroups} unabhängige Strategiegruppen. Aktuell sind es {groups.size} – sie wird deshalb keine Trades eröffnen. Das ist in v0.1 mit
            nur einer echten Strategie zu erwarten.
          </p>
        )}
        <div className="form">
          <label htmlFor="s-min">Mindestens zustimmende Gruppen</label>
          <input id="s-min" type="number" min={1} max={10} value={cfg.minAgreeingGroups} onChange={(e) => setCfg('minAgreeingGroups', Math.max(1, parseInt(e.target.value, 10) || 1))} />
          <label htmlFor="s-mem">Signal-Gedächtnis (Kerzen)</label>
          <input id="s-mem" type="number" min={1} max={20} value={cfg.memoryBars} onChange={(e) => setCfg('memoryBars', Math.max(1, parseInt(e.target.value, 10) || 1))} />
          <label htmlFor="s-score">Mindest-Score (0–1)</label>
          <input id="s-score" type="number" min={0} max={1} step={0.05} value={cfg.minScore} onChange={(e) => setCfg('minScore', Math.min(1, Math.max(0, parseFloat(e.target.value) || 0)))} />
        </div>
        <Toggle id="s-veto" checked={cfg.vetoOnConflict} onChange={(v) => setCfg('vetoOnConflict', v)} label="Gegensignal blockiert den Trade" />
        <Toggle
          id="s-demo"
          checked={state.settings.superAllowDemo}
          onChange={(v) => lab.commit((s) => (s.settings.superAllowDemo = v))}
          label="DEMO-Strategien zulassen (nur zur Funktionsprüfung)"
        />
        <p className="fine">
          Ähnliche Strategien werden in Gruppen zusammengefasst und zählen nur einmal (Schutz vor Doppelzählung). Gruppen und Gewichte entstehen per Walk-Forward im Backtest – nie aus den Daten, auf
          denen danach gemessen wird.
        </p>
        {Object.keys(state.superWeights.weights).length > 0 && (
          <div className="grid2">
            {Object.entries(state.superWeights.weights).map(([id, w]) => (
              <KV key={id} k={id}>
                Gewicht {fmtNum(w, 3)} · Gruppe {state.superWeights.groups[id]}
              </KV>
            ))}
          </div>
        )}
        {Object.keys(state.superWeights.weights).length > 0 && (
          <button className="btn ghost small" onClick={() => lab.commit((s) => (s.superWeights = { weights: {}, groups: {}, origin: 'Gleichgewichtung (Standard)' }))}>
            Zurück auf Gleichgewichtung
          </button>
        )}
      </Card>

      <Card title="Machine Learning" right={<Badge tone="bad">Gesperrt</Badge>}>
        <p>
          ML bleibt ausgeschaltet, bis unabhängige Out-of-Sample-Tests über mehrere Zeiträume und Instrumente bestanden sind. v0.1 enthält bewusst keinen ML-Code, damit nichts versehentlich auf
          Vergangenheitsdaten überangepasst wird.
        </p>
      </Card>
    </div>
  );
}
