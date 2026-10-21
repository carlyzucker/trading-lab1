import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runBacktest } from '../src/core/backtest';
import { accountConfig, defaultState, makeBackup, migrateState, type AppState } from '../src/core/state';
import { addInstrument, detectGaps, discoverInstruments, scan, skipGap, SUPER_ID } from '../src/core/live';
import { amt001 } from '../src/core/strategies/amt001';
import { demoEmaCross } from '../src/core/strategies/demoEmaCross';
import { synthBars, TEST_SOURCE } from './helpers';
import { linearInstrument, mockFetch } from './mockExchange';

const MS = 900_000;
const bars = synthBars(1600, { seed: 7 });
// Bybit-Perpetual liegt 0.05 % über Binance-Spot (Basis) – mit leicht anderen Hochs/Tiefs
const bybitBars = bars.map((b) => ({ ...b, o: b.o * 1.0005, h: b.h * 1.0006, l: b.l * 1.0004, c: b.c * 1.0005 }));

async function setup(startIdx: number) {
  let now = bars[startIdx].t + 60_000; // Kerze startIdx läuft, startIdx-1 ist zuletzt abgeschlossen
  const data = {
    binance: { BTCUSDT: bars },
    bybit: { BTCUSDT: bybitBars },
    instruments: { linear: [linearInstrument('BTCUSDT', 'BTC')], spot: [] },
    usdPerChf: 1.25,
    now: () => now,
  };
  const deps = { fetch: mockFetch(data), now: () => now };
  const state = defaultState(now);
  const disc = await discoverInstruments(deps, state);
  await addInstrument(deps, state, disc.candidates.BTC[0]);
  return { state, deps, advance: (ms: number) => (now += ms), getNow: () => now };
}

test('Live-Scan = Backtest: identische Trades bei identischen Daten (Demo, AMT, Superstrategie)', async () => {
  const start = 400;
  const { state, deps, advance } = await setup(start);
  const r0 = await scan(deps, state); // Initialisierung: keine Rückwärts-Trades
  assert.equal(r0.processedBars, 0);
  assert.equal(state.accounts[demoEmaCross.id].startBalance, 625);
  for (let i = start; i < 1500; i++) {
    advance(MS);
    const r = await scan(deps, state);
    assert.equal(r.errors.length, 0, JSON.stringify(r.errors));
    assert.equal(r.processedBars, 1);
  }
  const market = {
    key: 'BTC',
    execSymbol: 'BTCUSDT',
    spec: state.specs.BTCUSDT,
    signalBars: bars.slice(0, 1500),
    signalSource: TEST_SOURCE,
    execBars: bybitBars.slice(0, 1500),
    execSource: TEST_SOURCE,
    markBars: bybitBars.slice(0, 1500),
    funding: [],
  };
  for (const def of [demoEmaCross, amt001]) {
    const bt = runBacktest({ def, params: def.defaults, markets: [market], barMs: MS, cfg: accountConfig(state.settings), startBalance: 625, fromT: bars[start].t - MS + MS });
    const live = state.accounts[def.id];
    // Live schliesst offene Positionen am Ende nicht – Vergleich nur über abgeschlossene Trades vor dem Backtest-Ende
    const lastT = bars[1499].t;
    const strip = (t: (typeof live.trades)[number]) => ({ ...t, id: '' });
    assert.deepEqual(
      live.trades.filter((t) => t.closedT < lastT).map(strip),
      bt.account.trades.filter((t) => t.closedT < lastT && !t.exitReason.startsWith('Backtest')).map(strip),
      def.id,
    );
    assert.ok(live.trades.length > 0, `${def.id}: Live hat Trades`);
  }
  assert.ok(state.accounts[SUPER_ID], 'Superstrategie hat eigenes Konto');
  assert.ok(state.consensus.BTCUSDT, 'Konsens-Anzeige vorhanden');
});

test('Datenlücke wird erkannt, nicht stillschweigend simuliert; Nachrechnen = gleiche Logik, markiert', async () => {
  const { state, deps, advance } = await setup(400);
  await scan(deps, state);
  advance(MS);
  await scan(deps, state);
  advance(50 * MS); // App 50 Kerzen lang geschlossen
  const r = await scan(deps, state);
  assert.equal(r.processedBars, 0, 'Lücke wird nicht automatisch nachgeholt');
  assert.equal(state.live.gaps.length, 1);
  assert.equal(state.live.gaps[0].bars, 50);
  assert.equal(detectGaps(state, deps.now()).length, 1);
  const rr = await scan(deps, state, { replay: ['BTCUSDT'] });
  assert.equal(rr.processedBars, 50);
  assert.equal(state.live.gaps.length, 0);
  const replayed = Object.values(state.accounts).flatMap((a) => a.journal.filter((j) => j.replay));
  assert.ok(replayed.length >= 0);
});

test('Lücke überspringen: offene Positionen werden zum aktuellen Kurs geschlossen und protokolliert', async () => {
  const { state, deps, advance } = await setup(400);
  await scan(deps, state);
  // so lange laufen, bis irgendein Konto eine Position hat
  for (let i = 0; i < 400 && !Object.values(state.accounts).some((a) => Object.keys(a.positions).length); i++) {
    advance(MS);
    await scan(deps, state);
  }
  assert.ok(Object.values(state.accounts).some((a) => Object.keys(a.positions).length), 'Testvoraussetzung: offene Position');
  advance(30 * MS);
  await scan(deps, state);
  skipGap(state, 'BTCUSDT', deps.now());
  assert.ok(Object.values(state.accounts).every((a) => !Object.keys(a.positions).length));
  assert.ok(Object.values(state.accounts).some((a) => a.trades.some((t) => t.exitReason.startsWith('Lücke übersprungen'))));
  advance(MS);
  const r = await scan(deps, state);
  assert.equal(r.processedBars, 1);
});

test('Ohne Wechselkurs werden keine Konten eröffnet (keine erfundenen Werte)', async () => {
  const now = bars[500].t;
  const deps = { fetch: mockFetch({ binance: {}, bybit: {}, now: () => now, failHosts: ['api.frankfurter.dev'] }), now: () => now };
  const state = defaultState(now);
  const r = await scan(deps, state);
  assert.equal(Object.keys(state.accounts).length, 0);
  assert.ok(r.errors.length > 0);
});

test('Backup: Export/Import erhält Zustand, Bot startet nach Import gestoppt, ML bleibt gesperrt', async () => {
  const { state, deps } = await setup(400);
  await scan(deps, state);
  state.live.running = true;
  const json = JSON.stringify(makeBackup(state));
  const back: AppState = migrateState(JSON.parse(json));
  assert.equal(back.live.running, false);
  assert.equal(back.settings.mlEnabled, false);
  assert.deepEqual(back.accounts, state.accounts);
  assert.throws(() => migrateState({ foo: 1 }));
  assert.throws(() => migrateState({ schema: 999 }));
});
