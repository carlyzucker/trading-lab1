// TESTDATEN: deterministisch erzeugte, künstliche Kerzen. Sie dienen ausschliesslich der Prüfung
// der Rechenlogik und werden nirgends als echte Kurse angezeigt.
import type { AccountConfig } from '../src/core/account';
import { DEFAULT_FEES } from '../src/core/bybitRules';
import type { Bar, DataSource, InstrumentSpec } from '../src/core/types';

export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

export function synthBars(n: number, opts: { seed?: number; start?: number; t0?: number; ms?: number; vol?: number } = {}): Bar[] {
  const r = rng(opts.seed ?? 1);
  const ms = opts.ms ?? 900_000;
  let p = opts.start ?? 100;
  const out: Bar[] = [];
  const t0 = opts.t0 ?? Date.UTC(2026, 0, 1);
  for (let i = 0; i < n; i++) {
    // Regimewechsel: Trend und Seitwärts, damit beide Strategien Signale erzeugen
    const drift = Math.sin(i / 60) * 0.0015;
    const o = p;
    const c = o * (1 + drift + (r() - 0.5) * (opts.vol ?? 0.01));
    const h = Math.max(o, c) * (1 + r() * 0.004);
    const l = Math.min(o, c) * (1 - r() * 0.004);
    out.push({ t: t0 + i * ms, o, h, l, c, v: 100 + r() * 900 });
    p = c;
  }
  return out;
}

export const TEST_SOURCE: DataSource = { provider: 'test', endpoint: 'synthetisch', fetchedAt: 0, note: 'Testdaten' };

export function testSpec(over: Partial<InstrumentSpec> = {}): InstrumentSpec {
  return {
    exchange: 'bybit',
    category: 'linear',
    symbol: 'TESTUSDT',
    baseCoin: 'TEST',
    quoteCoin: 'USDT',
    settleCoin: 'USDT',
    status: 'Trading',
    contractType: 'LinearPerpetual',
    tickSize: 0.01,
    qtyStep: 0.001,
    minOrderQty: 0.001,
    maxOrderQty: 1_000_000,
    minNotionalValue: 5,
    contractMultiplier: 1,
    maxLeverage: 100,
    fundingIntervalMin: 480,
    maintenanceMarginRate: 0.005,
    mmrSource: 'annahme',
    source: TEST_SOURCE,
    ...over,
  };
}

export function testCfg(over: Partial<AccountConfig> = {}): AccountConfig {
  return { riskPct: 0.02, leverage: 1, maxLeverage: 3, slippageBps: 0, fees: DEFAULT_FEES, ...over };
}

export const bar = (t: number, o: number, h: number, l: number, c: number, v = 100): Bar => ({ t, o, h, l, c, v });
