// report-panels.ts — the inked panels that tell what a catch-up did (sim/offline/report.ts),
// shared by « Pendant ton absence » (what the base did while the player was away) and « Avant
// de partir » (what it will do if they leave now: the same catch-up, run on a copy). Panels: the
// Heart's net change, what was made, what went through the Crier, and the log of incidents in
// time order (each kind once) with what was lost for want of room — a lease that lapsed (D60:
// the purse could not pay its hour) names its parcel, and counts as a stop: what stood on it is
// dormant. Plain DOM; the styles are absence.css (`ab-*`).
import { el } from '@/core/dom';
import { locale, t } from '@/i18n/i18n';
import { credits, duration, num } from '@/i18n/format';
import { buildingDef, N_ITEMS } from '@/content/registry';
import { nodeName } from '@/content/research';
import { TICK_MS } from '@/sim/constants';
import type { AwayReport, Incident, IncidentKind } from '@/sim/offline/report';
import type { RemapNote } from '@/sim/save-remap';
import type { Sim } from '@/sim/state';
import { itemRef } from '../mention';
import { parcelLabel } from '../land-facts';

/** Rows per panel, incidents in the log. */
const ROWS = 7;
const LOG_ROWS = 9;

type PanelKey = 'away.heart' | 'away.made' | 'away.crier' | 'away.log' | 'away.changes';

const list = (parts: readonly string[]): string => new Intl.ListFormat(locale(), { type: 'conjunction' }).format(parts);
const signed = (mu: number): string => `${mu > 0 ? '+' : '−'}${num(Math.abs(mu) / 1000)}`;

/** Time since the start of the report, in words (« 3 h 20 min »). */
export const sinceStart = (r: AwayReport, tick: number): string => duration(((tick - r.fromTick) * TICK_MS) / 1000);

/** The items with the largest |values|, biggest first (ties by index: stable). */
function top(values: Float64Array, n: number, keep: (v: number) => boolean = (v) => Math.abs(v) >= 1000): number[] {
  const out: number[] = [];
  for (let i = 0; i < Math.min(values.length, N_ITEMS); i++) if (keep(values[i]!)) out.push(i);
  return out.sort((a, b) => Math.abs(values[b]!) - Math.abs(values[a]!) || a - b).slice(0, n);
}

function panel(key: PanelKey, id: string, rows: Array<HTMLElement | null>): HTMLElement {
  const body = rows.filter((x): x is HTMLElement => !!x);
  return el('section.ab-panel', { 'data-absence-panel': id }, [
    el('h3.lettering', {}, t(key)),
    body.length ? el('div.ab-rows', {}, body) : el('p.ab-none', {}, t('away.nothing')),
  ]);
}

const row = (label: string, value: string, tone?: 'up' | 'down'): HTMLElement =>
  el('div.ab-row', tone ? { 'data-tone': tone } : {}, [el('span.ab-label', {}, label), el('span.ab-value', {}, value)]);

/** One incident in words (« Minerai de fer : plus de place »). */
export function incidentText(sim: Sim, i: Incident): string {
  const item = i.item !== undefined ? itemRef(i.item) : '';
  switch (i.kind) {
    case 'storageFull': return t('away.inc.storageFull', { item });
    case 'storageEmpty': return t('away.inc.storageEmpty', { item });
    case 'storageOk': return t('away.inc.storageOk', { item });
    case 'brownout': return t('away.inc.brownout');
    case 'accEmpty': return t('away.inc.accEmpty');
    case 'accFull': return t('away.inc.accFull');
    case 'researchDone': return t('away.inc.researchDone', { what: i.ref ? nodeName(i.ref)[locale()] : '' });
    case 'built': {
      const e = i.ent !== undefined ? sim.ents.get(i.ent) : undefined;
      return t('away.inc.built', { what: e ? buildingDef(e.def).name[locale()] : '' });
    }
    case 'orderPaused': return t('away.inc.orderPaused', { item });
    case 'orderResumed': return t('away.inc.orderResumed', { item });
    case 'leaseLapsed': return t('away.inc.leaseLapsed', { c: i.parcel !== undefined ? parcelLabel(i.parcel) : '' });
    default: { const never: never = i.kind; return never; }
  }
}

/** What stops a line: a store full or empty, the power short, the accumulators flat, an order paused, a lease lapsed (its buildings dormant). */
const STOPS: ReadonlySet<IncidentKind> = new Set(['storageFull', 'storageEmpty', 'brownout', 'accEmpty', 'orderPaused', 'leaseLapsed']);

/** The first thing that stops part of the base, or null when nothing does. */
export function firstStop(r: AwayReport): Incident | null {
  let best: Incident | null = null;
  for (const i of r.incidents) if (STOPS.has(i.kind) && (!best || i.tick < best.tick)) best = i;
  return best;
}

/** Incidents in time order, a run of the same one counted once. */
function distinct(r: AwayReport): Incident[] {
  const seen = new Set<string>();
  const out: Incident[] = [];
  for (const i of [...r.incidents].sort((a, b) => a.tick - b.tick)) {
    const key = `${i.kind}:${i.item ?? ''}:${i.ref ?? ''}:${i.ent ?? ''}:${i.parcel ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(i);
  }
  return out;
}

/** The four panels of a report: the Heart, what was made, the Crier, the log. */
export function reportPanels(r: AwayReport, sim: Sim): HTMLElement[] {
  const heart = panel('away.heart', 'heart', top(r.hearthDelta, ROWS).map((i) => {
    const v = r.hearthDelta[i]!;
    return row(itemRef(i), signed(v), v > 0 ? 'up' : 'down');
  }));
  const made = panel('away.made', 'made', top(r.produced, ROWS, (v) => v >= 1000).map((i) => row(itemRef(i), num(r.produced[i]! / 1000))));

  const trade: Array<HTMLElement | null> = [];
  const sold = top(r.sold, 4, (v) => v >= 1000), bought = top(r.bought, 3, (v) => v >= 1000);
  if (sold.length) trade.push(row(t('away.sold'), list(sold.map((i) => `${num(r.sold[i]! / 1000)} ${itemRef(i)}`))));
  if (bought.length) trade.push(row(t('away.bought'), list(bought.map((i) => `${num(r.bought[i]! / 1000)} ${itemRef(i)}`))));
  if (r.earned) trade.push(row(t('away.earned'), `+${credits(r.earned)}`, 'up'));
  if (r.spent) trade.push(row(t('away.spent'), `−${credits(r.spent)}`, 'down'));
  if (r.earned || r.spent || r.creditsDelta) trade.push(row(t('away.net'), `${r.creditsDelta >= 0 ? '+' : '−'}${credits(Math.abs(r.creditsDelta))}`, r.creditsDelta >= 0 ? 'up' : 'down'));
  const crier = panel('away.crier', 'crier', trade);

  const lines = distinct(r);
  const log: Array<HTMLElement | null> = lines.slice(0, LOG_ROWS).map((i) =>
    row(incidentText(sim, i), t('away.at', { d: sinceStart(r, i.tick) }), i.kind === 'researchDone' || i.kind === 'built' ? 'up' : i.kind === 'leaseLapsed' ? 'down' : undefined));
  if (lines.length > LOG_ROWS) log.push(el('p.ab-more', {}, t('away.more', { n: lines.length - LOG_ROWS })));
  const lost = top(r.lostMu, 5, (v) => v >= 1000);
  if (lost.length) log.push(el('p.ab-lost', {}, t('away.lost', { list: list(lost.map((i) => `${num(r.lostMu[i]! / 1000)} ${itemRef(i)}`)) })));
  if (!log.length) log.push(el('p.ab-none', {}, t('away.calm')));
  return [heart, made, crier, panel('away.log', 'log', log)];
}

/** An approximate catch-up's honest error line (null: exact, or off by less than an item). */
export function approxNote(r: AwayReport): HTMLElement | null {
  if (r.mode !== 'approx') return null;
  let off = 0;
  for (const v of r.clampedMu) off += v;
  return off >= 1000 ? el('p.ab-approx', {}, t('away.approx', { n: num(Math.ceil(off / 1000)) })) : null;
}

/** What this version of the game changed in a loaded save (D47). */
export function changesPanel(c: RemapNote): HTMLElement {
  const rows: HTMLElement[] = [];
  if (c.removed.length) rows.push(el('p', {}, t('away.changes.removed', { list: list(c.removed.map((b) => `${b.id} ×${b.n}`)) })));
  if (c.lost.length) rows.push(el('p', {}, t('away.changes.lost', { list: list(c.lost.map((l) => `${num(l.mu / 1000)} ${l.id}`)) })));
  if (c.reset.length) rows.push(el('p', {}, t('away.changes.reset', { list: list(c.reset) })));
  return panel('away.changes', 'changes', rows);
}
