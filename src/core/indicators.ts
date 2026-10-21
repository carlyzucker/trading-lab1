import type { Bar } from './types';

/** Exponentieller gleitender Durchschnitt; die ersten (period-1) Werte sind NaN, Start = SMA. */
export function ema(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  if (period <= 0 || values.length < period) return out;
  const k = 2 / (period + 1);
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  let prev = sum / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

export function trueRange(bars: Bar[], i: number): number {
  const b = bars[i];
  if (i === 0) return b.h - b.l;
  const pc = bars[i - 1].c;
  return Math.max(b.h - b.l, Math.abs(b.h - pc), Math.abs(b.l - pc));
}

/** Average True Range nach Wilder. Erste (period) Werte NaN. */
export function atr(bars: Bar[], period: number): number[] {
  const out = new Array<number>(bars.length).fill(NaN);
  if (bars.length <= period) return out;
  let sum = 0;
  for (let i = 1; i <= period; i++) sum += trueRange(bars, i);
  let prev = sum / period;
  out[period] = prev;
  for (let i = period + 1; i < bars.length; i++) {
    prev = (prev * (period - 1) + trueRange(bars, i)) / period;
    out[i] = prev;
  }
  return out;
}
