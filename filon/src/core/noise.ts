// noise.ts — 2D value noise + FBM on a hashed integer lattice (agora's makeNoise2), with
// quantised wrappers for map generation. Only imul/shifts and + − × in IEEE double, which
// every JS engine evaluates identically; outputs are quantised to integers at once, so
// terrain is bit-identical everywhere.
import { hashStr } from './rng';

export interface Noise2 {
  noise(x: number, y: number): number;
  fbm(x: number, y: number, oct?: number, lac?: number, gain?: number): number;
}

export function makeNoise2(seed: string | number): Noise2 {
  const base = typeof seed === 'string' ? hashStr(seed) : seed >>> 0;
  const lattice = (xi: number, yi: number): number => {
    let h = base ^ Math.imul(xi, 374761393) ^ Math.imul(yi, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const smooth = (t: number): number => t * t * (3 - 2 * t);
  const noise = (x: number, y: number): number => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = smooth(xf), v = smooth(yf);
    const a = lattice(xi, yi), b = lattice(xi + 1, yi);
    const c = lattice(xi, yi + 1), d = lattice(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  const fbm = (x: number, y: number, oct = 5, lac = 2, gain = 0.5): number => {
    let amp = 0.5, freq = 1, sum = 0, norm = 0;
    for (let i = 0; i < oct; i++) {
      sum += amp * noise(x * freq, y * freq);
      norm += amp;
      amp *= gain; freq *= lac;
    }
    return sum / norm;
  };
  return { noise, fbm };
}

/** FBM quantised to an integer 0..255 at tile (x, y) with a feature size in tiles. */
export function qfbm(n: Noise2, x: number, y: number, scale: number, oct = 4): number {
  const v = n.fbm(x / scale, y / scale, oct);
  const q = Math.floor(v * 256);
  return q < 0 ? 0 : q > 255 ? 255 : q;
}
