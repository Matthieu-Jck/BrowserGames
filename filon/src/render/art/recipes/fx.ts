// fx.ts — the art of light and weather (no Pixi, no DOM: pure Canvas2D like the other recipes).
// The base is automated — nobody lives there (owner, 2026-10-11) — so every light at night is
// a machine's: LEDs and status beacons, work lamps, landing lights, the Heart's uplink beacon;
// amber only where a machine runs hot (kilns, coal generators), cold cyan and white everywhere else.
//
// 1. **What the art bakes in.** Building sprites carry their lights (LED cores, furnace mouths,
//    landing rings, gauges: opaque fills in an LED token) and their solar cells (fills in `PV`,
//    art/solar.ts). `isoArt` / `planArt` re-run a building's own recipe on a *spy* context that
//    rasterises nothing and notes those fills: each light's bounds and colour class, each
//    cell's polygon, in sprite px from the sprite's anchor. Whatever the recipes draw — today or
//    after the next art pass — lights glow and cells change state exactly where they are drawn.
//    Cached per (building, rotation).
// 2. **Night rigs**: what a machine adds at night from its kind and footprint only (no art
//    positions): a pool of work-lamp light on the ground (amber round hot machines), the
//    Heart's pulsing uplink beacon on top (`isoHead`).
// 3. **Textures**: a white glow with a hot core (LEDs), a soft one (pools, beacons), cloud
//    blobs for the drifting cloud shadows. Tinted per sprite: one white texture, every colour.
// 4. **Sun bulbs**: flowers of mirror. At night their petals close over the dish into a bud; at
//    dawn and dusk they stand half open; in full sun the dish is open and the mirror catches a
//    white sheen. Overlays in the solar panel's own frames (iso and plan), from the dish geometry
//    of `sunDish` in buildings.ts (`BULB_DISH` mirrors its numbers: keep them in step).
// 5. **Solar cells** (the Heart's array, any panel drawn in `PV`): dark at night, a warm glint
//    at dawn and dusk, a white sheen in full sun, drawn over the cells the spy found.
import type { BuildingId } from '@/content/buildings';
import type { BuildingDef } from '@/content/types';
import type { Rot } from '@/sim/types';
import { C, mix } from '../tokens';
import { ellipsePts, flat, hatch, ink, pathOf, shape, type Ctx, type Pt } from '../ink';
import { IsoFrame } from '../iso-shapes';
import { Frame, light } from '../shapes';
import { PV } from '../solar';
import { drawBuilding, isoHead } from './buildings';
import { drawBuildingTop, TOP_MARGIN, TOP_PX } from './buildings-top';

// ── 1. what the art bakes in: lights and solar cells ─────────────────────────────

/** Colour classes of the LED tokens (lower-case hex → class). */
export type GlowClass = 'cold' | 'warm' | 'red' | 'green';
const GLOW_OF: ReadonlyMap<string, GlowClass> = new Map<string, GlowClass>([
  [C.led, 'cold'], [C.glowCyan, 'cold'], [C.glowTurq, 'cold'],
  [C.ledWarm, 'warm'], [C.glowPeach, 'warm'],
  [C.ledRed, 'red'],
  [C.ledGreen, 'green'],
]);

/** One baked light: its centre and size in sprite px from the sprite's anchor (iso: 2× world px; plan: TOP_PX per tile). */
export interface Emitter {
  x: number;
  y: number;
  w: number;
  h: number;
  glow: GlowClass;
}

/** What the spy found in a sprite: its lights and its solar cells (polygons), from the anchor. */
export interface SpriteArt {
  emitters: Emitter[];
  cells: Pt[][];
}

interface Box { x0: number; y0: number; x1: number; y1: number; glow: GlowClass }

/**
 * A Canvas2D stand-in that draws nothing and records every opaque fill in an LED colour (its
 * bounds) or in `PV` (its polygon). It follows the path (with any transform) only for that;
 * every other call is a no-op (unknown methods too, through the Proxy below).
 */
class LightSpy {
  fillStyle: unknown = '#000000';
  strokeStyle: unknown = '#000000';
  globalAlpha = 1;
  lineWidth = 1;
  lineCap = 'butt';
  lineJoin = 'miter';
  globalCompositeOperation = 'source-over';
  readonly found: Box[] = [];
  readonly cells: Pt[][] = [];
  private m = [1, 0, 0, 1, 0, 0];
  private readonly stack: Array<{ fill: unknown; alpha: number; m: number[] }> = [];
  private path: Pt[] = [];
  private x0 = Infinity;
  private y0 = Infinity;
  private x1 = -Infinity;
  private y1 = -Infinity;

  private ext(x: number, y: number, vertex = true): void {
    const [a, b, c, d, e, f] = this.m as [number, number, number, number, number, number];
    const X = a * x + c * y + e, Y = b * x + d * y + f;
    if (X < this.x0) this.x0 = X;
    if (X > this.x1) this.x1 = X;
    if (Y < this.y0) this.y0 = Y;
    if (Y > this.y1) this.y1 = Y;
    if (vertex) this.path.push([X, Y]);
  }
  save(): void { this.stack.push({ fill: this.fillStyle, alpha: this.globalAlpha, m: this.m.slice() }); }
  restore(): void {
    const s = this.stack.pop();
    if (s) { this.fillStyle = s.fill; this.globalAlpha = s.alpha; this.m = s.m; }
  }
  beginPath(): void { this.x0 = this.y0 = Infinity; this.x1 = this.y1 = -Infinity; this.path = []; }
  moveTo(x: number, y: number): void { this.ext(x, y); }
  lineTo(x: number, y: number): void { this.ext(x, y); }
  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void { this.ext(cx, cy, false); this.ext(x, y); }
  bezierCurveTo(ax: number, ay: number, bx: number, by: number, x: number, y: number): void { this.ext(ax, ay, false); this.ext(bx, by, false); this.ext(x, y); }
  arc(x: number, y: number, r: number): void { this.ext(x - r, y - r, false); this.ext(x + r, y + r, false); }
  ellipse(x: number, y: number, rx: number, ry: number): void { const r = Math.max(rx, ry); this.ext(x - r, y - r, false); this.ext(x + r, y + r, false); }
  rect(x: number, y: number, w: number, h: number): void { this.ext(x, y); this.ext(x + w, y); this.ext(x + w, y + h); this.ext(x, y + h); }
  closePath(): void {}
  translate(x: number, y: number): void { this.transform(1, 0, 0, 1, x, y); }
  scale(x: number, y: number): void { this.transform(x, 0, 0, y, 0, 0); }
  rotate(t: number): void { const c = Math.cos(t), s = Math.sin(t); this.transform(c, s, -s, c, 0, 0); }
  transform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    const [A, B, Cc, D, E, F] = this.m as [number, number, number, number, number, number];
    this.m = [A * a + Cc * b, B * a + D * b, A * c + Cc * d, B * c + D * d, A * e + Cc * f + E, B * e + D * f + F];
  }
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void { this.m = [a, b, c, d, e, f]; }
  resetTransform(): void { this.m = [1, 0, 0, 1, 0, 0]; }
  fill(): void {
    if (this.globalAlpha < 0.95 || typeof this.fillStyle !== 'string' || this.x1 < this.x0) return;
    const style = this.fillStyle.toLowerCase();
    if (style === PV) { if (this.path.length >= 3) this.cells.push(this.path.slice()); return; }
    const glow = GLOW_OF.get(style);
    if (glow) this.found.push({ x0: this.x0, y0: this.y0, x1: this.x1, y1: this.y1, glow });
  }
  fillRect(x: number, y: number, w: number, h: number): void { this.beginPath(); this.rect(x, y, w, h); this.fill(); }
  createLinearGradient(): { addColorStop(): void } { return { addColorStop() {} }; }
  createRadialGradient(): { addColorStop(): void } { return { addColorStop() {} }; }
  createConicGradient(): { addColorStop(): void } { return { addColorStop() {} }; }
  createPattern(): null { return null; }
  // Readers a recipe might use (text, pixels, transform): plausible values, never a throw.
  measureText(text: string): { width: number; actualBoundingBoxAscent: number; actualBoundingBoxDescent: number } {
    return { width: String(text).length * 6, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 };
  }
  getImageData(_x: number, _y: number, w: number, h: number): { data: Uint8ClampedArray; width: number; height: number } {
    const W = Math.max(1, Math.floor(w)), H = Math.max(1, Math.floor(h));
    return { data: new Uint8ClampedArray(W * H * 4), width: W, height: H };
  }
  getTransform(): { a: number; b: number; c: number; d: number; e: number; f: number } {
    const [a, b, c, d, e, f] = this.m as [number, number, number, number, number, number];
    return { a, b, c, d, e, f };
  }
  isPointInPath(): boolean { return false; }
}

/** Recipes whose spy run failed (warned once each). */
const failed = new Set<string>();

/**
 * Run a drawing on a spy context; returns what it filled in LED colours and in `PV`. A recipe
 * that throws on the spy (a canvas call it cannot stand in for) costs that sprite its lights,
 * never the frame: the error is reported once and the sprite gets no night lights.
 */
function spy(draw: (ctx: Ctx) => void, what = '?'): LightSpy {
  const s = new LightSpy();
  try {
    run(s, draw);
  } catch (err) {
    if (!failed.has(what)) { failed.add(what); console.warn(`fx: no night lights for ${what}:`, err); }
    s.found.length = 0;
    s.cells.length = 0;
  }
  return s;
}

function run(s: LightSpy, draw: (ctx: Ctx) => void): void {
  const noop = (): undefined => undefined;
  const ctx = new Proxy(s, {
    get(t, k, r): unknown {
      if (k in t) { const v = Reflect.get(t, k, r) as unknown; return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(t) : v; }
      return noop;
    },
    set(t, k, v): boolean { (t as unknown as Record<string | symbol, unknown>)[k] = v; return true; },
  });
  draw(ctx as unknown as Ctx);
}

/** Spy results relative to the anchor; near-duplicate lights (the same light drawn twice) merge. */
function toArt(s: LightSpy, ox: number, oy: number): SpriteArt {
  const emitters: Emitter[] = [];
  for (const b of s.found) {
    const e: Emitter = { x: (b.x0 + b.x1) / 2 - ox, y: (b.y0 + b.y1) / 2 - oy, w: b.x1 - b.x0, h: b.y1 - b.y0, glow: b.glow };
    if (emitters.some((o) => o.glow === e.glow && Math.abs(o.x - e.x) < 2 && Math.abs(o.y - e.y) < 2 && Math.abs(o.w - e.w) < 3)) continue;
    emitters.push(e);
  }
  const cells = s.cells.map((poly) => poly.map(([x, y]) => [x - ox, y - oy] as Pt));
  return { emitters, cells };
}

/** What a drawing bakes in (its lights and solar cells), relative to (ox, oy): the spy on any drawing. */
export function artOf(draw: (ctx: Ctx) => void, ox = 0, oy = 0): SpriteArt {
  return toArt(spy(draw), ox, oy);
}

const isoCache = new Map<string, SpriteArt>();
const planCache = new Map<string, SpriteArt>();

/** The lights and solar cells baked into a building's iso sprite (at its look's level `lv`, D86), in atlas px (2× world) from its anchor. */
export function isoArt(id: BuildingId, rot: Rot, lv = 1): SpriteArt {
  const key = `${id}:${rot}:${lv}`;
  let art = isoCache.get(key);
  if (!art) {
    let ox = 0, oy = 0;
    const s = spy((ctx) => {
      const { frame } = drawBuilding(id, rot, () => ({ ctx, canvas: null }), lv);
      ox = frame.ox; oy = frame.oy;
    }, `b:${key}`);
    art = toArt(s, ox, oy);
    isoCache.set(key, art);
  }
  return art;
}

/** The lights and solar cells baked into a building's plan sprite (at its look's level `lv`), in atlas px (TOP_PX per tile) from its footprint's top-left. */
export function planArt(id: BuildingId, rot: Rot, lv = 1): SpriteArt {
  const key = `${id}:${rot}:${lv}`;
  let art = planCache.get(key);
  if (!art) {
    art = toArt(spy((ctx) => { drawBuildingTop(id, rot, () => ({ ctx, canvas: null }), lv); }, `bt:${key}`), TOP_MARGIN, TOP_MARGIN);
    planCache.set(key, art);
  }
  return art;
}

// ── 2. night rigs: what a machine adds at night, from its kind and footprint ─────

/** Machines that run hot: their lights and work lamps are amber; every other light is cold. */
export const HOT: ReadonlySet<BuildingId> = new Set<BuildingId>(['kiln', 'kiln_compact', 'brazier', 'ceramic_oven', 'sunheart', 'fumarole_tap', 'arc_furnace', 'forge_press']);

export interface NightRig {
  /** A pool of work-lamp light on the ground round the footprint: radius (tiles), strength; amber when hot. */
  pool?: { r: number; alpha: number; warm: boolean };
  /** A beacon (the Heart's uplink to Verrière), pulsing on the art's highest light — or, with none, at this share of `isoHead` — size (tiles across), strength. */
  beacon?: { at: number; d: number; alpha: number };
}

/**
 * The night rig of a building, from its kind and size only (the art is redrawn freely): the
 * Heart floodlit with its uplink beacon, landing pads (skydock, trade post) floodlit, hot
 * machines in an amber pool, other big machines in a faint cold one; small blocks, ribbons,
 * masts and the solar bulbs (asleep at night) get none.
 */
export function nightRig(id: BuildingId, def: BuildingDef): NightRig {
  const big = Math.max(def.w, def.h);
  if (def.kind === 'hearth') return { pool: { r: big * 0.86, alpha: 0.34, warm: false }, beacon: { at: 1, d: 2.4, alpha: 0.95 } };
  if (HOT.has(id)) return { pool: { r: big * 0.8, alpha: 0.32, warm: true } };
  switch (def.kind) {
    case 'dock':
      return { pool: { r: big * 0.78, alpha: 0.3, warm: false } };
    case 'trade': // the pad, not its scorched apron (D62): the 3 × 3 in the middle of the 5 × 5
      return { pool: { r: (big - 2) * 0.78, alpha: 0.3, warm: false } };
    case 'drill': case 'excavator': case 'backfiller': case 'machine': case 'lab': case 'storage':
    case 'generator': case 'geothermal': case 'accumulator':
      return big >= 2 ? { pool: { r: big * 0.62, alpha: 0.15, warm: false } } : {};
    default:
      return {};
  }
}

// ── 3. textures ─────────────────────────────────────────────────────────────────

/** A white glow: a hot core and a long soft falloff (LEDs; tinted per sprite, drawn additively). */
export function drawGlow(ctx: Ctx, size: number): void {
  const r = size / 2;
  const g = ctx.createRadialGradient(r, r, 0, r, r, r);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.09, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.2, 'rgba(255,255,255,0.52)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.2)');
  g.addColorStop(0.7, 'rgba(255,255,255,0.06)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
}

/** A white haze without a core (work-lamp pools on the ground, beacons). */
export function drawSoft(ctx: Ctx, size: number): void {
  const r = size / 2;
  const g = ctx.createRadialGradient(r, r, 0, r, r, r);
  g.addColorStop(0, 'rgba(255,255,255,0.85)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.6)');
  g.addColorStop(0.7, 'rgba(255,255,255,0.2)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
}

/**
 * A cloud's shadow seen from above: a few overlapping soft lobes in a lilac ink, the darkest
 * in the middle (drawn on the ground with a multiply blend). Deterministic per seed.
 */
export function drawCloud(ctx: Ctx, size: number, seed: number): void {
  let s = seed >>> 0;
  const rnd = (): number => { s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0; return s / 4294967296; };
  const tone = mix(C.steelL, C.lilac, 0.3); // a cool blue-violet: shaded sand cools, never greys
  const n = 6 + Math.floor(rnd() * 3);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rnd() * 0.6;
    const d = size * (0.12 + rnd() * 0.14);
    const cx = size / 2 + Math.cos(a) * d * 1.25, cy = size / 2 + Math.sin(a) * d * 0.8;
    const r = size * (0.16 + rnd() * 0.1);
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, `${tone}cc`);
    g.addColorStop(0.55, `${tone}66`);
    g.addColorStop(1, `${tone}00`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size * 0.3);
  g.addColorStop(0, `${tone}99`);
  g.addColorStop(1, `${tone}00`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
}

// ── 4. solar states: the solar panel's petals ─────────────────────────────────────

/** Overlay stages: 0 closed bud (night), 1 half open (dawn, dusk), 2 open (nothing to add), 3 open in full sun (sheen). */
export type SolarStage = 0 | 1 | 2 | 3;
export const SOLAR_STAGES: readonly SolarStage[] = [0, 1, 3];

/** The solar panel's dish in its own tile frame — mirrors `sunDish(ctx, f, 0.95, 0.95, 1.55, 0.86)` in buildings.ts. */
export const BULB_DISH = { cx: 0.95, cy: 0.95, cz: 1.55, R: 0.86, tilt: [-0.25, 0.12] as const };
/** The plan sprite's dish (buildings-top.ts: centre (0.92, 0.95), radius 0.84, ellipse 1 × 0.9 turned −0.35). */
export const BULB_TOP = { cx: 0.92, cy: 0.95, R: 0.84, squash: 0.9, turn: -0.35 };
const PETALS = 8;

type V3 = [number, number, number];
const norm = (v: V3): V3 => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

/** The local direction a rotation turns into the screen-fixed rotated direction (rx, ry) (as in buildings.ts). */
function facingDir(rot: Rot, rx: number, ry: number): [number, number] {
  switch (rot) {
    case 0: return [rx, ry];
    case 1: return [ry, -rx];
    case 2: return [-rx, -ry];
    default: return [-ry, rx];
  }
}

/** Petal colours: violet enamel over steel, pale on the side the light comes from, hatched in the shade. */
const PETAL = mix(C.violet, C.steel, 0.45), PETAL_LIT = mix(C.violetL, C.ice, 0.25), PETAL_SHADE = mix(C.violet, C.steelD, 0.45);
const PETAL_EDGE = mix(C.violetL, C.ice, 0.55);

/** The iso frame of a building's sprite (same canvas size and anchor as its atlas frame). */
export function isoFrameOf(id: BuildingId, w: number, h: number, rot: Rot): IsoFrame {
  return new IsoFrame(w, h, rot, isoHead(id));
}

/** A four-point sparkle (the sun caught in a mirror). */
function sparkle(ctx: Ctx, x: number, y: number, r: number, alpha = 0.95): void {
  const w = r * 0.18;
  flat(ctx, [[x, y - r], [x + w, y - w], [x + r, y], [x + w, y + w], [x, y + r], [x - w, y + w], [x - r, y], [x - w, y - w]], '#ffffff', alpha);
  flat(ctx, ellipsePts(x, y, r * 0.32, r * 0.32, 3, 0, 12), '#ffffff', alpha);
}

/**
 * The solar panel's state over its iso sprite (stage 2 draws nothing). The frame must be the
 * bulb's own (`isoFrameOf('sun_bulb', …)`), so the overlay lines up with the dish. Petals
 * hinge on the dish's rim: closed (0) they rise into a pointed bud over the receiver, half open
 * (1) they stand out from the rim like a tulip's, open (2) they lie folded under the dish.
 */
export function drawBulbIso(ctx: Ctx, f: IsoFrame, stage: SolarStage, s = 7): void {
  if (stage === 2) return;
  const { cx, cy, cz, R } = BULB_DISH;
  const [hx, hy] = facingDir(f.rot, BULB_DISH.tilt[0], BULB_DISH.tilt[1]);
  const n = norm([hx, hy, 1]);
  const u = norm([-n[1], n[0], 0]);
  const v: V3 = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
  const czt = cz / 2; // tiles (2 levels per tile): the dish is round in 3D
  const P = (q: V3): Pt => f.p(q[0], q[1], q[2] * 2);
  const dirAt = (a: number): V3 => [Math.cos(a) * u[0] + Math.sin(a) * v[0], Math.cos(a) * u[1] + Math.sin(a) * v[1], Math.cos(a) * u[2] + Math.sin(a) * v[2]];
  const tanAt = (a: number): V3 => [-Math.sin(a) * u[0] + Math.cos(a) * v[0], -Math.sin(a) * u[1] + Math.cos(a) * v[1], -Math.sin(a) * u[2] + Math.cos(a) * v[2]];
  const add = (p: V3, d: V3, k: number): V3 => [p[0] + d[0] * k, p[1] + d[1] * k, p[2] + d[2] * k];
  const C0: V3 = [cx, cy, czt];
  const rim = (a: number): V3 => add(C0, dirAt(a), R);
  const F = add(C0, n, 0.62); // the receiver (the "bulb") at the focus
  const rimPts = Array.from({ length: 48 }, (_, i) => P(rim((i / 48) * Math.PI * 2)));

  if (stage === 3) {
    // Full sun: two bright bands across the mirror, sparkles, the receiver blazing white.
    ctx.save(); pathOf(ctx, rimPts); ctx.clip();
    const a = P(add(C0, dirAt(Math.PI * 0.8), R * 1.1)), b = P(add(C0, dirAt(-Math.PI * 0.2), R * 1.1));
    const off = (p: Pt, k: number): Pt => [p[0] + k, p[1] - k * 0.5];
    ink(ctx, [off(a, -10), off(b, -10)], { w: 16, color: '#ffffff', alpha: 0.55, shade: false, taper: 0.25, jitter: 0, seed: s });
    ink(ctx, [off(a, 14), off(b, 14)], { w: 6, color: '#ffffff', alpha: 0.45, shade: false, taper: 0.25, jitter: 0, seed: s + 1 });
    ctx.restore();
    const g1 = P(add(C0, dirAt(Math.PI * 0.85), R * 0.55)), g2 = P(add(C0, dirAt(Math.PI * 1.35), R * 0.7));
    sparkle(ctx, g1[0], g1[1], 11);
    sparkle(ctx, g2[0], g2[1], 6, 0.8);
    const [fx, fy] = P(F);
    flat(ctx, ellipsePts(fx, fy, 30, 30, s + 2, 0, 24), C.glowPeach, 0.28);
    flat(ctx, ellipsePts(fx, fy, 17, 17, s + 3, 0, 20), '#ffffff', 0.5);
    sparkle(ctx, fx, fy, 15);
    return;
  }

  const closed = stage === 0;
  const tip = add(C0, n, R * 1.3);
  const W0 = R * Math.sin(Math.PI / PETALS) * 1.12; // half a petal's width at the hinge (they overlap a little)
  /** A point of petal i: t along it (0 hinge … 1 tip), s across (−1 … 1). */
  const pt = (am: number, t: number, sx: number): V3 => {
    const out = dirAt(am), side = tanAt(am);
    let c: V3, w: number;
    if (closed) {
      // A tulip bud: the rib from the rim to the tip, bulging out most at a third of its length.
      c = add(add(rim(am), [tip[0] - rim(am)[0], tip[1] - rim(am)[1], tip[2] - rim(am)[2]], t), out, R * 0.42 * Math.sin(Math.PI * t) * (1 - t));
      w = W0 * (1 - t) * (1 + 0.35 * Math.sin(Math.PI * t));
    } else {
      // Half open: straight out of the rim, leaning 40° out, a pointed leaf 0.7 R long.
      const L = R * 0.7;
      c = add(add(rim(am), n, L * 0.77 * t), out, L * 0.64 * t);
      w = W0 * Math.pow(1 - t, 0.85) * (1 + 0.5 * Math.sin(Math.PI * t));
    }
    return add(c, side, w * sx);
  };
  const petals = Array.from({ length: PETALS }, (_, i) => {
    const am = ((i + 0.5) / PETALS) * Math.PI * 2;
    const k = 10, pts: Pt[] = [];
    for (let j = 0; j <= k; j++) pts.push(P(pt(am, j / k, -1)));
    for (let j = k - 1; j >= 0; j--) pts.push(P(pt(am, j / k, 1)));
    const mid = pt(am, 0.4, 0);
    // Lit when it faces the light, which comes from the rotated −x (and a little −y).
    const d = dirAt(am), [r0x, r0y] = f.r(0, 0), [r1x, r1y] = f.r(d[0], d[1]);
    const facing = (r1x - r0x) + 0.45 * (r1y - r0y);
    const rib: Pt[] = Array.from({ length: 8 }, (_, j) => P(pt(am, 0.06 + (j / 7) * 0.8, 0)));
    return { pts, rib, depth: f.depth(mid[0], mid[1]) + mid[2] * 0.15, facing };
  }).sort((p, q) => p.depth - q.depth);
  if (!closed) {
    // The receiver stays in sight inside the crown, dimmed: the sun is low.
    const [fx, fy] = P(F);
    flat(ctx, ellipsePts(fx, fy, 14, 14, s + 3, 0, 20), C.glowPeach, 0.2);
  }
  for (const [i, p] of petals.entries()) {
    const col = p.facing < -0.25 ? PETAL_LIT : p.facing > 0.35 ? PETAL_SHADE : PETAL;
    shape(ctx, p.pts, col, { w: 1.9, seed: s + 10 + i });
    if (p.facing > 0) hatch(ctx, p.pts, Math.PI / 3, 3.2, { alpha: 0.3, seed: s + 20 + i });
    ink(ctx, p.rib, { w: 1.1, color: PETAL_EDGE, alpha: 0.6, shade: false, taper: 0.3, jitter: 0, seed: s + 30 + i });
  }
  if (closed) {
    // The bud's tip and its status light.
    const [tx, ty] = P(tip);
    light(ctx, tx, ty - 1, 2.2, C.ledGreen);
  }
}

/** The solar panel's state over its plan sprite (stage 2 draws nothing). */
export function drawBulbPlan(ctx: Ctx, f: Frame, stage: SolarStage, s = 9): void {
  if (stage === 2) return;
  const c = f.p(BULB_TOP.cx, BULB_TOP.cy), R = f.l(BULB_TOP.R);
  const turn = (x: number, y: number): Pt => {
    const t = BULB_TOP.turn;
    return [c[0] + x * Math.cos(t) - y * Math.sin(t), c[1] + x * Math.sin(t) + y * Math.cos(t)];
  };
  const at = (a: number, rho: number): Pt => turn(Math.cos(a) * R * rho, Math.sin(a) * R * BULB_TOP.squash * rho);
  if (stage === 3) {
    const rim = Array.from({ length: 48 }, (_, i) => at((i / 48) * Math.PI * 2, 0.93));
    ctx.save(); pathOf(ctx, rim); ctx.clip();
    ink(ctx, [at(Math.PI * 0.75, 1), at(-Math.PI * 0.25, 1)], { w: 10, color: '#ffffff', alpha: 0.55, shade: false, taper: 0.25, jitter: 0, seed: s });
    ink(ctx, [at(Math.PI * 0.62, 1), at(-Math.PI * 0.38, 1)], { w: 4, color: '#ffffff', alpha: 0.4, shade: false, taper: 0.25, jitter: 0, seed: s + 1 });
    ctx.restore();
    const g = at(Math.PI * 1.2, 0.5);
    sparkle(ctx, g[0], g[1], 8);
    flat(ctx, ellipsePts(c[0], c[1], R * 0.25, R * 0.25, s + 2, 0, 20), C.glowPeach, 0.3);
    sparkle(ctx, c[0], c[1], 10);
    return;
  }
  // From above, petals are pointed leaves from the rim: meeting at the centre when closed (a
  // star of overlapping petals), leaning out past the rim when half open.
  const closed = stage === 0;
  const order = Array.from({ length: PETALS }, (_, i) => i).sort((a, b) => Math.sin(((a + 0.5) / PETALS) * Math.PI * 2) - Math.sin(((b + 0.5) / PETALS) * Math.PI * 2));
  for (const i of order) {
    const am = ((i + 0.5) / PETALS) * Math.PI * 2, half = (Math.PI / PETALS) * 1.12;
    const pts: Pt[] = [];
    const k = 8;
    if (closed) {
      // Wedges that keep their angle (so the bud stays shut) and only come to a point at the centre.
      for (let j = 0; j <= k; j++) { const t = j / k; pts.push(at(am - half * (1 - t ** 4), 1 - t)); }
      for (let j = k - 1; j > 0; j--) { const t = j / k; pts.push(at(am + half * (1 - t ** 4), 1 - t)); }
    } else {
      for (let j = 0; j <= k; j++) { const t = j / k; pts.push(at(am - half * Math.pow(1 - t, 0.85) * (1 + 0.5 * Math.sin(Math.PI * t)), 1 + 0.45 * t)); }
      for (let j = k - 1; j >= 0; j--) { const t = j / k; pts.push(at(am + half * Math.pow(1 - t, 0.85) * (1 + 0.5 * Math.sin(Math.PI * t)), 1 + 0.45 * t)); }
    }
    const dx = Math.cos(am + BULB_TOP.turn), dy = Math.sin(am + BULB_TOP.turn);
    const facing = dx + dy; // the light comes from the top-left
    shape(ctx, pts, facing < -0.4 ? PETAL_LIT : facing > 0.5 ? PETAL_SHADE : PETAL, { w: 1.6, seed: s + 10 + i });
    if (facing > 0.2) hatch(ctx, pts, Math.PI / 4, 3.2, { alpha: 0.28, seed: s + 20 + i });
    ink(ctx, [at(am, closed ? 0.92 : 1.02), at(am, closed ? 0.12 : 1.35)], { w: 1, color: PETAL_EDGE, alpha: 0.55, shade: false, taper: 0.3, jitter: 0, seed: s + 30 + i });
  }
  if (closed) light(ctx, c[0], c[1], f.l(0.035), C.ledGreen);
  else flat(ctx, ellipsePts(c[0], c[1], R * 0.2, R * 0.2, s + 40, 0, 20), C.glowPeach, 0.2);
}

// ── 5. solar cells: the state of any panel drawn in PV ───────────────────────────

/** Night film over the cells (asleep, no reflection) and the warm glint of a low sun. */
const PV_NIGHT = mix(C.steelDD, C.violet, 0.18);

/**
 * The state of a sprite's solar cells (stage 2 draws nothing). `cells` are polygons in this
 * canvas's px (already offset); the sheen and glints are clipped to them, so they follow any
 * array the art draws.
 */
export function drawPvState(ctx: Ctx, cells: readonly Pt[][], stage: SolarStage, s = 13): void {
  if (stage === 2 || cells.length === 0) return;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const c of cells) for (const [x, y] of c) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  if (stage === 0) {
    for (const c of cells) flat(ctx, c, PV_NIGHT, 0.6);
    return;
  }
  // Clip to every cell, then sweep a band (white in full sun, peach when the sun is low).
  ctx.save();
  ctx.beginPath();
  for (const c of cells) { ctx.moveTo(c[0]![0], c[0]![1]); for (let i = 1; i < c.length; i++) ctx.lineTo(c[i]![0], c[i]![1]); ctx.closePath(); }
  ctx.clip();
  const w = x1 - x0, h = y1 - y0, L = Math.hypot(w, h);
  // A glare rising to the right across the array; k slides it from the top-left corner down.
  const band = (k: number, width: number, color: string, alpha: number, seed: number): void => {
    const p0: Pt = [x0 - w * 0.1, y0 + h * (k + 0.55)], p1: Pt = [x1 + w * 0.1, y0 + h * (k - 0.45)];
    ink(ctx, [p0, p1], { w: width, color, alpha, shade: false, taper: 0.2, jitter: 0, seed });
  };
  if (stage === 1) {
    flat(ctx, [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], C.glowPeach, 0.16);
    band(0.35, Math.max(3, L * 0.05), C.glowPeach, 0.55, s);
  } else {
    band(0.3, Math.max(6, L * 0.1), '#ffffff', 0.5, s);
    band(0.55, Math.max(2.5, L * 0.035), '#ffffff', 0.45, s + 1);
  }
  ctx.restore();
  if (stage === 3) {
    const sx = x0 + w * 0.32, sy = y0 + h * 0.3;
    sparkle(ctx, sx, sy, Math.max(5, Math.min(12, L * 0.08)));
  }
}

/** The plan frame of a building's sprite (same canvas size and anchor as its atlas frame). */
export function planFrameOf(w: number, h: number, rot: Rot): Frame {
  return new Frame(TOP_PX, TOP_MARGIN, w, h, rot);
}
