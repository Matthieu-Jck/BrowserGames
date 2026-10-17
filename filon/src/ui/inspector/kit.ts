// kit.ts — the panels' component kit (D89; owner, 2026-10-15: « Plus clair, plus séparé »): what
// every inspector panel gets — the context of the inspected building (colony, entity, its engine
// node, the host's actions), a way to register 4 Hz and per-frame updaters, a place in the foot
// for its actions — and the pieces every panel, the building card and the screens are built from,
// so they read as one family (styles: styles/kit.css):
// · `section`: a card with a header (an icon and a title, a figure on the right) and its body, one
//   per thing a building has (its recipe, its stores, its grid…), tagged with the facet it belongs
//   to so a specialised view (D88) can lift it; a title or tip given as a function follows the
//   language by itself (`lang`: the kit's one listener says it again at each switch, for every
//   panel and screen built from the kit);
// · `statusLine`: a mark, one word coloured by the state (`Work`: on, pause, off; slowed by a weak
//   grid, D91; building; asleep) and the reason as icons (the inputs missing, the output full, no
//   power, a weak grid and its %, no wire, no recipe…);
// · `equation`: what a building does as icons — « [ore] 15 + [coal] 15 → [plate] 15 /min »;
// · `meter`: a gauge for a buffer or a rate, its value beside it; `progressBar` for a task;
// · `stat`: a big figure and its caption; numbers through `fmt` / `kw` / `perMin` (format.ts), the
//   same everywhere.
// An item named here shows its icon (mention.ts).
import { ITEM_IDS, itemDef } from '@/content/registry';
import type { BuildingKind } from '@/content/types';
import { el, setAttr, setText } from '@/core/dom';
import { num, pct, rate } from '@/i18n/format';
import { locale, onLocale, t, type MsgKey } from '@/i18n/i18n';
import type { Atlas } from '@/render/art/atlas';
import { viewIconCanvas } from '@/render/art/view-icons';
import type { FNode } from '@/sim/flow/node';
import type { Sim } from '@/sim/state';
import { St, type Ent } from '@/sim/types';
import { itemPicker } from '../item-picker';
import { itemMention } from '../mention';
import '../styles/kit.css';

/**
 * The part of a building a specialised view asks for first (D88: the views session's Électricité,
 * Logistique and Production views): its grid card; its ribbons, stores, filters and outlets; its
 * state and what it makes.
 */
export type Facet = 'power' | 'logistics' | 'production';

export interface InspectorHost {
  sim(): Sim;
  selected(): number;
  select(id: number): void;
  remove(id: number): void;
  setRecipe(id: number, recipe: string | null): void;
  openResearch(): void;
  /** Open the Crier screen (on its Trade tab). */
  openCrier?(tab?: 'trade'): void;
  /** Open the Expertise window (D93: the Core's Archive). */
  openExpertise?(): void;
  notify(kind: 'good' | 'bad' | 'info' | 'warn', text: string): void;
  /** Take the Link tool from this pillar or the Heart (power wires, D25). */
  link?(id: number): void;
  /** The pillar the Link tool starts from now (0: none, or the tool is put away). */
  linkSource?(): number;
  /** The view on screen (D88): its part of the building is lifted under the header, the rest fades. */
  facet?(): Facet | null;
}

/** The inspected building, as a panel sees it while building its DOM. */
export interface PanelCtx {
  readonly sim: Sim;
  readonly e: Ent;
  readonly kind: BuildingKind;
  /** Its node in the compiled flow graph (absent while under construction or dormant). */
  readonly node: FNode | undefined;
  readonly atlas: Atlas;
  readonly host: InspectorHost;
  /** Register a 4 Hz updater for values that change without a rebuild. */
  live(fn: () => void): void;
  /** Register a per-frame updater (`simTicks`: the game time between ticks) for what moves smoothly: a progress bar. */
  anim(fn: (simTicks: number) => void): void;
  /** Put a button in the foot, beside Demolish: every action of the panel in one place (D89). */
  action(node: HTMLElement): void;
}

/** The tone of a building's state (St), for its progress bar (`data-tone`). */
export const STATUS_TONE: Readonly<Record<number, string>> = {
  [St.Ok]: 'good', [St.Starved]: 'warn', [St.Blocked]: 'warn', [St.Unpowered]: 'bad', [St.NoJob]: 'warn',
  [St.Idle]: 'idle', [St.LowPower]: 'warn', [St.NoFuel]: 'bad', [St.Building]: 'idle', [St.Dormant]: 'idle',
};

/**
 * A panel: DOM for one aspect of a building kind. Built when the selection (or what the
 * panel's signature depends on, see Inspector.sig) changes; live values go through `live`.
 */
export type Panel = (c: PanelCtx) => Array<HTMLElement | null>;

// ── numbers: one format everywhere ────────────────────────────────────────────

/** A number as the panels write it: `num` (format.ts: whole from 100, else up to two decimals); `d = 0` rounds down to whole items. */
export const fmt = (v: number, d?: number): string => (d === 0 ? num(Math.floor(v + 1e-9)) : num(d === 1 ? Math.round(v * 10) / 10 : v));
/** Kilowatts: « 120 kW ». */
export const kw = (v: number): string => t('insp.kw', { v: num(Math.round(v)) });
/** Items a minute: « 15/min ». */
export const perMin = (v: number): string => rate(v);

export const itemName = (i: number): string => itemDef(i).name[locale()];
export const itemIndex = (id: string): number => ITEM_IDS.indexOf(id as never);

/** Items a port or a route may carry (no fluids), in content order. */
export const CARGO = (): number[] => ITEM_IDS.map((_, i) => i).filter((i) => itemDef(i).kind !== 'fluid');

/** Has the base seen this item (made, used or held it)? Pickers list those first. */
export const seenBy = (sim: Sim) => (i: number): boolean => sim.produced[i]! > 0 || sim.consumed[i]! > 0 || sim.stock[i]! > 0;

// ── marks: small inked symbols of the kit (the glyphs of glyphs.ts are the panels' others) ──

const NS = 'http://www.w3.org/2000/svg';

export type MarkId = 'on' | 'slow' | 'pause' | 'off' | 'build' | 'sleep' | 'tree' | 'full' | 'recipe' | 'store' | 'data' | 'level' | 'route' | 'cargo' | 'flight' | 'order' | 'gate' | 'filter' | 'job' | 'token';

/** Each mark on a 16 × 16 board: [tag, attributes]. Classes `k-*` take the palette (kit.css). */
const MARKS: Readonly<Record<MarkId, ReadonlyArray<readonly [string, Record<string, string>]>>> = {
  // At work: a disc with a tick.
  on: [['circle', { class: 'k-disc k-on', cx: '8', cy: '8', r: '6.4' }], ['path', { class: 'k-stroke k-light', d: 'M5 8.3l2.1 2.1L11 6.2' }]],
  // At work, slowed (a weak grid, D91): the tick on amber.
  slow: [['circle', { class: 'k-disc k-pause', cx: '8', cy: '8', r: '6.4' }], ['path', { class: 'k-stroke', d: 'M5 8.3l2.1 2.1L11 6.2' }]],
  // A passing stop: two bars.
  pause: [['circle', { class: 'k-disc k-pause', cx: '8', cy: '8', r: '6.4' }], ['path', { class: 'k-stroke', d: 'M6.4 5.4v5.2M9.6 5.4v5.2' }]],
  // Stopped: a square.
  off: [['circle', { class: 'k-disc k-off', cx: '8', cy: '8', r: '6.4' }], ['rect', { class: 'k-fill-light', x: '5.6', y: '5.6', width: '4.8', height: '4.8', rx: '0.8' }]],
  // Being built: a dashed ring and a hammer's head.
  build: [['circle', { class: 'k-ring', cx: '8', cy: '8', r: '6.2' }], ['path', { class: 'k-stroke', d: 'M5.6 10.6l3.6-3.6M8.4 5.4l2.4 2.4' }]],
  // Asleep: a crescent.
  sleep: [['circle', { class: 'k-disc k-sleep', cx: '8', cy: '8', r: '6.4' }], ['path', { class: 'k-fill-light', d: 'M9.6 4.2a4.2 4.2 0 1 0 2.4 6.6 3.4 3.4 0 0 1-2.4-6.6z' }]],
  // The tech tree: three nodes, linked.
  tree: [['path', { class: 'k-stroke', d: 'M4 8h3.2M8.8 8l2.6-3.4M8.8 8l2.6 3.4' }], ['circle', { class: 'k-node', cx: '3.4', cy: '8', r: '2' }], ['circle', { class: 'k-node', cx: '8', cy: '8', r: '1.8' }], ['circle', { class: 'k-node', cx: '12.4', cy: '3.8', r: '1.8' }], ['circle', { class: 'k-node', cx: '12.4', cy: '12.2', r: '1.8' }]],
  // Full: a box with an arrow stopped against its lid.
  full: [['rect', { class: 'k-box', x: '2.6', y: '6.6', width: '10.8', height: '7.4', rx: '1.2' }], ['path', { class: 'k-stroke k-hot', d: 'M8 1.6v4M5.8 3.6L8 1.4l2.2 2.2' }], ['path', { class: 'k-stroke', d: 'M2.6 9.4h10.8' }]],
  // A recipe: a sheet with lines.
  recipe: [['path', { class: 'k-sheet', d: 'M3.4 1.8h6.8l2.4 2.4v10H3.4z' }], ['path', { class: 'k-stroke k-thin', d: 'M5.4 6.4h5.2M5.4 8.8h5.2M5.4 11.2h3.4' }]],
  // A store: a crate.
  store: [['rect', { class: 'k-box', x: '2.2', y: '4', width: '11.6', height: '9.6', rx: '1.2' }], ['path', { class: 'k-stroke k-thin', d: 'M2.2 7.4h11.6M8 7.4v6.2' }]],
  // Data: a punched card.
  data: [['path', { class: 'k-sheet', d: 'M2.4 3.4h9.4l1.8 1.8v7.4H2.4z' }], ['path', { class: 'k-stroke k-thin', d: 'M4.6 6.4h1M7.4 6.4h1M10.2 6.4h1M4.6 9.4h1M7.4 9.4h1' }]],
  // A level: three steps.
  level: [['path', { class: 'k-box', d: 'M2 14V10.4h4V7.2h4V4h4v10z' }]],
  // A route: two points and a dashed arc.
  route: [['path', { class: 'k-stroke k-dash', d: 'M3.6 11.6Q8 2 12.4 11.6' }], ['circle', { class: 'k-node', cx: '3.6', cy: '11.8', r: '1.8' }], ['circle', { class: 'k-node', cx: '12.4', cy: '11.8', r: '1.8' }]],
  // Cargo: a container.
  cargo: [['rect', { class: 'k-box', x: '1.8', y: '4.4', width: '12.4', height: '8.2', rx: '1' }], ['path', { class: 'k-stroke k-thin', d: 'M4.8 5.6v6M8 5.6v6M11.2 5.6v6' }]],
  // In flight: a parcel with speed lines.
  flight: [['rect', { class: 'k-box', x: '6', y: '4.6', width: '8', height: '6.8', rx: '1' }], ['path', { class: 'k-stroke k-thin', d: 'M1.6 6.4h3M2.6 8h2M1.6 9.6h3' }]],
  // A standing order: a clock face.
  order: [['circle', { class: 'k-sheet', cx: '8', cy: '8', r: '6' }], ['path', { class: 'k-stroke', d: 'M8 4.6V8l2.4 1.6' }]],
  // Gates: an arrow in, an arrow out.
  gate: [['path', { class: 'k-stroke k-in', d: 'M1.6 5.4h6M5.4 3.2l2.2 2.2-2.2 2.2' }], ['path', { class: 'k-stroke k-out', d: 'M8.4 10.6h6M12.2 8.4l2.2 2.2-2.2 2.2' }]],
  // A filter: a funnel.
  filter: [['path', { class: 'k-sheet', d: 'M2 3h12l-4.6 5.4v4.8L6.6 14.6V8.4z' }]],
  // AI tokens (D68): a lilac hexagon, as the tech tree draws them.
  token: [['path', { class: 'k-token', d: 'M8 1.6l5.6 3.2v6.4L8 14.4l-5.6-3.2V4.8z' }], ['circle', { class: 'k-fill-ink', cx: '8', cy: '8', r: '1.7' }]],
  // A job: a shovel.
  job: [['path', { class: 'k-stroke', d: 'M3 13l6.4-6.4' }], ['path', { class: 'k-sheet', d: 'M8.4 5.6l3-3 2 2-3 3c-.8.8-2.2.6-2.6-.4-.4-.6-.2-1.2.6-1.6z' }]],
};

/** A mark of the kit, sized in em; its meaning on hover when given. */
export function mark(id: MarkId, title?: string): HTMLElement {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  for (const [tag, attrs] of MARKS[id]) {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    svg.append(n);
  }
  const span = document.createElement('span');
  span.className = 'kmark';
  span.dataset.mark = id;
  if (title) { span.title = title; span.setAttribute('aria-label', title); span.setAttribute('role', 'img'); }
  span.append(svg);
  return span;
}

// ── words that follow the language ────────────────────────────────────────────

/** Words on a panel: a string, shown as given, or a function that says them in the language of the moment. */
export type Label = string | (() => string);

/** What each node built with a live label says, and where (its text, or an attribute). */
const spoken = new WeakMap<Element, Array<readonly [attr: string | null, say: () => string]>>();
let listening = false;

const write = (node: Element, attr: string | null, s: string): void => {
  if (attr) setAttr(node, attr, s);
  else setText(node, s);
};

/** Say every live label of the document again: the language changed. */
function relabel(): void {
  if (typeof document === 'undefined') return;
  for (const node of document.querySelectorAll('[data-lang]')) for (const [attr, say] of spoken.get(node) ?? []) write(node, attr, say());
}

/**
 * Put `label` in `node` — its text, or the attribute `attr` (a tooltip) — and, when it is a
 * function, say it again at each language switch: one listener for every panel, card and screen
 * built from the kit, so none re-sets its titles on refresh. A node out of the document is skipped
 * (it is said afresh when built again). Returns the node.
 */
export function lang<E extends Element>(node: E, label: Label | null | undefined, attr: string | null = null): E {
  if (label == null) return node;
  write(node, attr, typeof label === 'string' ? label : label());
  if (typeof label === 'function') {
    let said = spoken.get(node);
    if (!said) { spoken.set(node, (said = [])); node.setAttribute('data-lang', ''); }
    said.push([attr, label]);
    if (!listening) { listening = true; onLocale(relabel); }
  }
  return node;
}

// ── sections ──────────────────────────────────────────────────────────────────

export interface SectionOpts {
  /** Its hook: `[data-sec="…"]`. */
  sec: string;
  /** Its title: a function (« () => t('…') ») follows the language by itself (`lang`). */
  title: Label;
  /** A mark, a glyph or an item's icon before the title. */
  icon?: Node | null;
  /** A figure on the right of its header (a total, a count). */
  aside?: Node | string | null;
  /** The facet it belongs to (a specialised view lifts it, D88). */
  group?: Facet | null;
  /** What the section is, in words, on hover of its header (D53); a function follows the language. */
  tip?: Label | null;
}

/** A section card: its header (icon, title, a figure on the right), then its body. */
export function section(o: SectionOpts, body: Array<Node | null | undefined>): HTMLElement {
  return el('section.ksec', { 'data-sec': o.sec, 'data-group': o.group ?? null }, [
    lang(el('header.ksec-head', {}, [
      o.icon ? el('span.ksec-icon', {}, o.icon) : null,
      lang(el('h4.ksec-title.lettering'), o.title),
      o.aside != null ? el('span.ksec-aside', {}, o.aside) : null,
    ]), o.tip, 'title'),
    ...body.filter((n): n is Node => !!n),
  ]);
}

// ── the status line ───────────────────────────────────────────────────────────

/** A building's state as the status line says it: at work, at work slowed by a weak grid (D91), a passing stop, stopped; being built; asleep (D80). */
export type StateWord = 'on' | 'slow' | 'pause' | 'off' | 'build' | 'sleep';

/**
 * The status line: a mark and one word coloured by the state, then the reason as icons (the
 * items it waits for, its full output, a struck bolt, a cut plug, an empty slot…). `set` writes
 * the word change-only and swaps the reasons only when `sig` changes.
 */
export function statusLine(): { root: HTMLElement; set(state: StateWord, reasons: () => Node[], sig: string, tip: string): void } {
  const m = el('span.kstatus-mark'), word = el('b.kstatus-word'), why = el('span.kstatus-why');
  const root = el('div.kstatus', { 'data-state': 'on', role: 'status' }, [m, word, why]);
  let shown: StateWord | null = null, lastSig: string | null = null;
  return {
    root,
    set(state, reasons, sig, tip) {
      if (state !== shown) { shown = state; m.replaceChildren(mark(state)); setAttr(root, 'data-state', state); }
      setText(word, t(`kit.state.${state}` as MsgKey));
      if (sig !== lastSig) { lastSig = sig; why.replaceChildren(...reasons()); }
      setAttr(root, 'title', tip || null);
    },
  };
}

/**
 * The weak grid as a reason (D91): the Électricité view's half-bolt (art/view-icons.ts `low`, the
 * same mark the map draws) and the share of its demand the grid serves, « 62 % ».
 */
export function weakReason(sat: number): HTMLElement {
  const p = pct(sat / 1000);
  return el('span.kreason', { 'data-k': 'weak', title: t('insp.status.weak.tip', { p }) }, [viewIconCanvas('low', 20), el('b.kreason-n', {}, p)]);
}

/** A reason that is an item: its icon, dashed when it is missing, ringed coral when it is full. */
export function itemReason(item: number, how: 'missing' | 'full'): HTMLElement {
  return el('span.kreason', { 'data-k': how, 'data-item': ITEM_IDS[item] }, [itemMention(item, { name: false }), how === 'full' ? mark('full') : null]);
}

// ── figures ───────────────────────────────────────────────────────────────────

/** One term of an equation: an item's icon (or a glyph) and how many. */
export interface Term { icon: Node; n?: string | HTMLElement; item?: number }

/** An item as a term: its icon, its name on hover. */
export const itemTerm = (item: number, n?: string | HTMLElement): Term => ({ icon: itemMention(item, { name: false }), n, item });

/**
 * What a building does, as icons: « [ore] 15 + [coal] 15 → [plate] 15 », a unit after it (« /min »).
 * No inputs: « → [ore] 13,4 ». Each term's figure sits under its icon, or beside it when `inline`
 * (a list of recipes, the building card).
 */
export function equation(ins: readonly Term[], outs: readonly Term[], unit?: string, inline = false): HTMLElement {
  const term = (x: Term): HTMLElement => el('span.keq-term', { 'data-item': x.item !== undefined ? ITEM_IDS[x.item] : null }, [el('span.keq-icon', {}, x.icon), x.n != null ? el('b.keq-n', {}, x.n) : null]);
  const side = (xs: readonly Term[]): HTMLElement[] => xs.flatMap((x, i) => (i ? [el('span.keq-op', {}, '+'), term(x)] : [term(x)]));
  return el('div.keq', { 'data-inline': inline ? '' : null }, [...side(ins), el('span.keq-op.keq-to', {}, '→'), ...side(outs), unit ? el('small.keq-unit', {}, unit) : null]);
}

/** A big figure and its caption under it (« 21 kW · actuelle »). */
export function stat(value: HTMLElement, caption: string, icon?: Node | null): HTMLElement {
  return el('div.kstat', {}, [icon ? el('span.kstat-icon', {}, icon) : null, el('div.kstat-body', {}, [value, el('small.kstat-cap', {}, caption)])]);
}

/**
 * A meter: a gauge of a buffer or a rate against its room or its need, its value beside it.
 * `set(value, max, tone, text)`: the fill is value / max (a transform), the text change-only.
 */
export function meter(): { root: HTMLElement; set(value: number, max: number, tone: string, text: string): void } {
  const bar = progressBar(), v = el('span.kmeter-v');
  const root = el('div.kmeter', {}, [bar.root, v]);
  return {
    root,
    set(value, max, tone, text) {
      bar.set(max > 0 ? value / max : 0, tone);
      setText(v, text);
    },
  };
}

/**
 * A small progress bar (owner, 2026-10-13: "put a little progress bar to show the progression of
 * the current task"): `set(frac, tone)` scales its fill (0…1: a transform, no layout work, fine
 * every frame) and tints it by the building's state. Change-only writes.
 */
export function progressBar(): { root: HTMLElement; set(frac: number, tone: string): void } {
  const fill = el('div.insp-bar-fill');
  const root = el('div.insp-bar', { role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100' }, [fill]);
  let lastF = -1, lastT = '';
  return {
    root,
    set(frac, tone) {
      const f = Math.round(Math.max(0, Math.min(1, frac)) * 1000) / 1000;
      if (f !== lastF) { lastF = f; fill.style.transform = `scaleX(${f})`; root.setAttribute('aria-valuenow', String(Math.round(f * 100))); }
      if (tone !== lastT) { lastT = tone; root.setAttribute('data-tone', tone); }
    },
  };
}

/**
 * Progress that moves smoothly between the sim's 10 Hz ticks: the value read at the last tick plus
 * its last step per tick, times the time since that tick (`simTicks` − tick). `read` gives the
 * value now (0…`need`) and whether it advances; a value that wrapped (a craft done, the next one
 * begun) counts its step across the wrap. Returns the fraction done.
 */
export function smoothProgress(sim: Pick<Sim, 'tick'>, read: () => { v: number; need: number; on: boolean }): (simTicks: number) => number {
  let tick = -1, last = 0, step = 0;
  return (simTicks) => {
    const { v, need, on } = read();
    if (need <= 0) return 0;
    if (sim.tick !== tick) {
      let d = v - last;
      if (d < 0) d += need;
      step = on && tick >= 0 && sim.tick > tick ? d / (sim.tick - tick) : 0;
      tick = sim.tick;
      last = v;
    }
    return Math.min(1, (v + (on ? step * Math.max(0, Math.min(1, simTicks - sim.tick)) : 0)) / need);
  };
}

// ── rows and lists ────────────────────────────────────────────────────────────

export const heading = (text: string): HTMLElement => el('h4.lettering', {}, text);

/** A short explanation under a heading or a control: muted, never inline with what precedes it. */
export const note = (text: string): HTMLElement => el('p.insp-note', {}, text);

export function row(label: string | HTMLElement, value: HTMLElement | string, icon?: HTMLElement | null): HTMLElement {
  return el('div.insp-row', {}, [icon ?? null, el('span.insp-label', {}, label), el('span.insp-value', {}, value)]);
}

/** A row about one item: its icon and name on the left, `value` on the right. */
export function itemRow(item: number, value: HTMLElement | string): HTMLElement {
  return el('div.insp-row.insp-itemrow', { 'data-item': ITEM_IDS[item] }, [el('span.insp-label', {}, itemMention(item)), el('span.insp-value', {}, value)]);
}

/**
 * A picker over the cargo items with a first « none / any » choice (value -1): the item's icon
 * and name on the button and in the list, the items the base has seen first. `hook` names it
 * (`data-pick`) so the inspector can give it the focus back after a rebuild.
 */
export function itemSelect(sim: Sim, current: number, noneLabel: string, onPick: (item: number) => void, hook: string, label?: string, attrs: Record<string, unknown> = {}, noneFace?: string): HTMLButtonElement {
  return itemPicker({ items: CARGO(), value: current, none: noneLabel, onPick, known: seenBy(sim), label, attrs: { 'data-pick': hook, ...attrs }, ...(noneFace !== undefined ? { noneFace } : {}) }).root;
}

/**
 * Held items as chips, kept in step at 4 Hz: `read` gives the items to show and their amounts, in
 * order; `empty` is said when there are none. Each chip is the item's icon and the amount, with
 * the name beside the icon when `named` (short lists), else on hover (the Heart's stock).
 */
export function heldList(live: PanelCtx['live'], read: () => ReadonlyArray<readonly [item: number, amount: number]>, empty: string | HTMLElement, o: { named?: boolean; digits?: number } = {}): HTMLElement {
  const box = el('div.insp-held');
  const chips = new Map<number, { node: HTMLElement; n: HTMLElement }>();
  const none = typeof empty === 'string' ? el('span.insp-empty', {}, empty) : empty;
  live(() => {
    const now = read();
    const want = now.map(([i]) => {
      let c = chips.get(i);
      if (!c) {
        const n = el('b');
        c = { node: el('span.insp-chip', { 'data-item': ITEM_IDS[i] }, [itemMention(i, { name: !!o.named }), n]), n };
        chips.set(i, c);
      }
      return c.node;
    });
    const kids = want.length ? want : [none];
    if (kids.length !== box.children.length || kids.some((k, j) => box.children[j] !== k)) box.replaceChildren(...kids);
    for (const [i, v] of now) setText(chips.get(i)!.n, fmt(v, o.digits ?? 0));
    setAttr(box, 'data-empty', now.length ? null : '');
  });
  return box;
}

/**
 * A cost as chips: each item's icon (its name on hover) and how many, coral when the Heart holds
 * fewer. Items by id or index, amounts in whole items.
 */
export function costChips(sim: Sim, cost: ReadonlyArray<readonly [item: string | number, n: number]>): HTMLElement {
  return el('div.insp-cost', {}, cost.map(([it, n]) => {
    const i = typeof it === 'number' ? it : itemIndex(it);
    return el('span.tip-chip', { 'data-poor': sim.stock[i]! < n * 1000 ? '' : null }, [itemMention(i, { name: false }), fmt(n, 0)]);
  }));
}
