import { atr, ema } from '../indicators';
import type { Signal } from '../types';
import { num, type StrategyDef } from './types';

/** DEMO – dient nur dazu, Backtest- und Paper-Engine überprüfbar zu machen. Kein Anspruch auf Profitabilität. */
export const demoEmaCross: StrategyDef = {
  id: 'demo-ema-cross',
  name: 'DEMO – EMA-Kreuzung',
  version: '1.0.0',
  changelog: [{ version: '1.0.0', note: 'Erste Version zur Engine-Prüfung' }],
  kind: 'demo',
  description:
    'Long, wenn der schnelle EMA den langsamen von unten kreuzt; Short umgekehrt. Stop = ATR-Vielfaches, Ziel = festes Chance-Risiko-Verhältnis. Nur zur Prüfung der Engine.',
  assumptions: ['Alle Parameter sind willkürliche Standardwerte einer Lehrbuch-Strategie.'],
  params: [
    { key: 'fast', label: 'EMA schnell', type: 'int', min: 2, max: 200, step: 1 },
    { key: 'slow', label: 'EMA langsam', type: 'int', min: 3, max: 400, step: 1 },
    { key: 'atrPeriod', label: 'ATR-Periode', type: 'int', min: 2, max: 100, step: 1 },
    { key: 'atrMult', label: 'Stop (× ATR)', type: 'number', min: 0.5, max: 10, step: 0.1 },
    { key: 'rr', label: 'Ziel (× Risiko)', type: 'number', min: 0.5, max: 10, step: 0.1 },
    { key: 'allowShort', label: 'Short erlaubt', type: 'bool' },
  ],
  defaults: { fast: 9, slow: 21, atrPeriod: 14, atrMult: 2, rr: 2, allowShort: true },
  lookback: (p) => Math.max(num(p, 'slow'), num(p, 'atrPeriod')) + 3,
  evaluate({ bars, params }): Signal | null {
    const fast = num(params, 'fast');
    const slow = num(params, 'slow');
    if (fast >= slow) return null;
    const closes = bars.map((b) => b.c);
    const ef = ema(closes, fast);
    const es = ema(closes, slow);
    const a = atr(bars, num(params, 'atrPeriod'));
    const i = bars.length - 1;
    if (i < 1 || !Number.isFinite(es[i - 1]) || !Number.isFinite(a[i])) return null;
    const crossUp = ef[i - 1] <= es[i - 1] && ef[i] > es[i];
    const crossDown = ef[i - 1] >= es[i - 1] && ef[i] < es[i];
    const c = bars[i].c;
    const d = a[i] * num(params, 'atrMult');
    const rr = num(params, 'rr');
    if (crossUp) {
      return {
        side: 'long',
        refPrice: c,
        entries: [{ kind: 'market', riskFraction: 1 }],
        stop: c - d,
        targets: [{ price: c + d * rr, fraction: 1 }],
        reason: `EMA${fast} kreuzt EMA${slow} nach oben`,
      };
    }
    if (crossDown && params.allowShort) {
      return {
        side: 'short',
        refPrice: c,
        entries: [{ kind: 'market', riskFraction: 1 }],
        stop: c + d,
        targets: [{ price: c - d * rr, fraction: 1 }],
        reason: `EMA${fast} kreuzt EMA${slow} nach unten`,
      };
    }
    return null;
  },
};
