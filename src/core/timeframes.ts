// Zeitrahmen, die BEIDE Börsen anbieten (Binance-Spot und Bybit V5).
// Binance hat zusätzlich 8h/3d, Bybit zusätzlich nichts davon – daher nur die Schnittmenge.

export interface Timeframe {
  id: string; // interne ID = Binance-Schreibweise
  binance: string;
  bybit: string;
  ms: number; // 0 = variabel (Monat)
  label: string;
}

const MIN = 60_000;
const H = 60 * MIN;
const D = 24 * H;

export const TIMEFRAMES: Timeframe[] = [
  { id: '1m', binance: '1m', bybit: '1', ms: MIN, label: '1 Minute' },
  { id: '3m', binance: '3m', bybit: '3', ms: 3 * MIN, label: '3 Minuten' },
  { id: '5m', binance: '5m', bybit: '5', ms: 5 * MIN, label: '5 Minuten' },
  { id: '15m', binance: '15m', bybit: '15', ms: 15 * MIN, label: '15 Minuten' },
  { id: '30m', binance: '30m', bybit: '30', ms: 30 * MIN, label: '30 Minuten' },
  { id: '1h', binance: '1h', bybit: '60', ms: H, label: '1 Stunde' },
  { id: '2h', binance: '2h', bybit: '120', ms: 2 * H, label: '2 Stunden' },
  { id: '4h', binance: '4h', bybit: '240', ms: 4 * H, label: '4 Stunden' },
  { id: '6h', binance: '6h', bybit: '360', ms: 6 * H, label: '6 Stunden' },
  { id: '12h', binance: '12h', bybit: '720', ms: 12 * H, label: '12 Stunden' },
  { id: '1d', binance: '1d', bybit: 'D', ms: D, label: '1 Tag' },
  { id: '1w', binance: '1w', bybit: 'W', ms: 7 * D, label: '1 Woche' },
];

export function getTimeframe(id: string): Timeframe {
  const tf = TIMEFRAMES.find((t) => t.id === id);
  if (!tf) throw new Error(`Unbekannter Zeitrahmen: ${id}`);
  return tf;
}

/** Eine Kerze gilt erst als abgeschlossen, wenn ihre Endzeit vorbei ist. */
export function isClosed(barStart: number, tf: Timeframe, now: number): boolean {
  return barStart + tf.ms <= now;
}

/** Startzeit der letzten abgeschlossenen Kerze. (Wochenkerzen beginnen bei beiden Börsen am Montag.) */
export function lastClosedBarStart(tf: Timeframe, now: number): number {
  if (tf.id === '1w') {
    const MONDAY_OFFSET = 4 * 24 * 3600_000; // 1970-01-01 war ein Donnerstag
    const cur = Math.floor((now - MONDAY_OFFSET) / tf.ms) * tf.ms + MONDAY_OFFSET;
    return cur - tf.ms;
  }
  return Math.floor(now / tf.ms) * tf.ms - tf.ms;
}
