import assert from 'node:assert/strict';
import { test } from 'node:test';
import { floorToStep, liquidationPrice, sizePosition, effectiveLeverage, DEFAULT_FEES } from '../src/core/bybitRules';
import { atr, ema } from '../src/core/indicators';
import { buildVolumeProfile } from '../src/core/volumeProfile';
import { lastClosedBarStart, getTimeframe, isClosed } from '../src/core/timeframes';
import { bar, testSpec } from './helpers';

test('EMA: Startwert = SMA, danach rekursiv', () => {
  const e = ema([1, 2, 3, 4, 5], 3);
  assert.ok(Number.isNaN(e[1]));
  assert.equal(e[2], 2);
  assert.equal(e[3], 3); // 4*0.5 + 2*0.5
  assert.equal(e[4], 4);
});

test('ATR (Wilder) auf bekannten Werten', () => {
  const bars = [bar(0, 10, 11, 9, 10), bar(1, 10, 12, 10, 11), bar(2, 11, 13, 11, 12), bar(3, 12, 12, 8, 9)];
  const a = atr(bars, 2);
  // TR: [-, 2, 2, 4]; ATR[2] = (2+2)/2 = 2; ATR[3] = (2*1+4)/2 = 3
  assert.equal(a[2], 2);
  assert.equal(a[3], 3);
});

test('Volumenprofil: POC dort, wo das meiste Volumen liegt; Value Area ≥ 70 %', () => {
  const bars = [bar(0, 100, 101, 100, 101, 10), bar(1, 101, 102, 101, 102, 1000), bar(2, 102, 103, 102, 103, 10), bar(3, 103, 110, 103, 109, 5)];
  const vp = buildVolumeProfile(bars, 10, 0.7)!;
  assert.ok(vp.poc > 101 && vp.poc < 102, `POC ${vp.poc}`);
  assert.ok(vp.valueAreaVolumeShare >= 0.7);
  assert.ok(vp.val <= vp.poc && vp.vah >= vp.poc);
  const total = vp.volumes.reduce((a, x) => a + x, 0);
  assert.ok(Math.abs(total - 1025) < 1e-6, 'Volumen bleibt erhalten');
});

test('Rundung auf Bybit-Mengenschritt (immer abrunden)', () => {
  assert.equal(floorToStep(0.0129, 0.001), 0.012);
  assert.equal(floorToStep(9.4836, 0.001), 9.483);
  assert.equal(floorToStep(5, 1), 5);
});

test('Liquidationspreis isolierte Margin', () => {
  assert.ok(Math.abs(liquidationPrice('long', 100, 3, 0.005) - 67.1666667) < 1e-6);
  assert.ok(Math.abs(liquidationPrice('short', 100, 3, 0.005) - 132.8333333) < 1e-6);
});

test('Positionsgrösse: 2 % Risiko inkl. Gebühren', () => {
  const r = sizePosition({ equity: 1000, availableMargin: 1000, riskPct: 0.02, riskFraction: 1, side: 'long', entry: 100, stop: 98, leverage: 1, spec: testSpec(), fees: DEFAULT_FEES.linear });
  assert.ok(r.ok);
  assert.equal(r.qty, 9.483);
  assert.ok(r.riskAmount <= 20 && r.riskAmount > 19.99);
});

test('Positionsgrösse: Margin begrenzt, Mindestmenge, Spot-Short, Stop hinter Liquidation', () => {
  const tight = sizePosition({ equity: 1000, availableMargin: 1000, riskPct: 0.02, riskFraction: 1, side: 'long', entry: 100, stop: 99.9, leverage: 1, spec: testSpec(), fees: DEFAULT_FEES.linear });
  assert.ok(tight.ok && tight.notional <= 980 + 1e-9 && /Margin/.test(tight.note!));
  const tooSmall = sizePosition({ equity: 1000, availableMargin: 1000, riskPct: 0.02, riskFraction: 1, side: 'long', entry: 100, stop: 98, leverage: 1, spec: testSpec({ minOrderQty: 50 }), fees: DEFAULT_FEES.linear });
  assert.equal(tooSmall.ok, false);
  const spotShort = sizePosition({ equity: 1000, availableMargin: 1000, riskPct: 0.02, riskFraction: 1, side: 'short', entry: 100, stop: 102, leverage: 1, spec: testSpec({ category: 'spot' }), fees: DEFAULT_FEES.spot });
  assert.equal(spotShort.ok, false);
  const liq = sizePosition({ equity: 1000, availableMargin: 1000, riskPct: 0.02, riskFraction: 1, side: 'long', entry: 100, stop: 60, leverage: 3, spec: testSpec(), fees: DEFAULT_FEES.linear });
  assert.equal(liq.ok, false);
  assert.match(liq.note!, /Liquidation/);
});

test('Hebel: App-Maximum 3x, Spot immer 1x', () => {
  assert.equal(effectiveLeverage(10, 3, testSpec()), 3);
  assert.equal(effectiveLeverage(2, 3, testSpec({ maxLeverage: 1.5 })), 1.5);
  assert.equal(effectiveLeverage(3, 3, testSpec({ category: 'spot' })), 1);
});

test('Abgeschlossene Kerzen', () => {
  const tf = getTimeframe('15m');
  const now = Date.UTC(2026, 9, 21, 10, 7);
  assert.equal(lastClosedBarStart(tf, now), Date.UTC(2026, 9, 21, 9, 45));
  assert.equal(isClosed(Date.UTC(2026, 9, 21, 10, 0), tf, now), false);
  const w = getTimeframe('1w');
  assert.equal(new Date(lastClosedBarStart(w, now)).getUTCDay(), 1); // Montag
});
