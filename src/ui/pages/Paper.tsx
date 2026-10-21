import { useState } from 'react';
import { accountEquity, unrealized } from '../../core/account';
import { computeMetrics } from '../../core/metrics';
import { SUPER_ID } from '../../core/live';
import type { Lab } from '../useLab';
import { Badge, Card, Empty, fmtDate, fmtNum, fmtPrice, KV, Pnl, Side, Sparkline, toChf } from '../ui';

export function Paper({ lab }: { lab: Lab }) {
  const { state } = lab;
  const ids = Object.keys(state.accounts).sort((a, b) => (a === SUPER_ID ? -1 : b === SUPER_ID ? 1 : a.localeCompare(b)));
  const [sel, setSel] = useState(ids[0] ?? '');
  const [filter, setFilter] = useState<'alle' | 'trades' | 'hinweise'>('alle');
  const acc = state.accounts[sel] ?? state.accounts[ids[0]];
  if (!acc) return <Empty>Noch keine Konten. Sie werden angelegt, sobald der CHF/USD-Kurs abrufbar ist.</Empty>;

  const prices: Record<string, number> = {};
  for (const i of state.instruments) {
    const q = state.quotes[i.marketKey]?.bybit;
    if (q) prices[i.symbol] = q.mark ?? q.last;
  }
  const eq = accountEquity(acc, prices);
  const m = computeMetrics(acc);
  const journal = [...acc.journal].reverse().filter((j) => (filter === 'alle' ? true : filter === 'trades' ? j.level === 'trade' : j.level !== 'trade')).slice(0, 200);

  return (
    <div className="stack">
      <div className="chips" role="tablist" aria-label="Konto">
        {ids.map((id) => (
          <button key={id} role="tab" aria-selected={id === acc.id} className={`chip${id === acc.id ? ' on' : ''}`} onClick={() => setSel(id)}>
            {id === SUPER_ID ? 'Superstrategie' : state.accounts[id].name.replace(/^001 – /, '')}
          </button>
        ))}
      </div>

      <Card title={acc.name} right={<Pnl v={((eq - acc.startBalance) / acc.startBalance) * 100} unit="%" />}>
        <div className="grid2">
          <KV k="Kapital">
            {fmtNum(toChf(state, eq))} CHF · {fmtNum(eq)} USDT
          </KV>
          <KV k="Realisiert">
            <Pnl v={acc.balance - acc.startBalance} /> USDT
          </KV>
          <KV k="Trades / Gewinnquote">
            {m.trades} / {fmtNum(m.winRatePct, 0)} %
          </KV>
          <KV k="Profit Factor">{fmtNum(m.profitFactor)}</KV>
          <KV k="Max. Drawdown">{fmtNum(m.maxDrawdownPct)} %</KV>
          <KV k="Gebühren / Funding">
            {fmtNum(acc.fees)} / {fmtNum(acc.funding)} USDT
          </KV>
        </div>
        <Sparkline points={acc.equity} base={acc.startBalance} />
        {m.replayTrades > 0 && <p className="fine">{m.replayTrades} Trades stammen aus nachgerechneten Lücken.</p>}
      </Card>

      <Card title="Offene Positionen">
        {Object.values(acc.positions).length === 0 && Object.values(acc.pending).length === 0 && <Empty>Keine.</Empty>}
        {Object.values(acc.positions).map((p) => (
          <div key={p.symbol} className="position">
            <div className="row wrap">
              <Side side={p.side} /> <b>{p.symbol}</b> <Badge>{p.leverage}x isoliert</Badge> {p.replay && <Badge tone="warn">nachgerechnet</Badge>}
              <span className="push">
                <Pnl v={unrealized(p, prices[p.symbol] ?? p.lastMark)} /> USDT
              </span>
            </div>
            <div className="grid2">
              <KV k="Menge">{p.qty}</KV>
              <KV k="Ø Einstieg">{fmtPrice(p.entryAvg)}</KV>
              <KV k="Stop">{fmtPrice(p.stop)}{p.stop !== p.initialStop ? ' (nachgezogen)' : ''}</KV>
              <KV k="Ziele">{p.targets.map((t) => `${fmtPrice(t.price)}${t.hit ? ' ✓' : ''}`).join(' · ')}</KV>
              <KV k="Liquidation">{p.liqPrice ? fmtPrice(p.liqPrice) : '–'}</KV>
              <KV k="Margin">{fmtNum(p.margin)} USDT</KV>
              <KV k="Geplantes Risiko">{fmtNum(p.plannedRisk)} USDT</KV>
              <KV k="Eröffnet">{fmtDate(p.openedT)}</KV>
            </div>
            <p className="fine">{p.reason}</p>
          </div>
        ))}
        {Object.values(acc.pending).map((o) => (
          <div key={o.symbol} className="position pending">
            <Badge tone="accent">Order offen</Badge> <Side side={o.side} /> {o.symbol}: {o.tranches.map((t) => (t.kind === 'market' ? 'Market' : `Limit ${fmtPrice(t.price)}`)).join(' + ')} · Stop {fmtPrice(o.stop)}
          </div>
        ))}
      </Card>

      <Card title={`Abgeschlossene Trades (${acc.trades.length})`}>
        {acc.trades.length === 0 ? (
          <Empty>Noch keine.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Geschlossen</th>
                  <th>Trade</th>
                  <th className="r">Netto USDT</th>
                  <th className="r">R</th>
                  <th>Ausstieg</th>
                </tr>
              </thead>
              <tbody>
                {[...acc.trades].reverse().slice(0, 100).map((t) => (
                  <tr key={t.id}>
                    <td>{fmtDate(t.closedT)}</td>
                    <td>
                      <Side side={t.side} /> {t.symbol} {t.replay && <Badge tone="warn">N</Badge>}
                    </td>
                    <td className="r">
                      <Pnl v={t.net} />
                    </td>
                    <td className="r num">{fmtNum(t.r)}</td>
                    <td>{t.exitReason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card
        title="Trading-Journal"
        right={
          <select id="jf" aria-label="Filter" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
            <option value="alle">Alle</option>
            <option value="trades">Nur Trades</option>
            <option value="hinweise">Signale & Hinweise</option>
          </select>
        }
      >
        {journal.length === 0 ? (
          <Empty>Leer.</Empty>
        ) : (
          <ul className="journal">
            {journal.map((j, i) => (
              <li key={i} className={`j-${j.level}`}>
                <span className="fine num">{fmtDate(j.t)}</span> <b>{j.symbol}</b> {j.text} {j.replay && <Badge tone="warn">nachgerechnet</Badge>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
