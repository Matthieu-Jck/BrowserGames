// cast-shadows.ts — the buildings' cast shadows as the day turns (pure; BuildingsView draws
// them). Each building's shadow is baked once per rotation — its own recipe laid on the ground
// along a reference light (art/silhouette.ts, iso-shapes.ts ShadowFrame) — and through the day
// it is only stretched and swung by one linear map about the building's foot and faded: short
// and dark at noon, long and soft at dawn and dusk, gone at night. The reference light comes from
// −x, as the art's light does and as the cliffs' shadows fall (along +x); the sun stays on that
// side all day, swinging a little with the hours (`sunDirection`), and every shadow falls away
// from it.
//
// The seam (owner, 2026-10-13: a turbine's shadow "goes in the direction of the sun sometimes").
// One linear map about the foot stretches every point of the baked shadow away from the foot —
// at dawn and dusk (2.2×) the shadow of a building's own base on the sun's side of its foot was
// pushed out towards the sun, a dark wash beside a turbine's wide foot. So a mask keeps only the
// far side of the seam, the line through the foot across the light (`farSide`, `seamClip`): what
// lies on the sun's side is the base's shadow under the building itself (hidden by it), and the
// map leaves the seam where it is, so what is kept only ever moves along the light, away from
// the sun.
//
// An item sorted among the volumes (D130: by a building's near face) is drawn over the shadows'
// layer, so it takes the shade the layer lays there itself, as a tint: the buildings view reads
// the masks back (`maskCover`, through the day's map) where the item stands.

import { C, mix, num } from '../art/tokens';

/** The shadows' colour: ink with a little lilac (Moebius shadows are cool on the warm sand). */
export const SHADOW_TINT = num(mix(C.ink, C.lilacD, 0.3));

/** The reference shadow the masks are baked with: ground tiles per level of height (screen-fixed tile terms). */
export const SHADOW_DX = 0.42;
export const SHADOW_DY = 0;

export interface ShadowLook {
  /** Opacity of the shadows (0: none). */
  alpha: number;
  /** Length, as a multiple of the reference shadow. */
  length: number;
  /** Swing (radians) of the shadows from the reference, morning (−) to evening (+). */
  angle: number;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const smoothstep = (a: number, b: number, v: number): number => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };

/** The sun's course on the 24-hour clock: it rises and sets at these hours (the twilight's middle, daynight.ts). */
const RISE = 4.4, SET = 19.6;
/** The look's range: length at noon and what a low sun adds (× the reference), the widest swing (radians). */
const LEN_NOON = 0.6, LEN_LOW = 1.6, SWING = 0.2;
/** The longest a shadow ever gets (× the reference: at sunrise and sunset). */
export const SHADOW_LONGEST = LEN_NOON + LEN_LOW;

/** The reference shadow's displacement per level of height, in iso world px (a tile shift (dx, dy) shows as ((dx − dy)·32, (dx + dy)·16)). */
export const SHADOW_PX: readonly [number, number] = [(SHADOW_DX - SHADOW_DY) * 32, (SHADOW_DX + SHADOW_DY) * 16];

/** The swing (radians) of the sun and the shadows from the reference at an hour: morning (−) to evening (+). */
const swingAt = (hour: number): number => SWING * Math.max(-1, Math.min(1, (hour - 12) / 6));

/**
 * Where the sun stands at an hour, seen from above: the unit vector (tile terms) from a building
 * towards it. Always on the art's light side (−x, the screen's top-left), it swings a little
 * with the hours (west-south-west in the morning to west-north-west in the evening); every cast
 * shadow falls the opposite way.
 */
export function sunDirection(hour: number): [number, number] {
  const a = swingAt(hour), c = Math.cos(a), s = Math.sin(a);
  const dx = SHADOW_DX * c - SHADOW_DY * s, dy = SHADOW_DX * s + SHADOW_DY * c, n = Math.hypot(dx, dy);
  return [-dx / n, -dy / n];
}

/**
 * Is a point of a baked shadow (iso world px from the building's foot: its footprint's centre on
 * the ground) on the far side of the seam — the line through the foot across the light? Only
 * those are drawn: the sun's side is the base's shadow under the building, and stretched with the
 * day it would reach towards the sun.
 */
export const farSide = (px: number, py: number): boolean => px * SHADOW_PX[0] + py * SHADOW_PX[1] >= 0;

/**
 * The far side of the seam through (cx, cy) as a clip polygon: a square of half-size `r` on the
 * light's side of the seam (`r` must reach past the whole mask). The bake clips the mask to it.
 */
export function seamClip(cx: number, cy: number, r: number): Array<[number, number]> {
  const n = Math.hypot(SHADOW_PX[0], SHADOW_PX[1]), ux = SHADOW_PX[0] / n, uy = SHADOW_PX[1] / n; // along the light
  const tx = -uy, ty = ux; // along the seam
  return [
    [cx + tx * r, cy + ty * r], [cx + tx * r + ux * r, cy + ty * r + uy * r],
    [cx - tx * r + ux * r, cy - ty * r + uy * r], [cx - tx * r, cy - ty * r],
  ];
}

/**
 * How far (tiles) the shadow of a point `head` levels up can ever fall from its foot, at any hour:
 * along x + y (towards the viewer, the depth the volumes sort by) and along x − y (across the
 * screen) alike — the longest shadow, swung either way. A building on the mountains sorts past
 * the rock it may fall on (world/stand.ts).
 */
export function shadowReach(head: number): number {
  return Math.hypot(SHADOW_DX, SHADOW_DY) * SHADOW_LONGEST * head * (Math.cos(SWING) + Math.sin(SWING));
}

/** The sun's height (0 on the horizon … 1 at noon) at an hour of the 24-hour clock. */
export function sunHeight(hour: number): number {
  return Math.sin(Math.PI * clamp01((hour - RISE) / (SET - RISE)));
}

/**
 * The shadows' look at an hour (0–24) and night factor (0–1): long when the sun is low and
 * shortest at noon, darkest at midday and softer in a low sun, fading out through the twilight
 * (gone at night), swinging a little from morning to evening.
 */
export function shadowLook(hour: number, night: number): ShadowLook {
  const e = sunHeight(hour);
  const fade = 1 - smoothstep(0.35, 0.9, night);
  return {
    alpha: 0.46 * (0.6 + 0.4 * e) * fade,
    length: LEN_NOON + LEN_LOW * Math.pow(1 - e, 1.6),
    angle: swingAt(hour),
  };
}

/**
 * The rock's shadows for the time of day (art/terrain.ts `paintSunShadows`): the ground step per
 * relief level (tiles) — the buildings' own (the reference lay swung and stretched by the sun), so
 * a cliff and a turbine beside it agree, capped where a paint window's casters end
 * (`SHADOW_REACH` for the highest rock) — and how dark they show (a little lighter than a
 * building's: they cover far more ground; the rock's own tops a little darker: relief-view.ts).
 */
export function reliefSun(hour: number, night: number, reach: number, maxLevel: number): [number, number, number] {
  const look = shadowLook(hour, night);
  const c = Math.cos(look.angle) * look.length, s = Math.sin(look.angle) * look.length;
  let dx = SHADOW_DX * c - SHADOW_DY * s, dy = SHADOW_DX * s + SHADOW_DY * c;
  const n = Math.hypot(dx, dy), cap = reach / maxLevel;
  if (n > cap) { dx *= cap / n; dy *= cap / n; }
  return [dx, dy, look.alpha * 0.85];
}

/** A baked shadow mask's alpha, one byte a px, row-major: read back once from its sheet (`maskCover`). */
export interface MaskAlpha { readonly w: number; readonly h: number; readonly a: Uint8Array }

/** The day's map (`shadowMap`) as Pixi lays it: X = a·x + c·y, Y = b·x + d·y. */
export type ShadowMat = readonly [number, number, number, number];

/**
 * How much of a cast shadow covers iso world point (px, py) (0…1, the mask's alpha there; D130):
 * its mask laid as the buildings view lays it — its top-left at (x, y) before the day's map, then
 * stretched and swung about its foot (fx, fy) by `m` — read back through the map's inverse. An
 * item sorted among the volumes (items-view.ts) is over the shadows' layer, so it takes this
 * shade itself, as a tint (`shadeTint`).
 */
export function maskCover(mask: MaskAlpha, m: ShadowMat, x: number, y: number, fx: number, fy: number, px: number, py: number): number {
  const [a, b, c, d] = m, det = a * d - b * c;
  const rx = px - fx, ry = py - fy;
  const qx = (d * rx - c * ry) / det + fx - x, qy = (a * ry - b * rx) / det + fy - y;
  if (!(qx >= 0 && qy >= 0 && qx < mask.w && qy < mask.h)) return 0;
  return mask.a[Math.floor(qy) * mask.w + Math.floor(qx)]! / 255;
}

/**
 * How far past its own box (iso px) a mask's shadow can reach at any hour: the day's map moves a
 * point of it along the light by its own reach along the light (from the foot) times the change of
 * length, at most the longest shadow's plus the reference's (`shadowMap`: what lies on the seam
 * stays). For the buildings view's index of which shadows may cover a point.
 */
export function maskReach(x: number, y: number, w: number, h: number, fx: number, fy: number): number {
  const [sx, sy] = SHADOW_PX, n2 = sx * sx + sy * sy;
  let along = 0;
  for (const [cx, cy] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]] as const) along = Math.max(along, ((cx - fx) * sx + (cy - fy) * sy) / n2);
  return along * Math.sqrt(n2) * (SHADOW_LONGEST + 1) * 1.05;
}

/**
 * The tint that lays the shadows' ink at opacity `a` over what it multiplies: exact over white,
 * near enough over an item's colours (the ink is dark). White for no shade.
 */
export function shadeTint(a: number): number {
  if (!(a > 0)) return 0xffffff;
  const k = Math.min(1, a);
  const ch = (v: number): number => Math.round(255 * (1 - k) + k * v);
  return (ch((SHADOW_TINT >> 16) & 255) << 16) | (ch((SHADOW_TINT >> 8) & 255) << 8) | ch(SHADOW_TINT & 255);
}

/**
 * The linear map (iso world px, Pixi's layout: X = a·x + c·y, Y = b·x + d·y) that turns a shadow
 * baked along the reference light into the one of the moment: it sends the reference
 * displacement per level S0 to S (the reference swung by `angle` and scaled by `length`) and
 * keeps the direction across it. A tile shift (dx, dy) shows as ((dx − dy)·32, (dx + dy)·16) px.
 */
export function shadowMap(length: number, angle: number): [number, number, number, number] {
  const s0x = (SHADOW_DX - SHADOW_DY) * 32, s0y = (SHADOW_DX + SHADOW_DY) * 16;
  const c = Math.cos(angle) * length, s = Math.sin(angle) * length;
  const dx = SHADOW_DX * c - SHADOW_DY * s, dy = SHADOW_DX * s + SHADOW_DY * c;
  const sx = (dx - dy) * 32, sy = (dx + dy) * 16;
  const n2 = s0x * s0x + s0y * s0y;
  const ux = (sx - s0x) / n2, uy = (sy - s0y) / n2;
  return [1 + ux * s0x, uy * s0x, ux * s0y, 1 + uy * s0y];
}
