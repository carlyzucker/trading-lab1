import assert from 'node:assert/strict';
import { test } from 'node:test';
import { binanceHistory } from '../src/core/data/binance';
import { bybitFundingHistory, bybitHistory, bybitInstruments, bybitTier1Mmr, toSpec } from '../src/core/data/bybit';
import { DataError, DEFAULT_ENDPOINTS, getJson, withProxy } from '../src/core/data/http';
import { findCandidates, MARKETS } from '../src/core/data/markets';
import { getTimeframe } from '../src/core/timeframes';
import { synthBars } from './helpers';
import { linearInstrument, mockFetch, spotInstrument } from './mockExchange';

const MS = 900_000;
const bars = synthBars(2600, { seed: 5 });
const nowMid = (i: number) => bars[i].t + MS / 2; // mitten in Kerze i → Kerze i läuft noch

test('Binance: Seiten rückwärts laden, nur abgeschlossene Kerzen, aufsteigend', async () => {
  const f = mockFetch({ binance: { BTCUSDT: bars }, bybit: {}, now: () => nowMid(2500) });
  const r = await binanceHistory(f, DEFAULT_ENDPOINTS, 'BTCUSDT', '15m', 2300, nowMid(2500));
  assert.equal(r.bars.length, 2300);
  assert.equal(r.bars[r.bars.length - 1].t, bars[2499].t, 'laufende Kerze 2500 ausgeschlossen');
  for (let i = 1; i < r.bars.length; i++) assert.equal(r.bars[i].t - r.bars[i - 1].t, MS);
  assert.equal(r.source.provider, 'binance');
});

test('Bybit: neueste-zuerst wird umgedreht, Paging, Mark-Preis-Kerzen', async () => {
  const calls: string[] = [];
  const f = mockFetch({ binance: {}, bybit: { BTCUSDT: bars }, now: () => nowMid(2500), calls });
  const r = await bybitHistory(f, DEFAULT_ENDPOINTS, 'kline', 'linear', 'BTCUSDT', '15m', 1500, nowMid(2500));
  assert.equal(r.bars.length, 1500);
  assert.equal(r.bars[0].t, bars[1000].t);
  assert.equal(r.bars[1499].t, bars[2499].t);
  assert.ok(calls.length >= 2, 'mehrere Seiten');
  const m = await bybitHistory(f, DEFAULT_ENDPOINTS, 'mark-price-kline', 'linear', 'BTCUSDT', '15m', 10, nowMid(2500));
  assert.equal(m.bars.length, 10);
  assert.equal(m.bars[9].v, 0);
});

test('Bybit: Instrumente → Spezifikation inkl. Mindestmenge, Schrittweite, MMR', async () => {
  const f = mockFetch({ binance: {}, bybit: {}, now: () => 0, instruments: { linear: [linearInstrument('BTCUSDT', 'BTC')], spot: [] } });
  const { list, source } = await bybitInstruments(f, DEFAULT_ENDPOINTS, 'linear');
  const mmr = await bybitTier1Mmr(f, DEFAULT_ENDPOINTS, 'BTCUSDT');
  const spec = toSpec(list[0], mmr, source);
  assert.equal(spec.qtyStep, 0.001);
  assert.equal(spec.minOrderQty, 0.001);
  assert.equal(spec.minNotionalValue, 5);
  assert.equal(spec.maxLeverage, 100);
  assert.equal(spec.maintenanceMarginRate, 0.005);
  assert.equal(spec.mmrSource, 'bybit-risk-limit');
  assert.equal(spec.maxOrderQty, 500, 'Market-Order-Maximum');
});

test('Bybit: Funding-Historie rückwärts', async () => {
  const ev = Array.from({ length: 500 }, (_, i) => ({ t: Date.UTC(2026, 0, 1) + i * 8 * 3600_000, rate: 0.0001 }));
  const f = mockFetch({ binance: {}, bybit: {}, now: () => Date.UTC(2027, 0, 1), funding: { BTCUSDT: ev } });
  const r = await bybitFundingHistory(f, DEFAULT_ENDPOINTS, 'BTCUSDT', ev[50].t, ev[450].t);
  assert.equal(r.events.length, 401);
  assert.equal(r.events[0].t, ev[50].t);
});

test('Metalle: Rohstoff-Perpetual, Token und fehlende Instrumente werden unterschieden', () => {
  const inst = [
    { ...linearInstrument('XAUUSDT', 'XAU'), category: 'linear' as const },
    { ...linearInstrument('XAUTUSDT', 'XAUT'), category: 'linear' as const },
    { ...spotInstrument('PAXGUSDT', 'PAXG'), category: 'spot' as const },
    { ...linearInstrument('BTCUSDT', 'BTC'), category: 'linear' as const },
    { ...linearInstrument('BTC-27MAR27', 'BTC', { contractType: 'LinearFutures', quoteCoin: 'USDT' }), category: 'linear' as const },
  ];
  const gold = findCandidates(MARKETS.find((m) => m.key === 'GOLD')!, inst as never);
  assert.deepEqual(gold.map((c) => [c.symbol, c.productType, c.recommended]), [
    ['XAUUSDT', 'tradfi-perpetual', true],
    ['XAUTUSDT', 'token-perpetual', false],
    ['PAXGUSDT', 'token-spot', false],
  ]);
  assert.equal(gold[0].signal.provider, 'bybit', 'kein Binance-Spot-Äquivalent für XAU → Signal von Bybit');
  assert.equal(gold[2].signal.provider, 'binance');
  const copper = findCandidates(MARKETS.find((m) => m.key === 'COPPER')!, inst as never);
  assert.equal(copper.length, 0, 'Kupfer: nicht verfügbar');
  const btc = findCandidates(MARKETS.find((m) => m.key === 'BTC')!, inst as never);
  assert.deepEqual(btc.map((c) => c.symbol), ['BTCUSDT'], 'Futures mit Verfall ausgeschlossen');
  assert.equal(btc[0].signal.symbol, 'BTCUSDT');
  assert.equal(btc[0].signal.provider, 'binance');
});

test('Fehler: Netzwerk/CORS wird verständlich gemeldet, HTTP-Status und Bybit-retCode auch', async () => {
  const f = mockFetch({ binance: {}, bybit: {}, now: () => 0, failHosts: ['data-api.binance.vision'] });
  await assert.rejects(binanceHistory(f, DEFAULT_ENDPOINTS, 'BTCUSDT', '15m', 10, 0), (e: unknown) => e instanceof DataError && e.kind === 'network' && /CORS/.test(e.hint));
  const f403 = async () => ({ ok: false, status: 403, json: async () => ({}), text: async () => 'blocked' });
  await assert.rejects(getJson(f403, 'https://x'), (e: unknown) => e instanceof DataError && e.status === 403);
  const fRet = async () => ({ ok: true, status: 200, json: async () => ({ retCode: 10001, retMsg: 'params error', result: {} }), text: async () => '' });
  await assert.rejects(bybitInstruments(fRet, DEFAULT_ENDPOINTS, 'linear'), (e: unknown) => e instanceof DataError && e.kind === 'api');
});

test('Proxy-URL wird korrekt gebildet', () => {
  assert.equal(withProxy({ ...DEFAULT_ENDPOINTS, proxy: 'https://p.example.workers.dev/' }, 'https://api.bybit.com/v5/x?a=1'), 'https://p.example.workers.dev/?u=https%3A%2F%2Fapi.bybit.com%2Fv5%2Fx%3Fa%3D1');
  assert.ok(getTimeframe('1m').bybit === '1' && getTimeframe('1d').bybit === 'D');
});
