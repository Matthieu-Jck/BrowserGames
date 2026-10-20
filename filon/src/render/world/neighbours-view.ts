// neighbours-view.ts — the neighbouring bases on the land (D110; owner, 2026-10-17: « S'il y a un
// endroit possédé par un PNJ, il faut qu'il y ait vraiment une base », « leurs bâtiments ressemblent
// trop aux miens », « il n'y a rien qui marche, même pas de câble électrique »). The sim lays each
// base out from the seeds the first time something asks (sim/world/neighbours.ts); this view asks
// for those near the camera (there is no fog to wait for, D148), and draws each as someone else's
// working base:
// - its buildings, ribbons and flag through the buildings view (`layForeign`: the claim's art,
//   washed strongly in the colony's weathered colours, never switched off, parts always turning),
//   its lamps through the lights view, its grid's wires through the wires view (hung like the
//   claim's, always lit, never joined to the claim's grids);
// - what no base of the claim has (art/recipes/neighbour-dress.ts, baked once per colours): the
//   patched tarp each of its buildings stands on (the `decals` plane: both views), covered depots
//   (dome tents), banner poles by its pad, cairns along its edge (iso among the volumes, plan flat);
// - per frame, for the bases in view only: the goods riding its ribbons (a loop from the world's
//   clock: no sim, nothing saved), smoke from its furnaces' chimneys, its name and its trade's word
//   on a cloth band over it from mid zoom out (« Seven Horns · Fonderie », D134; constant on screen),
//   and now and then, at a minute's turn, a CrierBelt drone hauling a container off its pad (the
//   cargo view's).
//
// What it costs (D162). With no fog (D148) a far view takes in a dozen bases, and drawn from the
// claim's atlas they brought most of its pages onto the GPU (+230 MB on a fresh base). So:
// - a base wears a look by the zoom (world/neighbour-lod.ts): far, every texture a half-size copy on
//   the neighbours' own small sheet; in detail, the claim's frames where their page is on the GPU
//   already, copies of the rest (world/neighbour-art.ts). A switch lays its art again; its wires,
//   lights and moving parts' turns stay.
// - bases are laid within `MARGIN` of the view and dropped once out of a wider ring (`KEEP`) for
//   `DROP_MS`; the detail sheet is let go a while after the last base in detail; a sheet grown too
//   big is renewed (its bases laid again on a fresh one, the old destroyed).
// - checked for new bases when the view's range of parcels (or the look) changes, not every frame;
//   laid one step a frame, the nearest the view's middle first (`pending`, `layNext`): the sim lays a
//   base out a try at a time, then it is drawn, then lit. The bases round the view are laid out
//   ahead in the browser's idle time, and what their kinds need the first time baked (their cast
//   shadows, their lamps' places, their flags: `prefetch`, `nextIdle`), so one coming into view is
//   only drawn.
// `plain` (debug) draws them as before D162, for before / after shots and measures.
import { Container, Sprite, type Texture, type TextureSource } from 'pixi.js';
import { BUILDING_IDS, BUILDING_KIND, ITEM_IDS } from '@/content/registry';
import { colonyEmblem, emblemKey, type Emblem } from '@/content/emblem';
import { NEIGHBOUR_CORE_TOP, NEIGHBOUR_MAST, NEIGHBOUR_TENT } from '@/content/neighbours';
import type { BuildingId } from '@/content/buildings';
import { hash32 } from '@/core/hash';
import { WORLD } from '@/sim/constants';
import { footprint } from '@/sim/entities';
import type { Sim } from '@/sim/state';
import type { Ent } from '@/sim/types';
import { PARCEL, PARCEL_COLS, parcelAt, parcelCentre } from '@/sim/world/land';
import type { Holding, NLayout } from '@/sim/world/neighbours';
import { ibKey, IB_PX, type Atlas } from '../art/atlas';
import type { DynFrame } from '../art/dyn-atlas';
import { emblemColor } from '../art/emblem';
import {
  CORE, DRESS_K, PLAN_PX, bannerFrame, cairnFrame, coreFrame, coreWireZ, drawBanner, drawBannerPlan, drawCairn, drawCairnPlan, drawCore, drawCorePlan,
  drawName, drawTarp, drawTent, drawTentPlan, nameFrame, tentFrame, type DressColours,
} from '../art/recipes/neighbour-dress';
import { isoHead } from '../art/recipes/buildings';
import { C, mix, num } from '../art/tokens';
import { LH, tileToIso } from '../iso';
import type { Lin } from '../projection';
import type { BuildingsView } from './buildings-view';
import type { CargoView } from './cargo-view';
import { itemPx } from './items-view';
import type { LightsView } from './lights-view';
import { NeighbourArt } from './neighbour-art';
import { DETAIL_HOLD_MS, DROP_MS, FAR_K, KEEP, MARGIN, SHEET_CAP, grow, overlaps, planBases, zoomLook, type Box, type Look } from './neighbour-lod';
import { flagFrames } from './heart-flag';
import { buildingZ } from './stand';
import type { WiresView } from './wires-view';
import { goodAt, goodsOn } from './neighbour-goods';
import { wireAnchor, wireEnds } from './wire-geom';

/** The ghost entities' ids: out of the claim's range, 64 a base (its hub parcel's), under the buildings view's ranks. */
export const FOREIGN_ID0 = 12_000_000;
/** How strongly their buildings take their colours (‰ of the weathered colour multiplied in): unmistakably theirs. */
const WASH = 0.62;
/** A tarp's hem round a footprint (tiles). */
const HEM = 0.35;
/** The lines a base draws (and its goods ride), at most. */
const MAX_LINES = 20;
/** The goods on their ribbons: tiles between two, tiles a second. */
const ITEM_GAP = 1.6, ITEM_SPEED = 1.1;
/** The buildings that smoke (their furnaces' chimneys), and a plume's puffs. */
const SMOKERS: ReadonlySet<BuildingId> = new Set(['kiln', 'arc_furnace', 'ceramic_oven', 'forge_press', 'steam_boiler'] as BuildingId[]);
const PUFFS = 5, PUFF_LIFE = 3.2;
/** Their name over the base: shown from this zoom out, its height on screen (px). */
const NAME_ZOOM = 1.05, NAME_PX = 36;
/** Their drones: at a minute's turn, one base in this many (each a draw from its hub and the minute) sends a container up. */
const CARGO_ONE_IN = 5;
/** Bases laid out ahead in idle time: those within this many tiles past the laying ring; a try is started only with this much idle time left (ms). */
const AHEAD = 2 * KEEP, IDLE_MS = 8;
/** Parcels of that ring read per piece of idle work (a parcel read the first time costs the sim ~10 µs). */
const AHEAD_SLICE = 256;
/** A sheet that fills past its cap again within this long of being renewed holds what the view needs: its cap doubles (ms). */
const RENEW_MS = 60_000;

/** What the view needs from the shell (render reads no i18n: the names come in the player's language). */
export interface NeighboursDeps {
  buildings: BuildingsView;
  lights: LightsView;
  wires: WiresView;
  cargo: CargoView;
  atlas: Atlas;
  layers: { decals: Container; objects: Container; plan: Container; items: Container; status: Container; fx: Container };
  /** The band over a base: its name and its trade's word, in the player's language ('' while the market does not know its colony; app: ui/land-facts.ts `neighbourBanner`). */
  name: (h: Holding) => string;
  /** The screen's density (the renderer's resolution): the look goes by zoom × density (D162). */
  density: () => number;
  /** A test of the texture sources on the GPU now (D162: the claim's frames there are shared, not copied). */
  onGpu: () => (s: TextureSource) => boolean;
}

/**
 * A base as laid: what its art is laid from (its ghost entities, lines, tint, flag, dress), its art's
 * look and sheet, its dress sprites, its box (tiles), its ribbons and smokers for the per-frame work,
 * its pad, its name band (and the far sheet it was baked on), when it left the view's ring.
 */
interface Laid {
  h: Holding;
  hub: number;
  box: Box;
  ents: Ent[];
  lines: Int32Array[];
  tint: number;
  flag: { x: number; y: number; emblem: Emblem } | null;
  layout: NLayout;
  top: (typeof NEIGHBOUR_CORE_TOP)[keyof typeof NEIGHBOUR_CORE_TOP];
  look: Look;
  gen: number;
  sprites: Sprite[];
  shown: boolean;
  leftAt: number;
  ribbons: Array<{ tiles: Int32Array; items: readonly number[]; len: number; phase: number }>;
  smokers: Array<{ x: number; y: number; z: number; phase: number }>;
  pad: { x: number; y: number; w: number; h: number; rot: Ent['rot'] } | null;
  name: Sprite | null;
  nameGen: number;
  nameAt: readonly [number, number];
  nameText: string;
  colours: DressColours;
}

/** A base to lay (`relay`: laid already, its art again in the look of the moment), or to light (`lights`). */
interface Pending { h: Holding; relay: boolean; lights: (() => void) | null }

/** The browser's idle time (a timer where there is none: Safari). */
type IdleDeadline = { timeRemaining(): number; didTimeout: boolean };
const onIdle = (cb: (d: IdleDeadline) => void): number => (typeof requestIdleCallback === 'function'
  ? requestIdleCallback(cb, { timeout: 1000 })
  : window.setTimeout(() => { const t0 = performance.now(); cb({ timeRemaining: () => Math.max(0, 12 - (performance.now() - t0)), didTimeout: false }); }, 50));
const offIdle = (id: number): void => { if (typeof cancelIdleCallback === 'function') cancelIdleCallback(id); else window.clearTimeout(id); };

/** A soft grey puff, 64 px, white-tinted per use. */
function drawPuff(ctx: CanvasRenderingContext2D): void {
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 30);
  g.addColorStop(0, 'rgba(255,255,255,0.85)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
}

export class NeighboursView {
  private sim: Sim | null = null;
  private epochs = '';
  private sig = '';
  private readonly laid = new Map<number, Laid>();
  /** Their textures: the far and the detail sheets (D162). */
  readonly art: NeighbourArt;
  /** The look the zoom wants now (D162, with its hysteresis); when a base last wore detail (ms). */
  private look: Look | null = null;
  private detailAt = 0;
  /** Per-frame sprites: the goods (items layer), the smoke (fx layer). */
  private readonly goods = new Container({ label: 'neighbours:goods' });
  private readonly smoke = new Container({ label: 'neighbours:smoke' });
  private readonly names = new Container({ label: 'neighbours:names' });
  private nGoods = 0;
  private nSmoke = 0;
  private puff: DynFrame | null = null;
  private puffGen = -1;
  private lastEpoch = -1;
  /** The bases still to lay, nearest the view's middle first; a base drawn but not yet lit at the front (`lights`). */
  private pending: Pending[] = [];
  /**
   * The bases round the view not drawn yet (nearest first): laid out, then what their kinds need the
   * first time baked ahead (`nextIdle`), in idle time; the kinds and flags done; the idle callback
   * asked for; nothing left to do until the next replan.
   */
  private ahead: Holding[] = [];
  /** The ring round the view whose parcels are read for `ahead` (a slice at a time: a parcel read the first time is drawn by the sim), how far along, what was found. */
  private aheadRect: Box | null = null;
  private aheadAt = 0;
  private readonly aheadFound = new Map<number, Holding>();
  private aheadMid: readonly [number, number] = [0, 0];
  private readonly warmed = new Set<string>();
  private idle = 0;
  private idleDone = false;
  /** Each sheet's cap (pages) before it is renewed, and when it last was (ms). */
  private readonly cap: Record<Look, number> = { far: SHEET_CAP, detail: SHEET_CAP };
  private readonly renewedAt: Record<Look, number> = { far: -Infinity, detail: -Infinity };

  constructor(private readonly d: NeighboursDeps) {
    d.layers.items.addChild(this.goods);
    d.layers.fx.addChild(this.smoke);
    d.layers.status.addChild(this.names);
    this.art = new NeighbourArt(d.onGpu);
  }

  /**
   * The goods of a base in the view now (smoke, shots): how many, how many on a tile that is not one
   * of its lines' (should be none), how many on a stretch of line the buildings view does not show
   * though it is in the view (none: a stretch in view is never culled).
   */
  audit(hub: number, seconds = this.lastSeconds): { goods: number; offTile: number; undrawn: number } {
    const L = this.laid.get(hub);
    let goods = 0, offTile = 0, undrawn = 0;
    if (!L) return { goods, offTile, undrawn };
    for (const r of L.ribbons) {
      const tiles = new Set<number>();
      for (let i = 0; i < r.tiles.length; i += 3) tiles.add(r.tiles[i + 1]! * WORLD + r.tiles[i]!);
      const n = goodsOn(r.len, ITEM_GAP);
      for (let k = 0; k < n; k++) {
        const g = goodAt(r.tiles, r.phase, k, n, seconds, ITEM_SPEED)!;
        const [vx0, vy0, vx1, vy1] = this.lastView;
        if (g.x < vx0 || g.x > vx1 || g.y < vy0 || g.y > vy1) continue;
        const t = Math.floor(g.y) * WORLD + Math.floor(g.x);
        goods++;
        if (!tiles.has(t)) offTile++;
        else if (!this.d.buildings.foreignRibbonShown(hub, t)) undrawn++;
      }
    }
    return { goods, offTile, undrawn };
  }
  private lastSeconds = 0;
  private lastView: readonly [number, number, number, number] = [0, 0, 0, 0];

  /** Bases laid, drones sent off their pads (smoke, shots). */
  get count(): number { return this.laid.size; }
  launches = 0;

  /**
   * Debug (before / after shots and measures, D162): every base drawn as before its looks — from the
   * claim's atlas pages themselves, the dress at full size, never dropped. Set before the bases are
   * laid, or they are all laid again.
   */
  get plain(): boolean { return this.isPlain; }
  set plain(on: boolean) { if (on !== this.isPlain) { this.isPlain = on; this.epochs = ''; } }
  private isPlain = false;

  /** Bases laid by look, their sheets' pages and bytes (D162: perf, smoke, shots). */
  stats(): { far: number; detail: number; farPages: number; detailPages: number; MB: number; look: Look | null } {
    let far = 0, detail = 0;
    for (const L of this.laid.values()) if (L.look === 'far') far++; else detail++;
    return { far, detail, farPages: this.art.pages('far'), detailPages: this.art.pages('detail'), MB: Math.round(this.art.bytes / 1048576 * 10) / 10, look: this.look };
  }

  /**
   * Per frame: `view` the tile rect, P the projection, t its plan-ness, the camera's zoom, the game's
   * seconds and the world's minute.
   */
  update(sim: Sim, view: readonly [number, number, number, number], P: Lin, t: number, zoom: number, seconds: number, epoch: number): void {
    const ep = `${this.d.buildings.foreignEpoch}:${this.d.lights.foreignEpoch}`;
    if (sim !== this.sim || ep !== this.epochs) this.reset(sim, ep);
    const look = this.isPlain ? 'detail' : zoomLook(this.look, zoom * this.d.density());
    if (look !== this.look) { this.look = look; this.sig = ''; }
    const near: Box = [Math.max(0, Math.floor(view[0]) - MARGIN), Math.max(0, Math.floor(view[1]) - MARGIN), Math.min(WORLD, Math.ceil(view[2]) + MARGIN), Math.min(WORLD, Math.ceil(view[3]) + MARGIN)];
    const sig = `${Math.floor(near[0] / PARCEL)},${Math.floor(near[1] / PARCEL)},${Math.floor(near[2] / PARCEL)},${Math.floor(near[3] / PARCEL)}`;
    if (sig !== this.sig) { this.sig = sig; this.replan(sim, view, near); }
    this.age(performance.now());
    this.layNext(sim);
    this.prefetch(sim);
    this.lastSeconds = seconds;
    this.lastView = view;
    this.animate(view, P, t, zoom, seconds, epoch);
  }

  /** Bases still to lay (smoke, shots). */
  get queued(): number { return this.pending.length; }

  /**
   * The view's range of parcels or the look changed: the bases near it to lay (or lay again in the
   * look of the moment, or on a renewed sheet), nearest its middle first; the stale ones out of it
   * dropped; the laid ones shown or hidden; when each left the wider ring; those to lay out ahead.
   */
  private replan(sim: Sim, view: readonly [number, number, number, number], near: Box): void {
    const look = this.look!;
    const mx = (view[0] + view[2]) / 2, my = (view[1] + view[3]) / 2;
    const dist = (h: Holding): number => { const [px, py] = parcelCentre(h.hub); return (px - mx) ** 2 + (py - my) ** 2; };
    const inNear = sim.neighbours.inRect(near[0], near[1], near[2], near[3]);
    const plan = planBases([...this.laid.values()], inNear.map((h) => ({ hub: h.hub, d: dist(h) })), look, { far: this.art.gen('far'), detail: this.art.gen('detail') });
    for (const hub of plan.drop) this.dropBase(this.laid.get(hub)!);
    const byHub = new Map(inNear.map((h) => [h.hub, h]));
    // A base drawn but not yet lit keeps its place at the front: its lights are laid next.
    this.pending = [...this.pending.filter((q) => q.lights), ...plan.lay.map((hub) => ({ h: byHub.get(hub)!, relay: this.laid.has(hub), lights: null }))];
    const keep = grow(view, KEEP), now = performance.now();
    for (const L of this.laid.values()) {
      const on = overlaps(L.box, near);
      if (on !== L.shown) { L.shown = on; for (const s of L.sprites) s.visible = on; }
      L.leftAt = overlaps(L.box, keep) ? 0 : L.leftAt || now;
    }
    const wide = grow(near, AHEAD);
    this.aheadRect = [Math.max(0, wide[0]), Math.max(0, wide[1]), Math.min(WORLD - 1, wide[2]), Math.min(WORLD - 1, wide[3])];
    this.aheadAt = 0;
    this.aheadFound.clear();
    this.aheadMid = [mx, my];
    this.ahead = [];
    this.idleDone = false;
  }

  /**
   * Per frame, the bases' keeping (D162): one out of the view's ring for `DROP_MS` dropped; the
   * detail sheet let go once no base has worn detail for `DETAIL_HOLD_MS`; a sheet grown past
   * `SHEET_CAP` pages renewed (its bases laid again on a fresh one: `replan`); the sheets no base
   * draws from any more destroyed.
   */
  private age(now: number): void {
    let detail = false;
    for (const L of this.laid.values()) {
      if (L.leftAt && now - L.leftAt > DROP_MS && !this.isPlain) { this.dropBase(L); this.sig = ''; continue; }
      if (L.look === 'detail') detail = true;
    }
    if (detail || (this.look === 'detail' && this.pending.some((q) => !q.lights))) this.detailAt = now;
    else if (now - this.detailAt > DETAIL_HOLD_MS && this.art.pages('detail')) this.art.renew('detail');
    for (const look of ['far', 'detail'] as const) {
      if (this.art.pages(look) <= this.cap[look] || this.isPlain) continue;
      // Grown again soon after a renewal: what is near needs that much (the cap doubles), else renewed.
      if (now - this.renewedAt[look] < RENEW_MS) this.cap[look] *= 2;
      else { this.art.renew(look); this.sig = ''; }
      this.renewedAt[look] = now;
    }
    // What is drawn from a sheet: the bases' art (laid again on a renewed one a base a frame). Their name
    // bands, the puffs and the goods are textured again by `animate` before the frame is drawn.
    const inUse = new Set<number>();
    for (const L of this.laid.values()) inUse.add(L.gen);
    this.art.sweep(inUse);
  }

  /**
   * One step of laying a frame: the next base laid out by the sim (a try at a time, D162); then drawn
   * (its buildings, wires and dress; or its art again, in the look of the moment); then lit.
   */
  private layNext(sim: Sim): void {
    const next = this.pending[0];
    if (!next) return;
    if (next.lights) { this.pending.shift(); if (this.laid.has(next.h.hub)) next.lights(); return; }
    if (!sim.neighbours.laidOut(next.h) && !sim.neighbours.layoutStep(next.h)) return;
    const L = this.laid.get(next.h.hub);
    if (next.relay && L) {
      this.pending.shift();
      this.dropArt(L, true);
      this.layArt(L, this.look!);
    } else if (!L) {
      next.lights = this.lay(sim, next.h);
      if (!next.lights) this.pending.shift();
    } else this.pending.shift();
    this.art.flush();
  }

  /** The bases round the view prepared ahead in the browser's idle time (`nextIdle`: the next to lay first), a piece at a time. */
  private prefetch(sim: Sim): void {
    if (this.idle || this.idleDone) return;
    if (!this.nextIdle(sim)) { this.idleDone = true; return; }
    this.idle = onIdle((dl) => {
      this.idle = 0;
      if (this.sim !== sim) return;
      for (let job = this.nextIdle(sim); job && (dl.timeRemaining() >= IDLE_MS || dl.didTimeout); job = this.nextIdle(sim)) {
        job();
        if (dl.didTimeout) break; // the timeout's own call: one piece, the frames come first
      }
    });
  }

  /**
   * The next piece of idle work (D162), for the bases to lay first then those round the view: a try
   * towards a layout (sim/world/neighbours.ts `layoutStep`, ~10 ms at most); else, for one laid out but
   * not drawn, a kind of its buildings baked ahead (its cast shadow, its lamps' places), or its flag.
   */
  private nextIdle(sim: Sim): (() => void) | null {
    for (const q of this.pending) if (!q.lights && !sim.neighbours.laidOut(q.h)) return () => { sim.neighbours.layoutStep(q.h); };
    // The ring round the view read a slice of parcels at a time, its bases then taken nearest first.
    const R = this.aheadRect;
    if (R) {
      const a = parcelAt(R[0], R[1]), b = parcelAt(R[2], R[3]);
      const c0 = a % PARCEL_COLS, r0 = Math.floor(a / PARCEL_COLS), c1 = b % PARCEL_COLS, r1 = Math.floor(b / PARCEL_COLS), cols = c1 - c0 + 1, n = cols * (r1 - r0 + 1);
      if (this.aheadAt < n) return () => {
        for (const end = Math.min(n, this.aheadAt + AHEAD_SLICE); this.aheadAt < end; this.aheadAt++) {
          const h = sim.neighbours.holdingOf((r0 + Math.floor(this.aheadAt / cols)) * PARCEL_COLS + c0 + (this.aheadAt % cols));
          if (h) this.aheadFound.set(h.hub, h);
        }
        if (this.aheadAt < n) return;
        const [mx, my] = this.aheadMid;
        const dist = (h: Holding): number => { const [px, py] = parcelCentre(h.hub); return (px - mx) ** 2 + (py - my) ** 2; };
        this.ahead = [...this.aheadFound.values()].filter((h) => !this.laid.has(h.hub)).sort((p, q) => dist(p) - dist(q) || p.hub - q.hub);
      };
    }
    const queue = [...this.pending.filter((q) => !q.lights).map((q) => q.h), ...this.ahead];
    for (const h of queue) if (!sim.neighbours.laidOut(h)) return () => { sim.neighbours.layoutStep(h); };
    for (const h of queue) {
      if (this.laid.has(h.hub)) continue;
      const L = sim.neighbours.layout(h);
      for (let i = 0; i < L.structs.length && i < 38; i++) {
        const s = L.structs[i]!, k = `${s.def}:${s.rot}`;
        if (i === L.core || this.warmed.has(k)) continue;
        return () => { this.warmed.add(k); this.d.buildings.warmForeign(s.def, s.rot); this.d.lights.warmForeign(s.def, s.rot); };
      }
      if (!L.flag) continue;
      const e = colonyEmblem(sim.worldSeed, h.colony), k = `f:${emblemKey(e)}`;
      if (!this.warmed.has(k)) return () => { this.warmed.add(k); flagFrames(e); };
    }
    return null;
  }

  /** Another colony, or the views dropped their records: everything laid afresh, every sheet let go. */
  private reset(sim: Sim, ep: string): void {
    this.sim = sim;
    this.epochs = ep;
    this.sig = '';
    this.pending = [];
    this.ahead = [];
    if (this.idle) { offIdle(this.idle); this.idle = 0; }
    this.idleDone = false;
    for (const L of this.laid.values()) this.dropBase(L);
    this.laid.clear();
    this.d.wires.clearForeign();
    this.art.destroy();
    this.puff = null;
    this.puffGen = -1;
  }

  // ── laying a base ────────────────────────────────────────────────────────────

  /** Lay a base: its wires now, its art (buildings, ribbons, flag, dress) in the look of the moment; its lights by the step returned (null: nothing to lay). */
  private lay(sim: Sim, h: Holding): (() => void) | null {
    if (h.parcels.every((p) => sim.land.neighbour(p) < 0)) return null;
    const L = sim.neighbours.layout(h);
    const heart = L.structs[L.core >= 0 ? L.core : 0];
    if (!heart) return null;
    const emblem = colonyEmblem(sim.worldSeed, h.colony);
    const colours = coloursOf(emblem);
    const top = NEIGHBOUR_CORE_TOP[h.profile];
    const base = FOREIGN_ID0 + h.hub * 64;
    const all: Ent[] = L.structs.slice(0, 38).map((s, i) => ({ id: base + i, def: s.def, x: s.x, y: s.y, rot: s.rot, cfg: 0, builtAt: 0, portItems: [] }));
    // Its Core is its own (drawn below): the def the sim laid it as is never drawn there.
    const ents = all.filter((_, i) => i !== L.core);
    // Where its wires hang on its Core and its lanterns glow: its crown, over its middle.
    const coreAt = L.core >= 0 ? { x: all[L.core]!.x + CORE.n / 2, y: all[L.core]!.y + CORE.n / 2, z: coreWireZ(top) } : null;
    // The strong wash: their colour, sun-faded, multiplied into the claim's art.
    const tint = num(mix('#ffffff', mix(colours.field, C.peachD, 0.45), WASH));
    // Its lines: the very list the goods ride (`Laid.ribbons`), drawn stretch by stretch.
    const lines = L.ribbons.slice(0, MAX_LINES);
    // Its lanterns at night: its tents' doors, its banner poles' tips.
    const lanterns = [
      ...(coreAt ? [{ x: coreAt.x + 0.72, y: coreAt.y + 0.72, z: 0.75 }, { ...coreAt }] : []),
      ...L.tents.map(([x, y]) => ({ x: x + NEIGHBOUR_TENT * 0.85, y: y + NEIGHBOUR_TENT * 0.85, z: 0.9 })),
      ...L.banners.map(([x, y]) => ({ x: x + 0.5, y: y + 0.5, z: 5.6 })),
    ];
    const lights = (): void => this.d.lights.layForeign(h.hub, ents, lanterns);
    // Its grid's wires, from its Core's crown (its own terminal) or terminal to terminal, hidden where a cliff in front covers them.
    this.d.wires.layForeign(h.hub, L.wires.filter(([a, b]) => a < all.length && b < all.length).map(([a, b]) => {
      if (coreAt && (a === L.core || b === L.core)) { const o = all[a === L.core ? b : a]!; return [coreAt, wireAnchor(o, coreAt.x, coreAt.y)] as const; }
      return wireEnds(all[a]!, all[b]!);
    }), sim.grid);
    // The box it covers, its moving goods and smokers, its pad, its name's place (over the hub, a little north).
    let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
    for (const p of h.parcels) { const [cx, cy] = parcelCentre(p); bx0 = Math.min(bx0, cx - 12); by0 = Math.min(by0, cy - 12); bx1 = Math.max(bx1, cx + 12); by1 = Math.max(by1, cy + 12); }
    const smokers: Laid['smokers'] = [];
    if (coreAt && top === 'chimney') smokers.push({ x: coreAt.x + 0.35, y: coreAt.y - 0.35, z: 3.8, phase: (hash32(h.hub, 99, 0x5e0c) % 1000) / 1000 });
    L.structs.forEach((s, i) => {
      const id = BUILDING_IDS[s.def]! as BuildingId;
      if (i === L.core || !SMOKERS.has(id)) return;
      const [w, hh] = footprint(s.def, s.rot);
      smokers.push({ x: s.x + w * 0.62, y: s.y + hh * 0.38, z: isoHead(id) + 0.4, phase: (hash32(h.hub, i, 0x5e0c) % 1000) / 1000 });
    });
    const p0 = L.structs.find((s) => BUILDING_KIND[s.def] === 'trade'), [pw, ph] = p0 ? footprint(p0.def, p0.rot) : [0, 0];
    const [hx, hy] = parcelCentre(h.hub);
    const laid: Laid = {
      h, hub: h.hub, box: [bx0, by0, bx1, by1], ents, lines: lines.map((r) => r.tiles), tint, flag: L.flag ? { x: L.flag[0], y: L.flag[1], emblem } : null,
      layout: L, top, look: this.look!, gen: 0, sprites: [], shown: true, leftAt: 0, colours,
      ribbons: lines.map((r, j) => ({ tiles: r.tiles, items: r.items.length ? r.items : [r.item], len: r.tiles.length / 3, phase: (hash32(h.hub, j, 0x90d5) % 1000) / 1000 })),
      smokers, pad: p0 ? { x: p0.x, y: p0.y, w: pw, h: ph, rot: p0.rot } : null,
      name: null, nameGen: -1, nameAt: [hx + 0.5, hy - 2.5], nameText: '',
    };
    this.laid.set(h.hub, laid);
    this.layArt(laid, this.look!);
    return lights;
  }

  /**
   * A base's art in a look (D162): its buildings, ribbons and flag through the buildings view with the
   * look's textures, its dress baked on the look's sheet — its Core, the tarps under its buildings, its
   * covered depots, banner poles and cairns.
   */
  private layArt(B: Laid, look: Look): void {
    const L = B.layout, colours = B.colours, top = B.top;
    B.look = look;
    B.gen = this.art.gen(look);
    this.d.buildings.layForeign(B.hub, B.ents, B.lines, B.tint, B.flag, this.isPlain ? undefined : this.art.art(look));
    const ck = `${colours.field}:${colours.mark}`;
    const k = look === 'far' ? FAR_K : 1;
    const sprites = B.sprites;
    const bake = (key: string, w: number, h: number, ox: number, oy: number, draw: (ctx: CanvasRenderingContext2D) => void): DynFrame => this.art.bake(look, key, w, h, ox, oy, draw);
    // Its Core: iso among the volumes, plan flat.
    if (L.core >= 0) {
      const s = L.structs[L.core]!, f = coreFrame();
      sprites.push(this.isoSprite(bake(`core:${top}:${ck}`, f.w, f.h, f.ox, f.oy, (ctx) => drawCore(ctx, top, colours, f)), s.x, s.y, buildingZ(s.x, s.y, CORE.n, CORE.n), k));
      sprites.push(this.flatSprite(bake(`coreP:${top}:${ck}`, CORE.n * PLAN_PX, CORE.n * PLAN_PX, 0, 0, (ctx) => drawCorePlan(ctx, top, colours)), s.x, s.y, this.d.layers.plan, k));
    }
    // The tarps under its buildings (not under the masts), the widest patch of its colours.
    for (const s of L.structs) {
      if (BUILDING_IDS[s.def] === NEIGHBOUR_MAST) continue;
      const [w, hh] = footprint(s.def, s.rot);
      const fr = bake(`tarp:${w}x${hh}:${ck}`, (w + 2 * HEM) * PLAN_PX, (hh + 2 * HEM) * PLAN_PX, 0, 0, (ctx) => drawTarp(ctx, w, hh, HEM, colours, w * 7 + hh * 3));
      sprites.push(this.flatSprite(fr, s.x - HEM, s.y - HEM, this.d.layers.decals, k));
    }
    // Its covered depots, banner poles and cairns: iso among the volumes, plan flat.
    for (const [x, y] of L.tents) {
      const f = tentFrame(NEIGHBOUR_TENT);
      sprites.push(this.isoSprite(bake(`tent:${ck}`, f.w, f.h, f.ox, f.oy, (ctx) => drawTent(ctx, NEIGHBOUR_TENT, colours, f)), x, y, buildingZ(x, y, NEIGHBOUR_TENT, NEIGHBOUR_TENT), k));
      sprites.push(this.flatSprite(bake(`tentP:${ck}`, NEIGHBOUR_TENT * PLAN_PX, NEIGHBOUR_TENT * PLAN_PX, 0, 0, (ctx) => drawTentPlan(ctx, NEIGHBOUR_TENT, colours)), x, y, this.d.layers.plan, k));
    }
    for (const [x, y] of L.banners) {
      const f = bannerFrame();
      sprites.push(this.isoSprite(bake(`banner:${ck}`, f.w, f.h, f.ox, f.oy, (ctx) => drawBanner(ctx, colours, f)), x, y, buildingZ(x, y, 1, 1) + 0.02, k));
      sprites.push(this.flatSprite(bake(`bannerP:${ck}`, PLAN_PX, PLAN_PX, 0, 0, (ctx) => drawBannerPlan(ctx, colours)), x, y, this.d.layers.plan, k));
    }
    for (const [x, y] of L.cairns) {
      const f = cairnFrame();
      sprites.push(this.isoSprite(bake(`cairn:${ck}`, f.w, f.h, f.ox, f.oy, (ctx) => drawCairn(ctx, colours, f)), x, y, buildingZ(x, y, 1, 1), k));
      sprites.push(this.flatSprite(bake(`cairnP:${ck}`, PLAN_PX, PLAN_PX, 0, 0, (ctx) => drawCairnPlan(ctx, colours)), x, y, this.d.layers.plan, k));
    }
    if (!B.shown) for (const s of sprites) s.visible = false;
  }

  /** A base's art taken off (its look to change, or the base dropped): its buildings view sprites and its dress. `relay`: laid again at once. */
  private dropArt(B: Laid, relay: boolean): void {
    this.d.buildings.dropForeign(B.hub, relay);
    for (const s of B.sprites) s.destroy();
    B.sprites.length = 0;
  }

  /** A base dropped (D162): its art, wires, lights and name band gone, its lights no longer to lay; laid afresh when it comes near again. */
  private dropBase(B: Laid): void {
    if (this.pending.some((q) => q.h.hub === B.hub)) this.pending = this.pending.filter((q) => q.h.hub !== B.hub);
    this.dropArt(B, false);
    this.d.lights.dropForeign(B.hub);
    this.d.wires.dropForeign(B.hub);
    B.name?.destroy();
    B.name = null;
    this.laid.delete(B.hub);
  }

  /** An iso piece among the volumes: its footprint's ground corner at tile (x, y), depth key z; `k` its frame's scale down (far: FAR_K). */
  private isoSprite(f: DynFrame, x: number, y: number, z: number, k: number): Sprite {
    const s = new Sprite(f.tex), sc = k / DRESS_K;
    const [wx, wy] = tileToIso(x, y, 0);
    s.scale.set(sc);
    s.position.set(wx - f.ox * sc, wy - f.oy * sc);
    s.zIndex = z;
    this.d.layers.objects.addChild(s);
    return s;
  }

  /** A flat piece in tile units (the ground plane, or the plan sprites'), its top-left at tile (x, y); `k` its frame's scale down. */
  private flatSprite(f: DynFrame, x: number, y: number, layer: Container, k: number): Sprite {
    const s = new Sprite(f.tex);
    s.scale.set(k / PLAN_PX);
    s.position.set(x, y);
    s.zIndex = 0;
    layer.addChild(s);
    return s;
  }

  // ── per frame ──────────────────────────────────────────────────────────────

  private animate(view: readonly [number, number, number, number], P: Lin, t: number, zoom: number, seconds: number, epoch: number): void {
    const [vx0, vy0, vx1, vy1] = view;
    const iso = 1 - t;
    const inView = (L: Laid): boolean => L.shown && L.box[2] >= vx0 - 4 && L.box[0] <= vx1 + 4 && L.box[3] >= vy0 - 4 && L.box[1] <= vy1 + 4;
    let ng = 0, ns = 0;
    const showGoods = zoom >= 0.28;
    const ipx = itemPx(t, zoom), iscale = ipx / IB_PX;
    const newMinute = epoch !== this.lastEpoch;
    this.lastEpoch = epoch;
    for (const L of this.laid.values()) {
      const on = inView(L);
      // Their name, from mid zoom out, over the base (constant on screen); in iso only (the plan
      // views have their own: the Terrain view labels the base under its emblem).
      this.placeName(L, on && zoom < NAME_ZOOM && t < 0.5, P, iso, zoom);
      if (!on) continue;
      // The goods riding its ribbons, a loop on the game's clock (neighbour-goods.ts `goodAt`): each
      // between two consecutive tiles of its line, and drawn only where that line is (its stretch on
      // screen, `foreignRibbonShown`) — never on bare sand. A line carrying several goods (the store's
      // to the pad, the pad's to its depot) carries them in turn.
      if (showGoods) for (const r of L.ribbons) {
        const n = goodsOn(r.len, ITEM_GAP);
        if (!n) continue;
        for (let k = 0; k < n; k++) {
          const tex = this.itemTex(r.items[k % r.items.length]!, L.look);
          if (!tex) continue;
          const g = goodAt(r.tiles, r.phase, k, n, seconds, ITEM_SPEED)!;
          const { x, y } = g, t = r.tiles[g.tile * 3 + 1]! * WORLD + r.tiles[g.tile * 3]!;
          if (x < vx0 - 1 || x > vx1 + 1 || y < vy0 - 1 || y > vy1 + 1) continue;
          if (!this.d.buildings.foreignRibbonShown(L.hub, t)) continue;
          const sp = this.goodsSprite(ng++, tex);
          sp.position.set(P.a * x + P.c * y, P.b * x + P.d * y - 3 * iso);
          sp.scale.set(L.look === 'far' ? iscale * FAR_K : iscale);
        }
      }
      // Smoke from its chimneys: puffs rising and drifting downwind, fading.
      for (const sm of L.smokers) {
        for (let k = 0; k < PUFFS; k++) {
          const age = ((seconds / PUFF_LIFE + sm.phase + k / PUFFS) % 1);
          const gx = sm.x + age * 1.1, gy = sm.y - age * 0.5;
          const sp = this.smokeSprite(ns++);
          sp.position.set(P.a * gx + P.c * gy, P.b * gx + P.d * gy - (sm.z + age * 2.4) * LH * iso);
          sp.scale.set((0.34 + age * 0.7) * (0.6 + 0.4 * iso));
          sp.alpha = (1 - age) * 0.75 * (0.4 + 0.6 * iso);
          sp.tint = num(mix(C.paper, C.inkSoft, 0.35 - age * 0.3));
        }
      }
      // A drone hauls a container off its pad, now and then, at a minute's turn.
      if (newMinute && L.pad && hash32(L.hub, epoch, 0xca60) % CARGO_ONE_IN === 0) { this.d.cargo.launch(L.pad, 'sell'); this.launches++; }
    }
    for (let i = ng; i < this.nGoods; i++) (this.goods.children[i] as Sprite).visible = false;
    for (let i = ns; i < this.nSmoke; i++) (this.smoke.children[i] as Sprite).visible = false;
    this.nGoods = Math.max(ng, this.nGoods);
    this.nSmoke = Math.max(ns, this.nSmoke);
  }

  /** An item's ribbon glyph as a base in that look draws it (D162: far, its half-size copy, drawn at FAR_K × the scale). */
  private itemTex(item: number, look: Look): Texture | undefined {
    const t = item >= 0 ? this.d.atlas.textures.get(ibKey(ITEM_IDS[item]!)) : undefined;
    return t && !this.isPlain ? this.art.tex(look, t) : t;
  }

  private goodsSprite(i: number, tex: Texture): Sprite {
    let s = this.goods.children[i] as Sprite | undefined;
    if (!s) { s = new Sprite(tex); s.anchor.set(0.5); this.goods.addChild(s); }
    if (s.texture !== tex) s.texture = tex;
    s.visible = true;
    return s;
  }

  /** A puff of smoke (pooled); the puff baked on the far sheet, again when that sheet was renewed. */
  private smokeSprite(i: number): Sprite {
    if (!this.puff || this.puffGen !== this.art.gen('far')) {
      this.puff = this.art.label('puff', 64, 64, 32, 32, drawPuff);
      this.puffGen = this.art.gen('far');
      this.art.flush();
    }
    let s = this.smoke.children[i] as Sprite | undefined;
    if (!s) { s = new Sprite(this.puff.tex); s.anchor.set(0.5); this.smoke.addChild(s); }
    if (s.texture !== this.puff.tex) s.texture = this.puff.tex;
    s.visible = true;
    return s;
  }

  /** The name band over a base: baked when its name is known (or changes language, or the far sheet it was on was renewed), placed over its hub, constant on screen. */
  private placeName(L: Laid, show: boolean, P: Lin, iso: number, zoom: number): void {
    if (!show) { if (L.name) L.name.visible = false; return; }
    const hub = this.sim?.neighbours.holdingOf(L.hub);
    const text = hub ? this.d.name(hub) : '';
    if (!text) { if (L.name) L.name.visible = false; return; }
    if (text !== L.nameText || !L.name || L.nameGen !== this.art.gen('far')) {
      L.nameText = text;
      L.nameGen = this.art.gen('far');
      const f = nameFrame(text);
      const fr = this.art.label(`name:${text}:${L.colours.field}`, f.w, f.h, f.ox, f.oy, (ctx) => drawName(ctx, text, L.colours, f));
      this.art.flush();
      if (!L.name) { L.name = new Sprite(fr.tex); this.names.addChild(L.name); }
      L.name.texture = fr.tex;
      L.name.anchor.set(fr.ox / fr.w, fr.oy / fr.h);
    }
    const [x, y] = L.nameAt;
    const s = L.name;
    s.visible = true;
    s.position.set(P.a * x + P.c * y, P.b * x + P.d * y - 7 * LH * iso);
    const k = NAME_PX / (58 * Math.max(0.05, zoom));
    s.scale.set(k);
    s.alpha = Math.min(1, (NAME_ZOOM - zoom) / 0.2);
  }
}

/** A base's colours from its emblem (art/emblem.ts' palette). */
function coloursOf(e: Emblem): DressColours {
  const field = emblemColor(e.field), mark = emblemColor(e.ink);
  return { field, mark: mark === field ? C.paper : mark };
}
