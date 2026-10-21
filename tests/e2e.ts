// Oberflächentest im echten Chromium (Handy-Grösse). Externe APIs werden abgefangen und mit
// KÜNSTLICHEN Testdaten im offiziellen Antwortformat beantwortet – nur zur Prüfung der Bedienabläufe.
// Aufruf: npx tsx tests/e2e.ts <ausgabe-ordner>
import { chromium } from 'playwright-core';
import { resolve } from 'node:path';
import { mkdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { synthBars } from './helpers';
import { linearInstrument, mockFetch, spotInstrument } from './mockExchange';

const out = process.argv[2] ?? 'e2e-out';
mkdirSync(out, { recursive: true });
const MS = 900_000;
const now = Date.now();
const n = 6000;
const t0 = Math.floor(now / MS) * MS - (n - 1) * MS;
const btc = synthBars(n, { seed: 7, start: 64000, t0 });
const eth = synthBars(n, { seed: 8, start: 2500, t0 });
const xau = synthBars(n, { seed: 9, start: 2650, t0, vol: 0.004 });
const by = (b: typeof btc, f: number) => b.map((x) => ({ ...x, o: x.o * f, h: x.h * f, l: x.l * f, c: x.c * f }));
const funding = Array.from({ length: 400 }, (_, i) => ({ t: Math.floor(now / 28_800_000) * 28_800_000 - i * 28_800_000, rate: 0.0001 })).reverse();

const mock = mockFetch({
  binance: { BTCUSDT: btc, ETHUSDT: eth, PAXGUSDT: xau },
  bybit: { BTCUSDT: by(btc, 1.0004), ETHUSDT: by(eth, 1.0003), XAUUSDT: xau, XAUTUSDT: by(xau, 1.001), PAXGUSDT: by(xau, 1.0008) },
  funding: { BTCUSDT: funding, ETHUSDT: funding, XAUUSDT: funding },
  instruments: {
    linear: [linearInstrument('BTCUSDT', 'BTC'), linearInstrument('ETHUSDT', 'ETH', { lotSizeFilter: { minOrderQty: '0.01', qtyStep: '0.01', maxOrderQty: '7240', maxMktOrderQty: '3000', minNotionalValue: '5' } }), linearInstrument('XAUUSDT', 'XAU'), linearInstrument('XAUTUSDT', 'XAUT')],
    spot: [spotInstrument('PAXGUSDT', 'PAXG'), spotInstrument('BTCUSDT', 'BTC')],
  },
  usdPerChf: 1.25,
  now: () => Date.now(),
});

const browser = await chromium.launch({ executablePath: process.env.CHROME ?? undefined });
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: (process.env.SCHEME as 'dark' | 'light') ?? 'light' });
await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
await ctx.route(/(data-api\.binance\.vision|api\.bybit\.com|api\.frankfurter\.dev)/, async (route) => {
  const res = await mock(route.request().url());
  await route.fulfill({ status: res.status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: await res.text() });
});
const page = await ctx.newPage();
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const server = createServer((_q, r) => {
  r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  r.end(readFileSync(resolve('dist/index.html')));
}).listen(4173);
await page.goto('http://localhost:4173/');
await page.waitForSelector('text=Trading Strategy Lab');
await page.waitForTimeout(800);
const shot = (name: string) => page.screenshot({ path: `${out}/${name}.png`, fullPage: true });

await shot('01-start-leer');
await page.click('nav >> text=Märkte');
await page.click('button:has-text("Laden")');
await page.waitForSelector('text=Empfohlen');
// BTC, ETH und Gold (TradFi-Perpetual) wählen
for (const sym of ['BTCUSDT', 'ETHUSDT', 'XAUUSDT']) {
  await page.locator('.cand', { hasText: sym }).first().locator('button:has-text("Wählen")').click();
  await page.waitForSelector(`text=Simuliert: ${sym}`);
}
await page.click('nav >> text=Start');
await page.click('button:has-text("Jetzt prüfen")');
await page.waitForTimeout(1500);
await page.click('nav >> text=Märkte');
await page.waitForTimeout(300);
await shot('02-maerkte');
await page.click('nav >> text=Start');
await page.click('button:has-text("Bot starten")');
await page.waitForTimeout(1200);
await shot('03-start-laeuft');

await page.click('nav >> text=Backtest');
await page.selectOption('#bt-n', '5000');
await page.click('button:has-text("Kurse laden & testen")');
await page.waitForSelector('h2:has-text("Strategievergleich")', { timeout: 120_000 });
await shot('04-backtest');
await page.click('label:has-text("Walk-Forward")');
await page.click('button:has-text("Kurse laden & testen")');
await page.waitForSelector('text=Walk-Forward: Gewichte', { timeout: 120_000 });
await shot('05-walkforward');

await page.click('nav >> text=Super');
await page.waitForTimeout(300);
await shot('06-super');
await page.click('nav >> text=Strategien');
await page.click('button:has-text("Einstellungen & Annahmen") >> nth=0');
await shot('07-strategien');
await page.click('nav >> text=Paper');
await shot('08-paper');
await page.click('[aria-label="Einstellungen"]');
await shot('09-einstellungen');

// Neu laden → Zustand muss aus IndexedDB zurückkommen
await page.reload();
await page.waitForSelector('text=Trading Strategy Lab');
await page.click('nav >> text=Start');
await page.waitForTimeout(800);
const persisted = await page.locator('text=BTCUSDT, ETHUSDT, XAUUSDT').count();
const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
console.log(JSON.stringify({ persisted: persisted > 0, horizontalOverflow: overflow, errors }, null, 1));
await browser.close();
server.close();
