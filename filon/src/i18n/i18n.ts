// i18n.ts — the translation layer. fr.ts is the source of truth (`as const`); en.ts must
// carry exactly the same keys (enforced by its type) and the same {placeholders} (enforced
// by a test). t() is typed: placeholders are inferred from the French literal. Plurals go
// through Intl.PluralRules. The sim never produces text — only ids and numbers.
import { fr } from './fr';
import { en } from './en';
import type { Locale } from '@/core/kinds';

export interface PluralMsg {
  readonly one: string;
  readonly other: string;
  readonly zero?: string;
  readonly two?: string;
  readonly few?: string;
  readonly many?: string;
}
export type Msg = string | PluralMsg;
export type MsgKey = keyof typeof fr;
export type Dict = { readonly [K in MsgKey]: Msg };

type Ph<S> = S extends `${string}{${infer P}}${infer R}` ? P | Ph<R> : never;
type ParamsOf<K extends MsgKey> = (typeof fr)[K] extends string
  ? Ph<(typeof fr)[K]>
  : (typeof fr)[K] extends { readonly other: infer O } ? Ph<O> | 'n' : never;
export type Params<K extends MsgKey> = Record<ParamsOf<K>, string | number>;

const dicts: Record<Locale, Dict> = { fr, en };
let current: Locale = 'fr';
let rules = new Intl.PluralRules('fr');
let numFmt = new Intl.NumberFormat('fr');
const listeners = new Set<(l: Locale) => void>();

export function locale(): Locale { return current; }

export function setLocale(l: Locale): void {
  if (l === current) return;
  current = l;
  rules = new Intl.PluralRules(l);
  numFmt = new Intl.NumberFormat(l);
  for (const fn of [...listeners]) fn(l);
}

export function onLocale(fn: (l: Locale) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** First supported language in the browser's preference list (default English). */
export function pickLocale(langs: readonly string[]): Locale {
  for (const lang of langs) {
    const base = lang.toLowerCase().split('-')[0];
    if (base === 'fr' || base === 'en') return base;
  }
  return 'en';
}

function fill(template: string, params: Record<string, string | number> | undefined): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (m, k: string) => {
    const v = params[k];
    if (v === undefined) return m;
    return typeof v === 'number' ? numFmt.format(v) : v;
  });
}

/** Untyped lookup for dynamic keys (content ids); returns ⟦key⟧ when missing. */
export function tr(key: string, params?: Record<string, string | number>): string {
  const msg = (dicts[current] as Record<string, Msg | undefined>)[key];
  if (msg === undefined) return `⟦${key}⟧`;
  if (typeof msg === 'string') return fill(msg, params);
  const n = typeof params?.n === 'number' ? params.n : 0;
  const cat = rules.select(n) as keyof PluralMsg;
  return fill(msg[cat] ?? msg.other, params);
}

/** Typed lookup: the compiler checks the key and its {placeholders}. */
export function t<K extends MsgKey>(
  key: K,
  ...p: [ParamsOf<K>] extends [never] ? [] : [Params<K>]
): string {
  return tr(key, p[0] as Record<string, string | number> | undefined);
}

/** All placeholders of a message (both plural branches) — used by the parity test. */
export function placeholders(msg: Msg): string[] {
  const texts = typeof msg === 'string' ? [msg] : Object.values(msg).filter((v): v is string => typeof v === 'string');
  const set = new Set<string>();
  for (const s of texts) for (const m of s.matchAll(/\{(\w+)\}/g)) set.add(m[1]!);
  return [...set].sort();
}

export { dicts };
