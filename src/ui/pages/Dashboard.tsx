import { accountEquity, unrealized } from '../../core/account';
import { SUPER_ID } from '../../core/live';
import { getTimeframe } from '../../core/timeframes';
import type { Lab } from '../useLab';
import { ago, Badge, Card, Empty, fmtDate, fmtNum, fmtPrice, fmtTime, KV, Pnl, Side, Sparkline, toChf } from '../ui';

export function Dashboard({ lab, go }: { lab: Lab; go: (tab: string) => void }) {
  const { state } = lab;
  const prices: Record<string, number> = {};
  for (const i of state.instruments) {
    const q = state.quotes[i.marketKey]?.bybit;
    if (q) prices[i.symbol] = q.mark ?? q.last;
  }
  const accs = Object.values(state.accounts);
  const sup = state.accounts[SUPER_ID];
  const open = accs.flatMap((a) => Object.values(a.positions).map((p) => ({ a, p })));
  const enabled = state.instruments.filter((i) => i.enabled);
  const running = state.live.running;
  const paused = running && !lab.visible;
  const okAge = state.live.lastScanOkAt ? Date.now() - state.live.lastScanOkAt : Infinity;
  const dataStatus = !state.live.lastScanAt
    ? { tone: 'plain' as const, text: 'Noch nicht geprüft' }
    : okAge < 3 * state.settings.scanIntervalSec * 1000
      ? { tone: 'ok' as const, text: 'Aktuell' }
      : { tone: 'bad' as const, text: 'Fehler / veraltet' };

  return (
    <div className="stack">
      {lab.resumeInfo && <Card tone="info">{lab.resumeInfo}</Card>}
      {!state.fx && (
        <Card tone="warn" title="Keine Verbindung zu den Datenquellen">
          <p>
            Ohne Zugriff auf Binance, Bybit und den EZB-Kurs kann die App nicht rechnen und zeigt bewusst keine Kurse. In der Claude-Vorschau sind solche Abfragen gesperrt – auf deiner eigenen
            Webadresse (siehe README) funktioniert es. Prüfen unter Märkte → Datenquellen prüfen.
          </p>
        </Card>
      )}

      {state.live.gaps.length > 0 && (
        <Card tone="warn" title="Datenlücke erkannt">
          <p>Während dieser Zeit lief keine Simulation. Wähle pro Instrument, wie es weitergeht:</p>
          {state.live.gaps.map((g) => (
            <div key={g.symbol} className="gap">
              <div>
                <b>{g.symbol}</b>: {g.bars} Kerzen ({fmtDate(g.fromT)} → {fmtDate(g.toT)})
              </div>
              <div className="row">
                <button className="btn" onClick={() => void lab.replayGap(g.symbol)} disabled={!!lab.busy}>
                  Nachrechnen
                </button>
                <button className="btn ghost" onClick={() => lab.skip(g.symbol)}>
                  Überspringen
                </button>
              </div>
              <p className="fine">
                Nachrechnen verwendet die echten historischen Kerzen mit exakt denselben Regeln; solche Trades sind im Journal als „nachgerechnet“ markiert. Überspringen schliesst offene Positionen dieses
                Instruments zum aktuellen Bybit-Kurs.
              </p>
            </div>
          ))}
        </Card>
      )}

      <Card
        title="Bot"
        right={
          <Badge tone={paused ? 'warn' : running ? 'ok' : 'plain'}>{paused ? 'Pausiert (Hintergrund)' : running ? 'Läuft' : 'Gestoppt'}</Badge>
        }
      >
        <div className="bot-row">
          <button className={`btn big ${running ? 'stop' : ''}`} onClick={() => lab.setRunning(!running)} disabled={!enabled.length}>
            {running ? 'Bot stoppen' : 'Bot starten'}
          </button>
          <button className="btn ghost" onClick={() => void lab.scanNow()} disabled={!!lab.busy}>
            Jetzt prüfen
          </button>
        </div>
        {!enabled.length && (
          <p className="hint">
            Noch kein Instrument gewählt. <button className="link" onClick={() => go('markets')}>Märkte öffnen</button>
          </p>
        )}
        <div className="grid2">
          <KV k="Marktdaten">
            <Badge tone={dataStatus.tone}>{dataStatus.text}</Badge>
          </KV>
          <KV k="Letzte Prüfung">{state.live.lastScanAt ? `${fmtTime(state.live.lastScanAt)} (${ago(state.live.lastScanAt)})` : '–'}</KV>
          <KV k="Zeitrahmen">{getTimeframe(state.settings.timeframe).label}</KV>
          <KV k="Scan-Takt">alle {state.settings.scanIntervalSec} s</KV>
          <KV k="Instrumente">{enabled.map((i) => i.symbol).join(', ') || '–'}</KV>
          <KV k="Speicher">{lab.storage === 'indexeddb' ? 'Lokal (IndexedDB)' : 'Nur Arbeitsspeicher – geht beim Schliessen verloren'}</KV>
        </div>
        {paused && <p className="hint">Android hält Webseiten im Hintergrund an. Solange die App nicht sichtbar ist, wird nichts simuliert.</p>}
        {state.live.lastErrors.length > 0 && state.live.lastErrors[0].at === state.live.lastScanAt && (
          <div className="errors">
            {state.live.lastErrors
              .filter((e) => e.at === state.live.lastScanAt)
              .slice(0, 4)
              .map((e, i) => (
                <p key={i}>
                  <b>{e.symbol ? e.symbol + ': ' : ''}</b>
                  {e.message}
                  {e.hint && <span className="fine"> {e.hint}</span>}
                </p>
              ))}
          </div>
        )}
      </Card>

      <Card title="Superstrategie-Portfolio" right={sup && <span className="fine">{state.accountMeta[SUPER_ID] ? `Start ${fmtNum(state.accountMeta[SUPER_ID].startChf, 0)} CHF` : ''}</span>}>
        {sup ? <AccountSummary lab={lab} id={SUPER_ID} prices={prices} /> : <Empty>Konten werden angelegt, sobald der CHF/USD-Kurs abrufbar ist.</Empty>}
      </Card>

      <Card title="Vergleichskonten je Strategie">
        {accs.filter((a) => a.id !== SUPER_ID).length === 0 && <Empty>Noch keine Konten (Wechselkurs fehlt).</Empty>}
        <div className="acc-list">
          {accs
            .filter((a) => a.id !== SUPER_ID)
            .map((a) => (
              <AccountSummary key={a.id} lab={lab} id={a.id} prices={prices} compact />
            ))}
        </div>
      </Card>

      <Card title={`Offene simulierte Positionen (${open.length})`}>
        {open.length === 0 ? (
          <Empty>Keine offenen Positionen.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Konto</th>
                  <th>Instrument</th>
                  <th className="r">Menge</th>
                  <th className="r">Einstieg</th>
                  <th className="r">Stop</th>
                  <th className="r">Unreal. USDT</th>
                </tr>
              </thead>
              <tbody>
                {open.map(({ a, p }) => {
                  const px = prices[p.symbol] ?? p.lastMark;
                  return (
                    <tr key={a.id + p.symbol}>
                      <td>{a.id === SUPER_ID ? 'Super' : a.name.split(' – ')[0]}</td>
                      <td>
                        <Side side={p.side} /> {p.symbol} {p.leverage}x
                      </td>
                      <td className="r num">{p.qty}</td>
                      <td className="r num">{fmtPrice(p.entryAvg)}</td>
                      <td className="r num">{fmtPrice(p.stop)}</td>
                      <td className="r">
                        <Pnl v={unrealized(p, px)} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="fine">Bewertung zum Bybit-Mark-Preis des letzten Scans.</p>
      </Card>
    </div>
  );
}

function AccountSummary({ lab, id, prices, compact }: { lab: Lab; id: string; prices: Record<string, number>; compact?: boolean }) {
  const { state } = lab;
  const a = state.accounts[id];
  const meta = state.accountMeta[id];
  if (!a) return null;
  const eq = accountEquity(a, prices);
  const pnl = eq - a.startBalance;
  const pct = (pnl / a.startBalance) * 100;
  const openN = Object.keys(a.positions).length;
  return (
    <div className={compact ? 'acc compact' : 'acc'}>
      {compact && (
        <div className="acc-name">
          {a.name} <span className="fine">{a.trades.length} Trades · {openN} offen</span>
        </div>
      )}
      <div className="acc-figs">
        <div>
          <div className="big-num num">{fmtNum(toChf(state, eq))} CHF</div>
          <div className="fine num">
            {fmtNum(eq)} USDT · Start {fmtNum(a.startBalance)} USDT ({meta ? fmtNum(meta.startChf, 0) : '–'} CHF zu {meta ? fmtNum(meta.usdPerChfAtStart, 4) : '–'})
          </div>
        </div>
        <div className="r">
          <Pnl v={pct} unit="%" />
          <div className="fine">
            <Pnl v={pnl} /> USDT
          </div>
        </div>
      </div>
      {!compact && <Sparkline points={a.equity} base={a.startBalance} />}
      {!compact && (
        <p className="fine">
          {a.trades.length} abgeschlossene Trades · {openN} offen · Gebühren {fmtNum(a.fees)} USDT · Funding {fmtNum(a.funding)} USDT
        </p>
      )}
    </div>
  );
}
