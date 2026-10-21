// Superstrategie v0.1: Signalkonsens + (vorbereitete) statistische Gewichtung.
// Machine Learning ist bewusst NICHT eingebaut. Es bleibt gesperrt, bis unabhängige Out-of-Sample-Tests vorliegen.

import { runBacktest, type BacktestOptions, type BacktestResult } from './backtest';
import type { Params, StrategyDef } from './strategies/types';
import type { Bar, Side, Signal } from './types';

export interface SuperComponent {
  def: StrategyDef;
  params: Params;
  weight: number; // 1 = gleichgewichtet
  group: string; // ähnliche Strategien teilen eine Gruppe → zählen nur einmal
}

export interface SuperConfig {
  minAgreeingGroups: number; // so viele unabhängige Gruppen müssen zustimmen
  vetoOnConflict: boolean; // Gegensignal einer Gruppe blockiert
  memoryBars: number; // Signal bleibt so viele Kerzen "aktiv"
  minScore: number; // gewichteter Anteil der zustimmenden Gewichte (0..1)
}

export const DEFAULT_SUPER_CONFIG: SuperConfig = { minAgreeingGroups: 2, vetoOnConflict: true, memoryBars: 3, minScore: 0.5 };

export interface Vote {
  strategyId: string;
  group: string;
  side: Side;
  ageBars: number;
  weight: number;
  signal: Signal;
}

export interface Consensus {
  votes: Vote[];
  longGroups: string[];
  shortGroups: string[];
  score: number; // -1..+1 gewichtet (nur aktive Gruppen)
  decision: Side | null;
  explanation: string;
}

/** Sammelt die Stimmen aller Komponenten über die letzten memoryBars Kerzen (nur abgeschlossene Kerzen). */
export function collectVotes(bars: Bar[], comps: SuperComponent[], memoryBars: number): Vote[] {
  const votes: Vote[] = [];
  for (const c of comps) {
    const lb = c.def.lookback(c.params);
    for (let age = 0; age < memoryBars; age++) {
      const end = bars.length - age; // exklusiv
      if (end < lb) break;
      const sig = c.def.evaluate({ bars: bars.slice(end - lb, end), symbol: '', timeframe: '', params: c.params });
      if (sig) {
        votes.push({ strategyId: c.def.id, group: c.group, side: sig.side, ageBars: age, weight: c.weight, signal: sig });
        break; // jüngstes Signal je Komponente
      }
    }
  }
  return votes;
}

export function decide(votes: Vote[], cfg: SuperConfig): Consensus {
  const groupDir = new Map<string, { w: number; dir: number }>();
  for (const v of votes) {
    const g = groupDir.get(v.group) ?? { w: 0, dir: 0 };
    g.dir += v.side === 'long' ? 1 : -1;
    g.w = Math.max(g.w, v.weight);
    groupDir.set(v.group, g);
  }
  const longGroups: string[] = [];
  const shortGroups: string[] = [];
  let num = 0;
  let den = 0;
  for (const [g, x] of groupDir) {
    if (x.dir > 0) longGroups.push(g);
    if (x.dir < 0) shortGroups.push(g);
    if (x.dir !== 0) {
      num += x.w * Math.sign(x.dir);
      den += x.w;
    }
  }
  const score = den > 0 ? num / den : 0;
  let decision: Side | null = null;
  let explanation = 'Keine Signale';
  const conflict = longGroups.length > 0 && shortGroups.length > 0;
  if (votes.length) {
    if (conflict && cfg.vetoOnConflict) explanation = `Konflikt: ${longGroups.length} Long- vs. ${shortGroups.length} Short-Gruppe(n) → kein Trade`;
    else if (longGroups.length >= cfg.minAgreeingGroups && score >= cfg.minScore) decision = 'long';
    else if (shortGroups.length >= cfg.minAgreeingGroups && -score >= cfg.minScore) decision = 'short';
    if (!decision && !(conflict && cfg.vetoOnConflict))
      explanation = `Zu wenig Übereinstimmung (Long ${longGroups.length}, Short ${shortGroups.length}, benötigt ${cfg.minAgreeingGroups} Gruppen, Score ${score.toFixed(2)})`;
    if (decision) explanation = `${decision.toUpperCase()}: ${decision === 'long' ? longGroups.length : shortGroups.length} unabhängige Gruppe(n) einig, Score ${score.toFixed(2)}`;
  }
  return { votes, longGroups, shortGroups, score, decision, explanation };
}

/** Superstrategie als normale Strategie → läuft durch dieselbe Backtest- und Paper-Engine mit eigenem Konto. */
export function makeSuperStrategy(comps: SuperComponent[], cfg: SuperConfig): StrategyDef {
  const maxLb = Math.max(1, ...comps.map((c) => c.def.lookback(c.params)));
  return {
    id: 'super',
    name: 'Superstrategie (Konsens)',
    version: '0.1.0',
    changelog: [{ version: '0.1.0', note: 'Signalkonsens mit Gruppen gegen Doppelzählung; ML gesperrt' }],
    kind: 'meta',
    description: 'Handelt nur, wenn mehrere unabhängige Strategiegruppen in dieselbe Richtung zeigen und keine Gruppe widerspricht.',
    assumptions: ['Mindestanzahl Gruppen, Signal-Gedächtnis und Score-Schwelle sind Startwerte ohne Optimierung.'],
    params: [],
    defaults: {},
    lookback: () => maxLb + cfg.memoryBars - 1,
    evaluate({ bars }) {
      const c = decide(collectVotes(bars, comps, cfg.memoryBars), cfg);
      if (!c.decision) return null;
      const cur = bars[bars.length - 1].c;
      // Plan der gewichtigsten zustimmenden Stimme (bei Gleichstand: jüngste)
      const best = c.votes
        .filter((v) => v.side === c.decision)
        .sort((a, b) => b.weight - a.weight || a.ageBars - b.ageBars)[0];
      const s = best.signal;
      const okLevels = s.side === 'long' ? s.stop < cur && s.targets[0].price > cur : s.stop > cur && s.targets[0].price < cur;
      if (!okLevels) return null; // Plan ist durch die Kursbewegung bereits ungültig
      return {
        ...s,
        refPrice: cur, // Niveaus sind absolute Signalpreise; Referenz = aktueller Schluss
        entries: s.entries.filter((e) => e.kind === 'market').length ? s.entries : [{ kind: 'market', riskFraction: 1 }],
        reason: `Superstrategie – ${c.explanation} · Plan von ${best.strategyId}`,
      };
    },
  };
}

/** Pearson-Korrelation zweier gleich langer Reihen. */
export function correlation(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 3) return 0;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[i];
    mb += b[i];
  }
  ma /= n;
  mb /= n;
  let cov = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - ma;
    const db = b[i] - mb;
    cov += da * db;
    va += da * da;
    vb += db * db;
  }
  return va > 0 && vb > 0 ? cov / Math.sqrt(va * vb) : 0;
}

/** Gruppiert Strategien, deren Positionsrichtungen stark korrelieren (gegen Doppelzählung). */
export function clusterByCorrelation(series: Record<string, number[]>, threshold: number): Record<string, string> {
  const ids = Object.keys(series);
  const group: Record<string, string> = {};
  for (const id of ids) {
    if (group[id]) continue;
    group[id] = id;
    for (const other of ids) {
      if (group[other]) continue;
      if (correlation(series[id], series[other]) >= threshold) group[other] = id;
    }
  }
  return group;
}

/**
 * Statistisches Gewicht aus einer Trainingsperiode:
 * Gewicht = max(0, durchschnittliches R) × Stichproben-Faktor min(1, n/30).
 * Wenige Trades → kleines Gewicht (Schutz vor Zufallstreffern / Überanpassung).
 */
export function statWeight(avgR: number, trades: number): number {
  return Math.max(0, avgR) * Math.min(1, trades / 30);
}

export interface WalkForwardResult {
  splitT: number;
  train: Record<string, BacktestResult>;
  weights: Record<string, number>;
  groups: Record<string, string>;
  test: BacktestResult; // NUR Out-of-Sample
  note: string;
}

/**
 * Walk-Forward: Gewichte und Gruppen werden NUR aus dem Trainingsteil berechnet,
 * die Superstrategie wird danach ausschliesslich auf dem späteren Testteil gemessen.
 */
export function walkForwardSuper(
  comps: { def: StrategyDef; params: Params }[],
  cfg: SuperConfig,
  base: Omit<BacktestOptions, 'def' | 'params' | 'fromT' | 'toT'>,
  trainShare = 0.6,
  corrThreshold = 0.7,
): WalkForwardResult {
  const allT = base.markets.flatMap((m) => m.execBars.map((b) => b.t)).sort((a, b) => a - b);
  const splitT = allT[Math.floor(allT.length * trainShare)] ?? 0;
  const train: Record<string, BacktestResult> = {};
  for (const c of comps) train[c.def.id] = runBacktest({ ...base, def: c.def, params: c.params, toT: splitT - 1 });
  const groups = clusterByCorrelation(
    Object.fromEntries(Object.entries(train).map(([id, r]) => [id, r.exposure.v])),
    corrThreshold,
  );
  const weights: Record<string, number> = {};
  for (const [id, r] of Object.entries(train)) weights[id] = statWeight(r.metrics.avgR, r.metrics.trades);
  const superComps: SuperComponent[] = comps.map((c) => ({ ...c, weight: weights[c.def.id], group: groups[c.def.id] })).filter((c) => c.weight > 0);
  const sup = makeSuperStrategy(superComps.length ? superComps : [], cfg);
  const test = runBacktest({ ...base, def: sup, params: {}, fromT: splitT, accountId: 'wf-super' });
  return {
    splitT,
    train,
    weights,
    groups,
    test,
    note: superComps.length
      ? `${superComps.length} Komponente(n) mit positivem Trainings-Gewicht; Test nur auf Daten nach dem Trainingszeitraum.`
      : 'Keine Komponente hatte im Training ein positives Gewicht → Superstrategie handelt im Test nicht.',
  };
}
