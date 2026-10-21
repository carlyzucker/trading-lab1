import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { StrategyDef } from '../src/core/strategies/types';
import { amt001 } from '../src/core/strategies/amt001';
import { demoEmaCross } from '../src/core/strategies/demoEmaCross';
import { clusterByCorrelation, collectVotes, correlation, decide, DEFAULT_SUPER_CONFIG, makeSuperStrategy, statWeight, walkForwardSuper, type Vote } from '../src/core/superstrategy';
import type { Signal } from '../src/core/types';
import { synthBars, testCfg, testSpec, TEST_SOURCE } from './helpers';

const sig = (side: 'long' | 'short'): Signal => ({ side, refPrice: 100, entries: [{ kind: 'market', riskFraction: 1 }], stop: side === 'long' ? 98 : 102, targets: [{ price: side === 'long' ? 104 : 96, fraction: 1 }], reason: 'x' });
const vote = (id: string, group: string, side: 'long' | 'short', weight = 1): Vote => ({ strategyId: id, group, side, ageBars: 0, weight, signal: sig(side) });

test('Konsens: zwei unabhängige Gruppen nötig; ähnliche Strategien zählen nur einmal', () => {
  const cfg = DEFAULT_SUPER_CONFIG;
  assert.equal(decide([vote('a', 'g1', 'long'), vote('b', 'g2', 'long')], cfg).decision, 'long');
  assert.equal(decide([vote('a', 'g1', 'long'), vote('b', 'g1', 'long')], cfg).decision, null, 'gleiche Gruppe = Doppelzählung verhindert');
  assert.equal(decide([vote('a', 'g1', 'long'), vote('b', 'g2', 'long'), vote('c', 'g3', 'short')], cfg).decision, null, 'Veto bei Gegensignal');
  assert.equal(decide([vote('a', 'g1', 'short'), vote('b', 'g2', 'short')], cfg).decision, 'short');
});

test('Gewichte und Korrelation', () => {
  assert.equal(statWeight(-0.2, 100), 0);
  assert.equal(statWeight(0.5, 15), 0.25);
  assert.equal(correlation([1, 0, -1, 0, 1], [1, 0, -1, 0, 1]), 1);
  const g = clusterByCorrelation({ a: [1, 1, 0, -1, -1, 0], b: [1, 1, 0, -1, -1, 0], c: [0, 1, 0, 1, 0, -1] }, 0.7);
  assert.equal(g.a, 'a');
  assert.equal(g.b, 'a');
  assert.equal(g.c, 'c');
});

test('Superstrategie = normale Strategie mit Konto; handelt nur bei Übereinstimmung', () => {
  const always = (side: 'long' | 'short', id: string): StrategyDef => ({ ...demoEmaCross, id, lookback: () => 2, evaluate: ({ bars }) => ({ ...sig(side), refPrice: bars[bars.length - 1].c, stop: bars[bars.length - 1].c * (side === 'long' ? 0.98 : 1.02), targets: [{ price: bars[bars.length - 1].c * (side === 'long' ? 1.04 : 0.96), fraction: 1 }] }) });
  const bars = synthBars(50, { seed: 1 });
  const agree = makeSuperStrategy([{ def: always('long', 'x'), params: {}, weight: 1, group: 'x' }, { def: always('long', 'y'), params: {}, weight: 1, group: 'y' }], DEFAULT_SUPER_CONFIG);
  assert.equal(agree.evaluate({ bars, symbol: '', timeframe: '', params: {} })?.side, 'long');
  const conflict = makeSuperStrategy([{ def: always('long', 'x'), params: {}, weight: 1, group: 'x' }, { def: always('short', 'y'), params: {}, weight: 1, group: 'y' }], DEFAULT_SUPER_CONFIG);
  assert.equal(conflict.evaluate({ bars, symbol: '', timeframe: '', params: {} }), null);
  assert.equal(collectVotes(bars, [{ def: always('long', 'x'), params: {}, weight: 1, group: 'x' }], 3).length, 1);
});

test('Walk-Forward: Gewichte nur aus Trainingsdaten, Test nur danach', () => {
  const bars = synthBars(2400, { seed: 9 });
  const market = { key: 'T', execSymbol: 'TESTUSDT', spec: testSpec(), signalBars: bars, signalSource: TEST_SOURCE, execBars: bars, execSource: TEST_SOURCE, funding: [] };
  const wf = walkForwardSuper(
    [{ def: demoEmaCross, params: demoEmaCross.defaults }, { def: amt001, params: amt001.defaults }],
    DEFAULT_SUPER_CONFIG,
    { markets: [market], barMs: 900_000, cfg: testCfg(), startBalance: 625 },
  );
  for (const r of Object.values(wf.train)) for (const t of r.account.trades) assert.ok(t.openedT < wf.splitT);
  for (const t of wf.test.account.trades) assert.ok(t.openedT >= wf.splitT);
  assert.ok(typeof wf.note === 'string');
});
