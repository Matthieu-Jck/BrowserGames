// surface.ts — Ysmère's face as the orbital view paints it: pale ochre with deterministic
// blotches hashed from the world seed (the same planet for every player): dune seas, hardpan,
// mesa highlands, lilac rock basins, salt flats, turquoise lagoons, craters and two polar caps,
// plus the Cirque de Bonne-Veine's ring of rock. Each blotch is an irregular spherical disc,
// kept in planet space (unit vectors) and projected by the painter. Pure: no DOM.
import { HOME_POSITION } from '@/content/colonies';
import { WORLD_SEED } from '@/content/world';
import { hashUnit } from '@/core/hash';
import { DEG, fromLatLon, tangents, type V3 } from './globe';

export type BlotchKind = 'dune' | 'hardpan' | 'mesa' | 'rock' | 'salt' | 'lake' | 'cap' | 'crater' | 'cirque';

export interface Blotch {
  readonly kind: BlotchKind;
  /** Centre (planet space) and angular radius (radians). */
  readonly c: V3;
  readonly r: number;
  /** The outline: vertices on the sphere, closed. */
  readonly pts: readonly V3[];
  readonly seed: number;
  readonly wobble: number;
}

/** Kinds in paint order (back to front), with how many, their radius range (degrees), and vertices. */
const KINDS: ReadonlyArray<readonly [BlotchKind, number, number, number, number]> = [
  ['dune', 8, 16, 30, 72],
  ['hardpan', 11, 7, 14, 56],
  ['mesa', 10, 4.5, 11, 56],
  ['rock', 8, 3, 7.5, 44],
  ['salt', 7, 2.5, 6.5, 40],
  ['lake', 5, 2.5, 7, 48],
  ['crater', 16, 0.9, 2.3, 24],
];

const SALT = 0x0b17;

/** An irregular spherical disc: radius wobbled by a few hashed harmonics. */
export function blotch(kind: BlotchKind, c: V3, r: number, n: number, seed: number, wobble = 1): Blotch {
  const [t1, t2] = tangents(c);
  const h = (k: number): number => hashUnit(seed, SALT, k);
  const amps = [0.16 * h(1), 0.11 * h(2), 0.07 * h(3), 0.035 * h(4)].map((a) => a * wobble);
  const phs = [h(5), h(6), h(7), h(8)].map((p) => p * Math.PI * 2);
  const pts: V3[] = [];
  for (let i = 0; i < n; i++) {
    const th = (i / n) * Math.PI * 2;
    const k = 1 + amps[0]! * Math.sin(2 * th + phs[0]!) + amps[1]! * Math.sin(3 * th + phs[1]!) + amps[2]! * Math.sin(5 * th + phs[2]!) + amps[3]! * Math.sin(9 * th + phs[3]!);
    const rr = r * k, cs = Math.cos(rr), sn = Math.sin(rr);
    const a = Math.cos(th) * sn, b = Math.sin(th) * sn;
    pts.push([c[0] * cs + t1[0] * a + t2[0] * b, c[1] * cs + t1[1] * a + t2[1] * b, c[2] * cs + t1[2] * a + t2[2] * b]);
  }
  return { kind, c, r, pts, seed, wobble };
}

/** The same blotch's outline at k times its radius (a mesa's plateau, a lagoon's deep, a shore). */
export const blotchInner = (b: Blotch, k: number): readonly V3[] => blotch(b.kind, b.c, b.r * k, b.pts.length, b.seed, b.wobble).pts;

/** A wind streak: a short stretch of a parallel (the Souffle blows east), as points on the sphere. */
export interface Streak { readonly pts: readonly V3[]; readonly w: number }

/** Streaks combed by the constant wind, hashed over the planet (fewer near the poles). */
export function makeStreaks(seed = WORLD_SEED, n = 140): Streak[] {
  const out: Streak[] = [];
  for (let i = 0; i < n; i++) {
    const lat = Math.asin(2 * hashUnit(seed, SALT, 7000 + i, 1) - 1) / DEG * 0.85;
    const lon = hashUnit(seed, SALT, 7000 + i, 2) * 360 - 180;
    const len = 5 + hashUnit(seed, SALT, 7000 + i, 3) * 13;
    const pts: V3[] = [];
    for (let k = 0; k <= 8; k++) pts.push(fromLatLon(lat + Math.sin(k * 0.7 + i) * 0.25, lon + (len * k) / 8));
    out.push({ pts, w: 0.5 + hashUnit(seed, SALT, 7000 + i, 4) * 0.5 });
  }
  return out;
}

/** Every blotch of the planet, in paint order. */
export function makeSurface(seed = WORLD_SEED): Blotch[] {
  const out: Blotch[] = [];
  const home = fromLatLon(HOME_POSITION.lat, HOME_POSITION.lon);
  let id = 1;
  for (const [kind, count, r0, r1, n] of KINDS) {
    for (let i = 0; i < count; i++, id++) {
      const u = hashUnit(seed, SALT, id, 1), v = hashUnit(seed, SALT, id, 2);
      const lat = Math.asin(2 * u - 1) / DEG, lon = v * 360 - 180;
      const c = fromLatLon(lat, lon);
      // Keep the cirque's neighbourhood readable: nothing but dunes and hardpan over it.
      const dh = Math.acos(Math.max(-1, Math.min(1, c[0] * home[0] + c[1] * home[1] + c[2] * home[2]))) / DEG;
      const r = (r0 + hashUnit(seed, SALT, id, 3) * (r1 - r0)) * DEG;
      if (kind !== 'dune' && kind !== 'hardpan' && dh < r / DEG + 4) continue;
      out.push(blotch(kind, c, r, n, seed + id * 31, kind === 'crater' ? 0.25 : 1));
    }
  }
  // Polar caps of salt frost, a little off the poles.
  out.push(blotch('cap', fromLatLon(88, 40), 13 * DEG, 64, seed + 901, 0.8));
  out.push(blotch('cap', fromLatLon(-87, -120), 17 * DEG, 64, seed + 902, 0.8));
  // The cirque: a pale floor ringed by the Crown.
  out.push(blotch('cirque', home, 2.6 * DEG, 40, seed + 903, 0.35));
  return out;
}
