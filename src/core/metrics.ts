import type { Account } from './account';

export interface Metrics {
  startBalance: number;
  endBalance: number;
  netProfit: number;
  totalReturnPct: number;
  maxDrawdownPct: number;
  trades: number;
  wins: number;
  winRatePct: number;
  profitFactor: number; // Infinity möglich, wenn keine Verluste
  avgR: number;
  fees: number;
  funding: number;
  liquidations: number;
  rejectedEntries: number;
  maxConsecutiveLosses: number;
  avgPlannedRiskPct: number;
  replayTrades: number;
}

export function computeMetrics(acc: Account): Metrics {
  const trades = acc.trades;
  const wins = trades.filter((t) => t.net > 0);
  const grossWin = wins.reduce((a, t) => a + t.net, 0);
  const grossLoss = trades.filter((t) => t.net <= 0).reduce((a, t) => a - t.net, 0);
  let peak = acc.startBalance;
  let maxDD = 0;
  for (const p of acc.equity) {
    if (p.v > peak) peak = p.v;
    const dd = peak > 0 ? (peak - p.v) / peak : 0;
    if (dd > maxDD) maxDD = dd;
  }
  let streak = 0;
  let maxStreak = 0;
  for (const t of trades) {
    if (t.net <= 0) {
      streak++;
      maxStreak = Math.max(maxStreak, streak);
    } else streak = 0;
  }
  // geplantes Risiko relativ zum Kontostand ungefähr: R-Planung / Startkapital-Niveau
  let riskPctSum = 0;
  let bal = acc.startBalance;
  for (const t of trades) {
    riskPctSum += bal > 0 ? t.plannedRisk / bal : 0;
    bal += t.net;
  }
  return {
    startBalance: acc.startBalance,
    endBalance: acc.balance,
    netProfit: acc.balance - acc.startBalance,
    totalReturnPct: ((acc.balance - acc.startBalance) / acc.startBalance) * 100,
    maxDrawdownPct: maxDD * 100,
    trades: trades.length,
    wins: wins.length,
    winRatePct: trades.length ? (wins.length / trades.length) * 100 : 0,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0,
    avgR: trades.length ? trades.reduce((a, t) => a + t.r, 0) / trades.length : 0,
    fees: acc.fees,
    funding: acc.funding,
    liquidations: trades.filter((t) => t.exitReason === 'Liquidation').length,
    rejectedEntries: acc.journal.filter((j) => j.level === 'warn' && j.text.startsWith('Einstieg abgelehnt')).length,
    maxConsecutiveLosses: maxStreak,
    avgPlannedRiskPct: trades.length ? (riskPctSum / trades.length) * 100 : 0,
    replayTrades: trades.filter((t) => t.replay).length,
  };
}
