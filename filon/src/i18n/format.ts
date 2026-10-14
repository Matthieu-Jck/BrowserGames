// format.ts — locale-aware number/time formatting (Intl), cached per locale. French uses
// U+202F as the group separator and a no-break space before units; tests normalise them.
import { locale } from './i18n';
import type { Locale } from '@/core/kinds';

interface Fmts {
  int: Intl.NumberFormat;
  dec1: Intl.NumberFormat;
  dec2: Intl.NumberFormat;
  compact: Intl.NumberFormat;
  pct: Intl.NumberFormat;
}
const cache = new Map<Locale, Fmts>();

function fmts(): Fmts {
  const l = locale();
  let f = cache.get(l);
  if (!f) {
    f = {
      int: new Intl.NumberFormat(l, { maximumFractionDigits: 0 }),
      dec1: new Intl.NumberFormat(l, { maximumFractionDigits: 1 }),
      dec2: new Intl.NumberFormat(l, { maximumFractionDigits: 2 }),
      compact: new Intl.NumberFormat(l, { notation: 'compact', maximumFractionDigits: 1 }),
      pct: new Intl.NumberFormat(l, { style: 'percent', maximumFractionDigits: 0 }),
    };
    cache.set(l, f);
  }
  return f;
}

/** Plain number: integers as-is, small values with up to 2 decimals. */
export function num(v: number): string {
  const f = fmts();
  const a = Math.abs(v);
  if (a >= 100 || Number.isInteger(v)) return f.int.format(v);
  if (a >= 10) return f.dec1.format(v);
  return f.dec2.format(v);
}

/** Compact for big stocks: 12 400 → 12,4 k (≥ 10 000 only). */
export function compact(v: number): string {
  return Math.abs(v) >= 10000 ? fmts().compact.format(v) : num(v);
}

export const pct = (ratio: number): string => fmts().pct.format(ratio);

/** A rate in items per minute, e.g. « 12,5/min ». */
export const rate = (perMin: number): string => `${num(perMin)}/min`;

/** Ocelles (centi-ocelles in the engine → ocelles here). */
export const credits = (cents: number): string => `${num(Math.round(cents) / 100)} ◉`;

/** Durations: « 2 h 05 min », « 45 s » (FR) / « 2h 05m », « 45s » (EN). */
export function duration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const fr = locale() === 'fr';
  const nb = fr ? ' ' : '';
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60), r = s % 60;
  const two = (x: number): string => String(x).padStart(2, '0');
  if (d > 0) return fr ? `${d}${nb}j ${h}${nb}h` : `${d}d ${h}h`;
  if (h > 0) return fr ? `${h}${nb}h ${two(m)}${nb}min` : `${h}h ${two(m)}m`;
  if (m > 0) return fr ? `${m}${nb}min ${two(r)}${nb}s` : `${m}m ${two(r)}s`;
  return `${r}${nb}s`;
}
