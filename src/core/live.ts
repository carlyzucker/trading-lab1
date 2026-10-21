// Live-Paper-Trading: verarbeitet neu abgeschlossene Kerzen mit derselben Logik wie der Backtest.
// Läuft im Handy (solange die App offen ist) und unverändert im Node-Worker (24/7).

import { createAccount, forceClose, type Account } from './account';
import { stepMarketBar } from './backtest';
import { binanceHistory, binancePrice } from './data/binance';
import { bybitFundingHistory, bybitHistory, bybitInstruments, bybitTicker, bybitTier1Mmr, toSpec, type RawInstrumentInfo } from './data/bybit';
import { fetchUsdChf } from './data/fx';
import { describeError, type FetchLike } from './data/http';
import { findCandidates, MARKETS, type Candidate, type MarketKey } from './data/markets';
import { accountConfig, type AppState, type GapInfo, type SelectedInstrument } from './state';
import { getStrategy, STRATEGIES } from './strategies/registry';
import type { Params, StrategyDef } from './strategies/types';
import { collectVotes, decide, makeSuperStrategy, type SuperComponent } from './superstrategy';
import { getTimeframe, lastClosedBarStart } from './timeframes';
import type { Bar, DataSource, FundingEvent } from './types';

export interface LiveDeps {
  fetch: FetchLike;
  now: () => number;
}

/** Bis zu so vielen neuen Kerzen gilt als normaler Scan; mehr = Datenlücke (App war zu / angehalten). */
export const NORMAL_MAX_NEW_BARS = 3;
export const MAX_REPLAY_BARS = 20_000;
export const SUPER_ID = 'super';

// ---------- Instrumente entdecken ----------

export interface Discovery {
  candidates: Record<MarketKey, Candidate[]>;
  sources: DataSource[];
  errors: { category: string; message: string; hint: string }[];
  at: number;
}

export async function discoverInstruments(deps: LiveDeps, state: AppState): Promise<Discovery> {
  const ep = state.settings.endpoints;
  const all: RawInstrumentInfo[] = [];
  const sources: DataSource[] = [];
  const errors: Discovery['errors'] = [];
  for (const cat of ['linear', 'spot'] as const) {
    try {
      const r = await bybitInstruments(deps.fetch, ep, cat);
      all.push(...r.list);
      sources.push(r.source);
    } catch (e) {
      errors.push({ category: cat, ...describeError(e) });
    }
  }
  const candidates = {} as Record<MarketKey, Candidate[]>;
  for (const m of MARKETS) candidates[m.key] = all.length ? findCandidates(m, all) : [];
  return { candidates, sources, errors, at: deps.now() };
}

export async function addInstrument(deps: LiveDeps, state: AppState, c: Candidate): Promise<void> {
  const enabledCount = state.instruments.filter((i) => i.enabled).length;
  if (enabledCount >= state.settings.maxInstruments) throw new Error(`Maximal ${state.settings.maxInstruments} Instrumente gleichzeitig`);
  const mmr = c.category === 'linear' ? await bybitTier1Mmr(deps.fetch, state.settings.endpoints, c.symbol) : null;
  const source: DataSource = { provider: 'bybit', endpoint: `${state.settings.endpoints.bybit}/v5/market/instruments-info`, category: c.category, symbol: c.symbol, fetchedAt: deps.now() };
  state.specs[c.symbol] = toSpec(c.raw, mmr, source);
  state.instruments = state.instruments.filter((i) => i.symbol !== c.symbol && i.marketKey !== c.marketKey);
  const sel: SelectedInstrument = { marketKey: c.marketKey, symbol: c.symbol, category: c.category, productType: c.productType, signal: c.signal, enabled: true };
  state.instruments.push(sel);
}

// ---------- Konten ----------

export async function ensureFx(deps: LiveDeps, state: AppState): Promise<void> {
  if (state.fx && deps.now() - state.fx.source.fetchedAt < 6 * 3600_000) return;
  state.fx = await fetchUsdChf(deps.fetch, state.settings.endpoints);
}

export interface Runner {
  id: string;
  def: StrategyDef;
  params: Params;
  evaluate: boolean; // false = nur offene Positionen verwalten
}

export function superComponents(state: AppState): SuperComponent[] {
  return STRATEGIES.filter((s) => state.strategies[s.id]?.enabled && (s.kind !== 'demo' || state.settings.superAllowDemo)).map((s) => ({
    def: s,
    params: state.strategies[s.id].params,
    weight: state.superWeights.weights[s.id] ?? 1,
    group: state.superWeights.groups[s.id] ?? s.id,
  }));
}

export function runners(state: AppState): Runner[] {
  const out: Runner[] = STRATEGIES.map((s) => ({ id: s.id, def: s, params: state.strategies[s.id]?.params ?? s.defaults, evaluate: !!state.strategies[s.id]?.enabled }));
  out.push({ id: SUPER_ID, def: makeSuperStrategy(superComponents(state), state.settings.superConfig), params: {}, evaluate: true });
  return out;
}

/** Legt fehlende Konten mit 500 CHF (umgerechnet in USDT zum EZB-Kurs) an. */
export function ensureAccounts(state: AppState): string[] {
  if (!state.fx) throw new Error('Kein CHF/USD-Kurs verfügbar – Konten können nicht korrekt in USDT eröffnet werden.');
  const created: string[] = [];
  for (const r of runners(state)) {
    if (state.accounts[r.id]) continue;
    const usdt = state.settings.startCapitalChf * state.fx.usdPerChf;
    state.accounts[r.id] = createAccount(r.id, r.id === SUPER_ID ? 'Superstrategie' : r.def.name, Number(usdt.toFixed(2)));
    state.accountMeta[r.id] = {
      startChf: state.settings.startCapitalChf,
      usdPerChfAtStart: state.fx.usdPerChf,
      fxDate: state.fx.date,
      createdAt: Date.now(),
      strategyCodeVersion: r.def.version,
      strategyConfigVersion: state.strategies[r.id]?.configVersion ?? 1,
    };
    created.push(r.id);
  }
  return created;
}

export function resetAccount(state: AppState, id: string): void {
  delete state.accounts[id];
  delete state.accountMeta[id];
  ensureAccounts(state);
}

// ---------- Kurse ----------

export async function refreshQuotes(deps: LiveDeps, state: AppState): Promise<void> {
  const ep = state.settings.endpoints;
  for (const inst of state.instruments) {
    const q = state.quotes[inst.marketKey] ?? {};
    try {
      const t = await bybitTicker(deps.fetch, ep, inst.category, inst.symbol);
      q.bybit = { last: t.lastPrice, mark: t.markPrice, bid: t.bid, ask: t.ask, fundingRate: t.fundingRate, nextFundingTime: t.nextFundingTime, source: t.source };
      if (inst.signal.provider === 'binance') q.binance = await binancePrice(deps.fetch, ep, inst.signal.symbol);
      q.error = undefined;
      q.updatedAt = deps.now();
    } catch (e) {
      q.error = { ...describeError(e), at: deps.now() };
    }
    state.quotes[inst.marketKey] = q;
  }
}

// ---------- Lücken ----------

export function detectGaps(state: AppState, now: number): GapInfo[] {
  const tf = getTimeframe(state.settings.timeframe);
  const latest = lastClosedBarStart(tf, now);
  const gaps: GapInfo[] = [];
  for (const inst of state.instruments.filter((i) => i.enabled)) {
    const last = state.live.lastProcessed[inst.symbol];
    if (last === undefined) continue;
    const bars = Math.round((latest - last) / tf.ms);
    if (bars > NORMAL_MAX_NEW_BARS) gaps.push({ symbol: inst.symbol, fromT: last, toT: latest, bars });
  }
  return gaps;
}

function journalAll(state: AppState, symbol: string, t: number, text: string, level: 'info' | 'warn' = 'warn') {
  for (const acc of Object.values(state.accounts)) acc.journal.push({ t, symbol, text, level });
}

/**
 * Lücke überspringen: offene Positionen dieses Instruments werden zum aktuellen Bybit-Kurs geschlossen,
 * weil während der Lücke niemand Stops/Ziele überwacht hat. Danach Neustart ab jetzt.
 */
export function skipGap(state: AppState, symbol: string, now: number): void {
  const gap = state.live.gaps.find((g) => g.symbol === symbol);
  const inst = state.instruments.find((i) => i.symbol === symbol);
  const spec = state.specs[symbol];
  if (!gap || !inst || !spec) return;
  const px = state.quotes[inst.marketKey]?.bybit?.last;
  const hasOpen = Object.values(state.accounts).some((a) => a.positions[symbol] || a.pending[symbol]);
  if (hasOpen && !(px && px > 0)) throw new Error('Kein aktueller Bybit-Kurs – offene Positionen können nicht geschlossen werden. Bitte "Nachrechnen" wählen oder später erneut versuchen.');
  const cfg = accountConfig(state.settings);
  for (const acc of Object.values(state.accounts)) if (acc.positions[symbol] || acc.pending[symbol]) forceClose(acc, cfg, symbol, px!, now, spec, 'Lücke übersprungen (Schliessung zum aktuellen Kurs)');
  state.live.lastProcessed[symbol] = gap.toT;
  state.live.gaps = state.live.gaps.filter((g) => g.symbol !== symbol);
  journalAll(state, symbol, now, `Datenlücke von ${gap.bars} Kerzen übersprungen – keine Simulation in dieser Zeit.`);
}

// ---------- Scan ----------

export interface ScanReport {
  at: number;
  processedBars: number;
  newSignals: { symbol: string; account: string; side: string; reason: string }[];
  errors: { symbol?: string; message: string; hint: string }[];
  gaps: GapInfo[];
}

export async function scan(deps: LiveDeps, state: AppState, opts: { replay?: string[] } = {}): Promise<ScanReport> {
  const now = deps.now();
  const tf = getTimeframe(state.settings.timeframe);
  const latest = lastClosedBarStart(tf, now);
  const ep = state.settings.endpoints;
  const cfg = accountConfig(state.settings);
  const report: ScanReport = { at: now, processedBars: 0, newSignals: [], errors: [], gaps: [] };
  state.live.lastScanAt = now;
  state.live.scanCount++;

  try {
    await ensureFx(deps, state);
  } catch (e) {
    if (!state.fx) report.errors.push(describeError(e));
  }
  if (state.fx) ensureAccounts(state);
  else {
    report.errors.push({ message: 'Ohne Wechselkurs keine Konten', hint: 'Die App versucht es beim nächsten Scan erneut.' });
    finishScan(state, report);
    return report;
  }

  await refreshQuotes(deps, state);
  const rs = runners(state);
  const maxLb = Math.max(...rs.map((r) => r.def.lookback(r.params)));

  for (const inst of state.instruments.filter((i) => i.enabled)) {
    const spec = state.specs[inst.symbol];
    if (!spec) {
      report.errors.push({ symbol: inst.symbol, message: 'Keine Bybit-Spezifikation', hint: 'Instrument unter "Märkte" neu auswählen.' });
      continue;
    }
    const last = state.live.lastProcessed[inst.symbol];
    if (last === undefined) {
      state.live.lastProcessed[inst.symbol] = latest;
      journalAll(state, inst.symbol, now, `Start der Simulation ab Kerze ${new Date(latest).toISOString()} (keine rückwirkenden Trades).`, 'info');
      continue;
    }
    let n = Math.round((latest - last) / tf.ms);
    if (n <= 0) continue;
    const replay = n > NORMAL_MAX_NEW_BARS;
    if (replay && !opts.replay?.includes(inst.symbol)) {
      if (!state.live.gaps.some((g) => g.symbol === inst.symbol)) state.live.gaps.push({ symbol: inst.symbol, fromT: last, toT: latest, bars: n });
      continue;
    }
    if (n > MAX_REPLAY_BARS) n = MAX_REPLAY_BARS;

    try {
      const sigCount = maxLb + n + 2;
      const signal =
        inst.signal.provider === 'binance'
          ? await binanceHistory(deps.fetch, ep, inst.signal.symbol, tf.id, sigCount, now)
          : await bybitHistory(deps.fetch, ep, 'kline', inst.signal.category ?? inst.category, inst.signal.symbol, tf.id, sigCount, now);
      const exec = await bybitHistory(deps.fetch, ep, 'kline', inst.category, inst.symbol, tf.id, n + 2, now);
      const mark = inst.category === 'linear' ? await bybitHistory(deps.fetch, ep, 'mark-price-kline', 'linear', inst.symbol, tf.id, n + 2, now) : null;
      const needFunding = inst.category === 'linear' && (replay || Object.values(state.accounts).some((a) => a.positions[inst.symbol] || a.pending[inst.symbol]));
      const funding: FundingEvent[] = needFunding ? (await bybitFundingHistory(deps.fetch, ep, inst.symbol, last, now)).events : [];

      const sigIdx = new Map(signal.bars.map((b, i) => [b.t, i] as const));
      const markByT = new Map((mark?.bars ?? []).map((b) => [b.t, b] as const));
      const newExec = exec.bars.filter((b) => b.t > last && b.t <= latest);
      for (const eb of newExec) {
        const si = sigIdx.get(eb.t);
        const mk = markByT.get(eb.t);
        const ev = funding.filter((f) => f.t > eb.t && f.t <= eb.t + tf.ms);
        for (const r of rs) {
          const acc = state.accounts[r.id];
          if (!acc) continue;
          const lb = r.def.lookback(r.params);
          const window = r.evaluate && si !== undefined && si >= lb - 1 ? signal.bars.slice(si - lb + 1, si + 1) : null;
          const sig = stepMarketBar(acc, cfg, r.def, r.params, {
            symbol: inst.symbol,
            spec,
            execBar: eb,
            mark: mk ? { h: mk.h, l: mk.l, c: mk.c } : undefined,
            funding: ev,
            barMs: tf.ms,
            signalWindow: window,
            replay,
          });
          if (sig && acc.pending[inst.symbol]?.createdT === eb.t) report.newSignals.push({ symbol: inst.symbol, account: r.id, side: sig.side, reason: sig.reason });
        }
        if (si === undefined) journalAll(state, inst.symbol, eb.t, `Keine Signalkerze (${inst.signal.provider}) für diese Zeit – nicht bewertet.`);
        state.live.lastProcessed[inst.symbol] = eb.t;
        report.processedBars++;
      }
      if (!newExec.length && n > 0) report.errors.push({ symbol: inst.symbol, message: 'Bybit lieferte noch keine neue abgeschlossene Kerze', hint: 'Normal kurz nach Kerzenschluss; nächster Scan versucht es erneut.' });
      if (replay) state.live.gaps = state.live.gaps.filter((g) => g.symbol !== inst.symbol);

      updateConsensus(state, inst.symbol, signal.bars);
      recordEquity(state, inst.symbol, latest);
    } catch (e) {
      report.errors.push({ symbol: inst.symbol, ...describeError(e) });
    }
  }
  finishScan(state, report);
  return report;
}

function finishScan(state: AppState, report: ScanReport) {
  report.gaps = [...state.live.gaps];
  if (!report.errors.length) state.live.lastScanOkAt = report.at;
  state.live.lastErrors = [...report.errors.map((e) => ({ at: report.at, ...e })), ...state.live.lastErrors].slice(0, 30);
}

function updateConsensus(state: AppState, symbol: string, bars: Bar[]) {
  const comps: SuperComponent[] = STRATEGIES.filter((s) => state.strategies[s.id]?.enabled).map((s) => ({
    def: s,
    params: state.strategies[s.id].params,
    weight: state.superWeights.weights[s.id] ?? 1,
    group: state.superWeights.groups[s.id] ?? s.id,
  }));
  const allowed = new Set(superComponents(state).map((c) => c.def.id));
  const votes = collectVotes(bars, comps, state.settings.superConfig.memoryBars);
  const c = decide(votes.filter((v) => allowed.has(v.strategyId)), state.settings.superConfig);
  state.consensus[symbol] = {
    t: bars[bars.length - 1]?.t ?? 0,
    votes: votes.map((v) => ({ strategyId: v.strategyId, group: v.group, side: v.side, ageBars: v.ageBars })),
    decision: c.decision,
    explanation: c.explanation,
  };
}

function recordEquity(state: AppState, symbol: string, t: number) {
  void symbol;
  const prices: Record<string, number> = {};
  for (const i of state.instruments) {
    const q = state.quotes[i.marketKey]?.bybit;
    if (q) prices[i.symbol] = q.mark ?? q.last;
  }
  for (const acc of Object.values(state.accounts)) {
    let e = acc.balance;
    for (const p of Object.values(acc.positions)) {
      const px = prices[p.symbol] ?? p.lastMark;
      e += (p.side === 'long' ? px - p.entryAvg : p.entryAvg - px) * p.qty;
    }
    const lastPt = acc.equity[acc.equity.length - 1];
    if (!lastPt || lastPt.t !== t) acc.equity.push({ t, v: e });
    else lastPt.v = e;
    if (acc.equity.length > 3000) acc.equity.splice(0, acc.equity.length - 3000);
  }
}

export function strategyById(id: string): StrategyDef | undefined {
  return id === SUPER_ID ? undefined : getStrategy(id);
}

export type { Account };
