// globe.ts — the geometry of the orbital view, pure (no DOM, no canvas): Ysmère as a unit
// sphere seen in orthographic projection from a fixed point above the cirque; the sun of the
// world day; great circles lifted above the ground (freight routes); the visible outline of a
// spherical cap (the night side, its twilight bands); the Crier Ring's plane; cubic Bézier
// flights. Two frames of reference:
//   planet space — x towards (0°, 0°), y towards (0°, 90° E), z the north pole;
//   view space   — x right, y DOWN (canvas order), z towards the viewer; the planet's disc is
//                  the unit circle and a point is drawn at (cx + R·x, cy + R·y).
// The view frame maps planet → view with east to the right and north up, as seen from space.
import { HOME_POSITION } from '@/content/colonies';
import { DAY_EPOCHS, SOLAR } from '@/sim/constants';

export type V3 = readonly [number, number, number];
export type P2 = [number, number];

export const DEG = Math.PI / 180;

export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
export const mix3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const len3 = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export function unit(a: V3): V3 {
  const l = len3(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}
const clamp1 = (v: number): number => (v < -1 ? -1 : v > 1 ? 1 : v);

/** Angle between two unit vectors (radians). */
export const angle = (a: V3, b: V3): number => Math.acos(clamp1(dot(a, b)));

/** A place on Ysmère (degrees) as a unit vector in planet space. */
export function fromLatLon(lat: number, lon: number): V3 {
  const la = lat * DEG, lo = lon * DEG;
  return [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
}

/** Two unit vectors orthogonal to `c` and to each other (any pair). */
export function tangents(c: V3): [V3, V3] {
  const helper: V3 = Math.abs(c[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const u = unit(cross(helper, c));
  return [u, cross(c, u)];
}

// ── the view ──────────────────────────────────────────────────────────────

/** Where we look from: screen right `e`, screen up `n`, towards the viewer `v` (planet space). */
export interface ViewFrame { readonly e: V3; readonly n: V3; readonly v: V3 }

/** The view from above the place (lat, lon) (degrees), north up. */
export function viewFrame(lat: number, lon: number): ViewFrame {
  const la = lat * DEG, lo = lon * DEG;
  return {
    v: fromLatLon(lat, lon),
    e: [-Math.sin(lo), Math.cos(lo), 0],
    n: [-Math.sin(la) * Math.cos(lo), -Math.sin(la) * Math.sin(lo), Math.cos(la)],
  };
}

/** Planet space → view space (x right, y down, z towards the viewer). */
export const toView = (f: ViewFrame, p: V3): V3 => [dot(p, f.e), -dot(p, f.n), dot(p, f.v)];

/** A view-space point is drawn when it is in front of the planet or outside its disc. */
export const shown = (p: V3): boolean => p[2] >= 0 || p[0] * p[0] + p[1] * p[1] > 1;

// ── the sun of the world day ──────────────────────────────────────────────

/** First epoch of the day with sun (sim/constants SOLAR), and how many have some. */
const DAWN = SOLAR.findIndex((s) => s > 0);
const LIT = SOLAR.filter((s) => s > 0).length;

/** Day-epoch of local noon at the cirque: the middle of the sunlit run (24 of 36). */
export const NOON = DAWN + LIT / 2;

/**
 * Latitude of the subsolar point (degrees) that makes the cirque's daylight last exactly LIT of
 * the DAY_EPOCHS, so the terminator crosses the cirque when its solar output starts and stops:
 * at sunrise the hour angle is H0 = π·LIT/DAY and cos H0 = −tan φ·tan δ. Ysmère's long lilac
 * day is a polar summer: the sun stands near 57° N and the south is mostly in the night.
 */
export const SUN_LAT = Math.atan(-Math.cos((Math.PI * LIT) / DAY_EPOCHS) / Math.tan(HOME_POSITION.lat * DEG)) / DEG;

/** The sun's direction (planet space) at a fractional absolute world epoch. */
export function sunDir(epoch: number): V3 {
  const d = ((epoch % DAY_EPOCHS) + DAY_EPOCHS) % DAY_EPOCHS;
  // The planet turns east: the subsolar point slides west, 360° per day.
  return fromLatLon(SUN_LAT, HOME_POSITION.lon - (360 * (d - NOON)) / DAY_EPOCHS);
}

// ── great circles and caps ────────────────────────────────────────────────

/** Spherical interpolation between unit vectors. */
export function slerp(a: V3, b: V3, t: number): V3 {
  const om = angle(a, b);
  if (om < 1e-6) return a;
  const s = Math.sin(om);
  return add(scale(a, Math.sin((1 - t) * om) / s), scale(b, Math.sin(t * om) / s));
}

/** A freight route: the great circle from a to b (unit vectors), lifted `peak` radii at its middle; n + 1 points. */
export function greatArc(a: V3, b: V3, peak: number, n: number): V3[] {
  const out: V3[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    out.push(scale(slerp(a, b, t), 1 + peak * Math.sin(Math.PI * t)));
  }
  return out;
}

/** n + 1 points of the limb (the unit circle) from angle a0 to a1 (radians, either way). */
function limbArc(a0: number, a1: number, n: number): P2[] {
  const out: P2[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    out.push([Math.cos(a), Math.sin(a)]);
  }
  return out;
}

/**
 * The visible part of the cap {p : p·c ≥ cos ρ} (c a unit vector in VIEW space, ρ ≤ 90°), as a
 * closed polygon in unit-disc coordinates; null when the cap is wholly on the far side. Where
 * the cap's circle passes behind the limb, the outline follows the limb on the cap's side.
 * With z(φ) = z0 + M·cos(φ − α) the depth of the circle's point at parameter φ, the visible arc
 * is |φ − α| ≤ acos(−z0/M).
 */
export function capOutline(c: V3, rho: number, n = 120): P2[] | null {
  const [u, w] = tangents(c);
  const cr = Math.cos(rho), sr = Math.sin(rho);
  const at = (phi: number): V3 => {
    const a = Math.cos(phi) * sr, b = Math.sin(phi) * sr;
    return [c[0] * cr + u[0] * a + w[0] * b, c[1] * cr + u[1] * a + w[1] * b, c[2] * cr + u[2] * a + w[2] * b];
  };
  const z0 = c[2] * cr;
  const M = Math.hypot(u[2], w[2]) * sr;
  if (M < 1e-9) {
    // The circle is parallel to the screen: in front (the whole circle), on the limb, or behind.
    if (z0 > 1e-9) return Array.from({ length: n }, (_, i) => { const p = at((i / n) * Math.PI * 2); return [p[0], p[1]] as P2; });
    if (Math.abs(z0) <= 1e-9 && c[2] > 0) return limbArc(0, Math.PI * 2, n).slice(0, n);
    return null;
  }
  if (z0 - M >= 0) return Array.from({ length: n }, (_, i) => { const p = at((i / n) * Math.PI * 2); return [p[0], p[1]] as P2; });
  if (z0 + M <= 0) return null;
  const alpha = Math.atan2(w[2], u[2]);
  const beta = Math.acos(clamp1(-z0 / M));
  const out: P2[] = [];
  for (let i = 0; i <= n; i++) {
    const p = at(alpha - beta + (2 * beta * i) / n);
    out.push([p[0], p[1]]);
  }
  // Back along the limb, from the arc's end to its start, on the side inside the cap.
  const [ex, ey] = out[n]!, [sx, sy] = out[0]!;
  const a0 = Math.atan2(ey, ex), a1 = Math.atan2(sy, sx);
  let d = (((a1 - a0) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2); // a0 → a1 counter-clockwise
  const mid = a0 + d / 2;
  if (Math.cos(mid) * c[0] + Math.sin(mid) * c[1] < cr) d -= Math.PI * 2; // the other way round
  const m = Math.max(4, Math.ceil((Math.abs(d) / (Math.PI * 2)) * n));
  out.push(...limbArc(a0, a0 + d, m).slice(1, m));
  return out;
}

// ── the Crier Ring ────────────────────────────────────────────────────────

/** The ring's plane in view space: `e1` its long axis, `e2` its near side, `up` its upper normal. */
export interface RingFrame { readonly e1: V3; readonly e2: V3; readonly up: V3 }

/**
 * The ring's plane: `open` = sin of its opening towards the viewer (the projected ellipse's
 * minor/major ratio), `roll` its screen tilt (radians, negative lifts the right end). θ = 0 is
 * the right end, θ = π/2 the point nearest the viewer (the bottom of the ellipse).
 */
export function ringFrame(open: number, roll: number): RingFrame {
  const ci = Math.sqrt(Math.max(0, 1 - open * open));
  const e1: V3 = [Math.cos(roll), Math.sin(roll), 0];
  const e2: V3 = [-Math.sin(roll) * open, Math.cos(roll) * open, ci];
  const n = cross(e1, e2);
  return { e1, e2, up: n[1] > 0 ? scale(n, -1) : n };
}

/** A point of the ring: angle θ, radius r (planet radii), height h along its upper normal. */
export function ringAt(f: RingFrame, theta: number, r: number, h = 0): V3 {
  const c = Math.cos(theta) * r, s = Math.sin(theta) * r;
  return [f.e1[0] * c + f.e2[0] * s + f.up[0] * h, f.e1[1] * c + f.e2[1] * s + f.up[1] * h, f.e1[2] * c + f.e2[2] * s + f.up[2] * h];
}

/** A point of a cubic Bézier in 3D. */
export function bezier(p0: V3, p1: V3, p2: V3, p3: V3, t: number): V3 {
  const u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return [
    a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
    a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1],
    a * p0[2] + b * p1[2] + c * p2[2] + d * p3[2],
  ];
}
