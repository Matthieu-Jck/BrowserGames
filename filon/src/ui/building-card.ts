// building-card.ts — the building card: an inked paper card that opens above the build bar when
// the pointer rests on a tray slot (`.bb-slot[data-def]`), or a slot takes the keyboard focus.
// It shows rather than tells (owner, 2026-10-13): a routing block's rule as a little diagram, a
// machine's recipes as icons per minute, its ports as its footprint with arrows in and out, then
// its figures (building-facts.ts: power, throughput, stores, reach, where it may stand, what it
// replaces) and its cost (each item's amount, icon and name, coral where the Hearth runs short).
// Words only where nothing shows how it works: its description's first sentence (`brief`).
//
// It listens on the build bar's root by event delegation, so the bar knows nothing of it. A short
// rest opens it; once one is open, the next slot's opens at once, and it closes a moment after the
// pointer leaves the slots, so sweeping along the tray reads like flipping cards. The shell calls
// `refresh()` at 4 Hz with the other cartouches: a research that lands or the language rebuild it
// (its facts are compared whole: they are a few hundred bytes), stock changes only recolour the
// cost. It never takes the pointer (`pointer-events: none`).
import { ITEM_IDS, hasBuilding } from '@/content/registry';
import { el, setAttr, setStyle } from '@/core/dom';
import { num } from '@/i18n/format';
import { t } from '@/i18n/i18n';
import type { Atlas } from '@/render/art/atlas';
import type { Side } from '@/content/types';
import type { Sim } from '@/sim/state';
import { buildingIcon } from './build-bar';
import { itemMention } from './mention';
import {
  buildingFacts, factCtx, type BuildingFacts, type ItemRate, type PortFact, type RecipeFact, type RuleFact, type RuleLegend, type RuleSide,
} from './building-facts';

/** How long the pointer rests on a slot before the card opens (ms). */
const REST_MS = 260;
/** After a card closes, another slot opens at once for this long (ms): sweeping the tray. */
const WARM_MS = 700;
/** Grace before closing when the pointer leaves a slot (ms): crossing the gap to the next one. */
const LEAVE_MS = 120;

export interface BuildingCardHost {
  sim(): Sim;
  /** A full screen (the menu included) covers the bar: the card closes. */
  covered?(): boolean;
}

export class BuildingCard {
  readonly root: HTMLElement;
  /** The slot under the pointer or the focus (pending or shown), and the one the card stands for. */
  private target: HTMLElement | null = null;
  private anchor: HTMLElement | null = null;
  private sig = '';
  private chips: Array<{ node: HTMLElement; item: number; mu: number }> = [];
  private restTimer = 0;
  private leaveTimer = 0;
  private warmUntil = 0;

  constructor(private readonly atlas: Atlas, private readonly host: BuildingCardHost, bar: HTMLElement) {
    this.root = el('div.bcard.cartouche', { 'data-screen': 'building-card', role: 'tooltip', hidden: '' });
    bar.addEventListener('pointerover', (e) => this.enter(e.target));
    bar.addEventListener('pointerout', (e) => this.leave(e.relatedTarget));
    bar.addEventListener('focusin', (e) => this.enter(e.target));
    bar.addEventListener('focusout', (e) => this.leave(e.relatedTarget));
  }

  /** The building the card shows (null when closed). */
  get shown(): string | null {
    return this.root.hidden ? null : this.anchor?.dataset.def ?? null;
  }

  private slotOf(target: EventTarget | null): HTMLElement | null {
    return target instanceof Element ? target.closest<HTMLElement>('.bb-slot[data-def]') : null;
  }

  private enter(target: EventTarget | null): void {
    const slot = this.slotOf(target);
    if (!slot) return;
    window.clearTimeout(this.leaveTimer);
    if (slot === this.target) return; // a child of the same slot
    this.target = slot;
    window.clearTimeout(this.restTimer);
    if (!this.root.hidden || performance.now() < this.warmUntil) this.open(slot);
    else this.restTimer = window.setTimeout(() => this.open(slot), REST_MS);
  }

  private leave(to: EventTarget | null): void {
    if (this.target && to instanceof Node && this.target.contains(to)) return; // still inside the slot
    this.target = null;
    window.clearTimeout(this.restTimer);
    window.clearTimeout(this.leaveTimer);
    this.leaveTimer = window.setTimeout(() => this.close(), LEAVE_MS);
  }

  private open(slot: HTMLElement): void {
    if (!slot.isConnected) return;
    this.anchor = slot;
    this.sig = '';
    this.refresh();
  }

  close(): void {
    window.clearTimeout(this.restTimer);
    if (!this.root.hidden) this.warmUntil = performance.now() + WARM_MS;
    this.anchor = null;
    this.target = null;
    setAttr(this.root, 'hidden', '');
  }

  /** 4 Hz (and on opening): rebuild when the facts changed, recolour the cost, follow the slot. */
  refresh(): void {
    const a = this.anchor;
    const def = a?.dataset.def;
    if (!a || !def) return;
    if (!hasBuilding(def)) { this.close(); return; } // never throw in the 4 Hz loop over a stray slot
    // The tray closed or was rebuilt (another category): its slots are gone. Or a screen came
    // over the bar from the keyboard while the pointer rested on a slot.
    if (!a.isConnected || !a.closest('.buildbar[data-open]') || this.host.covered?.()) { this.close(); return; }
    const sim = this.host.sim();
    const facts = buildingFacts(def, factCtx(sim));
    const sig = JSON.stringify(facts);
    if (sig !== this.sig) { this.sig = sig; this.build(facts); }
    for (const c of this.chips) setAttr(c.node, 'data-poor', sim.stock[c.item]! < c.mu ? '' : null);
    setAttr(this.root, 'hidden', null);
    this.place(a);
  }

  private build(f: BuildingFacts): void {
    const atlas = this.atlas;
    this.chips = f.cost.map((c) => ({
      item: c.item, mu: c.mu,
      // The amount, then the item's icon and name: a card has the room to say what it costs.
      node: el('span.bcard-chip', { 'data-item': ITEM_IDS[c.item] }, [num(Math.ceil(c.mu / 1000)), itemMention(c.item)]),
    }));
    this.root.replaceChildren(...[
      el('header.bcard-head', {}, [
        buildingIcon(atlas, f.id, 44),
        el('div.bcard-titles', {}, [el('div.bcard-name.lettering', {}, f.name), el('div.bcard-sub', {}, f.sub)]),
      ]),
      f.brief ? el('p.bcard-desc', {}, f.brief) : null,
      f.locked ? el('div.bcard-lock', {}, f.locked) : null,
      f.rule ? ruleBlock(f.rule) : null,
      f.recipes ? recipesBlock(f.recipes) : null,
      f.ports ? portsBlock(f.ports) : null,
      f.rows.length ? el('dl.bcard-rows', {}, f.rows.map((r) => el('div.bcard-row', { 'data-k': r.k }, [
        el('dt', {}, r.label),
        el('dd', {}, [...(r.items ?? []).map((i) => itemMention(i, { name: false })), el('span', {}, r.text)]),
      ]))) : null,
      el('footer.bcard-cost', {}, [
        el('span.bcard-h.lettering', {}, t('build.cost')),
        ...(this.chips.length ? this.chips.map((c) => c.node) : [el('span', {}, t('build.free'))]),
      ]),
    ].filter((n): n is HTMLElement => !!n));
  }

  /**
   * Above the tray, centred on the slot, kept inside the window, its tail pointing at the slot.
   * Rects are in screen pixels, but the card's own left/top are in its zoomed pixels (it zooms
   * with `--ui-scale`, like #ui): divide by the zoom, read off the card itself (screen ÷ layout width).
   */
  private place(slot: HTMLElement): void {
    const r = slot.getBoundingClientRect();
    const tray = (slot.closest('.bb-tray') ?? slot).getBoundingClientRect();
    const box = this.root.getBoundingClientRect();
    const zoom = this.root.offsetWidth > 0 ? box.width / this.root.offsetWidth : 1;
    const cx = r.left + r.width / 2;
    const x = Math.max(8, Math.min(window.innerWidth - box.width - 8, cx - box.width / 2));
    const above = tray.top - box.height - 14;
    setStyle(this.root, 'left', `${Math.round(x / zoom)}px`);
    setStyle(this.root, 'top', `${Math.round(Math.max(8, above) / zoom)}px`);
    setStyle(this.root, '--tail', `${Math.round(Math.max(20, Math.min(box.width - 20, cx - x)) / zoom)}px`);
    setAttr(this.root, 'data-tail', above >= 8 ? '' : null); // no room above: no tail to point with
  }
}

// ── recipes ────────────────────────────────────────────────────────────────

/** « [ore] 30 + [coal] 6 → [plate] 15  Plaque de fer », one line per unlocked recipe, columns aligned. */
function recipesBlock(list: readonly RecipeFact[]): HTMLElement {
  const chip = (r: ItemRate): HTMLElement => el('span.bcard-ir', {}, [itemMention(r.item, { name: false }), num(r.perMin)]);
  const plus = (rates: readonly ItemRate[]): HTMLElement[] => rates.flatMap((r, i) => (i ? [el('span.bcard-plus', {}, '+'), chip(r)] : [chip(r)]));
  return el('section.bcard-recipes', {}, [
    el('div.bcard-h.lettering', {}, t('card.recipes')),
    ...(list.length
      ? list.map((r) => el('div.bcard-recipe', {}, [
        el('span.bcard-ins', {}, plus(r.ins)),
        el('span.bcard-to', {}, '→'),
        el('span.bcard-outs', {}, plus(r.outs)),
        el('span.bcard-rname', {}, r.name),
      ]))
      : [el('div.bcard-none', {}, t('card.recipes.none'))]),
  ]);
}

// ── the routing rule diagram ───────────────────────────────────────────────
// A 3 × 3 board: the block in the middle (front up), what happens on each side around it. Drawn
// as inline SVG; colours come from the CSS tokens through classes (`data-tone`), so the diagram
// follows the palette.

const NS = 'http://www.w3.org/2000/svg';

function svg(tag: string, attrs: Record<string, string | number>, kids: Element[] = []): SVGElement {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  n.append(...kids);
  return n;
}

/** An arrowhead with its tip at (x, y), pointing along (ux, uy). */
function head(x: number, y: number, ux: number, uy: number): SVGElement {
  const l = Math.hypot(ux, uy) || 1;
  const dx = ux / l, dy = uy / l;
  const bx = x - dx * 7, by = y - dy * 7;
  return svg('path', { class: 'bc-head', d: `M${x} ${y}L${bx - dy * 4.5} ${by + dx * 4.5}L${bx + dy * 4.5} ${by - dx * 4.5}Z` });
}

/** A straight arrow from (x1, y1) to (x2, y2): a head at the end, and at the start too for `both`. */
function arrow(x1: number, y1: number, x2: number, y2: number, s: Pick<RuleSide, 'tone' | 'dashed'>, both = false): SVGElement {
  const ux = x2 - x1, uy = y2 - y1;
  const l = Math.hypot(ux, uy) || 1;
  const k = 5 / l; // stop the line short of the tips so its round cap does not poke through
  const kids: Element[] = [
    svg('line', { x1: both ? x1 + ux * k : x1, y1: both ? y1 + uy * k : y1, x2: x2 - ux * k, y2: y2 - uy * k, ...(s.dashed ? { 'stroke-dasharray': '4 3' } : {}) }),
    head(x2, y2, ux, uy),
  ];
  if (both) kids.push(head(x1, y1, -ux, -uy));
  return svg('g', { class: 'bc-arrow', 'data-tone': s.tone }, kids);
}

/** The block's four sides on a 84 px board: inner end (at the block), outer end (the board's edge). */
const EDGE: Record<Side, [number, number, number, number]> = {
  N: [42, 27, 42, 4], E: [57, 42, 80, 42], S: [42, 57, 42, 80], W: [27, 42, 4, 42],
};

function sideMark(side: Side, s: RuleSide): SVGElement {
  const [ix, iy, ox, oy] = EDGE[side];
  if (s.flow === 'store') {
    // A store pressed against that side: a little crate.
    const cx = (ix + ox) / 2, cy = (iy + oy) / 2;
    return svg('g', { class: 'bc-store' }, [
      svg('rect', { x: cx - 13, y: cy - 10, width: 26, height: 20, rx: 3 }),
      svg('path', { d: `M${cx - 13} ${cy - 3}H${cx + 13}M${cx} ${cy - 3}V${cy + 10}` }),
    ]);
  }
  if (s.flow === 'in') return arrow(ox, oy, ix, iy, s);
  return arrow(ix, iy, ox, oy, s, s.flow === 'both');
}

function blockDiagram(rule: RuleFact): SVGElement {
  const kids: Element[] = [];
  // The neighbouring tiles, faint, so the sides read as places.
  for (const [x, y] of [[28, 0], [56, 28], [28, 56], [0, 28]] as const) kids.push(svg('rect', { class: 'bc-tile', x: x + 2, y: y + 2, width: 24, height: 24, rx: 4 }));
  const block = svg('g', { class: 'bc-block' }, [svg('rect', { x: 29, y: 29, width: 26, height: 26, rx: 5 })]);
  if (rule.shape === 'cross') {
    kids.push(block);
    // One line straight through, the other crossing it over a gap: they never mix.
    kids.push(arrow(42, 82, 42, 2, { tone: 'a' }));
    kids.push(svg('g', { class: 'bc-arrow', 'data-tone': 'b' }, [
      svg('line', { x1: 2, y1: 42, x2: 34, y2: 42 }), svg('line', { x1: 50, y1: 42, x2: 77, y2: 42 }), head(82, 42, 1, 0),
    ]));
    return svg('svg', { class: 'bc-diagram', viewBox: '0 0 84 84', width: 84, height: 84, 'aria-hidden': 'true' }, kids);
  }
  // The block's own mark: a chevron towards its front, or a hub for blocks that work every way.
  block.append(rule.directed ? svg('path', { class: 'bc-mark', d: 'M35 47L42 39L49 47' }) : svg('circle', { class: 'bc-mark', cx: 42, cy: 42, r: 4 }));
  kids.push(block);
  for (const side of ['N', 'E', 'S', 'W'] as const) {
    const s = rule.sides?.[side];
    if (s) kids.push(sideMark(side, s));
  }
  return svg('svg', { class: 'bc-diagram', viewBox: '0 0 84 84', width: 84, height: 84, 'aria-hidden': 'true' }, kids);
}

/** A bridge: two of them, facing the same way four tiles apart, and the items' leap over the three between. */
function bridgeDiagram(): SVGElement {
  const kids: Element[] = [];
  for (let i = 1; i < 4; i++) kids.push(svg('rect', { class: 'bc-tile bc-gap', x: 4 + i * 26, y: 46, width: 22, height: 22, rx: 4 }));
  for (const x of [4, 108]) {
    kids.push(svg('g', { class: 'bc-block' }, [
      svg('rect', { x, y: 44, width: 26, height: 26, rx: 5 }),
      svg('path', { class: 'bc-mark', d: `M${x + 8} 57L${x + 14} 57M${x + 11} 53L${x + 16} 57L${x + 11} 61` }), // → its direction
    ]));
  }
  kids.push(svg('g', { class: 'bc-arrow', 'data-tone': 'a' }, [
    svg('path', { class: 'bc-arc', d: 'M17 42Q69 0 117 38' }), head(119, 41, 0.75, 1),
  ]));
  return svg('svg', { class: 'bc-diagram bc-wide', viewBox: '0 0 138 74', width: 138, height: 74, 'aria-hidden': 'true' }, kids);
}

/**
 * A legend swatch in its line's tone, read against a little block as on the diagram: an arrow
 * out of it, into it, both ways, or a crate pressed against it.
 */
function swatch(l: RuleLegend): SVGElement {
  const block = (x: number): SVGElement => svg('rect', { class: 'bc-sw-block', x, y: 3.5, width: 7, height: 7, rx: 1.5 });
  let kids: Element[];
  switch (l.flow) {
    case 'store': kids = [svg('g', { class: 'bc-store' }, [svg('rect', { x: 2, y: 1.5, width: 14, height: 11, rx: 2 })]), block(18)]; break;
    case 'in': kids = [arrow(1, 7, 17, 7, l), block(18)]; break;
    case 'both': kids = [arrow(2, 7, 24, 7, l, true)]; break;
    default: kids = [block(1), arrow(9, 7, 25, 7, l)]; break;
  }
  return svg('svg', { class: 'bc-swatch', viewBox: '0 0 26 14', width: 26, height: 14, 'aria-hidden': 'true' }, kids);
}

// ── the ports diagram ──────────────────────────────────────────────────────
// The footprint from above, front up (as placed before a turn: R turns it), each inlet a
// turquoise arrow into its tile's edge and each outlet a coral arrow out of it — the colours of
// the ports in the world. A legend counts them.

const CELL = 18, PAD = 16;
const OUT: Record<Side, [number, number]> = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };

function portsDiagram(p: NonNullable<BuildingFacts['ports']>): SVGElement {
  const W = p.w * CELL + 2 * PAD, H = p.h * CELL + 2 * PAD;
  const kids: Element[] = [svg('g', { class: 'bc-block' }, [svg('rect', { x: PAD, y: PAD, width: p.w * CELL, height: p.h * CELL, rx: 4 })])];
  for (let i = 1; i < p.w; i++) kids.push(svg('line', { class: 'bc-grid', x1: PAD + i * CELL, y1: PAD, x2: PAD + i * CELL, y2: PAD + p.h * CELL }));
  for (let j = 1; j < p.h; j++) kids.push(svg('line', { class: 'bc-grid', x1: PAD, y1: PAD + j * CELL, x2: PAD + p.w * CELL, y2: PAD + j * CELL }));
  // The front: a small chevron on the north edge.
  kids.push(svg('path', { class: 'bc-front', d: `M${W / 2 - 5} ${PAD + 7}L${W / 2} ${PAD + 3}L${W / 2 + 5} ${PAD + 7}` }));
  for (const q of p.list) {
    const [ux, uy] = OUT[q.side];
    const cx = PAD + (q.x + 0.5) * CELL, cy = PAD + (q.y + 0.5) * CELL;
    const ex = cx + (ux * CELL) / 2, ey = cy + (uy * CELL) / 2; // the tile's edge
    const far: [number, number] = [ex + ux * 13, ey + uy * 13], near: [number, number] = [ex + ux * 1.5, ey + uy * 1.5];
    kids.push(q.io === 'in' ? arrow(far[0], far[1], near[0], near[1], { tone: 'pin' }) : arrow(near[0], near[1], far[0], far[1], { tone: 'pout' }));
  }
  return svg('svg', { class: 'bc-diagram bc-ports', viewBox: `0 0 ${W} ${H}`, width: W, height: H, 'aria-hidden': 'true' }, kids);
}

function portsBlock(p: NonNullable<BuildingFacts['ports']>): HTMLElement {
  const n = (io: PortFact['io']): number => p.list.filter((q) => q.io === io).length;
  const legend: RuleLegend[] = [];
  if (n('in')) legend.push({ tone: 'pin', flow: 'in', text: t('card.ins', { n: n('in') }) });
  if (n('out')) legend.push({ tone: 'pout', flow: 'out', text: t('card.outs', { n: n('out') }) });
  return el('div.bcard-rule.bcard-ports', { 'data-shape': 'ports' }, [
    portsDiagram(p),
    el('ul.bcard-legend', {}, legend.map((l) => el('li', { 'data-flow': l.flow }, [swatch(l), el('span', {}, l.text)]))),
  ]);
}

function ruleBlock(rule: RuleFact): HTMLElement {
  return el('div.bcard-rule', { 'data-shape': rule.shape }, [
    rule.shape === 'bridge' ? bridgeDiagram() : blockDiagram(rule),
    el('ul.bcard-legend', {}, rule.legend.map((l) => el('li', { 'data-flow': l.flow }, [swatch(l), el('span', {}, l.text)]))),
  ]);
}
