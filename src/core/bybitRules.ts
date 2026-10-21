import type { FeeModel, InstrumentSpec, Side } from './types';

/**
 * Standard-Gebühren Bybit (Nicht-VIP), Stand Oktober 2026 laut Bybit Learn "Bybit Trading Fees":
 * Perpetual/Futures: Maker 0.020 %, Taker 0.055 %. Spot: 0.10 % / 0.10 %.
 * Die tatsächliche Gebührenstufe eines Kontos ist nur mit privatem API-Schlüssel abrufbar –
 * den verwenden wir bewusst NICHT. Deshalb: einstellbar und als Annahme gekennzeichnet.
 */
export const DEFAULT_FEES: Record<'linear' | 'spot', FeeModel> = {
  linear: { takerRate: 0.00055, makerRate: 0.0002, label: 'Annahme: Bybit Nicht-VIP Derivate (Taker 0.055 %, Maker 0.02 %)' },
  spot: { takerRate: 0.001, makerRate: 0.001, label: 'Annahme: Bybit Nicht-VIP Spot (0.10 %)' },
};

/** Falls /v5/market/risk-limit nicht lesbar ist. Bybit-Tier-1 liegt bei grossen Kontrakten meist bei 0.5 %; als Annahme konservativer 1 %. */
export const FALLBACK_MMR = 0.01;

export function floorToStep(x: number, step: number): number {
  if (step <= 0) return x;
  const n = Math.floor(x / step + 1e-9);
  return roundClean(n * step, step);
}

export function roundToTick(x: number, tick: number): number {
  if (tick <= 0) return x;
  return roundClean(Math.round(x / tick) * tick, tick);
}

function roundClean(x: number, step: number): number {
  const decimals = Math.max(0, Math.ceil(-Math.log10(step)) + 1);
  return Number(x.toFixed(Math.min(decimals, 12)));
}

/** Isolierte Margin, vereinfachte Bybit-Formel (ohne Schliessgebühr-Puffer): */
export function liquidationPrice(side: Side, entry: number, leverage: number, mmr: number): number {
  if (side === 'long') return entry * (1 - 1 / leverage + mmr);
  return entry * (1 + 1 / leverage - mmr);
}

export function effectiveLeverage(requested: number, appMax: number, spec: InstrumentSpec): number {
  if (spec.category === 'spot') return 1;
  return Math.max(1, Math.min(requested, appMax, spec.maxLeverage));
}

export interface SizingInput {
  equity: number; // Kontostand (USDT), Basis für 2 %
  availableMargin: number; // frei verfügbare Margin (USDT)
  riskPct: number; // 0.02
  riskFraction: number; // Anteil dieser Tranche am Gesamtrisiko
  side: Side;
  entry: number; // erwarteter Ausführungspreis (Bybit)
  stop: number; // Stop (Bybit-Basis)
  leverage: number;
  spec: InstrumentSpec;
  fees: FeeModel;
}

export interface SizingResult {
  ok: boolean;
  qty: number;
  notional: number;
  margin: number;
  riskAmount: number; // geplanter maximaler Verlust inkl. Gebühren
  liqPrice: number;
  note?: string;
}

/**
 * Positionsgrösse so, dass ein Stop-Treffer inkl. Taker-Gebühren ca. riskPct * riskFraction kostet.
 * Danach Bybit-Regeln: qtyStep abrunden, Mindestmenge, Mindestnotional, Margin, Liquidation.
 */
export function sizePosition(inp: SizingInput): SizingResult {
  const { spec, side, entry, stop, leverage } = inp;
  const fail = (note: string): SizingResult => ({ ok: false, qty: 0, notional: 0, margin: 0, riskAmount: 0, liqPrice: NaN, note });

  if (!(entry > 0) || !(stop > 0)) return fail('Ungültiger Preis');
  if (side === 'long' && stop >= entry) return fail('Stop liegt nicht unter dem Einstieg');
  if (side === 'short' && stop <= entry) return fail('Stop liegt nicht über dem Einstieg');
  if (spec.category === 'spot' && side === 'short') return fail('Short ist auf Bybit-Spot nicht möglich');

  const budget = inp.equity * inp.riskPct * inp.riskFraction;
  const perUnit = (Math.abs(entry - stop) + entry * inp.fees.takerRate + stop * inp.fees.takerRate) * spec.contractMultiplier;
  let qty = budget / perUnit;

  const maxByMargin = (inp.availableMargin * 0.98 * leverage) / (entry * spec.contractMultiplier);
  let note: string | undefined;
  if (qty > maxByMargin) {
    qty = maxByMargin;
    note = 'Menge durch verfügbare Margin begrenzt (Risiko < Ziel)';
  }
  if (spec.maxOrderQty > 0 && qty > spec.maxOrderQty) qty = spec.maxOrderQty;
  qty = floorToStep(qty, spec.qtyStep);

  if (qty < spec.minOrderQty) return fail(`Menge ${qty} unter Bybit-Minimum ${spec.minOrderQty}`);
  const notional = qty * entry * spec.contractMultiplier;
  if (spec.minNotionalValue > 0 && notional < spec.minNotionalValue)
    return fail(`Positionswert ${notional.toFixed(2)} unter Bybit-Minimum ${spec.minNotionalValue}`);

  const liq = spec.category === 'spot' ? 0 : liquidationPrice(side, entry, leverage, spec.maintenanceMarginRate);
  if (spec.category !== 'spot') {
    if (side === 'long' && stop <= liq) return fail('Stop liegt hinter dem Liquidationspreis – Hebel zu hoch');
    if (side === 'short' && stop >= liq) return fail('Stop liegt hinter dem Liquidationspreis – Hebel zu hoch');
  }
  return { ok: true, qty, notional, margin: notional / leverage, riskAmount: qty * perUnit, liqPrice: liq, note };
}
