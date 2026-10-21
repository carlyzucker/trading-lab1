import { useState } from 'react';
import { probeSources, type ProbeResult } from '../../core/data/probe';
import { MARKETS, PRODUCT_LABEL } from '../../core/data/markets';
import type { Lab } from '../useLab';
import { Badge, Card, Empty, fmtNum, fmtPrice, fmtTime, KV, Source } from '../ui';

export function Markets({ lab }: { lab: Lab }) {
  const { state, discovery } = lab;
  const [probe, setProbe] = useState<ProbeResult[] | null>(null);
  const [probing, setProbing] = useState(false);

  const runProbe = async () => {
    setProbing(true);
    try {
      setProbe(await probeSources(lab.deps.fetch, state.settings.endpoints));
    } finally {
      setProbing(false);
    }
  };

  return (
    <div className="stack">
      <Card title="Instrumente bei Bybit" right={<button className="btn small" onClick={() => void lab.discover()} disabled={!!lab.busy}>{discovery ? 'Neu laden' : 'Laden'}</button>}>
        <p className="fine">
          Die App fragt die echte Instrumentliste von Bybit ab (/v5/market/instruments-info) und ordnet sie zu. Nichts ist fest einprogrammiert: was Bybit nicht öffentlich anbietet, wird als nicht verfügbar
          angezeigt.
        </p>
        {discovery?.errors.map((e) => (
          <p key={e.category} className="error-line">
            Bybit {e.category}: {e.message} <span className="fine">{e.hint}</span>
          </p>
        ))}
        {discovery && <p className="fine">Stand: {fmtTime(discovery.at)}</p>}
      </Card>

      {MARKETS.map((m) => {
        const sel = state.instruments.find((i) => i.marketKey === m.key);
        const cands = discovery?.candidates[m.key] ?? [];
        const q = state.quotes[m.key];
        const spec = sel ? state.specs[sel.symbol] : undefined;
        const basisBps = q?.binance && q?.bybit ? ((q.bybit.last - q.binance.price) / q.binance.price) * 10_000 : undefined;
        const spreadBps = q?.bybit?.bid && q.bybit.ask ? ((q.bybit.ask - q.bybit.bid) / ((q.bybit.ask + q.bybit.bid) / 2)) * 10_000 : undefined;
        return (
          <Card
            key={m.key}
            title={m.label}
            right={sel ? <Badge tone="ok">Simuliert: {sel.symbol}</Badge> : discovery && !discovery.errors.length && !cands.length ? <Badge tone="bad">Nicht verfügbar</Badge> : <Badge>Nicht gewählt</Badge>}
          >
            {sel && (
              <>
                <div className="quote">
                  {q?.bybit ? (
                    <>
                      <div>
                        <div className="fine">Bybit {sel.category === 'linear' ? 'Perpetual' : 'Spot'} · Ausführung</div>
                        <div className="big-num num">{fmtPrice(q.bybit.last)}</div>
                        <Source s={q.bybit.source} />
                      </div>
                      {q.binance && (
                        <div>
                          <div className="fine">Binance Spot · Signale</div>
                          <div className="big-num num">{fmtPrice(q.binance.price)}</div>
                          <Source s={q.binance.source} />
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="fine">Noch kein Kurs. {q?.error ? '' : 'Kurse kommen mit dem nächsten Scan („Jetzt prüfen“ auf Start).'}</p>
                  )}
                </div>
                {q?.error && (
                  <p className="error-line">
                    Kein aktueller Kurs: {q.error.message} <span className="fine">{q.error.hint}</span>
                  </p>
                )}
                <div className="grid2">
                  <KV k="Produkt">{PRODUCT_LABEL[sel.productType]}</KV>
                  <KV k="Signalquelle">{sel.signal.provider === 'binance' ? `Binance Spot ${sel.signal.symbol}` : `Bybit ${sel.signal.symbol} (kein passendes Binance-Instrument)`}</KV>
                  {basisBps !== undefined && <KV k="Bybit vs. Binance">{fmtNum(basisBps, 1)} Basispunkte</KV>}
                  {spreadBps !== undefined && <KV k="Spread Bybit">{fmtNum(spreadBps, 2)} Basispunkte</KV>}
                  {q?.bybit?.mark !== undefined && <KV k="Mark-Preis">{fmtPrice(q.bybit.mark)}</KV>}
                  {q?.bybit?.fundingRate !== undefined && <KV k="Funding (nächste)">{fmtNum(q.bybit.fundingRate * 100, 4)} %</KV>}
                </div>
                {spec && (
                  <details>
                    <summary>Bybit-Handelsbedingungen</summary>
                    <div className="grid2">
                      <KV k="Kontrakttyp">{spec.contractType}</KV>
                      <KV k="Abrechnung">{spec.settleCoin}</KV>
                      <KV k="Mindestmenge">{spec.minOrderQty} {spec.baseCoin}</KV>
                      <KV k="Mengenschritt">{spec.qtyStep}</KV>
                      <KV k="Tick">{spec.tickSize}</KV>
                      <KV k="Min. Positionswert">{spec.minNotionalValue} USDT</KV>
                      <KV k="Kontraktmultiplikator">{spec.contractMultiplier} (1 Kontrakt = 1 {spec.baseCoin})</KV>
                      <KV k="Max. Hebel Bybit">{spec.maxLeverage}x (App: max. {state.settings.maxLeverage}x)</KV>
                      <KV k="Funding-Intervall">{spec.fundingIntervalMin ? `${spec.fundingIntervalMin / 60} h` : '–'}</KV>
                      <KV k="Maintenance Margin">
                        {fmtNum(spec.maintenanceMarginRate * 100, 2)} % {spec.mmrSource === 'annahme' && <Badge tone="warn">Annahme</Badge>}
                      </KV>
                    </div>
                    <Source s={spec.source} />
                  </details>
                )}
                {Object.values(state.accounts).some((a) => a.positions[sel.symbol] || a.pending[sel.symbol]) ? (
                  <p className="fine">Entfernen erst möglich, wenn keine Position und keine Order mehr offen ist.</p>
                ) : (
                  <button className="btn ghost small" onClick={() => lab.commit((s) => (s.instruments = s.instruments.filter((i) => i.marketKey !== m.key)))}>
                    Nicht mehr simulieren
                  </button>
                )}
              </>
            )}

            {discovery && !discovery.errors.length && cands.length === 0 && (
              <p>
                Bybit bietet für {m.label} über die öffentliche V5-API kein passendes USDT-Instrument an. Es wird <b>kein</b> Paper-Trade erzeugt.
                {m.assetClass === 'metall' && ' CFDs aus Bybits separatem MT5-Konto sind über diese API nicht zugänglich und werden bewusst nicht verwendet.'}
              </p>
            )}
            {cands.length > 0 && (
              <div className="cands">
                {cands.map((c) => (
                  <div key={c.symbol + c.category} className={`cand${sel?.symbol === c.symbol ? ' active' : ''}`}>
                    <div>
                      <b>{c.symbol}</b> <span className="fine">{c.category}</span> {c.recommended ? <Badge tone="accent">Empfohlen</Badge> : <Badge tone="warn">Nur auf ausdrücklichen Wunsch</Badge>}
                      <div className="fine">{c.label}</div>
                    </div>
                    {sel?.symbol !== c.symbol && (
                      <button className="btn small" onClick={() => void lab.choose(c)} disabled={!!lab.busy}>
                        Wählen
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
            {!discovery && !sel && <Empty>Instrumentliste oben laden.</Empty>}
          </Card>
        );
      })}

      <Card title="Datenquellen prüfen" right={<button className="btn small" onClick={() => void runProbe()} disabled={probing}>{probing ? 'Prüfe …' : 'Prüfen'}</button>}>
        <p className="fine">Ruft jede benötigte öffentliche Schnittstelle einmal auf und zeigt das echte Ergebnis.</p>
        {probe && (
          <ul className="probe">
            {probe.map((r) => (
              <li key={r.name}>
                <Badge tone={r.ok ? 'ok' : 'bad'}>{r.ok ? 'OK' : 'Fehler'}</Badge> <b>{r.name}</b> <span className="num">{r.detail}</span>
                {r.hint && <div className="fine">{r.hint}</div>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
