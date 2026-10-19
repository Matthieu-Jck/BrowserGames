// deposit-card.ts — the deposit card (D99; owner, 2026-10-16: « hovering over a known resource
// source should pop a little tooltip or window that says what it is and which machine to extract
// it »). With nothing in hand, the pointer resting on a known deposit (anywhere: no fog, D148)
// pops a small cartouche beside it: the ore's glyph and name; what one tile of it gives a drill a
// minute as a bar against the best such tile, and the deposit's known tiles and their sum; the
// machines that work it as icons with their names, dim with a lock while still to unlock (a vein
// under rock: the excavators first, an arrow, then the drills); and the parcel's state — the
// claim's flag, a lease, a neighbouring base's, or its price. Water gets its pumps. Built from the
// panels' kit (D89: the meter), facts from deposit-facts.ts. Not while placing (D53: the tip has
// that job); the shell asks for it only when no tool, link or land mode is in hand.
// On a mouse it shows after a short rest on the tile; under a finger, on a tap with nothing in
// hand on bare ground (the shell's `tap`), until the finger moves on. It catches no pointer, and
// stays inside the window (`tipPlace`, D96).
import { ITEM_IDS, buildingDef, buildingIdx, itemDef } from '@/content/registry';
import { el, setAttr } from '@/core/dom';
import { locale, t, tr, type MsgKey } from '@/i18n/i18n';
import type { Atlas } from '@/render/art/atlas';
import { WORLD } from '@/sim/constants';
import type { Sim } from '@/sim/state';
import { buildingIcon, itemIcon } from './build-bar';
import { depositAt, depositExtent, type DepositFacts, type DepositMachine } from './deposit-facts';
import { glyph } from './glyphs';
import { meter, perMin } from './inspector/kit';
import { parcelState, parcelUnder } from './land-facts';
import { tipPlace } from './tip';
import { oc } from './trade-view';
import './styles/deposit-card.css';

/** How long the pointer rests on a tile before its card shows (ms). */
export const REST_MS = 320;
/** Screen px a finger may wander from its tap before the card goes. */
const SLOP = 10;

const coarse = typeof matchMedia === 'function' ? matchMedia('(pointer: coarse)') : null;
const SVG_NS = 'http://www.w3.org/2000/svg';

/** A closed padlock, inked (a machine still to unlock). */
function lock(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('class', 'dcard-lock');
  svg.setAttribute('aria-hidden', 'true');
  for (const [tag, a] of [
    ['path', { class: 'dl-shackle', d: 'M5 7.4V5.2a3 3 0 0 1 6 0v2.2' }],
    ['rect', { class: 'dl-body', x: '3.2', y: '7.2', width: '9.6', height: '7', rx: '1.4' }],
    ['path', { class: 'dl-hole', d: 'M8 10v1.8' }],
  ] as const) {
    const n = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(a)) n.setAttribute(k, v);
    svg.append(n);
  }
  return svg;
}

export class DepositCard {
  readonly root: HTMLElement;
  private sig = '';
  /** The tile under the pointer and since when (ms), the tile a tap pinned and where the finger was. */
  private tile = -1;
  private since = 0;
  private pinned: { key: number; sx: number; sy: number } | null = null;
  /** The last deposit flooded (its tiles), so resting along one deposit floods it once. */
  private extent: { item: number; keys: Set<number>; tiles: number; perMin: number } | null = null;
  /** Its size in its own px and its zoom (the UI's), measured when its content changes. */
  private size: [number, number] = [0, 0];
  private zoom = 1;

  constructor(private readonly atlas: Atlas) {
    this.root = el('div.dcard.cartouche', { hidden: true, role: 'tooltip', 'data-deposit-card': '' });
  }

  /** Is the card up? */
  get shown(): boolean {
    return !this.root.hidden;
  }

  /**
   * Each frame: the tile under the pointer when nothing is in hand and the pointer is over the
   * world (null otherwise: the card goes), and the pointer in screen px.
   */
  update(sim: Sim, tile: readonly [number, number] | null, sx: number, sy: number): void {
    const key = tile ? Math.floor(tile[1]) * WORLD + Math.floor(tile[0]) : -1;
    const now = performance.now();
    if (key !== this.tile) { this.tile = key; this.since = now; }
    if (this.pinned && (this.pinned.key !== key || Math.abs(sx - this.pinned.sx) > SLOP || Math.abs(sy - this.pinned.sy) > SLOP)) this.pinned = null;
    const rested = !coarse?.matches && now - this.since >= REST_MS;
    if (key < 0 || !(rested || this.pinned)) { this.hide(); return; }
    const x = key % WORLD, y = (key - x) / WORLD;
    const f = depositAt(sim, x, y);
    if (!f) { this.hide(); return; }
    this.show(sim, f, x, y, sx, sy);
  }

  /** A tap (or a click) with nothing in hand on bare ground: the card at once, until the pointer moves on. */
  tap(x: number, y: number, sx: number, sy: number): void {
    this.pinned = { key: Math.floor(y) * WORLD + Math.floor(x), sx, sy };
  }

  hide(): void {
    if (this.sig !== '') { this.sig = ''; this.root.hidden = true; }
  }

  private show(sim: Sim, f: DepositFacts, x: number, y: number, sx: number, sy: number): void {
    const ext = f.where === 'water' ? null : this.extentOf(sim, f.item, x, y);
    const p = parcelUnder(x, y), state = parcelState(sim, p);
    const cents = state === 'free' ? sim.landPrice(p) : 0;
    const sig = JSON.stringify([f.item, f.where, f.tilePerMin, ext?.tiles, ext ? Math.round(ext.perMin) : 0, f.machines.map((m) => m.locked), f.dig.map((m) => m.locked), state, cents, sim.credits >= cents, locale()]);
    if (sig !== this.sig) {
      this.sig = sig;
      this.build(sim, f, ext, state, cents);
      this.root.hidden = false;
      this.size = [this.root.offsetWidth, this.root.offsetHeight];
      this.zoom = this.size[0] > 0 ? this.root.getBoundingClientRect().width / this.size[0] : 1;
    }
    this.place(sx, sy);
  }

  private extentOf(sim: Sim, item: number, x: number, y: number): { tiles: number; perMin: number } {
    const k = y * WORLD + x;
    if (this.extent?.item !== item || !this.extent.keys.has(k)) this.extent = { item, ...depositExtent(sim, x, y) };
    return this.extent;
  }

  private build(sim: Sim, f: DepositFacts, ext: { tiles: number; perMin: number } | null, state: ReturnType<typeof parcelState>, cents: number): void {
    const L = locale();
    const kids: Array<HTMLElement | null> = [];
    kids.push(el('div.dcard-head', {}, [itemIcon(this.atlas, f.item, 28), el('span.dcard-name.lettering', {}, itemDef(f.item).name[L])]));
    // What it gives: one tile against the best tile of that ore; the deposit, its known tiles and their sum.
    if (f.where !== 'water') {
      const m = meter();
      m.set(f.tilePerMin, f.tileMax, f.tilePerMin >= f.tileMax * 0.5 ? 'good' : 'warn', perMin(f.tilePerMin));
      kids.push(el('div.dcard-rich', { title: t('deposit.tile.tip') }, [m.root]));
      if (ext && ext.tiles > 1) {
        kids.push(el('div.dcard-size', { title: t('deposit.size.tip') }, [glyph('ore'), el('span', {}, `${tr('land.tiles', { n: ext.tiles })} · ${perMin(ext.perMin)}`)]));
      }
    }
    // Who works it.
    const row = (m: DepositMachine): HTMLElement => {
      const def = buildingDef(buildingIdx(m.def));
      return el('div.dcard-m', { 'data-def': m.def, 'data-locked': m.locked ? '' : null, title: m.locked ? t('deposit.locked') : null }, [
        buildingIcon(this.atlas, m.def, 22), el('span', {}, def.name[L]), m.locked ? lock() : null,
      ]);
    };
    const mach: HTMLElement[] = [];
    if (f.dig.length) {
      mach.push(...f.dig.map(row));
      mach.push(el('div.dcard-then', { title: t('deposit.dig') }, '↓'));
    }
    mach.push(...f.machines.map(row));
    kids.push(el('div.dcard-mach', { 'data-where': f.where, title: f.where === 'vein' ? t('deposit.dig') : null }, mach));
    // The parcel: the claim's, a lease, a neighbouring base's (D110), or its price.
    const land: Record<string, [Parameters<typeof glyph>[0], MsgKey]> = {
      start: ['flag', 'land.legend.held'], bought: ['flag', 'land.legend.held'], granted: ['flag', 'land.legend.held'],
      leased: ['lease', 'land.legend.leased'], neighbour: ['flagNeighbour', 'land.legend.neighbour'], free: ['parcel', 'land.legend.free'],
    };
    const [g, label] = land[state]!;
    kids.push(el('div.dcard-land', { 'data-state': state, 'data-poor': state === 'free' && sim.credits < cents ? '' : null }, [
      glyph(g, t(label)), el('span', {}, state === 'free' ? oc(cents) : t(label)),
    ]));
    this.root.replaceChildren(...kids.filter((n): n is HTMLElement => !!n));
    setAttr(this.root, 'data-ore', ITEM_IDS[f.item]!);
    setAttr(this.root, 'data-where', f.where);
  }

  /** Beside the pointer, inside the window; in the card's own zoomed px (it zooms with the UI, like #ui). */
  private place(sx: number, sy: number): void {
    const zoom = this.zoom;
    const [x, y] = tipPlace(sx, sy, this.size[0] * zoom, this.size[1] * zoom, window.innerWidth, window.innerHeight, !!coarse?.matches);
    this.root.style.left = `${Math.round(x / zoom)}px`;
    this.root.style.top = `${Math.round(y / zoom)}px`;
  }
}
