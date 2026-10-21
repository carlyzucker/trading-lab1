import { atr } from '../indicators';
import type { Bar, Signal } from '../types';
import { buildVolumeProfile } from '../volumeProfile';
import { num, type StrategyDef } from './types';

/**
 * 001 – Imre Gams Auction Market Theory (TESTVARIANTE, experimentell)
 *
 * Quelle: Video "So tradet ein Hedgefonds-Manager WIRKLICH (LIVE TRADE)", Kanal Tim Flossbach,
 * https://www.youtube.com/watch?v=MbxYHR8qCps. Das Video beschreibt die Ideen (Auction Market Theory,
 * Value-Area-Ränder, Volume Profile, Invalidierung), aber KEINE exakten Regeln. Jede Zahl unten ist
 * deshalb eine eigene, klar markierte Annahme. Fibonacci-Elemente aus dem Video sind noch nicht enthalten.
 *
 * Definierte Regel (Long; Short spiegelbildlich):
 *  1. Volumenprofil über `profileBars` Kerzen VOR dem Beobachtungsfenster → POC, VAH, VAL.
 *  2. Ausbruch: die letzten ≥ `minOutsideBars` Schlusskurse (innerhalb von `maxOutsideBars`) lagen unter VAL.
 *  3. Rückkehr in den Value-Bereich: aktuelle Kerze schliesst über VAL und unter POC.
 *  4. Marktstruktur-Bestätigung (optional): Schluss über dem Hoch der Vorkerze.
 *  5. Gestaffelter Einstieg: 1. Teil Market, 2. Teil Limit am VAL (Retest), begrenzte Gültigkeit.
 *  6. Strukturabhängiger Stop: tiefstes Tief des Ausbruchs − Puffer × ATR.
 *  7. Teilgewinn am POC, Rest am gegenüberliegenden Rand (VAH); danach Stop auf Einstand.
 */
export const amt001: StrategyDef = {
  id: 'amt-001-imre-gams',
  name: '001 – Imre Gams Auction Market Theory',
  version: '0.1.0-exp',
  changelog: [{ version: '0.1.0-exp', note: 'Erste eindeutig definierte Testvariante (Rückkehr in die Value Area)' }],
  kind: 'experimental',
  source: 'https://www.youtube.com/watch?v=MbxYHR8qCps',
  description:
    'Handelt die Rückkehr des Preises in die Value Area des vorherigen Volumenprofils (gescheiterte Auktion ausserhalb von Value). Ziele: POC, dann gegenüberliegender Value-Rand.',
  assumptions: [
    'Volumenprofil aus Kerzen statt Tick-Daten: Volumen gleichmässig über die Kerzenspanne verteilt.',
    'Profil-Länge (profileBars), Bins, Ausbruchsfenster, ATR-Puffer, Teilgewinn-Anteil und Mindest-CRV sind NICHT aus dem Video belegt.',
    'Value Area = 70 % des Volumens ist eine verbreitete Konvention, im Video nicht als Zahl genannt.',
    'Gestaffelter Einstieg 50/50 mit Limit am Value-Rand ist eine eigene Konkretisierung.',
    'Fibonacci-Bestandteile aus dem Video sind in v0.1 nicht umgesetzt.',
  ],
  params: [
    { key: 'profileBars', label: 'Profil-Länge (Kerzen)', type: 'int', min: 20, max: 1000, step: 1, assumption: true },
    { key: 'bins', label: 'Preisstufen im Profil', type: 'int', min: 10, max: 200, step: 1, assumption: true },
    { key: 'valueAreaPct', label: 'Value Area Anteil', type: 'number', min: 0.5, max: 0.9, step: 0.01, assumption: true, help: '0.70 = 70 %' },
    { key: 'minOutsideBars', label: 'Min. Kerzen ausserhalb', type: 'int', min: 1, max: 20, step: 1, assumption: true },
    { key: 'maxOutsideBars', label: 'Ausbruchsfenster (Kerzen)', type: 'int', min: 2, max: 100, step: 1, assumption: true },
    { key: 'confirmStructure', label: 'Struktur-Bestätigung', type: 'bool', assumption: true, help: 'Schluss jenseits Hoch/Tief der Vorkerze' },
    { key: 'atrPeriod', label: 'ATR-Periode', type: 'int', min: 2, max: 100, step: 1, assumption: true },
    { key: 'stopBufferAtr', label: 'Stop-Puffer (× ATR)', type: 'number', min: 0, max: 3, step: 0.05, assumption: true },
    { key: 'scaleIn', label: 'Gestaffelter Einstieg', type: 'bool', assumption: true },
    { key: 'limitValidBars', label: 'Limit gültig (Kerzen)', type: 'int', min: 1, max: 50, step: 1, assumption: true },
    { key: 'tp1Fraction', label: 'Teilgewinn am POC (Anteil)', type: 'number', min: 0.1, max: 0.9, step: 0.05, assumption: true },
    { key: 'minRR', label: 'Mindest-CRV bis POC', type: 'number', min: 0, max: 5, step: 0.1, assumption: true },
    { key: 'breakevenAfterTp1', label: 'Stop auf Einstand nach Ziel 1', type: 'bool', assumption: true },
    { key: 'allowShort', label: 'Short erlaubt', type: 'bool' },
  ],
  defaults: {
    profileBars: 96,
    bins: 40,
    valueAreaPct: 0.7,
    minOutsideBars: 1,
    maxOutsideBars: 12,
    confirmStructure: true,
    atrPeriod: 14,
    stopBufferAtr: 0.25,
    scaleIn: true,
    limitValidBars: 3,
    tp1Fraction: 0.5,
    minRR: 1,
    breakevenAfterTp1: true,
    allowShort: true,
  },
  lookback: (p) => num(p, 'profileBars') + num(p, 'maxOutsideBars') + 1,
  evaluate({ bars, params }): Signal | null {
    const P = num(params, 'profileBars');
    const M = num(params, 'maxOutsideBars');
    const L = bars.length;
    if (L < P + M + 1) return null;
    const cur = bars[L - 1];
    const prev = bars[L - 2];
    const recent = bars.slice(L - 1 - M, L - 1);
    const profileBars = bars.slice(L - 1 - M - P, L - 1 - M);
    const vp = buildVolumeProfile(profileBars, num(params, 'bins'), num(params, 'valueAreaPct'));
    if (!vp) return null;
    const a = atr(bars, num(params, 'atrPeriod'))[L - 1];
    if (!Number.isFinite(a)) return null;
    const buffer = a * num(params, 'stopBufferAtr');
    const minOut = num(params, 'minOutsideBars');
    const scale = !!params.scaleIn;
    const fmt = (x: number) => x.toPrecision(6);

    const outsideRun = (pred: (b: Bar) => boolean): Bar[] => {
      const run: Bar[] = [];
      for (let i = recent.length - 1; i >= 0 && pred(recent[i]); i--) run.unshift(recent[i]);
      return run;
    };

    // LONG: Rückkehr von unterhalb VAL
    if (prev.c < vp.val && cur.c > vp.val && cur.c < vp.poc && (!params.confirmStructure || cur.c > prev.h)) {
      const run = outsideRun((b) => b.c < vp.val);
      if (run.length >= minOut && run.length < M) {
        const exLow = Math.min(cur.l, ...run.map((b) => b.l));
        const stop = exLow - buffer;
        const rr = (vp.poc - cur.c) / (cur.c - stop);
        if (stop < cur.c && rr >= num(params, 'minRR')) {
          const canLimit = scale && vp.val > stop && vp.val < cur.c;
          return {
            side: 'long',
            refPrice: cur.c,
            entries: canLimit
              ? [
                  { kind: 'market', riskFraction: 0.5 },
                  { kind: 'limit', price: vp.val, riskFraction: 0.5, validBars: num(params, 'limitValidBars') },
                ]
              : [{ kind: 'market', riskFraction: 1 }],
            stop,
            targets: [
              { price: vp.poc, fraction: num(params, 'tp1Fraction') },
              { price: vp.vah, fraction: 1 },
            ],
            moveStopToBreakevenAfterFirstTarget: !!params.breakevenAfterTp1,
            reason: `Rückkehr über VAL ${fmt(vp.val)} nach ${run.length} Kerze(n) darunter · POC ${fmt(vp.poc)} · VAH ${fmt(vp.vah)} · CRV ${rr.toFixed(2)}`,
          };
        }
      }
    }

    // SHORT: Rückkehr von oberhalb VAH
    if (params.allowShort && prev.c > vp.vah && cur.c < vp.vah && cur.c > vp.poc && (!params.confirmStructure || cur.c < prev.l)) {
      const run = outsideRun((b) => b.c > vp.vah);
      if (run.length >= minOut && run.length < M) {
        const exHigh = Math.max(cur.h, ...run.map((b) => b.h));
        const stop = exHigh + buffer;
        const rr = (cur.c - vp.poc) / (stop - cur.c);
        if (stop > cur.c && rr >= num(params, 'minRR')) {
          const canLimit = scale && vp.vah < stop && vp.vah > cur.c;
          return {
            side: 'short',
            refPrice: cur.c,
            entries: canLimit
              ? [
                  { kind: 'market', riskFraction: 0.5 },
                  { kind: 'limit', price: vp.vah, riskFraction: 0.5, validBars: num(params, 'limitValidBars') },
                ]
              : [{ kind: 'market', riskFraction: 1 }],
            stop,
            targets: [
              { price: vp.poc, fraction: num(params, 'tp1Fraction') },
              { price: vp.val, fraction: 1 },
            ],
            moveStopToBreakevenAfterFirstTarget: !!params.breakevenAfterTp1,
            reason: `Rückkehr unter VAH ${fmt(vp.vah)} nach ${run.length} Kerze(n) darüber · POC ${fmt(vp.poc)} · VAL ${fmt(vp.val)} · CRV ${rr.toFixed(2)}`,
          };
        }
      }
    }
    return null;
  },
};
