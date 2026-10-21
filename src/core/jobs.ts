// Backtest-Aufträge: serialisierbar, damit sie in einem Web Worker (Handy) oder in Node laufen können.
import type { AccountConfig, ClosedTrade, JournalEntry } from './account';
import { runBacktest, type BacktestResult, type MarketData } from './backtest';
import type { Metrics } from './metrics';
import { getStrategy } from './strategies/registry';
import type { Params, StrategyDef } from './strategies/types';
import { makeSuperStrategy, walkForwardSuper, type SuperConfig } from './superstrategy';

export interface BacktestJob {
  mode: 'compare' | 'walkforward';
  strategyIds: string[];
  params: Record<string, Params>;
  includeSuper: boolean;
  superGroups: Record<string, string>;
  /** Welche Strategien an der Superstrategie teilnehmen (Standard: alle getesteten) */
  superIds?: string[];
  superConfig: SuperConfig;
  markets: MarketData[];
  barMs: number;
  cfg: AccountConfig;
  startBalance: number;
  trainShare?: number;
}

export interface StrategyRunSummary {
  id: string;
  name: string;
  kind: StrategyDef['kind'];
  version: string;
  metrics: Metrics;
  trades: ClosedTrade[];
  equity: { t: number; v: number }[];
  warnings: JournalEntry[];
  dataInfo: BacktestResult['dataInfo'];
  signals: number;
}

export interface JobResult {
  runs: StrategyRunSummary[];
  walkForward?: {
    splitT: number;
    weights: Record<string, number>;
    groups: Record<string, string>;
    train: StrategyRunSummary[];
    test: StrategyRunSummary;
    note: string;
  };
  durationMs: number;
}

function downsample<T>(xs: T[], max: number): T[] {
  if (xs.length <= max) return xs;
  const step = xs.length / max;
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(xs[Math.floor(i * step)]);
  out.push(xs[xs.length - 1]);
  return out;
}

function summarize(def: StrategyDef, r: BacktestResult): StrategyRunSummary {
  return {
    id: def.id,
    name: def.name,
    kind: def.kind,
    version: def.version,
    metrics: r.metrics,
    trades: r.account.trades.slice(-500),
    equity: downsample(r.account.equity, 300),
    warnings: r.account.journal.filter((j) => j.level === 'warn').slice(-50),
    dataInfo: r.dataInfo,
    signals: r.signals.length,
  };
}

export function runJob(job: BacktestJob): JobResult {
  const t0 = Date.now();
  const defs = job.strategyIds.map((id) => {
    const d = getStrategy(id);
    if (!d) throw new Error(`Unbekannte Strategie ${id}`);
    return d;
  });
  const base = { markets: job.markets, barMs: job.barMs, cfg: job.cfg, startBalance: job.startBalance, equityEvery: 1 };
  if (job.mode === 'walkforward') {
    const wf = walkForwardSuper(
      defs.filter((d) => !job.superIds || job.superIds.includes(d.id)).map((d) => ({ def: d, params: job.params[d.id] ?? d.defaults })),
      job.superConfig,
      base,
      job.trainShare ?? 0.6,
    );
    const sup = makeSuperStrategy([], job.superConfig);
    return {
      runs: [],
      walkForward: {
        splitT: wf.splitT,
        weights: wf.weights,
        groups: wf.groups,
        train: defs.filter((d) => wf.train[d.id]).map((d) => summarize(d, wf.train[d.id])),
        test: summarize({ ...sup, name: 'Superstrategie (Out-of-Sample)' }, wf.test),
        note: wf.note,
      },
      durationMs: Date.now() - t0,
    };
  }
  const runs = defs.map((d) => summarize(d, runBacktest({ ...base, def: d, params: job.params[d.id] ?? d.defaults })));
  if (job.includeSuper) {
    const comps = defs.filter((d) => !job.superIds || job.superIds.includes(d.id)).map((d) => ({ def: d, params: job.params[d.id] ?? d.defaults, weight: 1, group: job.superGroups[d.id] ?? d.id }));
    const sup = makeSuperStrategy(comps, job.superConfig);
    runs.push(summarize(sup, runBacktest({ ...base, def: sup, params: {} })));
  }
  return { runs, durationMs: Date.now() - t0 };
}
