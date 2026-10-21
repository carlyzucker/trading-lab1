import type { Bar, Signal } from '../types';

export interface ParamSpec {
  key: string;
  label: string;
  type: 'int' | 'number' | 'bool';
  min?: number;
  max?: number;
  step?: number;
  /** true = nicht aus der Quelle belegt, experimentelle Annahme */
  assumption?: boolean;
  help?: string;
}

export type Params = Record<string, number | boolean>;

export interface StrategyContext {
  /**
   * Nur abgeschlossene Kerzen bis einschliesslich der aktuellen Kerze.
   * Die Engine übergibt ein Fenster – Zugriff auf Zukunftsdaten ist dadurch technisch unmöglich.
   */
  bars: Bar[];
  symbol: string;
  timeframe: string;
  params: Params;
}

export interface StrategyDef {
  id: string;
  name: string;
  version: string;
  changelog: { version: string; note: string }[];
  kind: 'demo' | 'experimental' | 'validated' | 'meta';
  description: string;
  source?: string;
  assumptions: string[];
  params: ParamSpec[];
  defaults: Params;
  /** Wie viele abgeschlossene Kerzen (inkl. aktueller) die Strategie braucht. */
  lookback(params: Params): number;
  evaluate(ctx: StrategyContext): Signal | null;
}

export function num(p: Params, k: string): number {
  const v = p[k];
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`Parameter ${k} fehlt oder ist ungültig`);
  return v;
}
