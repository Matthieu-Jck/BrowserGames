// report-panels.ts — the inked panels that tell what a catch-up did (sim/offline/report.ts),
// shared by « Pendant ton absence » (what the base did while the player was away) and « Avant
// de partir » (what it will do if they leave now: the same catch-up, run on a copy). Each panel is
// a kit section with its icon (D89: « Plus clair, plus séparé »), and its numbers are bars on the
// panel's own scale, so the eye reads the sizes before the digits:
// · « Au Cœur » (a crate): the Heart's net change, gains in turquoise, losses in coral;
// · « Fabriqué » (a recipe sheet): what was made;
// · « À la Criée » (CrierBelt's ringed planet): what was sold and bought as item chips, the ocelles
//   earned and spent as bars, the net in the header;
// · « Journal de bord » (a clock): the incidents on a time line of the absence — a numbered dot each,
//   coral for what stops a line, turquoise for good news — then one row each in time order (each
//   kind once): its number, its time, its mark, its words; what was lost for want of room as chips.
//   A lease that lapsed (D60: the purse could not pay its hour) names its parcel, and counts as a
//   stop: what stood on it is dormant.
// Plain DOM built once per report; the styles are absence.css (`ab-*`).
import { viewIconCanvas } from '@/render/art/view-icons';
import { el } from '@/core/dom';
import { locale, t } from '@/i18n/i18n';
import { credits, duration, num } from '@/i18n/format';
import { buildingDef, N_ITEMS } from '@/content/registry';
import { nodeName } from '@/content/research';
import { RETIRED_NAMES } from '@/content/retired';
import { TICK_MS } from '@/sim/constants';
import type { AwayReport, Incident, IncidentKind } from '@/sim/offline/report';
import type { RemapNote } from '@/sim/save-remap';
import type { Sim } from '@/sim/state';
import { glyph } from '../glyphs';
import { mark, meter, section, type Label } from '../inspector/kit';
import { itemMention, itemRef } from '../mention';
import { parcelLabel } from '../land-facts';

/** Rows per panel, incidents in the log. */
const ROWS = 7;
const LOG_ROWS = 9;
/** The time line: dots closer than this (a fraction of the absence) go on another lane, at most `LANES`. */
const DOT_GAP = 0.035;
const LANES = 3;

type PanelId = 'heart' | 'made' | 'crier' | 'log' | 'changes';
type Tone = 'good' | 'bad' | 'idle';

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

/** A panel: a kit section with its icon, `data-absence-panel` its hook; « Rien n’a bougé » when it has no rows. */
function panel(id: PanelId, title: Label, icon: HTMLElement, rows: Array<HTMLElement | null>, aside?: Node | null): HTMLElement {
  const body = rows.filter((x): x is HTMLElement => !!x);
  const s = section({ sec: `ab-${id}`, title, icon, aside: aside ?? null }, [
    body.length ? el('div.ab-rows', {}, body) : el('p.ab-none', {}, t('away.nothing')),
  ]);
  s.classList.add('ab-panel');
  s.setAttribute('data-absence-panel', id);
  return s;
}

/** A row with a bar: its label (an item: its icon and name), a gauge on the panel's scale, the figure. */
function barRow(label: Node | string, v: number, max: number, tone: Tone, text: string): HTMLElement {
  const m = meter();
  m.set(Math.abs(v), max, tone, text);
  return el('div.ab-row', { 'data-tone': tone }, [el('span.ab-label', {}, label), m.root]);
}

/** Items as chips: each icon (its name on hover) and how many. */
const chips = (values: Float64Array, items: readonly number[]): HTMLElement =>
  el('span.ab-chips', {}, items.map((i) => el('span.ab-chip', {}, [itemMention(i, { name: false }), el('b', {}, num(values[i]! / 1000))])));

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
    case 'researchHeld': return t('away.inc.researchHeld');
    case 'researchResumed': return t('away.inc.researchResumed');
    default: { const never: never = i.kind; return never; }
  }
}

/** What stops a line: a store full or empty, the power short, the accumulators flat, an order paused, a lease lapsed (its buildings dormant). */
const STOPS: ReadonlySet<IncidentKind> = new Set(['storageFull', 'storageEmpty', 'brownout', 'accEmpty', 'orderPaused', 'leaseLapsed', 'researchHeld']);
/** Good news: a research done, a building finished, a line running again. */
const GOOD: ReadonlySet<IncidentKind> = new Set(['researchDone', 'built', 'storageOk', 'orderResumed', 'researchResumed']);

/** An incident's mark, as the inspector draws the same trouble (a full box, an empty slot, a struck bolt…). */
const INCIDENT_ICON: Record<IncidentKind, () => HTMLElement> = {
  storageFull: () => mark('full'), storageEmpty: () => glyph('empty'), storageOk: () => mark('on'),
  brownout: () => glyph('noPower'), accEmpty: () => glyph('noPower'), accFull: () => glyph('power'),
  researchDone: () => mark('tree'), built: () => mark('build'), orderPaused: () => mark('pause'), orderResumed: () => mark('order'),
  leaseLapsed: () => glyph('lease'), researchHeld: () => mark('off'), researchResumed: () => mark('on'),
};

const toneOf = (k: IncidentKind): Tone => (STOPS.has(k) ? 'bad' : GOOD.has(k) ? 'good' : 'idle');

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

/**
 * The absence as a line, from the departure (0) to the return: a numbered dot per incident shown,
 * in its tone; dots too close to the one before climb a lane (the rows below carry the numbers).
 */
function timeLine(r: AwayReport, sim: Sim, shown: readonly Incident[]): HTMLElement {
  const span = Math.max(1, r.toTick - r.fromTick);
  const lanes: number[] = [];
  const dots = shown.map((inc, k) => {
    const x = Math.max(0, Math.min(1, (inc.tick - r.fromTick) / span));
    let lane = lanes.findIndex((last) => x - last >= DOT_GAP);
    if (lane < 0) lane = lanes.length < LANES ? lanes.length : lanes.indexOf(Math.min(...lanes));
    lanes[lane] = x;
    return el('span.ab-dot', {
      'data-tone': toneOf(inc.kind), style: `left:${(x * 100).toFixed(2)}%;--lane:${lane}`,
      title: `+${sinceStart(r, inc.tick)} · ${incidentText(sim, inc)}`,
    }, String(k + 1));
  });
  return el('div.ab-time', { style: `--lanes:${Math.max(1, lanes.length)}` }, [
    el('div.ab-track', {}, dots),
    el('div.ab-ends', {}, [el('span', {}, '0'), el('span', {}, `+${sinceStart(r, r.toTick)}`)]),
  ]);
}

/** The four panels of a report: the Heart, what was made, the Crier, the log. */
export function reportPanels(r: AwayReport, sim: Sim): HTMLElement[] {
  // ── the Heart: gains and losses on one scale ──
  const hearth = top(r.hearthDelta, ROWS);
  const hMax = Math.max(1, ...hearth.map((i) => Math.abs(r.hearthDelta[i]!)));
  const heart = panel('heart', () => t('away.heart'), mark('store'), hearth.map((i) => {
    const v = r.hearthDelta[i]!;
    return barRow(itemMention(i), v, hMax, v > 0 ? 'good' : 'bad', signed(v));
  }));

  // ── what was made ──
  const madeItems = top(r.produced, ROWS, (v) => v >= 1000);
  const mMax = Math.max(1, ...madeItems.map((i) => r.produced[i]!));
  const made = panel('made', () => t('away.made'), mark('recipe'), madeItems.map((i) => barRow(itemMention(i), r.produced[i]!, mMax, 'good', num(r.produced[i]! / 1000))));

  // ── the Crier: the goods as chips, the ocelles as bars, the net in the header ──
  const trade: Array<HTMLElement | null> = [];
  const sold = top(r.sold, 4, (v) => v >= 1000), bought = top(r.bought, 3, (v) => v >= 1000);
  if (sold.length) trade.push(el('div.ab-row.ab-goods', {}, [el('span.ab-label', {}, t('away.sold')), chips(r.sold, sold)]));
  if (bought.length) trade.push(el('div.ab-row.ab-goods', {}, [el('span.ab-label', {}, t('away.bought')), chips(r.bought, bought)]));
  const cMax = Math.max(1, r.earned, r.spent);
  if (r.earned) trade.push(barRow(t('away.earned'), r.earned, cMax, 'good', `+${credits(r.earned)}`));
  if (r.spent) trade.push(barRow(t('away.spent'), r.spent, cMax, 'bad', `−${credits(r.spent)}`));
  const moved = !!(r.earned || r.spent || r.creditsDelta);
  const net = moved
    ? el('span.ab-net', { 'data-tone': r.creditsDelta >= 0 ? 'good' : 'bad', title: t('away.net') }, `${r.creditsDelta >= 0 ? '+' : '−'}${credits(Math.abs(r.creditsDelta))}`)
    : null;
  const crier = panel('crier', () => t('away.crier'), glyph('crier'), trade, net);

  // ── the log: the time line, then a row per incident; what was lost for want of room ──
  const lines = distinct(r);
  const shown = lines.slice(0, LOG_ROWS);
  const log: Array<HTMLElement | null> = [];
  if (shown.length) {
    log.push(timeLine(r, sim, shown));
    log.push(el('ol.ab-incs', {}, shown.map((i, k) => el('li.ab-inc', { 'data-tone': toneOf(i.kind) }, [
      el('span.ab-n', {}, String(k + 1)),
      el('span.ab-at', {}, t('away.at', { d: sinceStart(r, i.tick) })),
      el('span.ab-inc-icon', {}, INCIDENT_ICON[i.kind]()),
      el('span.ab-inc-text', {}, incidentText(sim, i)),
    ]))));
  }
  if (lines.length > LOG_ROWS) log.push(el('p.ab-more', {}, t('away.more', { n: lines.length - LOG_ROWS })));
  const lost = top(r.lostMu, 5, (v) => v >= 1000);
  if (lost.length) log.push(el('div.ab-lost', { title: t('away.lost', { list: list(lost.map((i) => `${num(r.lostMu[i]! / 1000)} ${itemRef(i)}`)) }) }, [mark('full'), el('span.ab-label', {}, t('away.lost.label')), chips(r.lostMu, lost)]));
  // What the Gleaners took off the ribbons by night (D103): counted, never silent.
  const taken = r.gleaned ? top(r.gleaned, 5, (v) => v >= 1000) : [];
  if (taken.length) log.push(el('div.ab-lost.ab-gleaned', { title: t('away.gleaned', { list: list(taken.map((i) => `${num(r.gleaned[i]! / 1000)} ${itemRef(i)}`)) }) }, [viewIconCanvas('moon', 16, false), el('span.ab-label', {}, t('stats.gleaned')), chips(r.gleaned, taken)]));
  if (!log.length) log.push(el('p.ab-none.ab-calm', {}, [mark('on'), t('away.calm')]));
  const logAside = lines.length ? el('span.ab-count', {}, [
    ...(['bad', 'good'] as const).map((tone) => {
      const n = lines.filter((i) => toneOf(i.kind) === tone).length;
      return n ? el('span.ab-count-n', { 'data-tone': tone }, num(n)) : null;
    }),
  ]) : null;
  return [heart, made, crier, panel('log', () => t('away.log'), mark('order'), log, logAside)];
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
  // A retired building by its old name (D117: the ids meant nothing to the player), else its id.
  if (c.removed.length) rows.push(el('p', {}, t('away.changes.removed', { list: list(c.removed.map((b) => `${RETIRED_NAMES[b.id]?.[locale()] ?? b.id} ×${b.n}`)) })));
  if (c.lost.length) rows.push(el('p', {}, t('away.changes.lost', { list: list(c.lost.map((l) => `${num(l.mu / 1000)} ${l.id}`)) })));
  if (c.reset.length) rows.push(el('p', {}, t('away.changes.reset', { list: list(c.reset) })));
  return panel('changes', () => t('away.changes'), mark('build'), rows);
}
