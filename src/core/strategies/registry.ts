import { amt001 } from './amt001';
import { demoEmaCross } from './demoEmaCross';
import type { StrategyDef } from './types';

/** Strategiebibliothek. Neue Strategie = neue Datei + hier eintragen. */
export const STRATEGIES: StrategyDef[] = [amt001, demoEmaCross];

export function getStrategy(id: string): StrategyDef | undefined {
  return STRATEGIES.find((s) => s.id === id);
}
