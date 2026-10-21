// Virtuelles Konto + Ausführungsmodell.
// Identische Logik für Backtest und Live-Paper-Trading (Live verarbeitet einfach neu abgeschlossene Kerzen).
//
// Reihenfolge innerhalb einer Ausführungskerze (bewusst konservativ):
//   1. Market-Einstiege zum Eröffnungskurs (+ Slippage)
//   2. Limit-Einstiege, falls berührt
//   3. Liquidation (Mark-Preis-Extrem, sonst Last-Preis)
//   4. Stop-Loss (vor Take-Profit – trifft beides in derselben Kerze, gilt der Verlust)
//   5. Take-Profits (Teilgewinne)
//   6. Funding, falls ein Funding-Zeitpunkt in die Kerze fällt
// Signale entstehen erst NACH Kerzenschluss und werden frühestens in der nächsten Kerze ausgeführt.

import { effectiveLeverage, liquidationPrice, floorToStep, sizePosition } from './bybitRules';
import type { Bar, FeeModel, FundingEvent, InstrumentSpec, Side, Signal } from './types';

export interface AccountConfig {
  riskPct: number; // 0.02
  leverage: number; // gewünscht, 1..3
  maxLeverage: number; // App-Obergrenze 3
  slippageBps: number; // Annahme für Market-/Stop-Ausführungen
  fees: Record<'linear' | 'spot', FeeModel>;
}

export interface Fill {
  t: number;
  kind: 'entry' | 'tp' | 'stop' | 'liquidation' | 'end' | 'manual';
  price: number;
  qty: number;
  fee: number;
  maker: boolean;
}

export interface Position {
  symbol: string;
  side: Side;
  qty: number;
  filledQty: number; // insgesamt eingestiegene Menge
  entryAvg: number;
  stop: number;
  initialStop: number;
  targets: { price: number; fraction: number; hit: boolean }[];
  beAfterFirstTarget: boolean;
  leverage: number;
  liqPrice: number;
  margin: number;
  openedT: number;
  fees: number;
  funding: number;
  realized: number; // Brutto-Ergebnis aus Teilschliessungen
  plannedRisk: number;
  strategyId: string;
  reason: string;
  replay: boolean;
  fills: Fill[];
  lastMark: number;
}

export interface PendingTranche {
  kind: 'market' | 'limit';
  price?: number; // Ausführungs-Basis (Bybit)
  riskFraction: number;
  validBars: number;
  barsSeen: number;
}

export interface PendingEntry {
  symbol: string;
  side: Side;
  createdT: number;
  stop: number;
  targets: { price: number; fraction: number }[];
  beAfterFirstTarget: boolean;
  tranches: PendingTranche[];
  strategyId: string;
  reason: string;
  replay: boolean;
}

export interface ClosedTrade {
  id: string;
  symbol: string;
  side: Side;
  openedT: number;
  closedT: number;
  entryAvg: number;
  exitAvg: number;
  qty: number;
  gross: number;
  fees: number;
  funding: number;
  net: number;
  plannedRisk: number;
  r: number; // net / geplantes Risiko
  exitReason: string;
  strategyId: string;
  reason: string;
  replay: boolean;
  leverage: number;
}

export interface JournalEntry {
  t: number;
  symbol: string;
  text: string;
  level: 'info' | 'trade' | 'warn';
  replay?: boolean;
}

export interface Account {
  id: string;
  name: string;
  currency: 'USDT';
  startBalance: number;
  balance: number; // realisiertes Guthaben
  fees: number;
  funding: number;
  positions: Record<string, Position>;
  pending: Record<string, PendingEntry>;
  trades: ClosedTrade[];
  journal: JournalEntry[];
  equity: { t: number; v: number }[];
  tradeSeq: number;
}

export function createAccount(id: string, name: string, startBalance: number): Account {
  return {
    id,
    name,
    currency: 'USDT',
    startBalance,
    balance: startBalance,
    fees: 0,
    funding: 0,
    positions: {},
    pending: {},
    trades: [],
    journal: [],
    equity: [],
    tradeSeq: 0,
  };
}

export function usedMargin(acc: Account): number {
  let m = 0;
  for (const p of Object.values(acc.positions)) m += p.margin;
  return m;
}

export function unrealized(p: Position, price: number, spec?: InstrumentSpec): number {
  const mult = spec?.contractMultiplier ?? 1;
  return (p.side === 'long' ? price - p.entryAvg : p.entryAvg - price) * p.qty * mult;
}

export function accountEquity(acc: Account, lastPrices: Record<string, number>): number {
  let e = acc.balance;
  for (const p of Object.values(acc.positions)) e += unrealized(p, lastPrices[p.symbol] ?? p.lastMark);
  return e;
}

const MAX_JOURNAL = 2000;
function log(acc: Account, e: JournalEntry) {
  acc.journal.push(e);
  if (acc.journal.length > MAX_JOURNAL) acc.journal.splice(0, acc.journal.length - MAX_JOURNAL);
}

const fmt = (x: number) => (Math.abs(x) >= 100 ? x.toFixed(2) : x.toPrecision(6));

export interface BarInput {
  symbol: string;
  bar: Bar; // Bybit-Ausführungskerze
  barMs: number;
  mark?: { h: number; l: number; c: number }; // Bybit-Mark-Preis-Kerze (für Liquidation)
  funding: FundingEvent[]; // Ereignisse mit bar.t < t <= bar.t + barMs
  spec: InstrumentSpec;
  replay?: boolean;
}

function slip(side: Side, isBuy: boolean, price: number, bps: number): number {
  void side;
  const f = bps / 10_000;
  return isBuy ? price * (1 + f) : price * (1 - f);
}

/** Verarbeitet eine abgeschlossene Ausführungskerze für ein Symbol. */
export function processBar(acc: Account, cfg: AccountConfig, inp: BarInput): void {
  const { bar, spec, symbol } = inp;
  const fees = cfg.fees[spec.category];
  const pend = acc.pending[symbol];

  // 1 + 2: Einstiege
  if (pend) {
    for (const tr of pend.tranches) {
      tr.barsSeen++;
      let price: number | null = null;
      let maker = false;
      if (tr.kind === 'market') {
        price = slip(pend.side, pend.side === 'long', bar.o, cfg.slippageBps);
      } else if (tr.price !== undefined) {
        if (pend.side === 'long' && bar.l <= tr.price) price = Math.min(bar.o, tr.price);
        if (pend.side === 'short' && bar.h >= tr.price) price = Math.max(bar.o, tr.price);
        maker = true;
      }
      if (price === null) continue;
      fillEntry(acc, cfg, inp, pend, tr, price, maker, fees);
      tr.riskFraction = 0; // erledigt oder abgelehnt
    }
    pend.tranches = pend.tranches.filter((tr) => tr.riskFraction > 0 && tr.barsSeen < tr.validBars);
    if (pend.tranches.length === 0) delete acc.pending[symbol];
  }

  const pos = acc.positions[symbol];
  if (!pos) return;

  // 3: Liquidation
  if (spec.category !== 'spot') {
    const mh = inp.mark?.h ?? bar.h;
    const ml = inp.mark?.l ?? bar.l;
    const liqHit = pos.side === 'long' ? ml <= pos.liqPrice : mh >= pos.liqPrice;
    if (liqHit) {
      closeQty(acc, pos, pos.qty, pos.liqPrice, bar.t, 'liquidation', false, fees, inp);
      finalize(acc, pos, bar.t, 'Liquidation', inp);
      return;
    }
  }

  // 4: Stop
  const stopHit = pos.side === 'long' ? bar.l <= pos.stop : bar.h >= pos.stop;
  if (stopHit) {
    // Kurslücke: wenn schon die Eröffnung jenseits des Stops liegt, zum Eröffnungskurs
    const raw = pos.side === 'long' ? Math.min(bar.o, pos.stop) : Math.max(bar.o, pos.stop);
    const px = slip(pos.side, pos.side === 'short', raw, cfg.slippageBps);
    const isBE = Math.abs(pos.stop - pos.entryAvg) / pos.entryAvg < 1e-9;
    closeQty(acc, pos, pos.qty, px, bar.t, 'stop', false, fees, inp);
    finalize(acc, pos, bar.t, isBE ? 'Stop (Break-even)' : 'Stop-Loss', inp);
    return;
  }

  // 5: Take-Profits
  let firstHitNow = false;
  for (let i = 0; i < pos.targets.length; i++) {
    const tg = pos.targets[i];
    if (tg.hit) continue;
    const hit = pos.side === 'long' ? bar.h >= tg.price : bar.l <= tg.price;
    if (!hit) break; // Ziele der Reihe nach
    tg.hit = true;
    const isLast = i === pos.targets.length - 1;
    let q = isLast ? pos.qty : floorToStep(pos.filledQty * tg.fraction, spec.qtyStep);
    if (q > pos.qty) q = pos.qty;
    if (!isLast && pos.qty - q < spec.minOrderQty) q = pos.qty; // Rest wäre zu klein
    if (q <= 0) continue;
    const px = pos.side === 'long' ? Math.max(bar.o, tg.price) : Math.min(bar.o, tg.price);
    closeQty(acc, pos, q, px, bar.t, 'tp', true, fees, inp);
    if (i === 0) firstHitNow = true;
    if (pos.qty <= 0) {
      finalize(acc, pos, bar.t, isLast ? 'Take-Profit (alle Ziele)' : 'Take-Profit', inp);
      return;
    }
  }
  if (firstHitNow) {
    if (acc.pending[symbol]) {
      delete acc.pending[symbol];
      log(acc, { t: bar.t, symbol, level: 'info', text: 'Restliche Einstiegsorders nach erstem Ziel gestrichen', replay: inp.replay });
    }
    if (pos.beAfterFirstTarget) {
      pos.stop = pos.entryAvg;
      log(acc, { t: bar.t, symbol, level: 'info', text: `Stop auf Einstand ${fmt(pos.entryAvg)} nachgezogen`, replay: inp.replay });
    }
  }

  // 6: Funding
  if (spec.category === 'linear') {
    for (const ev of inp.funding) {
      if (ev.t <= bar.t || ev.t > bar.t + inp.barMs) continue;
      const value = pos.qty * (inp.mark?.c ?? bar.c) * spec.contractMultiplier;
      const pay = value * ev.rate * (pos.side === 'long' ? 1 : -1); // positiv = Zahlung
      acc.balance -= pay;
      acc.funding += pay;
      pos.funding += pay;
    }
  }
  pos.lastMark = bar.c;
}

function fillEntry(
  acc: Account,
  cfg: AccountConfig,
  inp: BarInput,
  pend: PendingEntry,
  tr: PendingTranche,
  price: number,
  maker: boolean,
  fees: FeeModel,
) {
  const { spec, symbol, bar } = inp;
  const existing = acc.positions[symbol];
  const lev = existing ? existing.leverage : effectiveLeverage(cfg.leverage, cfg.maxLeverage, spec);
  const sz = sizePosition({
    equity: acc.balance,
    availableMargin: acc.balance - usedMargin(acc),
    riskPct: cfg.riskPct,
    riskFraction: tr.riskFraction,
    side: pend.side,
    entry: price,
    stop: pend.stop,
    leverage: lev,
    spec,
    fees,
  });
  if (!sz.ok) {
    log(acc, { t: bar.t, symbol, level: 'warn', text: `Einstieg abgelehnt: ${sz.note}`, replay: inp.replay });
    return;
  }
  const fee = sz.notional * (maker ? fees.makerRate : fees.takerRate);
  acc.balance -= fee;
  acc.fees += fee;
  const fill: Fill = { t: bar.t, kind: 'entry', price, qty: sz.qty, fee, maker };
  if (existing) {
    const newQty = existing.qty + sz.qty;
    existing.entryAvg = (existing.entryAvg * existing.qty + price * sz.qty) / newQty;
    existing.qty = newQty;
    existing.filledQty += sz.qty;
    existing.margin += sz.margin;
    existing.fees += fee;
    existing.plannedRisk += sz.riskAmount;
    existing.liqPrice = spec.category === 'spot' ? 0 : liquidationPrice(existing.side, existing.entryAvg, lev, spec.maintenanceMarginRate);
    existing.fills.push(fill);
  } else {
    acc.positions[symbol] = {
      symbol,
      side: pend.side,
      qty: sz.qty,
      filledQty: sz.qty,
      entryAvg: price,
      stop: pend.stop,
      initialStop: pend.stop,
      targets: pend.targets.map((t) => ({ ...t, hit: false })),
      beAfterFirstTarget: pend.beAfterFirstTarget,
      leverage: lev,
      liqPrice: sz.liqPrice,
      margin: sz.margin,
      openedT: bar.t,
      fees: fee,
      funding: 0,
      realized: 0,
      plannedRisk: sz.riskAmount,
      strategyId: pend.strategyId,
      reason: pend.reason,
      replay: !!inp.replay,
      fills: [fill],
      lastMark: bar.c,
    };
  }
  log(acc, {
    t: bar.t,
    symbol,
    level: 'trade',
    replay: inp.replay,
    text: `${pend.side === 'long' ? 'LONG' : 'SHORT'} ${sz.qty} @ ${fmt(price)} (${maker ? 'Limit' : 'Market'}, ${lev}x, Stop ${fmt(pend.stop)}, Risiko ${sz.riskAmount.toFixed(2)} USDT)${sz.note ? ' – ' + sz.note : ''}`,
  });
}

function closeQty(
  acc: Account,
  pos: Position,
  qty: number,
  price: number,
  t: number,
  kind: Fill['kind'],
  maker: boolean,
  fees: FeeModel,
  inp: Pick<BarInput, 'spec' | 'replay'>,
) {
  const mult = inp.spec.contractMultiplier;
  const gross = (pos.side === 'long' ? price - pos.entryAvg : pos.entryAvg - price) * qty * mult;
  const fee = qty * price * mult * (maker ? fees.makerRate : fees.takerRate);
  acc.balance += gross - fee;
  acc.fees += fee;
  pos.realized += gross;
  pos.fees += fee;
  pos.margin *= (pos.qty - qty) / pos.qty;
  pos.qty = Number((pos.qty - qty).toFixed(12));
  pos.fills.push({ t, kind, price, qty, fee, maker });
  log(acc, {
    t,
    symbol: pos.symbol,
    level: 'trade',
    replay: inp.replay,
    text: `${kind === 'tp' ? 'Teilgewinn' : kind === 'stop' ? 'Stop' : kind === 'liquidation' ? 'LIQUIDATION' : 'Schliessung'} ${qty} @ ${fmt(price)} → ${gross >= 0 ? '+' : ''}${gross.toFixed(2)} USDT brutto`,
  });
}

function finalize(acc: Account, pos: Position, t: number, exitReason: string, inp: Pick<BarInput, 'replay'>) {
  const exits = pos.fills.filter((f) => f.kind !== 'entry');
  const exitQty = exits.reduce((a, f) => a + f.qty, 0);
  const exitAvg = exitQty > 0 ? exits.reduce((a, f) => a + f.price * f.qty, 0) / exitQty : pos.entryAvg;
  const net = pos.realized - pos.fees - pos.funding;
  acc.tradeSeq++;
  acc.trades.push({
    id: `${acc.id}-${acc.tradeSeq}`,
    symbol: pos.symbol,
    side: pos.side,
    openedT: pos.openedT,
    closedT: t,
    entryAvg: pos.entryAvg,
    exitAvg,
    qty: pos.filledQty,
    gross: pos.realized,
    fees: pos.fees,
    funding: pos.funding,
    net,
    plannedRisk: pos.plannedRisk,
    r: pos.plannedRisk > 0 ? net / pos.plannedRisk : 0,
    exitReason,
    strategyId: pos.strategyId,
    reason: pos.reason,
    replay: pos.replay || !!inp.replay,
    leverage: pos.leverage,
  });
  delete acc.positions[pos.symbol];
  delete acc.pending[pos.symbol];
  log(acc, { t, symbol: pos.symbol, level: 'trade', replay: inp.replay, text: `Trade beendet (${exitReason}): netto ${net >= 0 ? '+' : ''}${net.toFixed(2)} USDT` });
}

/** Schliesst eine Position zum angegebenen Preis (Backtest-Ende oder manuell). */
export function forceClose(acc: Account, cfg: AccountConfig, symbol: string, price: number, t: number, spec: InstrumentSpec, reason: string) {
  const pos = acc.positions[symbol];
  delete acc.pending[symbol];
  if (!pos) return;
  const fees = cfg.fees[spec.category];
  closeQty(acc, pos, pos.qty, slip(pos.side, pos.side === 'short', price, cfg.slippageBps), t, reason.startsWith('Backtest') ? 'end' : 'manual', false, fees, { spec });
  finalize(acc, pos, t, reason, {});
}

/**
 * Übersetzt ein Signal (Preise auf Signaldaten, z.B. Binance-Spot) in einen Bybit-Auftrag.
 * Preisniveaus werden proportional übertragen: Niveau_Bybit = Niveau_Signal * (Bybit-Schluss / Signal-Schluss).
 * So bleiben prozentuale Abstände erhalten, auch wenn Spot und Perpetual leicht abweichen (Basis).
 */
export function placeSignal(
  acc: Account,
  symbol: string,
  sig: Signal,
  signalBarT: number,
  execClose: number,
  strategyId: string,
  replay = false,
): boolean {
  if (acc.positions[symbol] || acc.pending[symbol]) return false;
  const ratio = execClose / sig.refPrice;
  const tx = (p: number) => p * ratio;
  acc.pending[symbol] = {
    symbol,
    side: sig.side,
    createdT: signalBarT,
    stop: tx(sig.stop),
    targets: sig.targets.map((t) => ({ price: tx(t.price), fraction: t.fraction })),
    beAfterFirstTarget: !!sig.moveStopToBreakevenAfterFirstTarget,
    tranches: sig.entries.map((e) => ({
      kind: e.kind,
      price: e.price !== undefined ? tx(e.price) : undefined,
      riskFraction: e.riskFraction,
      validBars: e.kind === 'market' ? 1 : Math.max(1, e.validBars ?? 3),
      barsSeen: 0,
    })),
    strategyId,
    reason: sig.reason,
    replay,
  };
  log(acc, {
    t: signalBarT,
    symbol,
    level: 'info',
    replay,
    text: `Signal ${sig.side.toUpperCase()}: ${sig.reason}${Math.abs(ratio - 1) > 1e-9 ? ` (Basis-Anpassung ×${ratio.toFixed(5)})` : ''}`,
  });
  return true;
}
