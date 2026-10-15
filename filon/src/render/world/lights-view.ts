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
//   ground, and on the Heart a pulsing uplink beacon. A building standing on the mountains (D44)
//   has its lights lifted with it, onto the rock top (world/stand.ts). One iso container (under
//   M, faded with the volumes) and one plan container (under P, fainter). Built on structural changes only,
//   from pooled sprites; per frame only the layer's alpha (the night factor: one render-group
//   uniform), the beacon's pulse, the incinerators' fire (a glow over each pit and up its flame,
//   bright as an item burns: world/pits.ts) and, during a morph, two transforms. A production
//   building that does not work is dark (D83): its glows and its work lamp hidden while the
//   buildings view's `WorkLook` says it is switched off — re-applied only when a look flips.
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
  drawBulbIso, drawBulbPlan, drawCloud, drawGlow, drawPvState, drawSoft, HOT, isoArt, isoFrameOf, nightRig, planArt, planFrameOf,
  SOLAR_STAGES, type Emitter, type GlowClass, type SolarStage,
} from '../art/recipes/fx';
import type { Grade } from '../daynight';
import { tileToIso } from '../iso';
import { isoToView, type Lin } from '../projection';
import { buildingZ, standOf } from './stand';
import { pitFire } from './pits';
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

export class LightsView {
  /** Iso glows (iso world px, under M) and plan glows (tile units, under P). */
  private readonly iso = new Container({ label: 'lights:iso' });
  private readonly plan = new Container({ label: 'lights:plan' });
  private readonly sheet: FxSheet;
  private isoPool: Sprite[] = [];
  private planPool: Sprite[] = [];
  private nIso = 0;
  private nPlan = 0;
  private overlays: Overlay[] = [];
  /** Beacons (pulsing): their sprites and base strength. */
  private beacons: Array<{ s: Sprite; a: number }> = [];
  /** The incinerators' fire: each pit's glows and their full strength (× the fire's heat); the colony they burn in. */
  private pits: Array<{ ent: number; glows: Array<{ s: Sprite; a: number }> }> = [];
  private sim: Sim | null = null;
  private te = -1;
  private stage = -1;
  /** Entities left dark (no glows, no solar overlay) from the next rebuild on: the intro's Heart until it lands (D31). */
  readonly hidden = new Set<number>();
  /** Which production buildings work (the buildings view's): a switched-off one shows no light (D83). */
  work: WorkLook | null = null;
  /** Each watched building's glows (its run of each pool) and whether they show; the look version applied. */
  private groups: Array<{ ent: number; i0: number; i1: number; p0: number; p1: number; on: boolean }> = [];
  private workVer = -1;

  constructor(
    private readonly layer: Container,
    private readonly objectLayer: Container,
    private readonly planLayer: Container,
    private readonly atlas: Atlas,
  ) {
    layer.blendMode = 'add';
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
   * Rebuild every light and overlay from the colony (on structural changes), after the buildings
   * view: a building's stand (how high it stands, how it sorts) is the one that view worked out.
   */
  rebuild(sim: Sim): void {
    this.nIso = 0;
    this.nPlan = 0;
    this.beacons = [];
    this.pits = [];
    this.groups = [];
    this.workVer = -1; // applied below, then on every flip
    this.sim = sim;
    for (const o of this.overlays) o.s.destroy();
    this.overlays = [];
    for (const e of sim.ents.sorted()) {
      const kind = BUILDING_KIND[e.def]!;
      if (kind === 'belt' || kind === 'conduit' || e.builtAt !== 0 || sim.isDormant(e) || this.hidden.has(e.id)) continue;
      const i0 = this.nIso, p0 = this.nPlan;
      this.addBuilding(e);
      if (looksAtWork(e.def) && (this.nIso > i0 || this.nPlan > p0)) this.groups.push({ ent: e.id, i0, i1: this.nIso, p0, p1: this.nPlan, on: true });
    }
    for (let i = this.nIso; i < this.isoPool.length; i++) this.isoPool[i]!.visible = false;
    for (let i = this.nPlan; i < this.planPool.length; i++) this.planPool[i]!.visible = false;
    this.sheet.flush();
    this.stage = -1;
  }

  private sprite(view: 'i' | 'p', key: 'glow' | 'soft'): Sprite {
    const pool = view === 'i' ? this.isoPool : this.planPool;
    const n = view === 'i' ? this.nIso++ : this.nPlan++;
    let s = pool[n];
    if (!s) {
      s = new Sprite();
      s.anchor.set(0.5);
      (view === 'i' ? this.iso : this.plan).addChild(s);
      pool.push(s);
    }
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
      const r = rig.pool.r, color = rig.pool.warm ? POOL_WARM : POOL_COLD;
      // A ground circle of radius r tiles is an ellipse r·√2·32 by r·√2·16 world px in iso.
      this.glow('i', 'soft', X, Y, r * Math.SQRT2 * 64, r * Math.SQRT2 * 32, color, rig.pool.alpha);
      this.glow('p', 'soft', e.x + w / 2, e.y + h / 2, r * 2, r * 2, color, rig.pool.alpha * 0.8);
    }
    if (rig.beacon) {
      // On the art's highest light (the uplink mast's tip), else at the top of the head room.
      let top: Emitter | null = null;
      for (const em of isoA.emitters) if (!top || em.y < top.y) top = em;
      let X: number, Y: number;
      if (top) { X = ax + top.x * 0.5; Y = ay + top.y * 0.5; } else {
        const [cx, cy] = rotLocal(def.w, def.h, rotI, def.w / 2, def.h / 2);
        [X, Y] = tileToIso(e.x + cx, e.y + cy, lv + isoHead(id) * rig.beacon.at);
      }
      const d = rig.beacon.d * Math.SQRT2 * 32;
      const core = this.glow('i', 'glow', X, Y, d * 0.35, d * 0.35, BEACON, 1);
      const halo = this.glow('i', 'soft', X, Y, d, d, BEACON, rig.beacon.alpha * 0.6);
      this.beacons.push({ s: core, a: 1 }, { s: halo, a: rig.beacon.alpha * 0.6 });
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
      this.pits.push({ ent: e.id, glows });
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

  /** An overlay sprite above a building (iso: in `objects` at zIndex z; plan: on `plan`). */
  private overlay(ent: number, view: 'i' | 'p', keys: ReadonlyArray<string | null>, x: number, y: number, k: number, z: number): void {
    if (!keys.some((key) => key !== null && !!this.sheet.get(key))) return;
    const s = new Sprite();
    s.scale.set(k);
    s.visible = false;
    if (view === 'i') { s.zIndex = z; this.objectLayer.addChild(s); } else this.planLayer.addChild(s);
    this.overlays.push({ ent, s, keys, x, y, k });
  }

  /**
   * The switched-off buildings' glows hidden, the working ones' shown (D83), when a look has
   * flipped since the last call: one pass over the watched buildings' groups, writing only those
   * that changed.
   */
  private lookAtWork(): void {
    const w = this.work;
    if (!w || w.version === this.workVer) return;
    this.workVer = w.version;
    for (const g of this.groups) {
      const on = w.isLit(g.ent);
      if (on === g.on) continue;
      g.on = on;
      for (let i = g.i0; i < g.i1; i++) this.isoPool[i]!.visible = on;
      for (let i = g.p0; i < g.p1; i++) this.planPool[i]!.visible = on;
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
    if (this.layer.visible && this.beacons.length) {
      const pulse = 1 - PULSE + PULSE * (0.5 + 0.5 * Math.sin((seconds * 2 * Math.PI) / PULSE_S));
      for (const b of this.beacons) b.s.alpha = b.a * pulse;
    }
    if (this.layer.visible && this.pits.length && this.sim) {
      // The fire as the buildings view last stepped it (the frame before): a smoulder, then the flare.
      const fire = pitFire(this.sim);
      for (const p of this.pits) {
        const k = 0.12 + 0.88 * fire.heat(p.ent);
        for (const g of p.glows) g.s.alpha = g.a * k;
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
    const dx = WIND_X * seconds, dy = WIND_Y * seconds;
    for (let i = 0; i < SKY_CLOUDS.length; i++) {
      const c = SKY_CLOUDS[i]!;
      const x = ((((c.x + dx - ox) % SKY) + SKY) % SKY) + ox;
      const y = ((((c.y + dy - oy) % SKY) + SKY) % SKY) + oy;
      this.sprites[i]!.position.set(x, y);
    }
  }
}
