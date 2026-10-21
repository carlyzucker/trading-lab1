# Trading Strategy Lab – v0.1

Private Paper-Trading-App. **Nur Simulation. Kein echtes Geld, keine API-Schlüssel.**

- Signale: öffentliche Binance-Spot-Daten (`data-api.binance.vision`), sonst Bybit selbst
- Ausführung: öffentliche Bybit-V5-Daten (`api.bybit.com`) – Last-Preis für Fills, Mark-Preis für Liquidation, echte Funding-Historie, echte Mindestmengen/Schrittweiten
- 500 CHF je Konto, umgerechnet in USDT zum EZB-Kurs (Annahme 1 USDT = 1 USD)
- 2 % Risiko je Trade inkl. Gebühren, Hebel 1–3x (isolierte Margin)

## Auf dem Handy benutzen (kostenlos, ca. 10 Minuten, einmalig)

Die Claude-Vorschau blockiert aus Sicherheitsgründen **alle** externen Abfragen – dort siehst du die Oberfläche, aber keine Kurse. Für echte Daten muss die App auf einer normalen Webadresse liegen. Am einfachsten mit GitHub Pages:

1. Auf github.com ein kostenloses Konto anlegen (im Handy-Browser).
2. Oben rechts **+** → **New repository** → Name `trading-lab` → **Public** → **Create repository**.
   (Kostenlose Pages-Seiten brauchen ein öffentliches Repository. Es enthält nur Programmcode, keine Daten von dir – deine Konten bleiben lokal im Handy.)
3. Im neuen Repository: **Add file → Upload files** → die Datei `index.html` (aus dem Ordner `dist`) hochladen → **Commit changes**.
4. **Settings → Pages** → bei *Branch* `main` und `/ (root)` wählen → **Save**.
5. Nach 1–2 Minuten erscheint oben die Adresse, z.B. `https://DEINNAME.github.io/trading-lab/`. In Chrome öffnen → Menü ⋮ → **Zum Startbildschirm hinzufügen**.

Update später: neue `index.html` hochladen (gleicher Weg, Datei ersetzen). Deine Daten bleiben erhalten, solange die Adresse gleich bleibt. Vorher trotzdem unter Einstellungen ein Backup machen.

### Falls „Datenquellen prüfen“ bei Bybit „Netzwerkfehler“ meldet

Dann blockiert Chrome die direkte Abfrage (CORS). Lösung ohne Kosten: eigener Mini-Proxy bei Cloudflare.

1. dash.cloudflare.com → kostenloses Konto → **Workers & Pages → Create → Worker** → Name wählen → **Deploy**.
2. **Edit code** → Inhalt von `cloudflare-proxy/worker.js` einfügen → **Deploy**.
3. Die Worker-Adresse (`https://…workers.dev`) in der App unter **Einstellungen → Eigener Proxy** eintragen.

Der Proxy leitet nur lesende Marktdaten-Anfragen weiter (fest eingeschränkt auf Bybit-Marktdaten, Binance-Marktdaten und den EZB-Kurs).

## Was die App macht – und was nicht

| Thema | Verhalten |
|---|---|
| App offen | Alle 60 s Scan: neue **abgeschlossene** Kerzen holen, Strategien rechnen, Paper-Trades ausführen, speichern (IndexedDB) |
| App im Hintergrund / zu | Es wird **nichts** simuliert. Beim nächsten Öffnen wird die Lücke erkannt (> 3 Kerzen). Du wählst: *Nachrechnen* (echte historische Kerzen, gleiche Regeln, markiert) oder *Überspringen* (offene Positionen werden zum aktuellen Kurs geschlossen) |
| Kein Kurs verfügbar | Fehler wird angezeigt, kein Trade, keine Ersatzwerte |
| Instrument fehlt bei Bybit | „Nicht verfügbar“, kein Paper-Trade |
| Gold/Silber/Kupfer | Die App liest die echte Bybit-Liste. TradFi-Perpetuals (USDT-Derivat auf den Rohstoffpreis) werden empfohlen; Gold-**Token** (XAUT, PAXG) nur auf ausdrücklichen Wunsch und klar beschriftet. MT5-CFDs sind über die öffentliche API nicht zugänglich und werden nicht verwendet. |

### Ausführungsmodell (konservativ)

Signal am Kerzenschluss → Einstieg frühestens zur Eröffnung der **nächsten** Kerze. Innerhalb einer Kerze: Einstiege → Liquidation (Mark-Preis) → Stop → Ziele → Funding. Treffen Stop und Ziel dieselbe Kerze, zählt der Verlust. Kurslücken über den Stop werden zum Eröffnungskurs ausgeführt.
Preisniveaus aus Binance-Signalen werden proportional auf Bybit übertragen (Basis-Anpassung).

### Annahmen (in der App markiert)

- Gebühren: Bybit Nicht-VIP (Derivate Taker 0.055 %, Maker 0.02 %; Spot 0.10 %) – einstellbar
- Slippage 5 Basispunkte auf Market-/Stop-Ausführungen – einstellbar
- Liquidationspreis vereinfacht (isolierte Margin, Tier-1-Maintenance-Margin aus `/v5/market/risk-limit`)
- Volumenprofil aus Kerzen (keine Tickdaten)
- Strategie 001: alle Zahlenparameter sind eigene Annahmen, weil das Video keine exakten Regeln nennt

## Strategien

- `001 – Imre Gams Auction Market Theory` (experimentell): Rückkehr in die Value Area des vorherigen Volumenprofils; gestaffelter Einstieg (Market + Limit am Value-Rand), Stop unter/über dem Ausbruchsextrem, Teilgewinn am POC, Rest am gegenüberliegenden Rand, danach Stop auf Einstand. Fibonacci aus dem Video ist noch nicht enthalten.
- `DEMO – EMA-Kreuzung`: nur zur Prüfung der Engine.
- **Superstrategie**: handelt nur, wenn mindestens 2 unabhängige Strategiegruppen übereinstimmen und keine widerspricht. Gewichte/Gruppen kommen nur aus Walk-Forward-Training. ML ist gesperrt. Mit nur einer echten Strategie handelt sie in v0.1 deshalb (korrekt) nicht.

Neue Strategie: Datei in `src/core/strategies/` anlegen (Vorlage: `demoEmaCross.ts`) und in `registry.ts` eintragen.

## 24/7 auf eigenem PC / Miniserver (Phase 2)

Derselbe Kern läuft in Node.js:

```
npm install
npm run probe          # prüft alle Datenquellen von diesem Rechner aus
npm run worker         # Dauerbetrieb, Zustand in ./data/state.json
npm run worker -- --import backup.json   # Handy-Backup übernehmen
```

Auf dem Server werden Lücken standardmässig nachgerechnet (`GAP_POLICY=replay`).

## Entwicklung

```
npm install
npm test          # 36 Tests: Indikatoren, Volumenprofil, Bybit-Regeln, Ausführung, Look-ahead, Live = Backtest, Lücken, Backup, Superstrategie
npm run typecheck
npm run build     # erzeugt dist/index.html (eine Datei, alles enthalten)
npm run e2e       # Oberflächentest im Chromium mit Testdaten
```

Hinweis: Der Ordner `types/` enthält Minimal-Typen für React, weil `@types/react` in der Build-Umgebung nicht installierbar war. Auf einem normalen Rechner `npm i -D @types/react @types/react-dom` ausführen und `types/` löschen.

## Projektstruktur

```
src/core/            Trading-Kern (ohne Browser-Abhängigkeit, läuft auch in Node)
  data/              Binance, Bybit, EZB-Kurs, Markt-Zuordnung, Quellen-Prüfung
  strategies/        Strategiebibliothek
  account.ts         Konto, Orders, Fills, Stops, Ziele, Liquidation, Funding
  backtest.ts        Backtest (gleiche Schrittfunktion wie Live)
  live.ts            Live-Scan, Lücken, Konten
  superstrategy.ts   Konsens, Gruppen, Gewichte, Walk-Forward
src/ui/              React-Oberfläche, IndexedDB, Web Worker
server/              Node-Worker (24/7) und Datenquellen-Prüfung
tests/               automatische Tests
cloudflare-proxy/    optionaler kostenloser CORS-Proxy
```
