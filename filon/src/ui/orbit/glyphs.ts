// glyphs.ts — the little inked pictures the orbital view stamps on Ysmère, pre-rendered once
// per size into canvases: one glyph per colony profile (a mining headframe, a foundry stack, a
// glass dome, a wind tower, a lighthouse, an ember kiln, a scholar's spire, a moored drifter),
// each in a day and a night version (tinted lilac, its windows lit); the player's Hearth dome;
// the cargo pod and its flame (the same recipe as the world view's craft); the station's bell.
// Glyphs are drawn in a 40 × 44 unit box standing on (20, 40); the Hearth in 56 × 52 on (28, 47).
import type { ColonyProfileId } from '@/content/colonies';
import { C } from '@/render/art/tokens';
import { ellipsePts, flat, hatch, ink, roundRectPts, shape, type Ctx, type Pt } from '@/render/art/ink';
import { light } from '@/render/art/shapes';
import { CRAFT, drawCargoCraft, drawFlame, drawPuff } from '@/render/art/recipes/cargo';

/** A pre-rendered picture: its canvas, the anchor in canvas px, and canvas px per CSS px. */
export interface Stamp { readonly cv: HTMLCanvasElement; readonly ax: number; readonly ay: number; readonly k: number }

type Light = readonly [number, number, number, string];
interface Glyph { readonly w: number; readonly h: number; readonly ax: number; readonly ay: number; draw(g: Ctx, s: number): void; readonly lights: readonly Light[] }

const shadowAt = (g: Ctx, x: number, y: number, rx: number): void => flat(g, ellipsePts(x + 1.5, y + 0.6, rx, rx * 0.28, 3, 0.04, 20), C.ink, 0.3);
const line = (g: Ctx, a: Pt, b: Pt, w: number, color: string, s: number): void => ink(g, [a, b], { w, color, seed: s, taper: 0, jitter: 0.15 });

const G = (draw: Glyph['draw'], lights: readonly Light[] = []): Glyph => ({ w: 40, h: 44, ax: 20, ay: 40, draw, lights });

/** Points of an elliptical arc from angle a0 to a1 (radians; canvas y down, so π → 2π is the upper half). */
function arc(cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, n: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) { const a = a0 + ((a1 - a0) * i) / n; out.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]); }
  return out;
}

export const GLYPHS: Record<ColonyProfileId, Glyph> = {
  // A headframe over its pit, the spoil heap, an ore cart.
  mining: G((g, s) => {
    shadowAt(g, 20, 40, 14);
    shape(g, ellipsePts(19, 38.5, 12.5, 4.6, s, 0.1, 22), C.peachD, { w: 1.4, seed: s });
    hatch(g, ellipsePts(22, 39, 9, 3, s, 0.1, 16), Math.PI / 4, 1.8, { w: 0.6, alpha: 0.4, seed: s });
    line(g, [11, 38], [20, 10], 2.6, C.steelD, s + 1);
    line(g, [29, 38], [20, 10], 2.6, C.steelD, s + 2);
    line(g, [14, 29.5], [26, 29.5], 1.7, C.steelD, s + 3);
    line(g, [16.5, 21], [23.5, 21], 1.5, C.steelD, s + 4);
    ink(g, [[22.6, 12], [22.6, 35]], { w: 0.8, alpha: 0.7, shade: false, taper: 0, seed: s + 5 });
    shape(g, ellipsePts(20, 11, 4.6, 4.6, s + 6, 0, 16), C.brass, { w: 1.4, seed: s + 6 });
    flat(g, ellipsePts(20, 11, 1.4, 1.4, s, 0, 8), C.ink);
    shape(g, roundRectPts(26.5, 31.5, 9.5, 5.2, 1.2), C.coral, { w: 1.3, seed: s + 7 });
    for (const x of [28.6, 33.8]) flat(g, ellipsePts(x, 37.4, 1.5, 1.5, s, 0, 8), C.ink);
  }, [[20, 25, 1.4, C.ledWarm]]),
  // A brick hall with a lit window, a banded stack, its smoke.
  foundry: G((g, s) => {
    shadowAt(g, 19, 40, 14);
    const hall = roundRectPts(6.5, 24, 21, 16, 1.5);
    shape(g, hall, C.coral, { w: 1.5, seed: s });
    flat(g, roundRectPts(6.5, 24, 21, 3.4, 1.2), C.coralD);
    hatch(g, roundRectPts(19, 27, 8.5, 13, 1), Math.PI / 3, 1.9, { w: 0.6, alpha: 0.45, seed: s });
    shape(g, roundRectPts(9.5, 30, 6, 5, 0.8), C.steelDD, { w: 1, seed: s + 1, shade: false });
    const stack = roundRectPts(24, 9, 6, 31, 1);
    shape(g, stack, C.steelD, { w: 1.4, seed: s + 2 });
    flat(g, roundRectPts(23.6, 15, 6.8, 2.4, 0.6), C.brass);
    drawPuff(g, 29, 6, 5.2, s + 3);
  }, [[12.5, 32.5, 2, C.ledWarm]]),
  // A ribbed glass dome on a plinth, lumen moss glowing inside.
  glasshouse: G((g, s) => {
    shadowAt(g, 20, 40, 15);
    shape(g, roundRectPts(5, 34, 30, 6.5, 1.5), C.steel, { w: 1.4, seed: s });
    const dome = arc(20, 34, 13, 14, Math.PI, Math.PI * 2, 20);
    flat(g, dome, C.turqL, 0.9);
    flat(g, ellipsePts(20, 33, 8, 3.5, s, 0.2, 16), '#7cf5c8', 0.8);
    // Meridian ribs: the upper halves of narrower ellipses, and the middle one.
    for (const k of [0.5, 0.0]) {
      if (k === 0) ink(g, [[20, 20], [20, 34]], { w: 0.8, alpha: 0.6, shade: false, taper: 0, seed: s + 3 });
      else ink(g, arc(20, 34, 13 * k, 14, Math.PI, Math.PI * 2, 14), { w: 0.8, alpha: 0.6, shade: false, taper: 0, seed: s + 4 });
    }
    ink(g, [[8, 27], [32, 27]], { w: 0.7, alpha: 0.5, shade: false, taper: 0, seed: s + 5 });
    hatch(g, [[22, 22], [33, 30], [33, 34], [22, 34]], Math.PI / 4, 2, { w: 0.5, alpha: 0.35, seed: s });
    ink(g, [...dome, dome[0]!], { w: 1.4, seed: s + 6, taper: 0 });
    flat(g, ellipsePts(14.5, 25, 2.2, 1.2, s, 0, 10, -0.7), '#ffffff', 0.85);
  }, [[20, 31, 2.2, '#7cf5c8']]),
  // A tapered tower with a three-blade rotor and a pennant.
  wind: G((g, s) => {
    shadowAt(g, 20, 40, 10);
    shape(g, [[16, 40], [24, 40], [21.6, 12], [18.4, 12]], C.steelL, { w: 1.4, seed: s });
    hatch(g, [[20.5, 40], [24, 40], [21.6, 12], [20.5, 12]], Math.PI / 3, 1.7, { w: 0.5, alpha: 0.45, seed: s });
    for (const y of [22, 31]) ink(g, [[17.4 - (y - 22) * 0.06, y], [22.6 + (y - 22) * 0.06, y]], { w: 1.4, color: C.coral, shade: false, taper: 0, seed: s + y });
    for (let i = 0; i < 3; i++) {
      const a = -Math.PI / 2 + (i / 3) * Math.PI * 2 + 0.35;
      const ca = Math.cos(a), sa = Math.sin(a), nx = -sa, ny = ca;
      shape(g, [[20 + nx * 1.6, 11 + ny * 1.6], [20 + ca * 12 + nx * 0.8, 11 + sa * 12 + ny * 0.8], [20 + ca * 12.6, 11 + sa * 12.6], [20 + ca * 11 - nx * 1, 11 + sa * 11 - ny * 1], [20 - nx * 1, 11 - ny * 1]], C.ice, { w: 1.1, seed: s + 10 + i });
    }
    shape(g, ellipsePts(20, 11, 2.4, 2.4, s, 0, 12), C.steel, { w: 1.1, seed: s + 20 });
  }, [[20, 35, 1.3, C.led]]),
  // A striped lighthouse on its harbour, the lamp throwing two beams.
  saltport: G((g, s) => {
    shape(g, ellipsePts(20, 39.5, 15, 3.8, s, 0.06, 22), C.shallow, { w: 1.1, seed: s, shade: false });
    ink(g, [[9, 41.5], [15, 41.5]], { w: 0.7, color: C.paper, alpha: 0.8, shade: false, seed: s + 1 });
    flat(g, [[20, 11], [2, 6], [2, 13]], C.glowPeach, 0.35);
    flat(g, [[20, 11], [38, 7], [38, 14]], C.glowPeach, 0.25);
    const tower: Pt[] = [[14, 39], [26, 39], [23.4, 14], [16.6, 14]];
    shape(g, tower, C.salt, { w: 1.4, seed: s + 2 });
    for (const [ya, yb] of [[19, 23], [28, 32.5]] as const) {
      const wa = 3.4 + (ya - 14) * 0.104, wb = 3.4 + (yb - 14) * 0.104;
      flat(g, [[20 - wa, ya], [20 + wa, ya], [20 + wb, yb], [20 - wb, yb]], C.coral);
    }
    hatch(g, [[21, 39], [26, 39], [23.4, 14], [21, 14]], Math.PI / 3, 1.8, { w: 0.5, alpha: 0.4, seed: s });
    ink(g, tower, { closed: true, w: 1.4, seed: s + 3 });
    shape(g, roundRectPts(15.8, 9, 8.4, 5.2, 1), C.steelD, { w: 1.2, seed: s + 4 });
    shape(g, ellipsePts(20, 8.6, 4.4, 3, s, 0, 14), C.coral, { w: 1.1, seed: s + 5 });
  }, [[20, 11.6, 2.4, C.glowPeach]]),
  // A squat kiln with a glowing mouth, a short stack and sparks.
  ember: G((g, s) => {
    shadowAt(g, 20, 40, 15);
    shape(g, roundRectPts(23.5, 16, 5, 14, 1), C.steelD, { w: 1.2, seed: s });
    const kiln = arc(20, 40, 14, 15, Math.PI, Math.PI * 2, 22);
    flat(g, kiln, C.coralD);
    hatch(g, [[22, 25], [34, 34], [34, 40], [22, 40]], Math.PI / 4, 1.8, { w: 0.6, alpha: 0.45, seed: s });
    for (let k = 1; k <= 2; k++) ink(g, arc(20, 40, 14 - k * 3.6, 15 - k * 3.8, Math.PI * 1.08, Math.PI * 1.92, 14), { w: 0.7, alpha: 0.45, shade: false, taper: 0, seed: s + k });
    ink(g, [...kiln, kiln[0]!], { w: 1.5, seed: s + 3, taper: 0 });
    const mouth = arc(20, 40, 5, 6, Math.PI, Math.PI * 2, 12);
    shape(g, mouth, C.ledWarm, { w: 1.1, seed: s + 4, shade: false });
    flat(g, mouth.map(([x, y]) => [20 + (x - 20) * 0.5, 40 + (y - 40) * 0.55] as Pt), '#fff3d6');
    for (const [x, y] of [[26, 12], [28.5, 9], [24.6, 7.5]] as const) flat(g, ellipsePts(x, y, 0.9, 0.9, s, 0, 6), C.glowPeach);
  }, [[20, 37, 3, C.ledWarm]]),
  // A slender ringed spire with a glowing tip, an observatory dome at its foot.
  scholar: G((g, s) => {
    shadowAt(g, 20, 40, 12);
    const spire: Pt[] = [[20, 3.5], [25.5, 40], [14.5, 40]];
    flat(g, spire, C.lilac);
    flat(g, [[20, 3.5], [25.5, 40], [20, 40]], C.lilacD);
    for (const y of [16, 27]) { const hw = (y - 3.5) * 0.15; ink(g, [[20 - hw, y], [20 + hw, y]], { w: 1.4, color: C.brassL, shade: false, taper: 0, seed: s + y }); }
    ink(g, spire, { closed: true, w: 1.4, seed: s + 1 });
    const obs = arc(10, 40, 5.5, 5.5, Math.PI, Math.PI * 2, 12);
    shape(g, obs, C.violet, { w: 1.2, seed: s + 2 });
    ink(g, [[8, 36], [12.5, 35.2]], { w: 0.9, color: C.ice, shade: false, taper: 0, seed: s + 3 });
  }, [[20, 5, 1.8, C.glowCyan], [10, 38, 1.3, C.ledWarm]]),
  // A mooring mast with a small drifter balloon tied to it.
  drifter: G((g, s) => {
    shadowAt(g, 22, 40, 12);
    shape(g, roundRectPts(15.5, 36, 8, 4.5, 1), C.steel, { w: 1.2, seed: s });
    line(g, [19.5, 36], [19.5, 14], 1.8, C.steelD, s + 1);
    ink(g, [[19.5, 15], [25, 18.5]], { w: 0.8, alpha: 0.8, shade: false, taper: 0, seed: s + 2 });
    const env = ellipsePts(27, 15, 10.5, 7.2, s + 3, 0.02, 30);
    shape(g, env, C.ice, { w: 1.4, seed: s + 3 });
    hatch(g, ellipsePts(30, 18, 8, 4.5, s, 0, 20), Math.PI / 4, 1.8, { w: 0.5, alpha: 0.35, seed: s });
    ink(g, [[17, 15.5], [37.4, 15.5]], { w: 1.6, color: C.coral, shade: false, taper: 0, seed: s + 4 });
    for (const x of [24, 30]) ink(g, [[x, 21.6], [27 + (x - 27) * 0.45, 26]], { w: 0.7, alpha: 0.8, shade: false, taper: 0, seed: s + x });
    shape(g, roundRectPts(24.2, 25.5, 5.6, 3.4, 0.8), C.coral, { w: 1, seed: s + 5 });
    flat(g, ellipsePts(23.5, 11.5, 2.4, 1.3, s, 0, 10, -0.5), '#ffffff', 0.8);
  }, [[27, 28, 1.3, C.ledWarm], [19.5, 14, 1.2, C.ledRed]]),
};

/** The Hearth, marking the player's cirque: a teal dome with portholes, salt tanks, a pennant. */
export const HOME_GLYPH: Glyph = {
  w: 56, h: 52, ax: 28, ay: 47,
  lights: [[28, 27, 1.8, C.ledWarm], [20, 38, 1.4, C.glowCyan], [36, 38, 1.4, C.glowCyan]],
  draw(g, s) {
    shadowAt(g, 28, 47, 21);
    shape(g, ellipsePts(28, 45.5, 21, 6.4, s, 0.01, 30), C.steel, { w: 1.5, seed: s });
    for (const x of [10.5, 45.5]) {
      shape(g, ellipsePts(x, 41, 5.6, 5.6, s + x, 0.01, 16), C.ice, { w: 1.2, seed: s + x });
      hatch(g, ellipsePts(x + 1.5, 42, 4, 3.6, s, 0, 12), Math.PI / 4, 1.6, { w: 0.5, alpha: 0.4, seed: s });
    }
    ink(g, [[28, 29], [28, 4.5]], { w: 1.4, color: C.steelD, seed: s + 1, taper: 0 });
    shape(g, [[28.4, 4.5], [40, 7.5], [28.4, 11]], C.coral, { w: 1.1, seed: s + 2 });
    const dome = arc(28, 44, 15.5, 17, Math.PI, Math.PI * 2, 24);
    flat(g, dome, C.teal);
    flat(g, dome.map(([x, y]) => [28 + (x - 28) * 1.0, 44 + (y - 44) * 0.42] as Pt), C.tealL, 0.55);
    for (const k of [0.45, 0.85]) ink(g, arc(28, 44, 15.5 * k, 17, Math.PI, Math.PI * 2, 16), { w: 0.8, alpha: 0.5, shade: false, taper: 0, seed: s + 3 });
    hatch(g, [[31, 28], [44, 38], [44, 44], [31, 44]], Math.PI / 4, 2, { w: 0.6, alpha: 0.4, seed: s });
    ink(g, [...dome, dome[0]!], { w: 1.6, seed: s + 4, taper: 0 });
    flat(g, ellipsePts(21, 33, 3, 1.6, s, 0, 12, -0.7), '#ffffff', 0.8);
  },
};

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.ceil(w));
  cv.height = Math.max(1, Math.ceil(h));
  return cv;
}

/** Render a glyph at k canvas px per unit, by day or by night (lilac-tinted, windows lit). */
export function stampGlyph(gl: Glyph, k: number, night: boolean, seed: number): Stamp {
  const cv = makeCanvas(gl.w * k, gl.h * k);
  const g = cv.getContext('2d')!;
  g.lineJoin = 'round';
  g.lineCap = 'round';
  g.scale(k, k);
  gl.draw(g, seed);
  if (night) {
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = C.lilacD;
    g.globalAlpha = 0.5;
    g.fillRect(0, 0, gl.w, gl.h);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    for (const [x, y, r, col] of gl.lights) light(g, x, y, r * 1.3, col);
  } else {
    for (const [x, y, r, col] of gl.lights) light(g, x, y, r * 0.7, col);
  }
  return { cv, ax: gl.ax * k, ay: gl.ay * k, k };
}

/** The cargo pod, nose up, its nozzle at the anchor; `u` = its length in canvas px. */
export function stampCraft(u: number): Stamp {
  const pad = Math.ceil(u * 0.08) + 2;
  const cv = makeCanvas(2 * CRAFT.halfW * u + 2 * pad, CRAFT.h * u + 2 * pad);
  const g = cv.getContext('2d')!;
  g.lineJoin = 'round';
  g.lineCap = 'round';
  drawCargoCraft(g, CRAFT.halfW * u + pad, CRAFT.h * u + pad, u, 5);
  return { cv, ax: CRAFT.halfW * u + pad, ay: CRAFT.h * u + pad, k: 1 };
}

/** The pod's flame, hanging from the anchor. */
export function stampFlame(u: number): Stamp {
  const pad = Math.ceil(u * 0.1) + 2;
  const cv = makeCanvas(0.5 * u + 2 * pad, 0.75 * u + 2 * pad);
  drawFlame(cv.getContext('2d')!, 0.25 * u + pad, pad + u * 0.06, u, 1);
  return { cv, ax: 0.25 * u + pad, ay: pad + u * 0.06, k: 1 };
}

/** The Crier's brass bell, hanging from its pivot (the anchor); `u` = its height in canvas px. */
export function stampBell(u: number): Stamp {
  const pad = 3;
  const cv = makeCanvas(1.4 * u + 2 * pad, 1.3 * u + 2 * pad);
  const g = cv.getContext('2d')!;
  g.lineJoin = 'round';
  const x = 0.7 * u + pad, y = pad;
  const P = (dx: number, dy: number): Pt => [x + dx * u, y + dy * u];
  shape(g, [P(-0.1, 0.02), P(0.1, 0.02), P(0.12, 0.12)], C.brassL, { w: 1, seed: 2, shade: false });
  const bell: Pt[] = [P(-0.2, 0.1), P(0.2, 0.1), P(0.3, 0.32), P(0.36, 0.7), P(0.62, 0.92), P(-0.62, 0.92), P(-0.36, 0.7), P(-0.3, 0.32)];
  flat(g, bell, C.brass);
  hatch(g, [P(0.08, 0.1), P(0.3, 0.32), P(0.36, 0.7), P(0.62, 0.92), P(0.08, 0.92)], Math.PI / 3, Math.max(1.5, u * 0.09), { w: Math.max(0.5, u * 0.03), alpha: 0.45, seed: 3 });
  ink(g, [P(-0.52, 0.86), P(0.52, 0.86)], { w: Math.max(0.8, u * 0.05), color: C.brassL, shade: false, taper: 0, seed: 4 });
  ink(g, bell, { closed: true, w: Math.max(1, u * 0.07), seed: 5 });
  shape(g, ellipsePts(x, y + 1.02 * u, u * 0.11, u * 0.11, 6, 0, 12), C.coralD, { w: Math.max(0.8, u * 0.05), seed: 6 });
  flat(g, ellipsePts(x - u * 0.12, y + 0.42 * u, u * 0.05, u * 0.14, 7, 0, 10), '#ffffff', 0.7);
  return { cv, ax: x, ay: y, k: 1 };
}
