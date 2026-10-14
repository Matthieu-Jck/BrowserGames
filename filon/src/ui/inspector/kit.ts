// kit.ts — what every inspector panel gets: the context of the inspected building (colony,
// entity, its engine node, the host's actions), a way to register 4 Hz live updaters, and the
// small DOM helpers the panels share (rows, an item's row, headings, notes, item pickers, lists
// of held items, number formats). An item named here shows its icon (mention.ts).
import { ITEM_IDS, itemDef } from '@/content/registry';
import type { BuildingKind } from '@/content/types';
import { el, setAttr, setText } from '@/core/dom';
import { locale } from '@/i18n/i18n';
import type { Atlas } from '@/render/art/atlas';
import type { FNode } from '@/sim/flow/node';
import type { Sim } from '@/sim/state';
import { St, type Ent } from '@/sim/types';
import { itemPicker } from '../item-picker';
import { itemMention } from '../mention';

export interface InspectorHost {
  sim(): Sim;
  selected(): number;
  select(id: number): void;
  remove(id: number): void;
  setRecipe(id: number, recipe: string | null): void;
  openResearch(): void;
  /** Open the Crier screen (on its Trade tab). */
  openCrier?(tab?: 'trade'): void;
  notify(kind: 'good' | 'bad' | 'info' | 'warn', text: string): void;
  /** Take the Link tool from this pillar or the Heart (power wires, D25). */
  link?(id: number): void;
  /** The pillar the Link tool starts from now (0: none, or the tool is put away). */
  linkSource?(): number;
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
}

/** The tone of a building's state (St), for its status line and its progress bar (`data-tone`). */
export const STATUS_TONE: Readonly<Record<number, string>> = {
  [St.Ok]: 'good', [St.Starved]: 'warn', [St.Blocked]: 'warn', [St.Unpowered]: 'bad', [St.NoJob]: 'warn',
  [St.Idle]: 'idle', [St.LowPower]: 'warn', [St.NoFuel]: 'bad', [St.Building]: 'idle', [St.Dormant]: 'idle',
};

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

/**
 * A panel: DOM for one aspect of a building kind. Built when the selection (or what the
 * panel's signature depends on, see Inspector.sig) changes; live values go through `live`.
 */
export type Panel = (c: PanelCtx) => Array<HTMLElement | null>;

export const itemName = (i: number): string => itemDef(i).name[locale()];
export const fmt = (v: number, d = 1): string => new Intl.NumberFormat(locale(), { maximumFractionDigits: d }).format(v);
export const itemIndex = (id: string): number => ITEM_IDS.indexOf(id as never);

/** Items a port or a route may carry (no fluids), in content order. */
export const CARGO = (): number[] => ITEM_IDS.map((_, i) => i).filter((i) => itemDef(i).kind !== 'fluid');

/** Has the base seen this item (made, used or held it)? Pickers list those first. */
export const seenBy = (sim: Sim) => (i: number): boolean => sim.produced[i]! > 0 || sim.consumed[i]! > 0 || sim.stock[i]! > 0;

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
