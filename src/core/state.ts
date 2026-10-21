// Gesamter gespeicherter Zustand (IndexedDB im Handy, JSON-Datei auf dem Server).
import type { Account, AccountConfig } from './account';
import { DEFAULT_FEES } from './bybitRules';
import { DEFAULT_ENDPOINTS, type Endpoints } from './data/http';
import type { MarketKey, ProductType } from './data/markets';
import type { FxRate } from './data/fx';
import { STRATEGIES } from './strategies/registry';
import type { Params } from './strategies/types';
import { DEFAULT_SUPER_CONFIG, type SuperConfig } from './superstrategy';
import type { DataSource, InstrumentSpec, Side } from './types';

export const SCHEMA_VERSION = 1;

export interface Settings {
  timeframe: string;
  startCapitalChf: number;
  riskPct: number;
  leverage: number;
  maxLeverage: number;
  slippageBps: number;
  fees: AccountConfig['fees'];
  scanIntervalSec: number;
  maxInstruments: number;
  endpoints: Endpoints;
  superConfig: SuperConfig;
  superAllowDemo: boolean;
  mlEnabled: false; // bewusst nicht aktivierbar in v0.1
}

export interface SelectedInstrument {
  marketKey: MarketKey;
  symbol: string; // Bybit
  category: 'linear' | 'spot';
  productType: ProductType;
  signal: { provider: 'binance' | 'bybit'; symbol: string; category?: 'linear' | 'spot' };
  enabled: boolean;
}

export interface StrategyState {
  enabled: boolean;
  params: Params;
  /** Jede Änderung der Einstellungen erzeugt eine neue Konfigurations-Version */
  configVersion: number;
  history: { configVersion: number; codeVersion: string; params: Params; changedAt: number }[];
}

export interface AccountMeta {
  startChf: number;
  usdPerChfAtStart: number;
  fxDate: string;
  createdAt: number;
  strategyCodeVersion: string;
  strategyConfigVersion: number;
}

export interface MarketQuote {
  binance?: { price: number; source: DataSource };
  bybit?: { last: number; mark?: number; bid?: number; ask?: number; fundingRate?: number; nextFundingTime?: number; source: DataSource };
  error?: { message: string; hint: string; at: number };
  updatedAt?: number;
}

export interface GapInfo {
  symbol: string;
  fromT: number; // letzte verarbeitete Kerze
  toT: number; // letzte abgeschlossene Kerze jetzt
  bars: number;
}

export interface ConsensusView {
  t: number;
  votes: { strategyId: string; group: string; side: Side; ageBars: number }[];
  decision: Side | null;
  explanation: string;
}

export interface LiveState {
  running: boolean;
  lastScanAt?: number;
  lastScanOkAt?: number;
  lastProcessed: Record<string, number>;
  stoppedAt?: number;
  gaps: GapInfo[];
  scanCount: number;
  lastErrors: { at: number; symbol?: string; message: string; hint: string }[];
}

export interface AppState {
  schema: number;
  createdAt: number;
  settings: Settings;
  instruments: SelectedInstrument[];
  specs: Record<string, InstrumentSpec>;
  strategies: Record<string, StrategyState>;
  superWeights: { weights: Record<string, number>; groups: Record<string, string>; origin: string };
  accounts: Record<string, Account>;
  accountMeta: Record<string, AccountMeta>;
  quotes: Partial<Record<MarketKey, MarketQuote>>;
  fx?: FxRate;
  live: LiveState;
  consensus: Record<string, ConsensusView>;
}

export function defaultState(now = Date.now()): AppState {
  const strategies: Record<string, StrategyState> = {};
  for (const s of STRATEGIES) {
    strategies[s.id] = {
      enabled: true,
      params: { ...s.defaults },
      configVersion: 1,
      history: [{ configVersion: 1, codeVersion: s.version, params: { ...s.defaults }, changedAt: now }],
    };
  }
  return {
    schema: SCHEMA_VERSION,
    createdAt: now,
    settings: {
      timeframe: '15m',
      startCapitalChf: 500,
      riskPct: 0.02,
      leverage: 1,
      maxLeverage: 3,
      slippageBps: 5,
      fees: DEFAULT_FEES,
      scanIntervalSec: 60,
      maxInstruments: 20,
      endpoints: { ...DEFAULT_ENDPOINTS },
      superConfig: { ...DEFAULT_SUPER_CONFIG },
      superAllowDemo: false,
      mlEnabled: false,
    },
    instruments: [],
    specs: {},
    strategies,
    superWeights: { weights: {}, groups: {}, origin: 'Gleichgewichtung (Standard)' },
    accounts: {},
    accountMeta: {},
    quotes: {},
    live: { running: false, lastProcessed: {}, gaps: [], scanCount: 0, lastErrors: [] },
    consensus: {},
  };
}

export function accountConfig(s: Settings): AccountConfig {
  return {
    riskPct: s.riskPct,
    leverage: Math.min(Math.max(1, s.leverage), s.maxLeverage),
    maxLeverage: s.maxLeverage,
    slippageBps: s.slippageBps,
    fees: s.fees,
  };
}

/** Prüft ein importiertes Backup und ergänzt fehlende neue Felder. */
export function migrateState(raw: unknown): AppState {
  if (!raw || typeof raw !== 'object') throw new Error('Backup ist keine gültige Datei');
  const r = raw as Partial<AppState> & { app?: string; state?: AppState };
  const s = (r.app === 'trading-strategy-lab' ? r.state : r) as Partial<AppState>;
  if (!s || typeof s.schema !== 'number') throw new Error('Backup enthält keine Schema-Version');
  if (s.schema > SCHEMA_VERSION) throw new Error(`Backup stammt von einer neueren App-Version (Schema ${s.schema})`);
  const base = defaultState(s.createdAt ?? Date.now());
  const merged: AppState = {
    ...base,
    ...s,
    settings: { ...base.settings, ...(s.settings ?? {}), mlEnabled: false },
    strategies: { ...base.strategies, ...(s.strategies ?? {}) },
    live: { ...base.live, ...(s.live ?? {}), running: false },
    schema: SCHEMA_VERSION,
  } as AppState;
  return merged;
}

export function makeBackup(state: AppState) {
  return { app: 'trading-strategy-lab', exportedAt: new Date().toISOString(), schema: SCHEMA_VERSION, state };
}
