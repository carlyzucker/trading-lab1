// Nachbildung der öffentlichen Binance-/Bybit-/Frankfurter-Antwortformate für Tests.
// Formate gemäss offizieller API-Dokumentation; die ZAHLEN sind künstliche Testdaten.
import type { FetchLike } from '../src/core/data/http';
import type { Bar, FundingEvent } from '../src/core/types';

export interface MockData {
  binance: Record<string, Bar[]>;
  bybit: Record<string, Bar[]>; // Last-Preis
  mark?: Record<string, Bar[]>;
  funding?: Record<string, FundingEvent[]>;
  instruments?: { linear: unknown[]; spot: unknown[] };
  usdPerChf?: number;
  now: () => number;
  failHosts?: string[];
  calls?: string[];
}

const s = (x: number) => String(x);

export function mockFetch(d: MockData): FetchLike {
  return async (url: string) => {
    d.calls?.push(url);
    const u = new URL(url);
    if (d.failHosts?.includes(u.host)) throw new TypeError('Failed to fetch');
    const q = u.searchParams;
    const now = d.now();
    const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
    const v5 = (result: unknown) => ok({ retCode: 0, retMsg: 'OK', result, retExtInfo: {}, time: now });

    if (u.pathname === '/api/v3/klines') {
      const bars = d.binance[q.get('symbol')!] ?? [];
      const end = q.has('endTime') ? Number(q.get('endTime')) : Infinity;
      const lim = Number(q.get('limit') ?? 500);
      // Binance liefert auch die laufende (noch nicht abgeschlossene) Kerze
      const vis = bars.filter((b) => b.t <= end && b.t <= now).slice(-lim);
      return ok(vis.map((b) => [b.t, s(b.o), s(b.h), s(b.l), s(b.c), s(b.v), b.t + 899_999, '0', 1, '0', '0', '0']));
    }
    if (u.pathname === '/api/v3/ticker/price') {
      const bars = d.binance[q.get('symbol')!] ?? [];
      const last = bars.filter((b) => b.t <= now).pop();
      return ok({ symbol: q.get('symbol'), price: s(last?.c ?? 0) });
    }
    if (u.pathname === '/v5/market/kline' || u.pathname === '/v5/market/mark-price-kline') {
      const src = u.pathname.includes('mark') ? (d.mark ?? d.bybit) : d.bybit;
      const bars = src[q.get('symbol')!] ?? [];
      const end = q.has('end') ? Number(q.get('end')) : Infinity;
      const lim = Number(q.get('limit') ?? 200);
      const vis = bars.filter((b) => b.t <= end && b.t <= now).slice(-lim).reverse(); // neueste zuerst
      const list = vis.map((b) => (u.pathname.includes('mark') ? [s(b.t), s(b.o), s(b.h), s(b.l), s(b.c)] : [s(b.t), s(b.o), s(b.h), s(b.l), s(b.c), s(b.v), '0']));
      return v5({ category: q.get('category'), symbol: q.get('symbol'), list });
    }
    if (u.pathname === '/v5/market/tickers') {
      const bars = d.bybit[q.get('symbol')!] ?? [];
      const last = bars.filter((b) => b.t <= now).pop();
      return v5({ category: q.get('category'), list: [{ symbol: q.get('symbol'), lastPrice: s(last?.c ?? 0), markPrice: s(last?.c ?? 0), bid1Price: s(last?.c ?? 0), ask1Price: s(last?.c ?? 0), fundingRate: '0.0001', nextFundingTime: '0', price24hPcnt: '0.01' }] });
    }
    if (u.pathname === '/v5/market/funding/history') {
      const ev = (d.funding?.[q.get('symbol')!] ?? []).filter((e) => e.t <= Number(q.get('endTime') ?? Infinity) && e.t <= now);
      return v5({ category: 'linear', list: ev.slice(-200).reverse().map((e) => ({ symbol: q.get('symbol'), fundingRate: s(e.rate), fundingRateTimestamp: s(e.t) })) });
    }
    if (u.pathname === '/v5/market/risk-limit') {
      return v5({ category: 'linear', list: [{ id: 1, symbol: q.get('symbol'), riskLimitValue: '2000000', maintenanceMargin: '0.005', initialMargin: '0.01', isLowestRisk: 1, maxLeverage: '100.00' }] });
    }
    if (u.pathname === '/v5/market/instruments-info') {
      const cat = q.get('category') as 'linear' | 'spot';
      return v5({ category: cat, list: d.instruments?.[cat] ?? [], nextPageCursor: '' });
    }
    if (u.pathname.endsWith('/latest')) {
      return ok({ amount: 1, base: 'CHF', date: '2026-10-20', rates: { USD: d.usdPerChf ?? 1.25 } });
    }
    return { ok: false, status: 404, json: async () => ({}), text: async () => 'not found' };
  };
}

export function linearInstrument(symbol: string, baseCoin: string, over: Record<string, unknown> = {}) {
  return {
    symbol,
    contractType: 'LinearPerpetual',
    status: 'Trading',
    baseCoin,
    quoteCoin: 'USDT',
    settleCoin: 'USDT',
    priceScale: '2',
    leverageFilter: { minLeverage: '1', maxLeverage: '100.00', leverageStep: '0.01' },
    priceFilter: { minPrice: '0.10', maxPrice: '1999999.80', tickSize: '0.10' },
    lotSizeFilter: { maxOrderQty: '1190.000', minOrderQty: '0.001', qtyStep: '0.001', maxMktOrderQty: '500.000', minNotionalValue: '5' },
    fundingInterval: 480,
    ...over,
  };
}

export function spotInstrument(symbol: string, baseCoin: string) {
  return {
    symbol,
    baseCoin,
    quoteCoin: 'USDT',
    status: 'Trading',
    lotSizeFilter: { basePrecision: '0.0001', quotePrecision: '0.01', minOrderQty: '0.0001', maxOrderQty: '100', minOrderAmt: '1', maxOrderAmt: '2000000' },
    priceFilter: { tickSize: '0.01' },
  };
}
