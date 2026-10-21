// 24/7-Betrieb (Phase 2): derselbe Trading-Kern wie in der Handy-App, als Node.js-Prozess.
// Start:  npm run worker
// Optionen: --import backup.json   (Handy-Backup übernehmen)
//           --once                 (nur ein Scan, z.B. zum Testen)
// Umgebungsvariablen: STATE_FILE (Standard ./data/state.json), GAP_POLICY=replay|skip (Standard replay)

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { addInstrument, discoverInstruments, scan, skipGap, type LiveDeps } from '../src/core/live';
import { defaultState, makeBackup, migrateState, type AppState } from '../src/core/state';

const STATE_FILE = process.env.STATE_FILE ?? './data/state.json';
const GAP_POLICY = (process.env.GAP_POLICY ?? 'replay') as 'replay' | 'skip';
const args = process.argv.slice(2);

const deps: LiveDeps = { fetch: (u, i) => fetch(u, i), now: () => Date.now() };

function load(): AppState {
  const imp = args.indexOf('--import');
  if (imp >= 0) {
    const s = migrateState(JSON.parse(readFileSync(args[imp + 1], 'utf8')));
    console.log(`Backup importiert: ${args[imp + 1]}`);
    return s;
  }
  if (existsSync(STATE_FILE)) return migrateState(JSON.parse(readFileSync(STATE_FILE, 'utf8')));
  return defaultState();
}

function save(state: AppState) {
  mkdirSync(dirname(STATE_FILE), { recursive: true });
  const tmp = `${STATE_FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify(makeBackup(state)));
  renameSync(tmp, STATE_FILE); // atomar: nie eine halb geschriebene Datei
}

async function firstSetup(state: AppState) {
  if (state.instruments.length) return;
  const d = await discoverInstruments(deps, state);
  for (const e of d.errors) console.error(`Instrumente (${e.category}) nicht abrufbar: ${e.message} – ${e.hint}`);
  if (d.errors.length) {
    console.error('Instrumentliste unvollständig – Einrichtung wird beim nächsten Scan wiederholt.');
    return;
  }
  for (const [key, list] of Object.entries(d.candidates)) {
    const rec = list.find((c) => c.recommended);
    if (rec) {
      await addInstrument(deps, state, rec);
      console.log(`${key}: ${rec.symbol} (${rec.productType})`);
    } else console.log(`${key}: bei Bybit nicht verfügbar – wird nicht simuliert`);
  }
}

async function tick(state: AppState) {
  await firstSetup(state);
  const r = await scan(deps, state, { replay: GAP_POLICY === 'replay' ? state.instruments.map((i) => i.symbol) : [] });
  if (GAP_POLICY === 'skip')
    for (const g of [...state.live.gaps]) {
      try {
        skipGap(state, g.symbol, deps.now());
      } catch (e) {
        console.error(`Lücke ${g.symbol}: ${(e as Error).message}`);
      }
    }
  const eq = Object.values(state.accounts).map((a) => `${a.id}: ${a.balance.toFixed(2)} USDT, ${Object.keys(a.positions).length} offen`).join(' | ');
  console.log(`[${new Date(r.at).toISOString()}] Kerzen ${r.processedBars}, Signale ${r.newSignals.length}, Fehler ${r.errors.length} · ${eq}`);
  for (const e of r.errors) console.error(`  ${e.symbol ?? ''} ${e.message} – ${e.hint}`);
  save(state);
}

async function main() {
  const state = load();
  state.live.running = true;
  await firstSetup(state);
  save(state);
  if (args.includes('--once')) return tick(state);
  console.log(`Worker läuft – Scan alle ${state.settings.scanIntervalSec} s. Beenden mit Strg+C.`);
  for (;;) {
    try {
      await tick(state);
    } catch (e) {
      console.error('Scan fehlgeschlagen:', e);
    }
    await new Promise((r) => setTimeout(r, state.settings.scanIntervalSec * 1000));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
