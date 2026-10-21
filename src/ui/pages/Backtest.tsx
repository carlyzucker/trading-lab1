import { useState } from 'react';
import type { MarketData } from '../../core/backtest';
import { binanceHistory } from '../../core/data/binance';
import { bybitFundingHistory, bybitHistory } from '../../core/data/bybit';
import { describeError } from '../../core/data/http';
import type { JobResult, StrategyRunSummary } from '../../core/jobs';
import { superComponents } from '../../core/live';
import { accountConfig } from '../../core/state';
import { STRATEGIES } from '../../core/strategies/registry';
import { TIMEFRAMES, getTimeframe } from '../../core/timeframes';
import { lastJobRunner, runJobAsync } from '../runJob';
import type { Lab } from '../useLab';
import { Badge, Card, Empty, fmtDate, fmtNum, fmtPrice, KV, Pnl, Side, Source, Sparkline, toChf } from '../ui';

const COUNTS = [500, 1000, 2000, 5000, 10000, 20000];
const cache = new Map<string, MarketData>();

export function Backtest({ lab }: { lab: Lab }) {
  const { state } = lab;
  const insts = state.instruments.filter((i) => state.specs[i.symbol]);
  const [symbols, setSymbols] = useState<string[]>(insts.slice(0, 1).map((i) => i.symbol));
  const [tf, setTf] = useState(state.settings.timeframe);
  const [count, setCount] = useState(2000);
  const [mode, setMode] = useState<'compare' | 'walkforward'>('compare');
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<{ message: string; hint: string } | null>(null);
  const [result, setResult] = useState<JobResult | null>(null);
  const activeIds = STRATEGIES.filter((s) => state.strategies[s.id]?.enabled).map((s) => s.id);

  const load = async (): Promise<MarketData[]> => {
    const now = Date.now();
    const ep = state.settings.endpoints;
    const out: MarketData[] = [];
    for (const sym of symbols) {
      const inst = state.instruments.find((i) => i.symbol === sym)!;
      const key = `${sym}|${tf}|${count}`;
      const hit = cache.get(key);
      if (hit && now - hit.execSource.fetchedAt < 10 * 60_000) {
        out.push(hit);
        continue;
      }
      const tag = (what: string) => (n: number) => setProgress(`${sym}: ${what} ${n}/${count}`);
      const sig =
        inst.signal.provider === 'binance'
          ? await binanceHistory(lab.deps.fetch, ep, inst.signal.symbol, tf, count, now, tag('Binance-Kerzen'))
          : await bybitHistory(lab.deps.fetch, ep, 'kline', inst.signal.category ?? inst.category, inst.signal.symbol, tf, count, now, tag('Signalkerzen'));
      const exec = await bybitHistory(lab.deps.fetch, ep, 'kline', inst.category, sym, tf, count, now, tag('Bybit-Kerzen'));
      const mark = inst.category === 'linear' ? await bybitHistory(lab.deps.fetch, ep, 'mark-price-kline', 'linear', sym, tf, count, now, tag('Bybit-Mark-Preis')) : null;
      let funding: { events: { t: number; rate: number }[]; source?: MarketData['fundingSource'] } = { events: [] };
      if (inst.category === 'linear' && exec.bars.length) {
        setProgress(`${sym}: Funding-Historie`);
        funding = await bybitFundingHistory(lab.deps.fetch, ep, sym, exec.bars[0].t, now);
      }
      const md: MarketData = {
        key: inst.marketKey,
        execSymbol: sym,
        spec: state.specs[sym],
        signalBars: sig.bars,
        signalSource: sig.source,
        execBars: exec.bars,
        execSource: exec.source,
        markBars: mark?.bars,
        markSource: mark?.source,
        funding: funding.events,
        fundingSource: funding.source,
      };
      cache.set(key, md);
      out.push(md);
    }
    return out;
  };

  const run = async () => {
    setError(null);
    setResult(null);
    if (!state.fx) {
      setError({ message: 'Kein CHF/USD-Kurs', hint: 'Startkapital kann ohne echten Wechselkurs nicht in USDT umgerechnet werden.' });
      return;
    }
    try {
      setProgress('Lade historische Kurse …');
      const markets = await load();
      setProgress(`Rechne Backtest (${markets.reduce((a, m) => a + m.execBars.length, 0)} Kerzen) …`);
      const r = await runJobAsync({
        mode,
        strategyIds: activeIds,
        params: Object.fromEntries(activeIds.map((id) => [id, state.strategies[id].params])),
        includeSuper: true,
        superGroups: state.superWeights.groups,
        superIds: superComponents(state).map((c) => c.def.id),
        superConfig: state.settings.superConfig,
        markets,
        barMs: getTimeframe(tf).ms,
        cfg: accountConfig(state.settings),
        startBalance: Number((state.settings.startCapitalChf * state.fx.usdPerChf).toFixed(2)),
      });
      setResult(r);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setProgress(null);
    }
  };

  if (!insts.length)
    return (
      <Card title="Backtest">
        <Empty>Zuerst unter „Märkte“ ein Bybit-Instrument wählen. Backtests laufen nur mit echten historischen Kursen.</Empty>
      </Card>
    );

  return (
    <div className="stack">
      <Card title="Backtest einrichten">
        <div className="form">
          <fieldset>
            <legend>Instrumente</legend>
            {insts.map((i) => (
              <label key={i.symbol} className="check">
                <input
                  type="checkbox"
                  id={`bt-${i.symbol}`}
                  checked={symbols.includes(i.symbol)}
                  onChange={(e) => setSymbols(e.target.checked ? [...symbols, i.symbol] : symbols.filter((x) => x !== i.symbol))}
                />
                {i.symbol}
              </label>
            ))}
          </fieldset>
          <label htmlFor="bt-tf">Zeitrahmen</label>
          <select id="bt-tf" value={tf} onChange={(e) => setTf(e.target.value)}>
            {TIMEFRAMES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
          <label htmlFor="bt-n">Anzahl Kerzen</label>
          <select id="bt-n" value={count} onChange={(e) => setCount(Number(e.target.value))}>
            {COUNTS.map((c) => (
              <option key={c} value={c}>
                {c.toLocaleString('de-CH')} ({fmtNum((c * getTimeframe(tf).ms) / 86_400_000, 1)} Tage)
              </option>
            ))}
          </select>
          <fieldset>
            <legend>Art</legend>
            <label className="check">
              <input type="radio" id="bt-mode-c" checked={mode === 'compare'} onChange={() => setMode('compare')} /> Strategievergleich (+ Superstrategie, gleich gewichtet)
            </label>
            <label className="check">
              <input type="radio" id="bt-mode-w" checked={mode === 'walkforward'} onChange={() => setMode('walkforward')} /> Superstrategie Walk-Forward (60 % Training, 40 % unabhängiger Test)
            </label>
          </fieldset>
        </div>
        <div className="grid2">
          <KV k="Startkapital">{state.fx ? `${state.settings.startCapitalChf} CHF = ${fmtNum(state.settings.startCapitalChf * state.fx.usdPerChf)} USDT` : 'Wechselkurs fehlt'}</KV>
          <KV k="Risiko / Hebel">
            {state.settings.riskPct * 100} % je Trade · {state.settings.leverage}x
          </KV>
          <KV k="Gebühren">{state.settings.fees.linear.label}</KV>
          <KV k="Slippage">
            {state.settings.slippageBps} Basispunkte <Badge tone="warn">Annahme</Badge>
          </KV>
          <KV k="Aktive Strategien">{activeIds.length}</KV>
        </div>
        <button className="btn big" onClick={() => void run()} disabled={!!progress || !symbols.length || !activeIds.length}>
          {progress ? 'Läuft …' : 'Kurse laden & testen'}
        </button>
        {progress && <p className="fine">{progress}</p>}
        {error && (
          <p className="error-line">
            {error.message} <span className="fine">{error.hint}</span>
          </p>
        )}
      </Card>

      {result && result.runs.length > 0 && <Comparison runs={result.runs} lab={lab} />}
      {result?.walkForward && <WalkForward wf={result.walkForward} lab={lab} />}
      {result && <p className="fine">Rechenzeit {fmtNum(result.durationMs / 1000, 1)} s · berechnet im {lastJobRunner === 'web-worker' ? 'Web Worker' : 'Hauptthread'}.</p>}
    </div>
  );
}

function Comparison({ runs, lab }: { runs: StrategyRunSummary[]; lab: Lab }) {
  return (
    <>
      <Card title="Strategievergleich">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Strategie</th>
                <th className="r">Rendite</th>
                <th className="r">Max. DD</th>
                <th className="r">Trades</th>
                <th className="r">Gewinnq.</th>
                <th className="r">PF</th>
                <th className="r">Ø R</th>
                <th className="r">Gebühren</th>
                <th className="r">Funding</th>
                <th className="r">Ø Risiko</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td>
                    {r.name} {r.kind === 'demo' && <Badge tone="warn">DEMO</Badge>}
                  </td>
                  <td className="r">
                    <Pnl v={r.metrics.totalReturnPct} unit="%" />
                  </td>
                  <td className="r num">{fmtNum(r.metrics.maxDrawdownPct)} %</td>
                  <td className="r num">{r.metrics.trades}</td>
                  <td className="r num">{fmtNum(r.metrics.winRatePct, 0)} %</td>
                  <td className="r num">{fmtNum(r.metrics.profitFactor)}</td>
                  <td className="r num">{fmtNum(r.metrics.avgR)}</td>
                  <td className="r num">{fmtNum(r.metrics.fees)}</td>
                  <td className="r num">{fmtNum(r.metrics.funding)}</td>
                  <td className="r num">{fmtNum(r.metrics.avgPlannedRiskPct)} %</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="fine">Beträge in USDT. Wenige Trades sind statistisch nicht aussagekräftig. Ein Backtest auf einem einzigen Zeitraum beweist keine Profitabilität.</p>
      </Card>
      {runs.map((r) => (
        <RunDetail key={r.id} r={r} lab={lab} />
      ))}
    </>
  );
}

function RunDetail({ r, lab }: { r: StrategyRunSummary; lab: Lab }) {
  const m = r.metrics;
  return (
    <Card title={r.name} right={<Pnl v={m.totalReturnPct} unit="%" />}>
      <Sparkline points={r.equity} base={m.startBalance} />
      <div className="grid2">
        <KV k="Endkapital">
          {fmtNum(m.endBalance)} USDT ≈ {fmtNum(toChf(lab.state, m.endBalance))} CHF
        </KV>
        <KV k="Netto">
          <Pnl v={m.netProfit} /> USDT
        </KV>
        <KV k="Liquidationen">{m.liquidations}</KV>
        <KV k="Abgelehnte Einstiege">{m.rejectedEntries}</KV>
        <KV k="Max. Verlustserie">{m.maxConsecutiveLosses}</KV>
        <KV k="Signale angenommen">{r.signals}</KV>
      </div>
      <details>
        <summary>Datenquellen</summary>
        {r.dataInfo.map((d) => (
          <div key={d.symbol} className="sources">
            <b>{d.symbol}</b>: {d.bars} Kerzen, {fmtDate(d.from)} → {fmtDate(d.to)}
            {d.skippedNoExec > 0 && <span className="fine"> · {d.skippedNoExec} Signalkerzen ohne passende Bybit-Kerze übersprungen</span>}
            <div>
              Signale: <Source s={d.signalSource} />
            </div>
            <div>
              Ausführung: <Source s={d.execSource} />
            </div>
            {d.markSource && (
              <div>
                Liquidation: <Source s={d.markSource} />
              </div>
            )}
            {d.fundingSource && (
              <div>
                Funding: <Source s={d.fundingSource} />
              </div>
            )}
          </div>
        ))}
      </details>
      {r.warnings.length > 0 && (
        <details>
          <summary>Hinweise ({r.warnings.length})</summary>
          <ul className="journal">
            {r.warnings.map((w, i) => (
              <li key={i}>
                {fmtDate(w.t)} {w.symbol}: {w.text}
              </li>
            ))}
          </ul>
        </details>
      )}
      <details>
        <summary>Trades ({r.trades.length})</summary>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Eröffnet</th>
                <th>Richtung</th>
                <th className="r">Einstieg</th>
                <th className="r">Ausstieg</th>
                <th className="r">Netto</th>
                <th className="r">R</th>
                <th>Grund</th>
              </tr>
            </thead>
            <tbody>
              {[...r.trades].reverse().map((t) => (
                <tr key={t.id}>
                  <td>{fmtDate(t.openedT)}</td>
                  <td>
                    <Side side={t.side} />
                  </td>
                  <td className="r num">{fmtPrice(t.entryAvg)}</td>
                  <td className="r num">{fmtPrice(t.exitAvg)}</td>
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
      </details>
    </Card>
  );
}

function WalkForward({ wf, lab }: { wf: NonNullable<JobResult['walkForward']>; lab: Lab }) {
  return (
    <>
      <Card title="Walk-Forward: Gewichte aus dem Training" tone="info">
        <p>
          Trainingszeitraum bis {fmtDate(wf.splitT)}. Gewichte und Ähnlichkeitsgruppen stammen ausschliesslich aus diesem Teil. {wf.note}
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Strategie</th>
                <th className="r">Trades (Training)</th>
                <th className="r">Ø R</th>
                <th className="r">Gewicht</th>
                <th>Gruppe</th>
              </tr>
            </thead>
            <tbody>
              {wf.train.map((t) => (
                <tr key={t.id}>
                  <td>{t.name}</td>
                  <td className="r num">{t.metrics.trades}</td>
                  <td className="r num">{fmtNum(t.metrics.avgR)}</td>
                  <td className="r num">{fmtNum(wf.weights[t.id] ?? 0, 3)}</td>
                  <td>{wf.groups[t.id]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="fine">Gewicht = max(0, Ø R) × min(1, Trades/30). Wenige Trades → kleines Gewicht.</p>
        <button
          className="btn small"
          onClick={() =>
            lab.commit((s) => {
              s.superWeights = { weights: wf.weights, groups: wf.groups, origin: `Walk-Forward bis ${fmtDate(wf.splitT)}` };
            })
          }
        >
          Diese Gewichte für die Live-Superstrategie übernehmen
        </button>
      </Card>
      <RunDetail r={wf.test} lab={lab} />
    </>
  );
}
