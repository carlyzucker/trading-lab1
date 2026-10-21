import type { ReactNode } from 'react';
import type { AppState } from '../core/state';
import type { DataSource } from '../core/types';

const TZ = 'Europe/Zurich';

export const fmtTime = (t?: number) =>
  t ? new Date(t).toLocaleString('de-CH', { timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '–';
export const fmtDate = (t?: number) => (t ? new Date(t).toLocaleString('de-CH', { timeZone: TZ, day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '–');
export const fmtNum = (x: number | undefined, d = 2) =>
  x === undefined || !Number.isFinite(x) ? (x === Infinity ? '∞' : '–') : x.toLocaleString('de-CH', { minimumFractionDigits: d, maximumFractionDigits: d });
export const fmtPrice = (x?: number) => {
  if (x === undefined || !Number.isFinite(x)) return '–';
  const d = x >= 1000 ? 2 : x >= 1 ? 4 : 6;
  return x.toLocaleString('de-CH', { minimumFractionDigits: d, maximumFractionDigits: d });
};
export const fmtSigned = (x: number, d = 2) => `${x > 0 ? '+' : ''}${fmtNum(x, d)}`;
export const toChf = (state: AppState, usdt: number) => (state.fx ? usdt / state.fx.usdPerChf : NaN);
export const ago = (t?: number) => {
  if (!t) return 'nie';
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return `vor ${s} s`;
  if (s < 3600) return `vor ${Math.round(s / 60)} min`;
  return `vor ${Math.round(s / 3600)} h`;
};

export function Card({ title, right, children, tone }: { title?: ReactNode; right?: ReactNode; children: ReactNode; tone?: 'warn' | 'bad' | 'info' }) {
  return (
    <section className={`card${tone ? ' card-' + tone : ''}`}>
      {(title || right) && (
        <header className="card-head">
          {title && <h2>{title}</h2>}
          {right}
        </header>
      )}
      {children}
    </section>
  );
}

export function Badge({ children, tone = 'plain' }: { children: ReactNode; tone?: 'plain' | 'long' | 'short' | 'warn' | 'bad' | 'ok' | 'accent' }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function Side({ side }: { side: 'long' | 'short' }) {
  return <Badge tone={side}>{side === 'long' ? 'LONG' : 'SHORT'}</Badge>;
}

export function Pnl({ v, d = 2, unit }: { v: number; d?: number; unit?: string }) {
  return (
    <span className={`num pnl ${v > 0 ? 'pos' : v < 0 ? 'neg' : ''}`}>
      {fmtSigned(v, d)}
      {unit ? ` ${unit}` : ''}
    </span>
  );
}

export function KV({ k, children }: { k: ReactNode; children: ReactNode }) {
  return (
    <div className="kv">
      <span className="k">{k}</span>
      <span className="v">{children}</span>
    </div>
  );
}

export function Source({ s }: { s?: DataSource }) {
  if (!s) return null;
  const path = s.endpoint.replace(/^https?:\/\/[^/]+/, '');
  return (
    <span className="src" title={s.endpoint}>
      Quelle: {s.provider === 'binance' ? 'Binance' : s.provider === 'bybit' ? 'Bybit' : s.provider === 'frankfurter' ? 'EZB/Frankfurter' : 'Test'} {path}
      {s.symbol ? ` · ${s.symbol}` : ''}
      {s.category ? ` (${s.category})` : ''} · {fmtTime(s.fetchedAt)}
    </span>
  );
}

export function Sparkline({ points, base, height = 64 }: { points: { t: number; v: number }[]; base?: number; height?: number }) {
  if (points.length < 2) return <div className="spark-empty">Noch kein Verlauf</div>;
  const w = 320;
  const vs = points.map((p) => p.v);
  const min = Math.min(...vs, base ?? Infinity);
  const max = Math.max(...vs, base ?? -Infinity);
  const t0 = points[0].t;
  const t1 = points[points.length - 1].t;
  const x = (t: number) => ((t - t0) / Math.max(1, t1 - t0)) * w;
  const y = (v: number) => (max === min ? height / 2 : height - 4 - ((v - min) / (max - min)) * (height - 8));
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  const last = points[points.length - 1];
  const up = base === undefined ? last.v >= points[0].v : last.v >= base;
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" role="img" aria-label="Kapitalverlauf">
      {base !== undefined && <line x1="0" x2={w} y1={y(base)} y2={y(base)} className="spark-base" />}
      <path d={`${d} L${w},${height} L0,${height} Z`} className={up ? 'spark-fill-up' : 'spark-fill-down'} />
      <path d={d} className={up ? 'spark-up' : 'spark-down'} fill="none" />
      <circle cx={x(last.t)} cy={y(last.v)} r="3" className={up ? 'spark-dot-up' : 'spark-dot-down'} />
    </svg>
  );
}

export function Toggle({ id, checked, onChange, label }: { id: string; checked: boolean; onChange: (v: boolean) => void; label: ReactNode }) {
  return (
    <label className="toggle" htmlFor={id}>
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="track" aria-hidden="true">
        <span className="thumb" />
      </span>
      <span>{label}</span>
    </label>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}
