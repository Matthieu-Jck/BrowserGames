// pit-burst.ts — the incinerator's burst (D125; owner, 2026-10-18: « l'incinérateur doit avoir une
// petite animation quand il brûle quelque chose »): what one item burning in a pit throws up, as pure
// geometry the views project. When an item falls into the fire (world/pits.ts `PitFire` says when,
// for a ribbon's item and for one a routing block or a machine hands straight in), the flame flares
// and a burst begins:
//
// - **sparks** (`BURST.sparks`): leap out of the throat on ballistic arcs — up fast, scattering round
//   the pit, slowing, fading out as they peak. The first two are hot (pale yellow, untinted), the
//   others cinders in the burnt item's colour at full brightness (`burstTints`: copper ore throws
//   orange cinders, slag dusky ones), a flame test of sorts;
// - **a puff of smoke** (one): rises from the flame's tip a beat after the flare, swells, drifts a
//   little to the right (as the boiler's plume, the light's way) and thins out, tinted by the item;
// - **the flame's tip** tinted towards the item's colour for the first half second (`flameTint`).
//
// Everything is in the pit's local frame: x, y in tiles from its centre, z in levels above the
// ground; the iso view projects it with tileToIso, the plan view lays x, y flat (z lifts it a little
// towards the top of the map, the plan's hint of height). Times are in ticks since the burst began
// (fractional: the render tick). The scatter comes from a hash of the burst's seed (the pit's entity
// and the tick the item went in), never Math.random: the same burst looks the same on every screen
// and on every frame. Nothing here allocates: the views pass their own scratch records.
import { ITEMS } from '@/content/items';
import { ITEM_IDS } from '@/content/registry';
import { mix } from '../art/tokens';
import { PIT } from '../art/recipes/buildings';

/**
 * The burst's numbers (ticks, at 10 a second): bursts drawn at once in one pit (`slots`: the next
 * takes the oldest's), sparks per burst (the first `hot` untinted), the least time between two
 * bursts (a fall sooner only feeds the flame: a fast line burns steadily, PitFire's `steadyHeat`),
 * the sparks' life, the puff's delay after the flare and its life.
 */
export const BURST = { slots: 3, sparks: 4, hot: 2, gap: 5, sparkLife: 8, puffDelay: 1.5, puffLife: 13.5 } as const;
/** How long a burst shows anything (ticks). */
export const BURST_LIFE = Math.max(BURST.sparkLife, BURST.puffDelay + BURST.puffLife);
/** For how long the flame's tip keeps the item's tint after a burst begins (ticks). */
export const FLAME_TINT_TICKS = 5;
/** Plan: how far up the map a level of height lifts a spark or the puff (tiles). */
export const PLAN_LIFT = 0.12;

/** A burst's seed: its pit and the tick its item went in (stable from frame to frame). */
export const burstSeed = (ent: number, tick: number): number =>
  (Math.imul(ent | 0, 0x9e3779b1) ^ Math.imul((Math.floor(tick) + 0x6b43) | 0, 0x85ebca6b)) >>> 0;

/** A uniform number in [0, 1) from a seed and two small indices (a 32-bit avalanche hash). */
export function hash01(seed: number, k: number, j: number): number {
  let h = (seed ^ Math.imul(k + 1, 0x9e3779b1) ^ Math.imul(j + 7, 0xc2b2ae35)) | 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** A spark's state: where (tiles, levels), its velocity (per tick), its alpha and size (× the texture's). */
export interface SparkAt { x: number; y: number; z: number; vx: number; vy: number; vz: number; a: number; s: number }
/** The puff's state: where (tiles, levels), its size (× the texture's) and alpha. */
export interface PuffAt { x: number; y: number; z: number; s: number; a: number }

/** Where sparks start: just under the collar's top, in the throat's mouth (levels). */
const Z0 = PIT.zr - 0.06;
/** The pull that bends their arcs (levels per tick²). */
const G = 0.13;

/**
 * Spark `k` of the burst `seed` at age `age` (ticks): `out.a` is 0 outside its life. Up at 0.75–1.05
 * levels a tick, out at 0.035–0.075 tiles a tick on a bearing of its own, from a point inside the
 * throat: clear of the tallest flame (about 2 levels) within a fifth of a second, it peaks 2.2–4.2
 * levels up past the collar's edge, fading over the last 45 % of its life and shrinking a little.
 */
export function sparkAt(seed: number, k: number, age: number, out: SparkAt): SparkAt {
  const L = BURST.sparkLife * (0.75 + 0.25 * hash01(seed, k, 5));
  if (!(age >= 0 && age < L)) { out.a = 0; return out; }
  const th = Math.PI * 2 * hash01(seed, k, 0) + k * 1.9; // spread round the pit, even for a bad draw
  const vh = 0.035 + 0.04 * hash01(seed, k, 1), vz0 = 0.75 + 0.3 * hash01(seed, k, 2);
  const r0 = PIT.ri * 0.55 * hash01(seed, k, 3);
  const c = Math.cos(th), s = Math.sin(th);
  out.x = c * (r0 + vh * age);
  out.y = s * (r0 + vh * age);
  out.z = Z0 + vz0 * age - (G * age * age) / 2;
  out.vx = c * vh;
  out.vy = s * vh;
  out.vz = vz0 - G * age;
  const u = age / L;
  out.a = Math.min(1, age / 0.4) * (u < 0.55 ? 1 : 1 - (u - 0.55) / 0.45);
  out.s = 1.25 * (1 - 0.4 * u);
  return out;
}

/**
 * The burst's puff at age `age` (ticks): from the flame's tip (1.1 levels up) a beat after the flare,
 * rising 1.8 levels as it slows, swelling to about three times its first size, drifting right
 * (+x −y: screen-right in iso), thickening fast and thinning out; `out.a` is 0 outside its life.
 */
export function puffAt(seed: number, age: number, out: PuffAt): PuffAt {
  const u = (age - BURST.puffDelay) / BURST.puffLife;
  if (!(u >= 0 && u < 1)) { out.a = 0; return out; }
  const rise = 1 - (1 - u) * (1 - u);
  const drift = (0.14 + 0.12 * hash01(seed, 9, 0)) * rise;
  const side = (hash01(seed, 9, 1) - 0.5) * 0.12;
  out.x = drift + side;
  out.y = -drift + side;
  out.z = 1.1 + 1.8 * rise;
  out.s = (0.42 + 0.12 * hash01(seed, 9, 2)) * (1 + 1.9 * rise);
  out.a = 0.85 * Math.min(1, u / 0.1) * Math.pow(1 - u, 1.3);
  return out;
}

/**
 * The night glow of a burst's sparks (lights-view.ts): how bright (0…1: up at once, gone as they
 * fade), how high its centre is (levels: their mean arc) and how far they have spread from the
 * pit's axis (tiles) at age `age` (ticks) — a warm haze over the cloud of sparks, which lights them
 * as they fly (the graded world would leave them dull).
 */
export function burstGlow(age: number): { readonly k: number; readonly z: number; readonly r: number } {
  if (!(age >= 0 && age < BURST.sparkLife)) return GLOW_OFF;
  const u = age / BURST.sparkLife;
  GLOW.k = u < 0.3 ? 1 : 1 - (u - 0.3) / 0.7;
  GLOW.z = Z0 + 0.9 * age - (G * age * age) / 2;
  GLOW.r = PIT.ri * 0.3 + 0.055 * age;
  return GLOW;
}
const GLOW = { k: 0, z: 0, r: 0 };
const GLOW_OFF = { k: 0, z: 0, r: 0 } as const;

// ── tints ──────────────────────────────────────────────────────────────────────

/** An item's colours in a burst (0xRRGGBB, for sprite tints): its cinders, its smoke, its flame's tip at full tint. */
export interface BurstTint { cinder: number; smoke: number; flame: number }

const num = (hex: string): number => parseInt(hex.slice(1, 7), 16);
const hex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;

/** A colour at full brightness: its hue and saturation, its brightest channel at 255 (dark coal glows bluish white, not grey). */
export function brighten(col: string): string {
  const n = num(col), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const m = Math.max(r, g, b, 1), k = 255 / m;
  return hex((Math.round(r * k) << 16) | (Math.round(g * k) << 8) | Math.round(b * k));
}

let tints: BurstTint[] | null = null;
/** The burst's tints for an item index (white for none: an unknown item burns plain). */
export function burstTints(item: number): BurstTint {
  if (!tints) {
    tints = ITEM_IDS.map((id) => {
      const col = (ITEMS as Record<string, { color: string }>)[id]?.color ?? '#ffffff';
      const b = brighten(col);
      return { cinder: num(mix(b, '#ffe7b0', 0.3)), smoke: num(mix('#ffffff', col, 0.38)), flame: num(mix('#ffffff', b, 0.55)) };
    });
  }
  return tints[item] ?? PLAIN;
}
const PLAIN: BurstTint = { cinder: 0xffe7b0, smoke: 0xffffff, flame: 0xffffff };

/** White mixed towards `to` by k (0…1), as 0xRRGGBB: the flame's tint as the item's fades out. */
export function towards(to: number, k: number): number {
  if (k <= 0) return 0xffffff;
  const q = Math.min(1, k);
  const ch = (s: number): number => Math.round(255 + (((to >> s) & 255) - 255) * q);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}
