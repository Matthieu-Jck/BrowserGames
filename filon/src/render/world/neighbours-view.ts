// neighbours-view.ts — the neighbouring bases on the land (D110; owner, 2026-10-17: « S'il y a un
// endroit possédé par un PNJ, il faut qu'il y ait vraiment une base », « leurs bâtiments ressemblent
// trop aux miens », « il n'y a rien qui marche, même pas de câble électrique »). The sim lays each
// base out from the seeds the first time something asks (sim/world/neighbours.ts); this view asks
// for those near the camera once they are surveyed (their lift pad out of the fog), and draws each
// as someone else's working base:
// - its buildings, ribbons and flag through the buildings view (`layForeign`: the claim's art,
//   washed strongly in the colony's weathered colours, never switched off, parts always turning),
//   its lamps through the lights view, its grid's wires through the wires view (hung like the
//   claim's, always lit, never joined to the claim's grids);
// - what no base of the claim has (art/recipes/neighbour-dress.ts, baked once per colours): the
//   patched tarp each of its buildings stands on (the `decals` plane: both views), covered depots
//   (dome tents), banner poles by its pad, cairns along its edge (iso among the volumes, plan flat);
// - per frame, for the bases in view only: the goods riding its ribbons (a loop from the world's
//   clock: no sim, nothing saved), smoke from its furnaces' chimneys, its name on a cloth band over
//   it from mid zoom out (constant on screen), and now and then, at a minute's turn, a CrierBelt
//   drone hauling a container off its pad (the cargo view's).
// A base laid stays laid until another colony comes into play (the views' `foreignEpoch`); its
// sprites are hidden while it is out of range. Checked for new bases when the view's range of
// parcels changes or the fog lifts, not every frame.
import { Container, Sprite, type Texture } from 'pixi.js';
import { BUILDING_IDS, BUILDING_KIND, ITEM_IDS } from '@/content/registry';
import { colonyEmblem, type Emblem } from '@/content/emblem';
import { NEIGHBOUR_CORE_TOP, NEIGHBOUR_MAST, NEIGHBOUR_TENT } from '@/content/neighbours';
import type { BuildingId } from '@/content/buildings';
import { hash32 } from '@/core/hash';
import { WORLD } from '@/sim/constants';
import { footprint } from '@/sim/entities';
import type { Sim } from '@/sim/state';
import type { Ent } from '@/sim/types';
import { PARCEL, parcelCentre } from '@/sim/world/land';
import type { Holding } from '@/sim/world/neighbours';
import { ibKey, IB_PX, type Atlas } from '../art/atlas';
import { DynAtlas, type DynFrame } from '../art/dyn-atlas';
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
import { buildingZ } from './stand';
import type { WiresView } from './wires-view';
import { wireAnchor, wireEnds } from './wire-geom';

/** The ghost entities' ids: out of the claim's range, 64 a base (its hub parcel's), under the buildings view's ranks. */
export const FOREIGN_ID0 = 12_000_000;
/** How far past the view a base is laid (tiles): a parcel and a half, so it is there before it shows. */
const MARGIN = PARCEL + (PARCEL >> 1);
/** How strongly their buildings take their colours (‰ of the weathered colour multiplied in): unmistakably theirs. */
const WASH = 0.62;
/** A tarp's hem round a footprint (tiles). */
const HEM = 0.35;
/** The goods on their ribbons: tiles between two, tiles a second. */
const ITEM_GAP = 1.6, ITEM_SPEED = 1.1;
/** The buildings that smoke (their furnaces' chimneys), and a plume's puffs. */
const SMOKERS: ReadonlySet<BuildingId> = new Set(['kiln', 'arc_furnace', 'brazier', 'ceramic_oven', 'forge_press', 'steam_boiler'] as BuildingId[]);
const PUFFS = 5, PUFF_LIFE = 3.2;
/** Their name over the base: shown from this zoom out, its height on screen (px). */
const NAME_ZOOM = 1.05, NAME_PX = 36;
/** Their drones: at a minute's turn, one base in this many (each a draw from its hub and the minute) sends a container up. */
const CARGO_ONE_IN = 5;

/** What the view needs from the shell (render reads no i18n: the names come in the player's language). */
export interface NeighboursDeps {
  buildings: BuildingsView;
  lights: LightsView;
  wires: WiresView;
  cargo: CargoView;
  atlas: Atlas;
  layers: { decals: Container; objects: Container; plan: Container; items: Container; status: Container; fx: Container };
  /** A colony's name in the player's language ('' while the market does not know it). */
  name: (colony: number) => string;
}

/** A base as laid: its sprites, its box (tiles), its ribbons and smokers for the per-frame work, its pad, its name band. */
interface Laid {
  hub: number;
  box: readonly [number, number, number, number];
  sprites: Sprite[];
  shown: boolean;
  ribbons: Array<{ tiles: Int32Array; item: number; len: number; phase: number }>;
  smokers: Array<{ x: number; y: number; z: number; phase: number }>;
  pad: { x: number; y: number; w: number; h: number; rot: Ent['rot'] } | null;
  name: Sprite | null;
  nameAt: readonly [number, number];
  nameText: string;
  colours: DressColours;
}

/** A soft grey puff, 64 px, white-tinted per use. */
function puffTexture(sheet: DynAtlas): DynFrame {
  return sheet.add('puff', 64, 64, 32, 32, (ctx) => {
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 30);
    g.addColorStop(0, 'rgba(255,255,255,0.85)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.45)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
  });
}

export class NeighboursView {
  private sim: Sim | null = null;
  private epochs = '';
  private sig = '';
  private readonly laid = new Map<number, Laid>();
  private readonly sheet = new DynAtlas();
  private readonly baked = new Map<string, DynFrame>();
  /** Per-frame sprites: the goods (items layer), the smoke (fx layer). */
  private readonly goods = new Container({ label: 'neighbours:goods' });
  private readonly smoke = new Container({ label: 'neighbours:smoke' });
  private readonly names = new Container({ label: 'neighbours:names' });
  private nGoods = 0;
  private nSmoke = 0;
  private puff: DynFrame | null = null;
  private lastEpoch = -1;

  constructor(private readonly d: NeighboursDeps) {
    d.layers.items.addChild(this.goods);
    d.layers.fx.addChild(this.smoke);
    d.layers.status.addChild(this.names);
  }

  /** Bases laid, drones sent off their pads (smoke, shots). */
  get count(): number { return this.laid.size; }
  launches = 0;

  /**
   * Per frame: `view` the tile rect, P the projection, t its plan-ness, the camera's zoom, the game's
   * seconds and the world's minute.
   */
  update(sim: Sim, view: readonly [number, number, number, number], P: Lin, t: number, zoom: number, seconds: number, epoch: number): void {
    const ep = `${this.d.buildings.foreignEpoch}:${this.d.lights.foreignEpoch}`;
    if (sim !== this.sim || ep !== this.epochs) this.reset(sim, ep);
    const x0 = Math.max(0, Math.floor(view[0]) - MARGIN), y0 = Math.max(0, Math.floor(view[1]) - MARGIN);
    const x1 = Math.min(WORLD, Math.ceil(view[2]) + MARGIN), y1 = Math.min(WORLD, Math.ceil(view[3]) + MARGIN);
    const sig = `${Math.floor(x0 / PARCEL)},${Math.floor(y0 / PARCEL)},${Math.floor(x1 / PARCEL)},${Math.floor(y1 / PARCEL)}:${sim.explored.length}`;
    if (sig !== this.sig) {
      this.sig = sig;
      for (const h of sim.neighbours.inRect(x0, y0, x1, y1)) if (!this.laid.has(h.hub)) this.lay(sim, h);
      for (const L of this.laid.values()) {
        const on = L.box[2] >= x0 && L.box[0] <= x1 && L.box[3] >= y0 && L.box[1] <= y1;
        if (on !== L.shown) { L.shown = on; for (const s of L.sprites) s.visible = on; }
      }
      this.sheet.flush();
    }
    this.animate(view, P, t, zoom, seconds, epoch);
  }

  /** Another colony, or the views dropped their records: everything laid afresh. */
  private reset(sim: Sim, ep: string): void {
    this.sim = sim;
    this.epochs = ep;
    this.sig = '';
    for (const L of this.laid.values()) { for (const s of L.sprites) s.destroy(); L.name?.destroy(); }
    this.laid.clear();
    this.d.wires.clearForeign();
  }

  // ── laying a base ────────────────────────────────────────────────────────────

  private lay(sim: Sim, h: Holding): void {
    if (h.parcels.every((p) => sim.land.neighbour(p) < 0)) return;
    const L = sim.neighbours.layout(h);
    const heart = L.structs[L.core >= 0 ? L.core : 0];
    if (!heart || !sim.revealed(heart.x + 1, heart.y + 1)) return; // still under the fog
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
    this.d.buildings.layForeign(h.hub, ents, L.ribbons.slice(0, 20).map((r) => r.tiles), tint, L.flag ? { x: L.flag[0], y: L.flag[1], emblem } : null);
    // Its lanterns at night: its tents' doors, its banner poles' tips.
    const lanterns = [
      ...(coreAt ? [{ x: coreAt.x + 0.72, y: coreAt.y + 0.72, z: 0.75 }, { ...coreAt }] : []),
      ...L.tents.map(([x, y]) => ({ x: x + NEIGHBOUR_TENT * 0.85, y: y + NEIGHBOUR_TENT * 0.85, z: 0.9 })),
      ...L.banners.map(([x, y]) => ({ x: x + 0.5, y: y + 0.5, z: 5.6 })),
    ];
    this.d.lights.layForeign(h.hub, ents, lanterns);
    // Its grid's wires, from its Core's crown (its own terminal) or terminal to terminal.
    this.d.wires.layForeign(h.hub, L.wires.filter(([a, b]) => a < all.length && b < all.length).map(([a, b]) => {
      if (coreAt && (a === L.core || b === L.core)) { const o = all[a === L.core ? b : a]!; return [coreAt, wireAnchor(o, coreAt.x, coreAt.y)] as const; }
      return wireEnds(all[a]!, all[b]!);
    }));
    const ck = `${emblem.field}:${emblem.ink}`;
    const sprites: Sprite[] = [];
    // Its Core: iso among the volumes, plan flat.
    if (L.core >= 0) {
      const s = L.structs[L.core]!, f = coreFrame();
      sprites.push(this.isoSprite(this.bake(`core:${top}:${ck}`, f.w, f.h, f.ox, f.oy, (ctx) => drawCore(ctx, top, colours, f)), s.x, s.y, buildingZ(s.x, s.y, CORE.n, CORE.n)));
      sprites.push(this.flatSprite(this.bake(`coreP:${top}:${ck}`, CORE.n * PLAN_PX, CORE.n * PLAN_PX, 0, 0, (ctx) => drawCorePlan(ctx, top, colours)), s.x, s.y, this.d.layers.plan));
    }
    // The tarps under its buildings (not under the masts), the widest patch of its colours.
    for (const s of L.structs) {
      if (BUILDING_IDS[s.def] === NEIGHBOUR_MAST) continue;
      const [w, hh] = footprint(s.def, s.rot);
      const fr = this.bake(`tarp:${w}x${hh}:${ck}`, (w + 2 * HEM) * PLAN_PX, (hh + 2 * HEM) * PLAN_PX, 0, 0, (ctx) => drawTarp(ctx, w, hh, HEM, colours, w * 7 + hh * 3));
      sprites.push(this.flatSprite(fr, s.x - HEM, s.y - HEM, this.d.layers.decals));
    }
    // Its covered depots, banner poles and cairns: iso among the volumes, plan flat.
    for (const [x, y] of L.tents) {
      const f = tentFrame(NEIGHBOUR_TENT);
      sprites.push(this.isoSprite(this.bake(`tent:${ck}`, f.w, f.h, f.ox, f.oy, (ctx) => drawTent(ctx, NEIGHBOUR_TENT, colours, f)), x, y, buildingZ(x, y, NEIGHBOUR_TENT, NEIGHBOUR_TENT)));
      sprites.push(this.flatSprite(this.bake(`tentP:${ck}`, NEIGHBOUR_TENT * PLAN_PX, NEIGHBOUR_TENT * PLAN_PX, 0, 0, (ctx) => drawTentPlan(ctx, NEIGHBOUR_TENT, colours)), x, y, this.d.layers.plan));
    }
    for (const [x, y] of L.banners) {
      const f = bannerFrame();
      sprites.push(this.isoSprite(this.bake(`banner:${ck}`, f.w, f.h, f.ox, f.oy, (ctx) => drawBanner(ctx, colours, f)), x, y, buildingZ(x, y, 1, 1) + 0.02));
      sprites.push(this.flatSprite(this.bake(`bannerP:${ck}`, PLAN_PX, PLAN_PX, 0, 0, (ctx) => drawBannerPlan(ctx, colours)), x, y, this.d.layers.plan));
    }
    for (const [x, y] of L.cairns) {
      const f = cairnFrame();
      sprites.push(this.isoSprite(this.bake(`cairn:${ck}`, f.w, f.h, f.ox, f.oy, (ctx) => drawCairn(ctx, colours, f)), x, y, buildingZ(x, y, 1, 1)));
      sprites.push(this.flatSprite(this.bake(`cairnP:${ck}`, PLAN_PX, PLAN_PX, 0, 0, (ctx) => drawCairnPlan(ctx, colours)), x, y, this.d.layers.plan));
    }
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
    this.laid.set(h.hub, {
      hub: h.hub, box: [bx0, by0, bx1, by1], sprites, shown: true, colours,
      ribbons: L.ribbons.map((r, j) => ({ tiles: r.tiles, item: r.item, len: r.tiles.length / 3, phase: (hash32(h.hub, j, 0x90d5) % 1000) / 1000 })),
      smokers, pad: p0 ? { x: p0.x, y: p0.y, w: pw, h: ph, rot: p0.rot } : null,
      name: null, nameAt: [hx + 0.5, hy - 2.5], nameText: '',
    });
  }

  /** A baked frame, once per key. */
  private bake(key: string, w: number, h: number, ox: number, oy: number, draw: (ctx: CanvasRenderingContext2D) => void): DynFrame {
    let f = this.baked.get(key);
    if (!f) { f = this.sheet.add(key, w, h, ox, oy, draw); this.baked.set(key, f); }
    return f;
  }

  /** An iso piece among the volumes: its footprint's ground corner at tile (x, y), depth key z. */
  private isoSprite(f: DynFrame, x: number, y: number, z: number): Sprite {
    const s = new Sprite(f.tex), k = 1 / DRESS_K;
    const [wx, wy] = tileToIso(x, y, 0);
    s.scale.set(k);
    s.position.set(wx - f.ox * k, wy - f.oy * k);
    s.zIndex = z;
    this.d.layers.objects.addChild(s);
    return s;
  }

  /** A flat piece in tile units (the ground plane, or the plan sprites'), its top-left at tile (x, y). */
  private flatSprite(f: DynFrame, x: number, y: number, layer: Container): Sprite {
    const s = new Sprite(f.tex);
    s.scale.set(1 / PLAN_PX);
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
      // The goods riding its ribbons, a loop on the game's clock.
      if (showGoods) for (const r of L.ribbons) {
        const tex = this.itemTex(r.item);
        if (!tex || r.len < 2) continue;
        const n = Math.max(1, Math.floor(r.len / ITEM_GAP));
        for (let k = 0; k < n; k++) {
          const s = (((seconds * ITEM_SPEED) / r.len + r.phase + k / n) % 1) * (r.len - 1);
          const i = Math.floor(s), f = s - i;
          const ax = r.tiles[i * 3]! + 0.5, ay = r.tiles[i * 3 + 1]! + 0.5, bx = r.tiles[(i + 1) * 3]! + 0.5, by = r.tiles[(i + 1) * 3 + 1]! + 0.5;
          const x = ax + (bx - ax) * f, y = ay + (by - ay) * f;
          if (x < vx0 - 1 || x > vx1 + 1 || y < vy0 - 1 || y > vy1 + 1) continue;
          const sp = this.goodsSprite(ng++, tex);
          sp.position.set(P.a * x + P.c * y, P.b * x + P.d * y - 3 * iso);
          sp.scale.set(iscale);
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

  private itemTex(item: number): Texture | undefined {
    return item >= 0 ? this.d.atlas.textures.get(ibKey(ITEM_IDS[item]!)) : undefined;
  }

  private goodsSprite(i: number, tex: Texture): Sprite {
    let s = this.goods.children[i] as Sprite | undefined;
    if (!s) { s = new Sprite(tex); s.anchor.set(0.5); this.goods.addChild(s); }
    if (s.texture !== tex) s.texture = tex;
    s.visible = true;
    return s;
  }

  private smokeSprite(i: number): Sprite {
    this.puff ??= puffTexture(this.sheet);
    let s = this.smoke.children[i] as Sprite | undefined;
    if (!s) { this.sheet.flush(); s = new Sprite(this.puff.tex); s.anchor.set(0.5); this.smoke.addChild(s); }
    s.visible = true;
    return s;
  }

  /** The name band over a base: baked when its name is known (or changes language), placed over its hub, constant on screen. */
  private placeName(L: Laid, show: boolean, P: Lin, iso: number, zoom: number): void {
    if (!show) { if (L.name) L.name.visible = false; return; }
    const hub = this.sim?.neighbours.holdingOf(L.hub);
    const text = hub ? this.d.name(hub.colony) : '';
    if (!text) { if (L.name) L.name.visible = false; return; }
    if (text !== L.nameText || !L.name) {
      L.nameText = text;
      const f = nameFrame(text);
      const fr = this.bake(`name:${text}:${L.colours.field}`, f.w, f.h, f.ox, f.oy, (ctx) => drawName(ctx, text, L.colours, f));
      this.sheet.flush();
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
