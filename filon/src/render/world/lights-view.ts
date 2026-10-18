// lights-view.ts — what the sun changes on the base, as views. The base is automated (nobody
// lives there): every light is a machine's.
//
// - **Night lights** (`LightsView`, on the additive `lights` layer, above the graded world so
//   the grade never dims them): every light the building art bakes in — LEDs, status beacons,
//   landing rings, furnace mouths — gets a glow, found by re-running the building's recipe on a
//   spy context (art/recipes/fx.ts), so lights sit exactly where the art puts them, in every
//   rotation, whatever the art becomes. Amber only on machines that run hot (kilns, coal generators);
//   elsewhere amber LEDs glow work-lamp white, cyan stays cyan, red and green stay. Each
//   building adds its night rig from its kind and footprint: a pool of work-lamp light on the
//   ground, and on the Heart a pulsing uplink beacon, on its dish's feed horn (fx `beaconSpot`). A building standing on the mountains (D44)
//   has its lights lifted with it, onto the rock top (world/stand.ts). One iso container (under
//   M, faded with the volumes) and one plan container (under P, fainter). Laid on structural changes only,
//   building by building (D92: a building keeps its lights until what they were laid from changes),
//   from pooled sprites; per frame only the layer's alpha (the night factor: one render-group
//   uniform), the beacon's pulse, the incinerators' fire (a glow over each pit and up its flame,
//   bright as an item burns, and a spark of light rising with each burst's sparks: world/pits.ts,
//   world/pit-burst.ts) and, during a morph, two transforms. A production
//   building that does not work is dark (D83): its glows and its work lamp hidden while the
//   buildings view's `WorkLook` says it is switched off — re-applied only when a look flips. A
//   neighbouring base's buildings (D110, `layForeign`) get their lights too, always on: kept apart
//   from the claim's records, dropped with them for another colony.
// - **Solar states**: solar panels wear an overlay above their sprite (iso: in `objects`, depth-
//   sorted just above the bulb; plan: on `plan`): a closed bud at night, half-open petals at
//   dawn and dusk, nothing when open, a sheen in full sun. Any solar cells drawn in `PV` (the
//   Heart's array) get theirs too: dark at night, a warm glint at dawn and dusk, a white sheen
//   at noon. Textures swap only when the stage changes (a few times a day).
// - **Cloud shadows** (`CloudShadows`, on `shade` inside the graded world): a few large soft
//   blobs drifting with the Sough over the ground, multiplied in by day, gone at night and in
//   the plan view. A pure function of the world clock: the same sky for everyone.
//
// The art (glow, haze, clouds, petals) is baked into one small sheet at construction; the
// cells' states are added to it the first time a building with cells shows up.
import { CanvasSource, Container, Matrix, Rectangle, Sprite, Texture } from 'pixi.js';
import { BUILDING_IDS, BUILDING_KIND, buildingDef } from '@/content/registry';
import type { BuildingId } from '@/content/buildings';
import { footprint } from '@/sim/entities';
import type { Sim } from '@/sim/state';
import type { Ent, Rot } from '@/sim/types';
import { bKey, btKey, type Atlas } from '../art/atlas';
import type { Pt } from '../art/ink';
import { C, num } from '../art/tokens';
import { artLevelOf, isoHead } from '../art/recipes/buildings';
import {
  beaconSpot, drawBulbIso, drawBulbPlan, drawCloud, drawGlow, drawPvState, drawSoft, HOT, isoArt, isoFrameOf, nightRig, planArt, planFrameOf,
  SOLAR_STAGES, type Emitter, type GlowClass, type SolarStage,
} from '../art/recipes/fx';
import type { Grade } from '../daynight';
import { LH, TW, tileToIso } from '../iso';
import { isoToView, type Lin } from '../projection';
import { buildingZ, standOf } from './stand';
import { pitFire } from './pits';
import { BURST, PLAN_LIFT, burstGlow, sparkAt, type SparkAt } from './pit-burst';
import { OFF_TINT, looksAtWork, type WorkLook } from './work-look';
import { PIT } from '../art/recipes/buildings';

// ── the fx sheet ─────────────────────────────────────────────────────────────────

const PAGE = 1024;
const PAD = 6;
const GLOW_PX = 64;
const SOFT_PX = 128;
const CLOUD_PX = 256;
export const CLOUD_KINDS = 3;

interface SheetFrame { tex: Texture; ox: number; oy: number }

function canvasOf(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(w));
  canvas.height = Math.max(1, Math.ceil(h));
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  return { canvas, ctx };
}

/** Trim a drawing to its painted pixels (overlays are drawn in a whole building frame). */
function cropped(canvas: HTMLCanvasElement, ox: number, oy: number): { canvas: HTMLCanvasElement; ox: number; oy: number } {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const { width: W, height: H } = canvas;
  const d = ctx.getImageData(0, 0, W, H).data;
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (d[(y * W + x) * 4 + 3]! > 2) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
  }
  if (x1 < 0) return { canvas: canvasOf(1, 1).canvas, ox: 0, oy: 0 };
  const out = canvasOf(x1 - x0 + 3, y1 - y0 + 3);
  out.ctx.drawImage(canvas, x0 - 1, y0 - 1, x1 - x0 + 3, y1 - y0 + 3, 0, 0, x1 - x0 + 3, y1 - y0 + 3);
  return { canvas: out.canvas, ox: ox - x0 + 1, oy: oy - y0 + 1 };
}

/** A small shelf-packed sheet that grows by 1024² pages; `flush()` uploads what changed. */
class FxSheet {
  private readonly frames = new Map<string, SheetFrame>();
  private readonly sources: CanvasSource[] = [];
  private readonly pages: CanvasRenderingContext2D[] = [];
  private readonly dirty = new Set<number>();
  private x = PAD;
  private y = PAD;
  private rowH = 0;

  get(key: string): SheetFrame | undefined { return this.frames.get(key); }

  add(key: string, canvas: HTMLCanvasElement, ox: number, oy: number): SheetFrame {
    const { width: w, height: h } = canvas;
    if (this.pages.length && this.x + w + PAD > PAGE) { this.x = PAD; this.y += this.rowH + PAD; this.rowH = 0; }
    if (!this.pages.length || this.y + h + PAD > PAGE) {
      const c = canvasOf(PAGE, PAGE);
      this.pages.push(c.ctx);
      this.sources.push(new CanvasSource({ resource: c.canvas, autoGenerateMipmaps: true, scaleMode: 'linear' }));
      this.x = PAD; this.y = PAD; this.rowH = 0;
    }
    const pg = this.pages.length - 1;
    this.pages[pg]!.drawImage(canvas, this.x, this.y);
    const f: SheetFrame = { tex: new Texture({ source: this.sources[pg]!, frame: new Rectangle(this.x, this.y, w, h) }), ox, oy };
    this.frames.set(key, f);
    this.dirty.add(pg);
    this.x += w + PAD;
    this.rowH = Math.max(this.rowH, h);
    return f;
  }

  flush(): void {
    for (const p of this.dirty) this.sources[p]!.update();
    this.dirty.clear();
  }

  destroy(): void {
    for (const f of this.frames.values()) f.tex.destroy(false);
    for (const s of this.sources) s.destroy();
    this.frames.clear();
  }
}

const bulbKey = (view: 'i' | 'p', rot: Rot, stage: SolarStage): string => `bulb:${view}:${rot}:${stage}`;
const pvKey = (view: 'i' | 'p', id: string, rot: Rot, stage: SolarStage): string => `pv:${view}:${id}:${rot}:${stage}`;

/** Bake the glow textures, the clouds and the solar panel's overlays for every rotation the atlas has. */
function bakeSheet(atlas: Atlas): FxSheet {
  const sheet = new FxSheet();
  const pieces: Array<{ key: string; canvas: HTMLCanvasElement; ox: number; oy: number }> = [];
  for (let k = 0; k < CLOUD_KINDS; k++) {
    const c = canvasOf(CLOUD_PX, CLOUD_PX);
    drawCloud(c.ctx, CLOUD_PX, 0x5eed + k * 977);
    pieces.push({ key: `cloud:${k}`, canvas: c.canvas, ox: CLOUD_PX / 2, oy: CLOUD_PX / 2 });
  }
  const soft = canvasOf(SOFT_PX, SOFT_PX);
  drawSoft(soft.ctx, SOFT_PX);
  pieces.push({ key: 'soft', canvas: soft.canvas, ox: SOFT_PX / 2, oy: SOFT_PX / 2 });
  const glow = canvasOf(GLOW_PX, GLOW_PX);
  drawGlow(glow.ctx, GLOW_PX);
  pieces.push({ key: 'glow', canvas: glow.canvas, ox: GLOW_PX / 2, oy: GLOW_PX / 2 });
  const def = buildingDef(BUILDING_IDS.indexOf('sun_bulb'));
  for (const rot of [0, 1, 2, 3] as Rot[]) {
    if (atlas.frames.has(bKey('sun_bulb', rot))) {
      for (const st of SOLAR_STAGES) {
        const f = isoFrameOf('sun_bulb', def.w, def.h, rot);
        const c = canvasOf(f.W, f.H);
        drawBulbIso(c.ctx, f, st);
        pieces.push({ key: bulbKey('i', rot, st), ...cropped(c.canvas, f.ox, f.oy) });
      }
    }
    if (atlas.frames.has(btKey('sun_bulb', rot))) {
      for (const st of SOLAR_STAGES) {
        const f = planFrameOf(def.w, def.h, rot);
        const c = canvasOf(f.W, f.H);
        drawBulbPlan(c.ctx, f, st);
        pieces.push({ key: bulbKey('p', rot, st), ...cropped(c.canvas, f.M, f.M) });
      }
    }
  }
  pieces.sort((a, b) => b.canvas.height - a.canvas.height || a.key.localeCompare(b.key));
  for (const p of pieces) sheet.add(p.key, p.canvas, p.ox, p.oy);
  sheet.flush();
  return sheet;
}

/** Bake the cells' states of one sprite (once per building and rotation), in sprite px from its anchor. */
function bakeCells(sheet: FxSheet, view: 'i' | 'p', id: string, rot: Rot, cells: readonly Pt[][]): void {
  if (sheet.get(pvKey(view, id, rot, 0))) return;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const c of cells) for (const [x, y] of c) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const m = 16; // room for the sparkle
  const ox = -x0 + m, oy = -y0 + m;
  const local = cells.map((c) => c.map(([x, y]) => [x + ox, y + oy] as Pt));
  for (const st of SOLAR_STAGES) {
    const c = canvasOf(x1 - x0 + 2 * m, y1 - y0 + 2 * m);
    drawPvState(c.ctx, local, st);
    sheet.add(pvKey(view, id, rot, st), c.canvas, ox, oy);
  }
}

// ── night lights ─────────────────────────────────────────────────────────────────

/** Light colours: cyan LEDs, work-lamp white (amber LEDs on cold machines), amber (hot machines), red, green. */
const COLD = num(C.led), WHITE = num('#eaf6ff'), AMBER = num(C.ledWarm), RED = num(C.ledRed), GREEN = num(C.ledGreen);
/** A burst's spark at night (D125): a hot point, paler than the fire's amber. */
const SPARK_LIGHT = num('#ffd59a');
const POOL_COLD = num('#d6efff'), POOL_WARM = num('#ffb562'), BEACON = num('#c4fbff');
/** Glow strength by class. */
const ALPHA: Record<GlowClass, number> = { cold: 1, warm: 0.9, red: 1, green: 0.85 };
/** Halo diameter ÷ the light's own size: points spread more than strips; big areas get a haze. */
const HALO_POINT = 9, HALO_STRIP = 5, HALO_AREA = 2.4;
/** A light bigger than this (world px) glows as an area (furnace mouths, gauges). */
const AREA_PX = 7;
/** The plan view's lights: fainter (its grade is light). */
const PLAN_LIGHTS = 0.55;
/** The Heart's beacon pulse: period (s) and depth. */
const PULSE_S = 3.2, PULSE = 0.35;

/**
 * Sun stage of the moment (0 night bud … 3 full sun), from the smoothed sun: half open through
 * most of dawn and dusk (04:00–05:20, 18:40–20:00), open in the low sun, the sheen in full sun.
 */
export function solarStage(sun: number): SolarStage {
  return sun >= 0.9 ? 3 : sun >= 0.62 ? 2 : sun >= 0.1 ? 1 : 0;
}

/** Local (unrotated) tile coords → the rotated footprint's coords (as IsoFrame.r). */
function rotLocal(w: number, h: number, rot: Rot, x: number, y: number): [number, number] {
  switch (rot) {
    case 0: return [x, y];
    case 1: return [h - y, x];
    case 2: return [w - x, h - y];
    default: return [y, w - x];
  }
}

/** A state overlay: its building, its sprite, its frame by stage (null: nothing to show), its anchor point and scale. */
interface Overlay { ent: number; s: Sprite; keys: ReadonlyArray<string | null>; x: number; y: number; k: number }

/**
 * One building's lights (D92), kept until what they were laid from (`sig`) changes: its glows in
 * each view (pooled sprites), its beacon's sprites, its pit's glows, its solar overlays, and — for a
 * building whose look says whether it works (D83) — whether its glows show.
 */
interface LightRec {
  sig: string;
  ent: number;
  iso: Sprite[];
  plan: Sprite[];
  overlays: Overlay[];
  beacons: Array<{ s: Sprite; a: number }>;
  pit: PitLights | null;
  /** Watched (D83): its glows shown as last applied. */
  watched: boolean;
  on: boolean;
  seen: number;
}

/**
 * An incinerator's night lights: its fire's glows (alpha by its heat), and per burst slot (D125) a
 * haze rising with that burst's cloud of sparks in each view and, in iso, a point of light on each
 * spark — from the throat's centre on the ground (iso world px; plan tiles).
 */
interface PitLights {
  ent: number;
  glows: Array<{ s: Sprite; a: number }>;
  sparks: Array<{ i: Sprite; p: Sprite; pts: Sprite[] }>;
  x: number; y: number; px: number; py: number;
}

/**
 * The solar overlays sort just over their building's key (+ 0.25 in iso, the plan's 0), after every
 * sprite at that very key, among themselves in entity order — the order a rebuild from scratch laid
 * them in (D92; the buildings view sorts its own sprites a hair under their keys).
 */
const TIE = 2 ** -36;

export class LightsView {
  /** Iso glows (iso world px, under M) and plan glows (tile units, under P). */
  private readonly iso = new Container({ label: 'lights:iso' });
  private readonly plan = new Container({ label: 'lights:plan' });
  private readonly sheet: FxSheet;
  /**
   * Glow sprites free for reuse (hidden), per view; how many are in use. The containers are sorted by
   * rank (the building's id, then the order its glows are laid): added light rounds a little
   * differently in another order where many glows stack, so they keep the order a rebuild from
   * scratch lays them in.
   */
  private readonly freeIso: Sprite[] = [];
  private readonly freePlan: Sprite[] = [];
  private nIso = 0;
  private nPlan = 0;
  /** Each building's lights, by entity; the record being laid; the rebuild's pass. */
  private readonly recs = new Map<number, LightRec>();
  /** Gathered from the records for the per-frame work: the watched ones (D83), the beacons, the pits, the overlays. */
  private readonly watched = new Set<LightRec>();
  private readonly beacons = new Set<{ s: Sprite; a: number }>();
  private readonly pits = new Set<PitLights>();
  private readonly overlays = new Set<Overlay>();
  private cur: LightRec | null = null;
  private pass = 0;
  private sim: Sim | null = null;
  private te = -1;
  private stage = -1;
  /** Entities left dark (no glows, no solar overlay) from the next rebuild on: the intro's Heart until it lands (D31). */
  readonly hidden = new Set<number>();
  /** Which production buildings work (the buildings view's): a switched-off one shows no light (D83). */
  work: WorkLook | null = null;
  /** The look version applied. */
  private workVer = -1;
  /** Building records laid and dropped by the last rebuild (perf, tests). */
  lastUpdate = { laid: 0, dropped: 0 };
  /** The neighbouring bases' lights (D110), by key (their hub parcel); bumped when they are dropped. */
  private readonly foreign = new Map<number, LightRec[]>();
  foreignEpoch = 0;

  /** Scratch for a burst's spark (pit-burst.ts `sparkAt`): no allocation per frame. */
  private readonly spark: SparkAt = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, a: 0, s: 1 };

  /** Is this neighbouring base's light laid? */
  hasForeign(key: number): boolean { return this.foreign.has(key); }

  /**
   * A neighbouring base's lights (D110): every building's, always on (they always work), and its
   * lanterns — points at tile (x, y), `z` levels up (its tents' doors, its banner poles' tips), warm.
   */
  layForeign(key: number, ents: readonly Ent[], lanterns: ReadonlyArray<{ x: number; y: number; z: number }> = []): void {
    if (this.foreign.has(key)) return;
    const recs: LightRec[] = [];
    for (const e of ents) {
      const r: LightRec = { sig: '', ent: e.id, iso: [], plan: [], overlays: [], beacons: [], pit: null, watched: false, on: true, seen: 0 };
      this.cur = r;
      this.addBuilding(e);
      for (const b of r.beacons) this.beacons.add(b);
      for (const o of r.overlays) this.overlays.add(o);
      recs.push(r);
    }
    if (lanterns.length && ents.length) {
      const r: LightRec = { sig: '', ent: ents[0]!.id + 39, iso: [], plan: [], overlays: [], beacons: [], pit: null, watched: false, on: true, seen: 0 };
      this.cur = r;
      for (const l of lanterns) {
        const [X, Y] = tileToIso(l.x, l.y, l.z);
        this.glow('i', 'glow', X, Y, 26, 26, AMBER, 0.9);
        this.glow('i', 'soft', X, Y + 6, 90, 50, POOL_WARM, 0.35);
        this.glow('p', 'glow', l.x, l.y, 0.6, 0.6, AMBER, 0.7);
      }
      recs.push(r);
    }
    this.cur = null;
    this.foreign.set(key, recs);
    this.stage = -1;
    this.sheet.flush();
  }

  constructor(
    private readonly layer: Container,
    private readonly objectLayer: Container,
    private readonly planLayer: Container,
    private readonly atlas: Atlas,
  ) {
    layer.blendMode = 'add';
    this.iso.sortableChildren = true;
    this.plan.sortableChildren = true;
    layer.addChild(this.iso, this.plan);
    layer.visible = false;
    this.sheet = bakeSheet(atlas);
  }

  /** Glow sprites in use (perf). */
  get count(): number { return this.nIso + this.nPlan; }

  /** Cloud textures for `CloudShadows` (shared sheet). */
  cloudTextures(): Texture[] {
    return Array.from({ length: CLOUD_KINDS }, (_, k) => this.sheet.get(`cloud:${k}`)!.tex);
  }

  /**
   * After a structural change, after the buildings view (a building's stand — how high it stands,
   * how it sorts — is the one that view worked out): the lights of the buildings whose lights
   * changed (`sigOf`) laid again, those of the buildings gone dropped, the rest kept (D92: on a base
   * of 25 000 entities every light laid again took 20–26 ms). Another colony starts from nothing.
   */
  rebuild(sim: Sim): void {
    if (sim !== this.sim) { this.clear(); this.sim = sim; }
    const pass = ++this.pass;
    const gone: LightRec[] = [];
    const todo: Array<{ e: Ent; sig: string }> = [];
    for (const e of sim.ents.sorted()) {
      const kind = BUILDING_KIND[e.def]!;
      if (kind === 'belt' || kind === 'conduit') continue;
      const sig = this.sigOf(sim, e);
      const r = this.recs.get(e.id);
      if (r && r.sig === sig) { r.seen = pass; continue; }
      if (r) { gone.push(r); this.recs.delete(e.id); }
      todo.push({ e, sig });
    }
    for (const [id, r] of this.recs) if (r.seen !== pass) { gone.push(r); this.recs.delete(id); }
    for (const r of gone) this.drop(r);
    for (const { e, sig } of todo) {
      const r: LightRec = { sig, ent: e.id, iso: [], plan: [], overlays: [], beacons: [], pit: null, watched: false, on: true, seen: pass };
      this.cur = r;
      // Dark while being built, dormant or hidden (the intro's Heart): a record with nothing in it.
      if (e.builtAt === 0 && !sim.isDormant(e) && !this.hidden.has(e.id)) this.addBuilding(e);
      r.watched = looksAtWork(e.def) && (r.iso.length > 0 || r.plan.length > 0);
      this.recs.set(e.id, r);
      if (r.watched) this.watched.add(r);
      for (const b of r.beacons) this.beacons.add(b);
      if (r.pit) this.pits.add(r.pit);
      for (const o of r.overlays) this.overlays.add(o);
    }
    this.cur = null;
    if (todo.length || gone.length) {
      this.workVer = -1; // the new ones' looks applied at the next update, then on every flip
      this.stage = -1; // the new overlays' solar stage, likewise
    }
    this.sheet.flush();
    this.lastUpdate = { laid: todo.length, dropped: gone.length };
  }

  /** Every light laid again from scratch (what `rebuild` must match: the shots' check). */
  rebuildAll(sim: Sim): void {
    this.clear(sim !== this.sim); // the neighbouring bases' lights stay (D110), but for another colony
    this.rebuild(sim);
  }

  /** What a building's lights are laid from: its kind, place, turn, built, dormant or hidden, its stand, the look it wears (the Heart's level: its lamps and beacon, D86). */
  private sigOf(sim: Sim, e: Ent): string {
    const st = standOf(e);
    const id = BUILDING_IDS[e.def]! as BuildingId;
    return `${e.def},${e.x},${e.y},${e.rot},${+(e.builtAt !== 0)}${+sim.isDormant(e)}${+this.hidden.has(e.id)},${st ? `${st.level},${st.z}` : ''},${artLevelOf(id, sim.hearthLevel)}`;
  }

  /** A record's lights gone: its glows back to the free pools (hidden), its overlays destroyed. */
  private drop(r: LightRec): void {
    for (const s of r.iso) { s.visible = false; this.freeIso.push(s); }
    for (const s of r.plan) { s.visible = false; this.freePlan.push(s); }
    this.nIso -= r.iso.length;
    this.nPlan -= r.plan.length;
    for (const o of r.overlays) { o.s.destroy(); this.overlays.delete(o); }
    this.watched.delete(r);
    for (const b of r.beacons) this.beacons.delete(b);
    if (r.pit) this.pits.delete(r.pit);
  }

  /** Every record dropped (another colony; a full rebuild keeps the neighbouring bases', `foreign` false). */
  private clear(foreign = true): void {
    for (const r of this.recs.values()) this.drop(r);
    this.recs.clear();
    if (!foreign) return;
    for (const rs of this.foreign.values()) for (const r of rs) this.drop(r);
    this.foreign.clear();
    this.foreignEpoch++;
  }

  private sprite(view: 'i' | 'p', key: 'glow' | 'soft'): Sprite {
    const free = view === 'i' ? this.freeIso : this.freePlan;
    let s = free.pop();
    if (!s) {
      s = new Sprite();
      s.anchor.set(0.5);
      (view === 'i' ? this.iso : this.plan).addChild(s);
    }
    const r = this.cur!;
    s.zIndex = r.ent * 256 + r.iso.length + r.plan.length; // its rank (`freeIso` above)
    if (view === 'i') { this.nIso++; r.iso.push(s); } else { this.nPlan++; r.plan.push(s); }
    s.texture = this.sheet.get(key)!.tex;
    s.visible = true;
    return s;
  }

  /** A glow centred at (x, y), d1 × d2 across (the view's units), in a colour. */
  private glow(view: 'i' | 'p', key: 'glow' | 'soft', x: number, y: number, d1: number, d2: number, color: number, alpha: number): Sprite {
    const s = this.sprite(view, key);
    const px = key === 'glow' ? GLOW_PX : SOFT_PX;
    s.position.set(x, y);
    s.scale.set(d1 / px, d2 / px);
    s.tint = color;
    s.alpha = alpha;
    return s;
  }

  /** One baked light: a point, a strip (taller than wide) or an area. `k` = view units per sprite px. */
  private emitter(view: 'i' | 'p', em: Emitter, x0: number, y0: number, k: number, hot: boolean): void {
    const w = em.w * k, h = em.h * k, size = Math.max(w, h);
    const color = em.glow === 'cold' ? COLD : em.glow === 'red' ? RED : em.glow === 'green' ? GREEN : hot ? AMBER : WHITE;
    const alpha = ALPHA[em.glow];
    const areaAt = view === 'i' ? AREA_PX : AREA_PX / 32;
    const x = x0 + em.x * k, y = y0 + em.y * k;
    if (size > areaAt) this.glow(view, 'soft', x, y, w * HALO_AREA, h * HALO_AREA, color, alpha * 0.7);
    else if (h > w * 1.3) this.glow(view, 'glow', x, y, w * HALO_STRIP * 1.6, h * HALO_STRIP, color, alpha);
    else this.glow(view, 'glow', x, y, size * HALO_POINT, size * HALO_POINT, color, alpha);
  }

  private addBuilding(e: Ent): void {
    const r = this.cur!;
    const id = BUILDING_IDS[e.def]! as BuildingId;
    const def = buildingDef(e.def);
    const rotI = this.atlas.frames.has(bKey(id, e.rot)) ? e.rot : 0;
    const rotP = this.atlas.frames.has(btKey(id, e.rot)) ? e.rot : 0;
    const hot = HOT.has(id);
    const bulb = id === 'sun_bulb';
    const look = artLevelOf(id, this.sim?.hearthLevel ?? 1); // the Heart's lamps follow its level (D86)
    const isoA = isoArt(id, rotI, look), planA = planArt(id, rotP, look);
    // Iso: atlas px are half world px; the sprite's anchor is the footprint's ground corner — on the
    // rock top for a building standing on the mountains (its stand's level: plan lights stay flat).
    const st = standOf(e), lv = st?.level ?? 0;
    const [ax, ay] = tileToIso(e.x, e.y, lv);
    for (const em of isoA.emitters) {
      if (bulb && Math.max(em.w, em.h) > 8) continue; // the receiver: the petals decide (a bud at night)
      this.emitter('i', em, ax, ay, 0.5, hot);
    }
    for (const em of planA.emitters) {
      if (bulb && Math.max(em.w, em.h) > 8) continue;
      this.emitter('p', em, e.x, e.y, 1 / 64, hot);
    }
    // The night rig: a pool of work-lamp light round the footprint, the Heart's uplink beacon.
    const rig = nightRig(id, def);
    const [w, h] = footprint(e.def, e.rot);
    if (rig.pool) {
      const [X, Y] = tileToIso(e.x + w / 2, e.y + h / 2, lv);
      const rr = rig.pool.r, color = rig.pool.warm ? POOL_WARM : POOL_COLD;
      // A ground circle of radius r tiles is an ellipse r·√2·32 by r·√2·16 world px in iso.
      this.glow('i', 'soft', X, Y, rr * Math.SQRT2 * 64, rr * Math.SQRT2 * 32, color, rig.pool.alpha);
      this.glow('p', 'soft', e.x + w / 2, e.y + h / 2, rr * 2, rr * 2, color, rig.pool.alpha * 0.8);
    }
    if (rig.beacon) {
      // Over the footprint's centre at its share of the head room — the Heart's uplink feed horn —
      // on the light baked there (fx `beaconSpot`; not the highest light: a link mast's is higher).
      const [cx, cy] = rotLocal(def.w, def.h, rotI, def.w / 2, def.h / 2);
      const [bx, by] = beaconSpot(isoA, cx, cy, isoHead(id) * rig.beacon.at);
      const X = ax + bx * 0.5, Y = ay + by * 0.5;
      const d = rig.beacon.d * Math.SQRT2 * 32;
      const core = this.glow('i', 'glow', X, Y, d * 0.35, d * 0.35, BEACON, 1);
      const halo = this.glow('i', 'soft', X, Y, d, d, BEACON, rig.beacon.alpha * 0.6);
      r.beacons.push({ s: core, a: 1 }, { s: halo, a: rig.beacon.alpha * 0.6 });
      this.glow('p', 'glow', e.x + w / 2, e.y + h / 2, rig.beacon.d * 0.5, rig.beacon.d * 0.5, BEACON, 0.8);
    }
    // An incinerator's fire: a warm glow on its throat and up its flame, as strong as the fire (`update`).
    if (def.kind === 'sink') {
      const [X, Y] = tileToIso(e.x + 0.5, e.y + 0.5, lv + PIT.zr);
      const [FX, FY] = tileToIso(e.x + 0.5, e.y + 0.5, lv + 1.1);
      const glows = [
        { s: this.glow('i', 'soft', X, Y, 1.7 * Math.SQRT2 * 64, 1.7 * Math.SQRT2 * 32, POOL_WARM, 0), a: 0.55 },
        { s: this.glow('i', 'soft', FX, FY, 44, 84, AMBER, 0), a: 0.8 },
        { s: this.glow('i', 'glow', X, Y - 4, 30, 18, AMBER, 0), a: 1 },
        { s: this.glow('p', 'soft', e.x + 0.5, e.y + 0.5, 1.8, 1.8, POOL_WARM, 0), a: 0.7 },
      ];
      // A burst's sparks (D125): a warm haze over each burst's cloud of them, rising and spreading with it (`update`), hidden until one shows.
      const [GX, GY] = tileToIso(e.x + 0.5, e.y + 0.5, lv);
      const sparks = Array.from({ length: BURST.slots }, () => {
        const i = this.glow('i', 'soft', GX, GY, 40, 40, AMBER, 0), p = this.glow('p', 'soft', e.x + 0.5, e.y + 0.5, 0.7, 0.7, AMBER, 0);
        const pts = Array.from({ length: BURST.sparks }, () => this.glow('i', 'glow', GX, GY, 15, 15, SPARK_LIGHT, 0));
        i.visible = p.visible = false;
        for (const q of pts) q.visible = false;
        return { i, p, pts };
      });
      r.pit = { ent: e.id, glows, sparks, x: GX, y: GY, px: e.x + 0.5, py: e.y + 0.5 };
    }
    // Solar states over the sprites: the bulb's petals, any cells drawn in PV.
    const z = (st ? st.z : buildingZ(e.x, e.y, w, h)) + 0.25;
    if (bulb) {
      this.overlay(e.id, 'i', [bulbKey('i', rotI, 0), bulbKey('i', rotI, 1), null, bulbKey('i', rotI, 3)], ax, ay, 0.5, z);
      this.overlay(e.id, 'p', [bulbKey('p', rotP, 0), bulbKey('p', rotP, 1), null, bulbKey('p', rotP, 3)], e.x, e.y, 1 / 64, 0);
    }
    if (isoA.cells.length) {
      bakeCells(this.sheet, 'i', id, rotI, isoA.cells);
      this.overlay(e.id, 'i', [pvKey('i', id, rotI, 0), pvKey('i', id, rotI, 1), null, pvKey('i', id, rotI, 3)], ax, ay, 0.5, z);
    }
    if (planA.cells.length) {
      bakeCells(this.sheet, 'p', id, rotP, planA.cells);
      this.overlay(e.id, 'p', [pvKey('p', id, rotP, 0), pvKey('p', id, rotP, 1), null, pvKey('p', id, rotP, 3)], e.x, e.y, 1 / 64, 0);
    }
  }

  /** An overlay sprite above a building (iso: in `objects` at depth key z; plan: on `plan`), ranked after the very key by entity (`TIE`). */
  private overlay(ent: number, view: 'i' | 'p', keys: ReadonlyArray<string | null>, x: number, y: number, k: number, z: number): void {
    if (!keys.some((key) => key !== null && !!this.sheet.get(key))) return;
    const r = this.cur!;
    const s = new Sprite();
    s.scale.set(k);
    s.visible = false;
    s.zIndex = z + TIE * (ent * 4 + r.overlays.length);
    if (view === 'i') this.objectLayer.addChild(s); else this.planLayer.addChild(s);
    r.overlays.push({ ent, s, keys, x, y, k });
  }

  /**
   * The switched-off buildings' glows hidden, the working ones' shown (D83), when a look has
   * flipped since the last call: one pass over the watched buildings, writing only those that
   * changed; their solar overlays greyed with them.
   */
  private lookAtWork(): void {
    const w = this.work;
    if (!w || w.version === this.workVer) return;
    this.workVer = w.version;
    for (const r of this.watched) {
      const on = w.isLit(r.ent);
      if (on === r.on) continue;
      r.on = on;
      for (const s of r.iso) s.visible = on;
      for (const s of r.plan) s.visible = on;
    }
    // A panel's petals and cells over its sprite: greyed with it (a few dozen at most).
    for (const o of this.overlays) {
      const tint = w.isLit(o.ent) ? 0xffffff : OFF_TINT;
      if (o.s.tint !== tint) o.s.tint = tint;
    }
  }

  /** Per frame: the night factor, the beacon's pulse, the view's fades, the solar stage. */
  update(g: Grade, P: Lin, te: number, seconds: number): void {
    this.lookAtWork();
    // Lights: one alpha on a render group (no per-sprite work), skipped entirely by day.
    const a = g.night;
    this.layer.visible = a > 0.004 && this.count > 0;
    this.layer.alpha = a;
    if (this.layer.visible && this.beacons.size) {
      const pulse = 1 - PULSE + PULSE * (0.5 + 0.5 * Math.sin((seconds * 2 * Math.PI) / PULSE_S));
      for (const b of this.beacons) b.s.alpha = b.a * pulse;
    }
    if (this.layer.visible && this.pits.size && this.sim) {
      // The fire as the buildings view last stepped it (the frame before): a smoulder, then the flare.
      const fire = pitFire(this.sim);
      for (const p of this.pits) {
        const k = 0.12 + 0.88 * fire.heat(p.ent);
        for (const gl of p.glows) gl.s.alpha = gl.a * k;
        // Each burst's sparks: a haze over their cloud and a point on each, gone as they fade (pit-burst.ts `burstGlow`, `sparkAt`).
        const bs = this.hidden.has(p.ent) ? undefined : fire.bursts(p.ent);
        for (let i = 0; i < p.sparks.length; i++) {
          const sp = p.sparks[i]!, age = bs ? fire.tick - bs.at[i]! : -1, g = burstGlow(age);
          if (g.k <= 0.01) {
            if (sp.i.visible) { sp.i.visible = sp.p.visible = false; for (const q of sp.pts) q.visible = false; }
            continue;
          }
          for (let k = 0; k < sp.pts.length; k++) {
            const o = sparkAt(bs!.seed[i]!, k, age, this.spark), q = sp.pts[k]!;
            q.visible = o.a > 0.01;
            if (!q.visible) continue;
            q.position.set(p.x + (o.x - o.y) * (TW / 2), p.y + (o.x + o.y) * (TW / 4) - o.z * LH + 3 * o.s); // on the streak's head, a little down its tail
            q.alpha = o.a;
          }
          const d = 2 * g.r * TW + 26; // the cloud's breadth (iso px), a margin for the streaks
          sp.i.position.set(p.x, p.y - g.z * LH);
          sp.i.scale.set(d / SOFT_PX, (d * 0.85) / SOFT_PX);
          sp.i.alpha = 0.75 * g.k;
          sp.p.position.set(p.px, p.py - g.z * PLAN_LIFT);
          sp.p.scale.set((2 * g.r + 0.4) / SOFT_PX);
          sp.p.alpha = 0.6 * g.k;
          if (!sp.i.visible) sp.i.visible = sp.p.visible = true;
        }
      }
    }
    if (te !== this.te) {
      this.te = te;
      const V = isoToView(P);
      this.iso.setFromMatrix(new Matrix(V.a, V.b, V.c, V.d, 0, 0));
      this.plan.setFromMatrix(new Matrix(P.a, P.b, P.c, P.d, 0, 0));
      // The same cross-fade as the volumes and the plan sprites (layers.ts).
      const isoA = te <= 0 ? 1 : te >= 0.6 ? 0 : 1 - te / 0.6;
      const planA = te >= 1 ? 1 : te <= 0.3 ? 0 : (te - 0.3) / 0.7;
      this.iso.alpha = isoA;
      this.iso.visible = isoA > 0;
      this.plan.alpha = planA * PLAN_LIGHTS;
      this.plan.visible = planA > 0;
    }
    const st = solarStage(g.sun);
    if (st !== this.stage) {
      this.stage = st;
      for (const o of this.overlays) {
        const key = o.keys[st];
        const fr = key ? this.sheet.get(key) : undefined;
        o.s.visible = !!fr;
        if (!fr) continue;
        o.s.texture = fr.tex;
        o.s.position.set(o.x - fr.ox * o.k, o.y - fr.oy * o.k);
      }
    }
  }

  destroy(): void {
    for (const o of this.overlays) o.s.destroy();
    this.overlays.clear();
    this.recs.clear();
    this.layer.removeChildren();
    this.iso.destroy({ children: true });
    this.plan.destroy({ children: true });
    this.sheet.destroy();
  }
}

// ── cloud shadows ────────────────────────────────────────────────────────────────

/** The sky's torus (tiles): clouds wrap around the camera within this square. */
const SKY = 224;
/** The Sough carries the clouds east-south-east (tiles per second of world time). */
const WIND_X = 0.21, WIND_Y = 0.08;
/** Overall strength of the shadows by day. */
const SHADE = 0.5;
/** The clouds: position in the torus (tiles), size (tiles across), shape, own strength. */
const SKY_CLOUDS: ReadonlyArray<{ x: number; y: number; d: number; k: number; a: number }> = [
  { x: 12, y: 30, d: 54, k: 0, a: 0.9 },
  { x: 92, y: 8, d: 38, k: 1, a: 0.75 },
  { x: 150, y: 66, d: 62, k: 2, a: 0.95 },
  { x: 48, y: 118, d: 44, k: 1, a: 0.8 },
  { x: 176, y: 150, d: 50, k: 0, a: 0.85 },
  { x: 110, y: 186, d: 34, k: 2, a: 0.7 },
  { x: 204, y: 100, d: 40, k: 0, a: 0.8 },
  { x: 70, y: 200, d: 46, k: 2, a: 0.8 },
  { x: 130, y: 120, d: 36, k: 1, a: 0.7 },
];

export class CloudShadows {
  private readonly plane = new Container({ label: 'clouds' });
  private readonly sprites: Sprite[] = [];
  private te = -1;
  /** Their drift (tiles a second): downwind of the world's prevailing wind once the shell sets it (D95). */
  private drift: readonly [number, number] = [WIND_X, WIND_Y];

  /** The way the clouds drift: the prevailing wind's (a unit vector, tile space; D95). */
  setDrift(ux: number, uy: number): void {
    const v = Math.hypot(WIND_X, WIND_Y);
    this.drift = [ux * v, uy * v];
  }

  constructor(layer: Container, textures: readonly Texture[]) {
    this.plane.blendMode = 'multiply';
    this.plane.visible = false;
    layer.addChild(this.plane);
    for (const c of SKY_CLOUDS) {
      const s = new Sprite(textures[c.k % textures.length]!);
      s.anchor.set(0.5);
      s.scale.set(c.d / CLOUD_PX);
      s.alpha = c.a;
      this.plane.addChild(s);
      this.sprites.push(s);
    }
  }

  /**
   * Per frame. (tx, ty): the camera's centre tile, so the sky wraps around wherever one looks
   * (zoomed far out the torus would show its seams: the shadows fade out below zoom 0.4);
   * seconds: world time, so the clouds drift with the world clock.
   */
  update(g: Grade, P: Lin, te: number, tx: number, ty: number, zoom: number, seconds: number): void {
    const far = zoom >= 0.42 ? 1 : zoom <= 0.3 ? 0 : (zoom - 0.3) / 0.12;
    const a = g.clouds * (1 - te) * SHADE * far;
    this.plane.visible = a > 0.01;
    if (!this.plane.visible) return;
    this.plane.alpha = a;
    if (te !== this.te) {
      this.te = te;
      this.plane.setFromMatrix(new Matrix(P.a, P.b, P.c, P.d, 0, 0));
    }
    const ox = tx - SKY / 2, oy = ty - SKY / 2;
    const dx = this.drift[0] * seconds, dy = this.drift[1] * seconds;
    for (let i = 0; i < SKY_CLOUDS.length; i++) {
      const c = SKY_CLOUDS[i]!;
      const x = ((((c.x + dx - ox) % SKY) + SKY) % SKY) + ox;
      const y = ((((c.y + dy - oy) % SKY) + SKY) % SKY) + oy;
      this.sprites[i]!.position.set(x, y);
    }
  }
}
