import type { Bar } from './types';

export interface VolumeProfile {
  low: number;
  high: number;
  binSize: number;
  volumes: number[];
  pocIndex: number;
  poc: number; // Mitte des POC-Bins
  vah: number; // Obergrenze Value Area
  val: number; // Untergrenze Value Area
  valueAreaVolumeShare: number; // tatsächlicher Anteil (>= gefordert)
}

/**
 * Volumenprofil aus Kerzen. Annahme (keine Tick-Daten verfügbar): das Volumen jeder Kerze
 * verteilt sich gleichmässig über ihre Spanne Low..High.
 * Value Area: klassisches Verfahren – vom POC aus jeweils die volumenstärkere Nachbarzone
 * hinzufügen, bis der geforderte Anteil (z.B. 70 %) erreicht ist.
 */
export function buildVolumeProfile(bars: Bar[], bins: number, valueAreaPct: number): VolumeProfile | null {
  if (bars.length === 0 || bins < 3) return null;
  let low = Infinity;
  let high = -Infinity;
  for (const b of bars) {
    if (b.l < low) low = b.l;
    if (b.h > high) high = b.h;
  }
  if (!(high > low)) return null;
  const binSize = (high - low) / bins;
  const volumes = new Array<number>(bins).fill(0);

  for (const b of bars) {
    if (b.v <= 0) continue;
    const span = b.h - b.l;
    if (span <= 0) {
      const idx = Math.min(bins - 1, Math.floor((b.c - low) / binSize));
      volumes[idx] += b.v;
      continue;
    }
    const first = Math.max(0, Math.floor((b.l - low) / binSize));
    const last = Math.min(bins - 1, Math.floor((b.h - low) / binSize));
    for (let i = first; i <= last; i++) {
      const binLo = low + i * binSize;
      const binHi = binLo + binSize;
      const overlap = Math.min(binHi, b.h) - Math.max(binLo, b.l);
      if (overlap > 0) volumes[i] += (b.v * overlap) / span;
    }
  }

  const total = volumes.reduce((a, x) => a + x, 0);
  if (total <= 0) return null;

  let pocIndex = 0;
  for (let i = 1; i < bins; i++) if (volumes[i] > volumes[pocIndex]) pocIndex = i;

  let lo = pocIndex;
  let hi = pocIndex;
  let acc = volumes[pocIndex];
  const target = total * valueAreaPct;
  while (acc < target && (lo > 0 || hi < bins - 1)) {
    const up = hi < bins - 1 ? volumes[hi + 1] : -1;
    const down = lo > 0 ? volumes[lo - 1] : -1;
    if (up >= down) {
      hi++;
      acc += volumes[hi];
    } else {
      lo--;
      acc += volumes[lo];
    }
  }

  return {
    low,
    high,
    binSize,
    volumes,
    pocIndex,
    poc: low + (pocIndex + 0.5) * binSize,
    val: low + lo * binSize,
    vah: low + (hi + 1) * binSize,
    valueAreaVolumeShare: acc / total,
  };
}
