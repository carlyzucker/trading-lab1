// Gemeinsame Typen des Trading-Kerns.
// Der Kern hat KEINE Abhängigkeit zu Browser oder React und läuft identisch in Node (24/7-Server).

/** Eine abgeschlossene Kerze. t = Startzeit (ms, UTC). */
export interface Bar {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export type Side = 'long' | 'short';

export type Provider = 'binance' | 'bybit' | 'frankfurter' | 'test';

/** Herkunft einer Zahl – wird überall mitgeführt, damit jede Berechnung ihre Quelle zeigt. */
export interface DataSource {
  provider: Provider;
  endpoint: string;
  symbol?: string;
  category?: string;
  interval?: string;
  fetchedAt: number;
  note?: string;
}

export interface SourcedBars {
  bars: Bar[];
  source: DataSource;
}

/** Bybit-Handelsbedingungen eines Instruments (aus /v5/market/instruments-info + risk-limit). */
export interface InstrumentSpec {
  exchange: 'bybit';
  category: 'linear' | 'spot';
  symbol: string;
  baseCoin: string;
  quoteCoin: string;
  settleCoin: string;
  status: string;
  contractType: string; // z.B. LinearPerpetual, LinearFutures, Spot
  tickSize: number;
  qtyStep: number;
  minOrderQty: number;
  maxOrderQty: number;
  minNotionalValue: number;
  /** Kontraktmultiplikator. Bybit-USDT-Linear: 1 Kontrakt = 1 Einheit Basiswert. */
  contractMultiplier: number;
  maxLeverage: number;
  fundingIntervalMin: number; // 0 bei Spot
  /** Maintenance-Margin-Rate der niedrigsten Risikostufe (z.B. 0.005). */
  maintenanceMarginRate: number;
  mmrSource: 'bybit-risk-limit' | 'annahme';
  source: DataSource;
}

export interface FeeModel {
  takerRate: number; // z.B. 0.00055
  makerRate: number; // z.B. 0.0002
  label: string;
}

export interface FundingEvent {
  t: number;
  rate: number; // positiv: Long zahlt an Short
}

/** Ein Einstiegs-Teil (gestaffelte Einstiege). */
export interface EntryTranche {
  kind: 'market' | 'limit';
  /** Bei limit: Preis auf Signaldaten-Basis. */
  price?: number;
  /** Anteil am geplanten Gesamtrisiko (0..1). Summe aller Tranchen <= 1. */
  riskFraction: number;
  /** Limit gültig für so viele Ausführungskerzen. */
  validBars?: number;
}

export interface TargetPlan {
  price: number; // Signaldaten-Basis
  fraction: number; // Anteil der Gesamtmenge, letzter Target schliesst Rest
}

/** Signal einer Strategie, berechnet am Schluss einer abgeschlossenen Kerze. */
export interface Signal {
  side: Side;
  /** Referenzpreis (Schlusskurs der Signalkerze auf Signaldaten). */
  refPrice: number;
  entries: EntryTranche[];
  stop: number;
  targets: TargetPlan[];
  moveStopToBreakevenAfterFirstTarget?: boolean;
  reason: string;
}

export interface TimedSignal extends Signal {
  t: number; // Startzeit der Signalkerze
  strategyId: string;
}
