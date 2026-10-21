import { accountEquity, createAccount, forceClose, placeSignal, processBar, type Account, type AccountConfig } from './account';
import { computeMetrics, type Metrics } from './metrics';
import type { Params, StrategyDef } from './strategies/types';
import type { Bar, DataSource, FundingEvent, InstrumentSpec, Signal } from './types';

/** Alle Daten eines Instruments für Backtest/Live. */
export interface MarketData {
  key: string; // z.B. "BTC"
  execSymbol: string; // Bybit-Symbol
  spec: InstrumentSpec;
  signalBars: Bar[];
  signalSource: DataSource;
  execBars: Bar[];
  execSource: DataSource;
  markBars?: Bar[];
  markSource?: DataSource;
  funding: FundingEvent[];
  fundingSource?: DataSource;
}

export interface StepArgs {
  symbol: string;
  spec: InstrumentSpec;
  execBar: Bar;
  mark?: { h: number; l: number; c: number };
  funding: FundingEvent[];
  barMs: number;
  /** Abgeschlossene Signalkerzen, letzte Kerze == execBar.t. null = keine Bewertung möglich. */
  signalWindow: Bar[] | null;
  replay?: boolean;
}

/**
 * EIN Zeitschritt für EIN Instrument – exakt dieselbe Funktion für Backtest und Live-Paper-Trading.
 * Zuerst wird die Kerze ausgeführt (offene Orders/Positionen), danach wird am Kerzenschluss bewertet.
 */
export function stepMarketBar(acc: Account, cfg: AccountConfig, def: StrategyDef, params: Params, a: StepArgs): Signal | null {
  processBar(acc, cfg, { symbol: a.symbol, bar: a.execBar, barMs: a.barMs, mark: a.mark, funding: a.funding, spec: a.spec, replay: a.replay });
  if (!a.signalWindow) return null;
  const last = a.signalWindow[a.signalWindow.length - 1];
  if (!last || last.t !== a.execBar.t) return null;
  if (a.signalWindow.length < def.lookback(params)) return null;
  const sig = def.evaluate({ bars: a.signalWindow, symbol: a.symbol, timeframe: '', params });
  if (sig) placeSignal(acc, a.symbol, sig, a.execBar.t, a.execBar.c, def.id, a.replay);
  return sig;
}

export interface BacktestOptions {
  def: StrategyDef;
  params: Params;
  markets: MarketData[];
  barMs: number;
  cfg: AccountConfig;
  startBalance: number; // USDT
  accountId?: string;
  fromT?: number; // nur Kerzen >= fromT handeln (frühere dürfen als Vorlauf dienen)
  toT?: number;
  equityEvery?: number; // jede n-te Kerze im Verlauf speichern
}

export interface BacktestResult {
  account: Account;
  metrics: Metrics;
  signals: { t: number; symbol: string; side: 'long' | 'short' }[];
  /** Positionsrichtung je Zeitpunkt (+1/-1/0, summiert über Instrumente) – für Korrelationsprüfung. */
  exposure: { t: number[]; v: number[] };
  dataInfo: { symbol: string; signalSource: DataSource; execSource: DataSource; markSource?: DataSource; fundingSource?: DataSource; bars: number; from: number; to: number; skippedNoExec: number }[];
}

export function runBacktest(o: BacktestOptions): BacktestResult {
  const acc = createAccount(o.accountId ?? `bt-${o.def.id}`, `${o.def.name} (Backtest)`, o.startBalance);
  const lb = o.def.lookback(o.params);
  const every = Math.max(1, o.equityEvery ?? 1);

  const prepared = o.markets.map((m) => {
    const sigIdx = new Map<number, number>();
    m.signalBars.forEach((b, i) => sigIdx.set(b.t, i));
    const markByT = new Map<number, Bar>();
    m.markBars?.forEach((b) => markByT.set(b.t, b));
    const execByT = new Map<number, Bar>();
    m.execBars.forEach((b) => execByT.set(b.t, b));
    const funding = [...m.funding].sort((a, b) => a.t - b.t);
    return { m, sigIdx, markByT, execByT, funding, fPtr: 0, skippedNoExec: 0 };
  });

  const times = new Set<number>();
  for (const p of prepared) for (const b of p.m.execBars) if ((o.fromT === undefined || b.t >= o.fromT) && (o.toT === undefined || b.t <= o.toT)) times.add(b.t);
  const timeline = [...times].sort((a, b) => a - b);
  for (const p of prepared) for (const b of p.m.signalBars) if (!p.execByT.has(b.t) && (o.fromT === undefined || b.t >= o.fromT)) p.skippedNoExec++;

  const signals: BacktestResult['signals'] = [];
  const lastPrice: Record<string, number> = {};
  const expT: number[] = [];
  const expV: number[] = [];

  timeline.forEach((t, k) => {
    for (const p of prepared) {
      const eb = p.execByT.get(t);
      if (!eb) continue;
      const ev: FundingEvent[] = [];
      while (p.fPtr < p.funding.length && p.funding[p.fPtr].t <= t + o.barMs) {
        if (p.funding[p.fPtr].t > t) ev.push(p.funding[p.fPtr]);
        p.fPtr++;
      }
      const si = p.sigIdx.get(t);
      const window = si !== undefined && si >= lb - 1 ? p.m.signalBars.slice(si - lb + 1, si + 1) : null;
      const mk = p.markByT.get(t);
      const sig = stepMarketBar(acc, o.cfg, o.def, o.params, {
        symbol: p.m.execSymbol,
        spec: p.m.spec,
        execBar: eb,
        mark: mk ? { h: mk.h, l: mk.l, c: mk.c } : undefined,
        funding: ev,
        barMs: o.barMs,
        signalWindow: window,
      });
      if (sig && acc.pending[p.m.execSymbol]?.createdT === t) signals.push({ t, symbol: p.m.execSymbol, side: sig.side });
      lastPrice[p.m.execSymbol] = eb.c;
    }
    let ex = 0;
    for (const pos of Object.values(acc.positions)) ex += pos.side === 'long' ? 1 : -1;
    expT.push(t);
    expV.push(ex);
    if (k % every === 0 || k === timeline.length - 1) acc.equity.push({ t, v: accountEquity(acc, lastPrice) });
  });

  const endT = timeline[timeline.length - 1] ?? 0;
  for (const p of prepared) {
    if (acc.positions[p.m.execSymbol] || acc.pending[p.m.execSymbol]) {
      forceClose(acc, o.cfg, p.m.execSymbol, lastPrice[p.m.execSymbol], endT, p.m.spec, 'Backtest-Ende (Schlusskurs)');
    }
  }
  if (timeline.length) acc.equity.push({ t: endT, v: acc.balance });

  return {
    account: acc,
    metrics: computeMetrics(acc),
    signals,
    exposure: { t: expT, v: expV },
    dataInfo: prepared.map((p) => ({
      symbol: p.m.execSymbol,
      signalSource: p.m.signalSource,
      execSource: p.m.execSource,
      markSource: p.m.markSource,
      fundingSource: p.m.fundingSource,
      bars: p.m.execBars.length,
      from: p.m.execBars[0]?.t ?? 0,
      to: p.m.execBars[p.m.execBars.length - 1]?.t ?? 0,
      skippedNoExec: p.skippedNoExec,
    })),
  };
}
