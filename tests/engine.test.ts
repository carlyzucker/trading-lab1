import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAccount, placeSignal, processBar } from '../src/core/account';
import { runBacktest, type MarketData } from '../src/core/backtest';
import { amt001 } from '../src/core/strategies/amt001';
import { demoEmaCross } from '../src/core/strategies/demoEmaCross';
import type { StrategyDef } from '../src/core/strategies/types';
import type { Signal } from '../src/core/types';
import { bar, synthBars, testCfg, testSpec, TEST_SOURCE } from './helpers';

const MS = 900_000;
const longSig = (over: Partial<Signal> = {}): Signal => ({
  side: 'long',
  refPrice: 100,
  entries: [{ kind: 'market', riskFraction: 1 }],
  stop: 98,
  targets: [{ price: 104, fraction: 1 }],
  reason: 'Test',
  ...over,
});
const step = (acc: ReturnType<typeof createAccount>, b: ReturnType<typeof bar>, extra: object = {}) =>
  processBar(acc, testCfg(), { symbol: 'TESTUSDT', bar: b, barMs: MS, funding: [], spec: testSpec(), ...extra });

test('Stop-Loss kostet ≈ 2 % inkl. Gebühren', () => {
  const acc = createAccount('a', 'a', 1000);
  placeSignal(acc, 'TESTUSDT', longSig(), 0, 100, 'x');
  step(acc, bar(MS, 100, 100.5, 99.5, 100));
  assert.ok(acc.positions.TESTUSDT);
  step(acc, bar(2 * MS, 99, 99.5, 97.5, 98));
  assert.equal(acc.trades.length, 1);
  const t = acc.trades[0];
  assert.equal(t.exitReason, 'Stop-Loss');
  assert.ok(Math.abs(t.net + 20) < 0.02, `Netto ${t.net}`);
  assert.ok(Math.abs(acc.balance - 980) < 0.02);
});

test('Stop und Ziel in derselben Kerze → Verlust wird angenommen (konservativ)', () => {
  const acc = createAccount('a', 'a', 1000);
  placeSignal(acc, 'TESTUSDT', longSig(), 0, 100, 'x');
  step(acc, bar(MS, 100, 105, 97, 101));
  assert.equal(acc.trades[0].exitReason, 'Stop-Loss');
});

test('Kurslücke über den Stop → Ausführung zum Eröffnungskurs', () => {
  const acc = createAccount('a', 'a', 1000);
  placeSignal(acc, 'TESTUSDT', longSig(), 0, 100, 'x');
  step(acc, bar(MS, 100, 100.2, 99.8, 100));
  step(acc, bar(2 * MS, 96, 97, 95, 96.5));
  const exit = acc.trades[0];
  assert.equal(exit.exitAvg, 96);
  assert.ok(exit.net < -20, 'Lücke kostet mehr als geplant');
});

test('Teilgewinn, danach Stop auf Einstand', () => {
  const acc = createAccount('a', 'a', 1000);
  placeSignal(acc, 'TESTUSDT', longSig({ targets: [{ price: 102, fraction: 0.5 }, { price: 104, fraction: 1 }], moveStopToBreakevenAfterFirstTarget: true }), 0, 100, 'x');
  step(acc, bar(MS, 100, 102.5, 99.5, 102));
  const pos = acc.positions.TESTUSDT;
  assert.ok(pos && pos.stop === 100 && Math.abs(pos.qty - 4.742) < 1e-9, `Rest ${pos?.qty}`);
  step(acc, bar(2 * MS, 101, 101.5, 99.8, 100));
  const t = acc.trades[0];
  assert.equal(t.exitReason, 'Stop (Break-even)');
  assert.ok(t.gross > 0 && t.net > 0);
});

test('Signal übersetzt Preisniveaus proportional auf Bybit (Basis-Anpassung)', () => {
  const acc = createAccount('a', 'a', 1000);
  placeSignal(acc, 'TESTUSDT', longSig(), 0, 101, 'x'); // Bybit 1 % höher als Signalquelle
  assert.ok(Math.abs(acc.pending.TESTUSDT.stop - 98.98) < 1e-9);
  assert.ok(Math.abs(acc.pending.TESTUSDT.targets[0].price - 105.04) < 1e-9);
});

test('Funding: Long zahlt bei positiver Rate', () => {
  const acc = createAccount('a', 'a', 1000);
  placeSignal(acc, 'TESTUSDT', longSig(), 0, 100, 'x');
  step(acc, bar(MS, 100, 100.5, 99.5, 100));
  const before = acc.balance;
  const qty = acc.positions.TESTUSDT.qty;
  step(acc, bar(2 * MS, 100, 100.5, 99.5, 100), { funding: [{ t: 3 * MS, rate: 0.0001 }] });
  assert.ok(Math.abs(before - acc.balance - qty * 100 * 0.0001) < 1e-9);
});

test('Liquidation vor Stop, wenn der Mark-Preis beides in einer Kerze durchschlägt', () => {
  const acc = createAccount('a', 'a', 1000);
  processBar; // Hebel 3x
  placeSignal(acc, 'TESTUSDT', longSig(), 0, 100, 'x');
  processBar(acc, testCfg({ leverage: 3 }), { symbol: 'TESTUSDT', bar: bar(MS, 100, 100.2, 99.9, 100), barMs: MS, funding: [], spec: testSpec() });
  processBar(acc, testCfg({ leverage: 3 }), { symbol: 'TESTUSDT', bar: bar(2 * MS, 99, 99, 50, 55), barMs: MS, funding: [], spec: testSpec(), mark: { h: 99, l: 50, c: 55 } });
  assert.equal(acc.trades[0].exitReason, 'Liquidation');
});

test('Gestaffelter Einstieg: Limit-Teil füllt nur bei Berührung, verfällt sonst', () => {
  const acc = createAccount('a', 'a', 1000);
  placeSignal(acc, 'TESTUSDT', longSig({ entries: [{ kind: 'market', riskFraction: 0.5 }, { kind: 'limit', price: 99, riskFraction: 0.5, validBars: 2 }] }), 0, 100, 'x');
  step(acc, bar(MS, 100, 100.5, 99.5, 100));
  const q1 = acc.positions.TESTUSDT.qty;
  step(acc, bar(2 * MS, 100, 100.5, 98.9, 99.5));
  assert.ok(acc.positions.TESTUSDT.qty > q1, 'Limit gefüllt');
  assert.equal(acc.pending.TESTUSDT, undefined);

  const acc2 = createAccount('b', 'b', 1000);
  placeSignal(acc2, 'TESTUSDT', longSig({ entries: [{ kind: 'market', riskFraction: 0.5 }, { kind: 'limit', price: 99, riskFraction: 0.5, validBars: 2 }] }), 0, 100, 'x');
  step(acc2, bar(MS, 100, 100.5, 99.5, 100));
  step(acc2, bar(2 * MS, 100, 100.5, 99.5, 100));
  assert.equal(acc2.pending.TESTUSDT, undefined, 'Limit verfallen');
});

function market(bars = synthBars(1500, { seed: 7 })): MarketData {
  return { key: 'T', execSymbol: 'TESTUSDT', spec: testSpec(), signalBars: bars, signalSource: TEST_SOURCE, execBars: bars, execSource: TEST_SOURCE, funding: [] };
}

test('Backtest liefert Trades und konsistente Kennzahlen (Demo + AMT)', () => {
  for (const def of [demoEmaCross, amt001]) {
    const r = runBacktest({ def, params: def.defaults, markets: [market()], barMs: MS, cfg: testCfg({ slippageBps: 5 }), startBalance: 625 });
    const sumNet = r.account.trades.reduce((a, t) => a + t.net, 0);
    assert.ok(Math.abs(r.account.balance - 625 - sumNet) < 1e-6, `${def.id}: Bilanz = Summe der Trades`);
    assert.ok(r.metrics.trades > 0, `${def.id} erzeugt Trades auf Testdaten`);
    assert.ok(r.metrics.fees > 0);
    assert.equal(Object.keys(r.account.positions).length, 0);
  }
});

test('Kein Look-ahead: Zukunftsdaten ändern vergangene Signale/Trades nicht', () => {
  const a = synthBars(1500, { seed: 11 });
  const k = 1000;
  const b = a.map((x, i) => (i > k ? { ...x, o: x.o * 1.3, h: x.h * 1.35, l: x.l * 1.25, c: x.c * 1.3, v: x.v * 5 } : x));
  for (const def of [demoEmaCross, amt001]) {
    const ra = runBacktest({ def, params: def.defaults, markets: [market(a)], barMs: MS, cfg: testCfg(), startBalance: 625 });
    const rb = runBacktest({ def, params: def.defaults, markets: [market(b)], barMs: MS, cfg: testCfg(), startBalance: 625 });
    const cut = a[k].t;
    assert.deepEqual(ra.signals.filter((s) => s.t <= cut), rb.signals.filter((s) => s.t <= cut), def.id);
    assert.deepEqual(ra.account.trades.filter((t) => t.closedT <= cut), rb.account.trades.filter((t) => t.closedT <= cut), def.id);
  }
});

test('Strategie sieht nie eine Kerze nach dem aktuellen Zeitpunkt', () => {
  const bars = synthBars(400, { seed: 3 });
  let maxSeen = -1;
  let violations = 0;
  const spy: StrategyDef = {
    ...demoEmaCross,
    id: 'spy',
    evaluate(ctx) {
      const last = ctx.bars[ctx.bars.length - 1].t;
      if (last < maxSeen) violations++;
      maxSeen = last;
      return demoEmaCross.evaluate(ctx);
    },
  };
  const m = market(bars);
  const r = runBacktest({ def: spy, params: demoEmaCross.defaults, markets: [m], barMs: MS, cfg: testCfg(), startBalance: 625 });
  assert.equal(violations, 0);
  // jede Ausführung passiert nach dem Signal
  for (const t of r.account.trades) assert.ok(t.openedT > 0);
  for (const t of r.account.trades) {
    const prior = r.signals.filter((s) => s.t <= t.openedT).pop();
    assert.ok(prior && prior.t < t.openedT, 'Einstieg erst nach dem Signal (Folgekerze)');
  }
});
