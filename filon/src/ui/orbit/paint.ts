// paint.ts — the orbital view's still layers, painted with the art kit (render/art: inked
// ribbons, flat fills, hatching, stipple) into offscreen canvases that the view blits every
// frame: the sky (a flat lilac-indigo with stippled stars and stepped halo rings), the far half
// of the Crier Ring, Ysmère's day face (blotches, wind streaks, graticule, atmosphere, the inked
// limb), the night side (lilac, hatched twilight bands, lit and dark limbs), and the near half of
// the ring with its station. All in CSS px; the caller sets the device-pixel transform.
import { hashUnit } from '@/core/hash';
import { C, mix } from '@/render/art/tokens';
import { ellipsePts, flat, hatch, ink, roundRectPts, shape, stipple, type Ctx, type Pt } from '@/render/art/ink';
import { antenna, dish, dome, ledStrip, light, rivet } from '@/render/art/shapes';
import {
  DEG, capOutline, fromLatLon, ringAt, tangents, toView,
  type P2, type RingFrame, type V3, type ViewFrame,
} from './globe';
import { blotchInner, type Blotch, type Streak } from './surface';

/** The sky: a deep lilac-indigo (ink, never black); the planet's base: pale ochre. */
export const SKY = mix(C.steelDD, C.lilacD, 0.3);
export const OCHRE = mix(C.sand, C.peach, 0.28);

/** The Crier Ring: radius and half-width of its deck, height of its wall (planet radii), its opening and roll. */
export const RING = { r: 1.48, w: 0.068, wall: 0.04, open: 0.3, roll: -0.13 } as const;

/** Where the planet sits in the panel (CSS px) and the device pixel ratio. */
export interface Layout { readonly w: number; readonly h: number; readonly cx: number; readonly cy: number; readonly R: number; readonly dpr: number }

/** View space → canvas (CSS px). */
export const px = (L: Layout, p: V3 | P2): Pt => [L.cx + L.R * p[0], L.cy + L.R * p[1]];

const TAU = Math.PI * 2;
const circle = (cx: number, cy: number, r: number, n = 96): Pt[] => {
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) out.push([cx + Math.cos((i / n) * TAU) * r, cy + Math.sin((i / n) * TAU) * r]);
  return out;
};

/** Trace a closed polygon into the current path (no beginPath). */
function trace(g: Ctx, pts: readonly Pt[]): void {
  g.moveTo(pts[0]![0], pts[0]![1]);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i]![0], pts[i]![1]);
  g.closePath();
}

/** Runs of consecutive points that pass a test (a closed ring wraps around). */
function runs<T>(pts: readonly T[], ok: (p: T) => boolean, closed: boolean): T[][] {
  const n = pts.length, out: T[][] = [];
  let start = 0;
  if (closed) {
    // Start right after a hidden point so a run never straddles the seam.
    const k = pts.findIndex((p) => !ok(p));
    if (k < 0) return [[...pts, pts[0]!]];
    start = k + 1;
  }
  let cur: T[] = [];
  for (let i = 0; i < n; i++) {
    const p = pts[(start + i) % n]!;
    if (ok(p)) cur.push(p);
    else if (cur.length) { out.push(cur); cur = []; }
  }
  if (cur.length) out.push(cur);
  return out.filter((r) => r.length > 1);
}

// ── the sky ───────────────────────────────────────────────────────────────

/** A four-point sparkle (a distant sun). */
function sparkle(g: Ctx, x: number, y: number, s: number, color: string): void {
  const pts: Pt[] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU - Math.PI / 2, r = i % 2 ? s * 0.18 : s;
    pts.push([x + Math.cos(a) * r, y + Math.sin(a) * r]);
  }
  flat(g, pts, color, 0.9);
  flat(g, circle(x, y, s * 0.45, 12), color, 0.2);
}

export function paintSky(g: Ctx, L: Layout, seed: number): void {
  g.fillStyle = SKY;
  g.fillRect(0, 0, L.w, L.h);
  // Stepped halo rings around the planet: a drawn glow, flat bands instead of a gradient.
  for (const [k, a] of [[2.5, 0.04], [2.0, 0.045], [1.6, 0.055], [1.28, 0.07]] as const) flat(g, circle(L.cx, L.cy, L.R * k, 120), C.lilac, a);
  const n = Math.round((L.w * L.h) / 650);
  for (let i = 0; i < n; i++) {
    const x = hashUnit(seed, 1, i) * L.w, y = hashUnit(seed, 2, i) * L.h, m = hashUnit(seed, 3, i);
    g.globalAlpha = 0.3 + 0.6 * hashUnit(seed, 4, i);
    g.fillStyle = m > 0.93 ? C.glowPeach : m > 0.8 ? C.ice : C.paper;
    g.beginPath();
    g.arc(x, y, 0.35 + m * m * m * 1.25, 0, TAU);
    g.fill();
  }
  g.globalAlpha = 1;
  const k = Math.max(3, Math.round((L.w * L.h) / 60000));
  for (let i = 0; i < k; i++) {
    const x = hashUnit(seed, 5, i) * L.w, y = hashUnit(seed, 6, i) * L.h;
    sparkle(g, x, y, 3 + hashUnit(seed, 7, i) * 4, i % 3 ? C.paper : C.glowPeach);
  }
}

// ── the planet's day face ─────────────────────────────────────────────────

/** Project a blotch: fill polygon (hidden vertices pushed onto the limb) and its visible outline runs. */
function project(L: Layout, f: ViewFrame, pts: readonly V3[]): { fill: Pt[]; outline: Pt[][] } | null {
  const vs = pts.map((p) => toView(f, p));
  if (vs.every((v) => v[2] < 0)) return null;
  const fill = vs.map((v): Pt => {
    if (v[2] >= 0) return px(L, v);
    const l = Math.hypot(v[0], v[1]) || 1;
    return [L.cx + (L.R * v[0]) / l, L.cy + (L.R * v[1]) / l];
  });
  const outline = runs(vs, (v) => v[2] >= 0.01, true).map((r) => r.map((v) => px(L, v)));
  return { fill, outline };
}

function inkRuns(g: Ctx, rs: readonly Pt[][], w: number, alpha: number, seed: number, color: string = C.ink): void {
  rs.forEach((r, i) => ink(g, r, { w, alpha, seed: seed + i, jitter: 0.35, taper: 0, color }));
}

function paintBlotch(g: Ctx, L: Layout, f: ViewFrame, b: Blotch): void {
  const pr = project(L, f, b.pts);
  if (!pr) return;
  const s = b.seed;
  const inner = (k: number): Pt[] | null => project(L, f, blotchInner(b, k))?.fill ?? null;
  switch (b.kind) {
    case 'dune': {
      flat(g, pr.fill, C.dune);
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const [x, y] of pr.fill) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
      stipple(g, x0, y0, x1 - x0, y1 - y0, Math.round((x1 - x0) * (y1 - y0) * 0.012), { clip: pr.fill, color: C.mesa, alpha: 0.35, r: 0.6, seed: s });
      inkRuns(g, pr.outline, 0.9, 0.28, s);
      break;
    }
    case 'hardpan':
      flat(g, pr.fill, C.hardpan, 0.85);
      inkRuns(g, pr.outline, 0.8, 0.3, s);
      break;
    case 'mesa': {
      flat(g, pr.fill, C.mesa);
      const top = inner(0.62);
      if (top) flat(g, top, C.rock1);
      hatch(g, pr.fill, Math.PI / 4, 2.6, { w: 0.7, alpha: 0.32, seed: s });
      if (top) { const t2 = project(L, f, blotchInner(b, 0.62)); if (t2) inkRuns(g, t2.outline, 0.7, 0.45, s + 3); }
      inkRuns(g, pr.outline, 1.2, 0.8, s + 1);
      break;
    }
    case 'rock':
      flat(g, pr.fill, hashUnit(s, 1) < 0.5 ? C.rock2 : C.rock3);
      hatch(g, pr.fill, Math.PI / 4, 2.2, { w: 0.6, alpha: 0.3, seed: s });
      inkRuns(g, pr.outline, 1.0, 0.75, s + 1);
      break;
    case 'salt':
      flat(g, pr.fill, C.salt);
      // A broken shoreline: every other stretch.
      for (const r of pr.outline) for (let i = 0; i + 3 < r.length; i += 6) ink(g, r.slice(i, i + 4), { w: 0.8, alpha: 0.5, seed: s + i, taper: 0.3 });
      break;
    case 'lake': {
      const shore = project(L, f, blotchInner(b, 1.22));
      if (shore) inkRuns(g, shore.outline, 0.6, 0.35, s + 4);
      flat(g, pr.fill, C.shallow);
      const deep = inner(0.55);
      if (deep) flat(g, deep, C.deep, 0.8);
      inkRuns(g, pr.outline, 1.1, 0.85, s + 1);
      break;
    }
    case 'cap': {
      flat(g, pr.fill, C.salt);
      const ice = inner(0.6);
      if (ice) flat(g, ice, C.ice, 0.55);
      inkRuns(g, pr.outline, 0.9, 0.55, s + 1);
      break;
    }
    case 'crater': {
      flat(g, pr.fill, C.dune, 0.9);
      // Shadow inside the upper-left wall, light on the lower-right one (light from the top-left).
      const c = toView(f, b.c);
      if (c[2] > 0.15) {
        const [x, y] = px(L, c), r = (b.r * L.R) * Math.sqrt(c[2]);
        flat(g, ellipsePts(x - r * 0.18, y - r * 0.2, r * 0.82, r * 0.82, s, 0.05, 16), C.mesa, 0.55);
      }
      inkRuns(g, pr.outline, 0.8, 0.65, s + 1);
      break;
    }
    case 'cirque': {
      const crown = project(L, f, blotchInner(b, 1.75));
      if (crown) {
        flat(g, crown.fill, C.rock1);
        hatch(g, crown.fill, Math.PI / 4, 1.8, { w: 0.6, alpha: 0.4, seed: s });
        inkRuns(g, crown.outline, 1.0, 0.85, s + 2);
      }
      flat(g, pr.fill, C.cirque);
      inkRuns(g, pr.outline, 0.9, 0.7, s + 1);
      break;
    }
  }
}

/** Fine meridians and parallels every 20° (the equator dashed), drawn only on the near side. */
function graticule(g: Ctx, L: Layout, f: ViewFrame): void {
  g.save();
  g.strokeStyle = C.inkSoft;
  g.lineWidth = 0.6;
  g.globalAlpha = 0.16;
  const stroke = (pts: V3[]): void => {
    for (const r of runs(pts.map((p) => toView(f, p)), (v) => v[2] >= 0, false)) {
      g.beginPath();
      r.forEach((v, i) => { const [x, y] = px(L, v); if (i) g.lineTo(x, y); else g.moveTo(x, y); });
      g.stroke();
    }
  };
  for (let lon = -180; lon < 180; lon += 20) stroke(Array.from({ length: 41 }, (_, i) => fromLatLon(-80 + i * 4, lon)));
  for (let lat = -60; lat <= 60; lat += 20) {
    if (lat === 0) { g.setLineDash([4, 3]); g.globalAlpha = 0.26; }
    stroke(Array.from({ length: 91 }, (_, i) => fromLatLon(lat, -180 + i * 4)));
    g.setLineDash([]);
    g.globalAlpha = 0.16;
  }
  g.restore();
}

/** Ysmère's day face: atmosphere, the disc and its blotches, wind streaks, graticule, limb stipple, the inked limb. */
export function paintPlanet(g: Ctx, L: Layout, f: ViewFrame, surface: readonly Blotch[], streaks: readonly Streak[]): void {
  const { cx, cy, R } = L;
  flat(g, circle(cx, cy, R * 1.06, 160), C.ice, 0.12);
  flat(g, circle(cx, cy, R * 1.03, 160), C.ice, 0.28);
  const limb = circle(cx, cy, R, 200);
  flat(g, limb, OCHRE);
  g.save();
  g.beginPath();
  trace(g, limb);
  g.clip();
  for (const b of surface) paintBlotch(g, L, f, b);
  // The Souffle combs the dust into faint east-west streaks.
  streaks.forEach((st, i) => {
    for (const r of runs(st.pts.map((p) => toView(f, p)), (v) => v[2] >= 0.05, false)) {
      ink(g, r.map((v) => px(L, v)), { w: st.w, color: C.mesa, alpha: 0.5, shade: false, taper: 0.45, jitter: 0.2, seed: 300 + i });
    }
  });
  graticule(g, L, f);
  // Stipple thickening towards the limb: the sphere's volume, drawn.
  const n = Math.round(R * 7);
  g.fillStyle = C.inkSoft;
  for (let i = 0; i < n; i++) {
    const u = hashUnit(77, 1, i), a = hashUnit(77, 2, i) * TAU;
    const d = 0.72 + 0.28 * Math.sqrt(u);
    if (hashUnit(77, 3, i) > ((d - 0.72) / 0.28) ** 1.6) continue;
    g.globalAlpha = 0.28;
    g.beginPath();
    g.arc(cx + Math.cos(a) * d * R, cy + Math.sin(a) * d * R, 0.55, 0, TAU);
    g.fill();
  }
  g.restore();
  ink(g, limb, { closed: true, w: 2.3, seed: 5, jitter: 0.3 });
}

// ── the night side ────────────────────────────────────────────────────────

/** Hatch the disc outside a cap (`clipOut`: the day cap) — a twilight band, drawn. */
function hatchBand(g: Ctx, L: Layout, clipOut: P2[] | null, spacing: number, alpha: number, angle: number, seed: number): void {
  const { cx, cy, R } = L;
  g.save();
  g.beginPath();
  trace(g, circle(cx, cy, R, 160));
  if (clipOut) trace(g, clipOut.map((p) => px(L, p)));
  g.clip('evenodd');
  hatch(g, circle(cx, cy, R, 24), angle, spacing, { w: 0.75, color: C.lilacD, alpha, seed });
  g.restore();
}

/**
 * The night side for a sun direction in VIEW space: hatched twilight bands, the lilac night
 * (a deeper cap at its heart), a fine terminator, the night limb's lilac air and the lit limb.
 */
export function paintNight(g: Ctx, L: Layout, sun: V3): void {
  const anti: V3 = [-sun[0], -sun[1], -sun[2]];
  hatchBand(g, L, capOutline(sun, (90 - 12) * DEG), 5.2, 0.3, Math.PI / 4, 3);
  hatchBand(g, L, capOutline(sun, (90 - 5) * DEG), 2.7, 0.42, Math.PI / 4, 4);
  const night = capOutline(anti, 90 * DEG);
  if (night) flat(g, night.map((p) => px(L, p)), C.lilacD, 0.5);
  const deep = capOutline(anti, 62 * DEG);
  if (deep) flat(g, deep.map((p) => px(L, p)), C.lilacD, 0.2);
  // The terminator: the great circle facing the sun, where it is on the near side.
  const [u, w] = tangents(sun);
  const term: V3[] = Array.from({ length: 160 }, (_, i) => {
    const a = (i / 160) * TAU;
    return [u[0] * Math.cos(a) + w[0] * Math.sin(a), u[1] * Math.cos(a) + w[1] * Math.sin(a), u[2] * Math.cos(a) + w[2] * Math.sin(a)];
  });
  for (const r of runs(term, (v) => v[2] >= 0, true)) ink(g, r.map((v) => px(L, v)), { w: 0.9, color: C.lilacD, alpha: 0.7, shade: false, taper: 0.08, seed: 9 });
  // The limb: lilac air on the night side, a warm lit rim and brighter air on the day side.
  const limb: V3[] = Array.from({ length: 240 }, (_, i) => [Math.cos((i / 240) * TAU), Math.sin((i / 240) * TAU), 0]);
  const at = (k: number) => (v: V3): Pt => px(L, [v[0] * k, v[1] * k, 0]);
  const lit = (v: V3): number => v[0] * sun[0] + v[1] * sun[1];
  for (const r of runs(limb, (v) => lit(v) < -0.08, true)) ink(g, r.map(at(1.03)), { w: 3.2, color: C.lilac, alpha: 0.6, shade: false, taper: 0.2, seed: 11 });
  for (const r of runs(limb, (v) => lit(v) > 0.12, true)) {
    ink(g, r.map(at(1.03)), { w: 2.6, color: C.ice, alpha: 0.45, shade: false, taper: 0.25, seed: 12 });
    ink(g, r.map(at(0.985)), { w: 1.4, color: C.glowPeach, alpha: 0.75, shade: false, taper: 0.25, seed: 13 });
  }
}

// ── the Crier Ring and its station ────────────────────────────────────────

/** One half of the ring ('back' behind the planet, 'front' before it): its wall, its deck, seams, portholes, the track. */
export function paintRingHalf(g: Ctx, L: Layout, rf: RingFrame, half: 'back' | 'front'): void {
  const { r, w, wall } = RING;
  const N = 96, t0 = half === 'front' ? 0 : Math.PI, t1 = t0 + Math.PI;
  const th = Array.from({ length: N + 1 }, (_, i) => t0 + ((t1 - t0) * i) / N);
  const P = (t: number, rr: number, h = 0): Pt => px(L, ringAt(rf, t, rr, h));
  // The wall that faces us: the outer one in front, the inner one behind.
  const wr = half === 'front' ? r + w : r - w;
  const wallTop = th.map((t) => P(t, wr)), wallBot = th.map((t) => P(t, wr, -wall));
  const wallPoly = [...wallTop, ...wallBot.slice().reverse()];
  const outer = th.map((t) => P(t, r + w)), inner = th.map((t) => P(t, r - w));
  const deck = [...outer, ...inner.slice().reverse()];
  flat(g, wallPoly, C.steelD);
  flat(g, deck, C.steel);
  // Panels: seams every 5°, a coral docking bay every 45°, a lighter plate every third.
  const step = (5 * Math.PI) / 180;
  for (let t = Math.ceil(t0 / step) * step; t < t1 - 1e-6; t += step) {
    const k = Math.round(t / step);
    if (k % 9 === 0) flat(g, [P(t, r - w), P(t, r + w), P(t + step, r + w), P(t + step, r - w)], C.coral, 0.9);
    else if (k % 3 === 0) flat(g, [P(t, r - w), P(t, r + w), P(t + step, r + w), P(t + step, r - w)], C.steelL, 0.55);
    ink(g, [P(t, r - w), P(t, r + w)], { w: 0.7, alpha: 0.55, shade: false, taper: 0, jitter: 0.1, seed: k });
    ink(g, [P(t, wr), P(t, wr, -wall)], { w: 0.6, alpha: 0.5, shade: false, taper: 0, jitter: 0.1, seed: k + 500 });
    // Portholes along the wall.
    const [hx, hy] = P(t + step / 2, wr, -wall * 0.5);
    flat(g, circle(hx, hy, 1.1, 8), C.glowCyan, 0.85);
  }
  // The glowing track along the middle of the deck.
  ink(g, th.map((t) => P(t, r)), { w: 1.3, color: C.tealL, alpha: 0.85, shade: false, taper: 0, jitter: 0.15, seed: 21 });
  ink(g, outer, { w: 1.5, seed: 22, taper: 0, jitter: 0.25 });
  ink(g, inner, { w: 1.2, seed: 23, taper: 0, jitter: 0.25 });
  ink(g, wallBot, { w: 1.3, seed: 24, taper: 0, jitter: 0.25 });
  if (half === 'back') {
    // Distance: a veil of sky over the far half.
    flat(g, wallPoly, SKY, 0.3);
    flat(g, deck, SKY, 0.3);
  }
}

/**
 * The station's place on the ring: on the near half, as far round to the right as the panel
 * leaves room for it (a narrow panel crops the ring's ends, never the station). Returns its
 * angle, its anchor (view space) and its size (CSS px).
 */
export function stationAt(L: Layout, rf: RingFrame): { th: number; p: V3; s: number } {
  const s = L.R * 0.2;
  // From the front-right towards the front until the module and its dish clear the panel's edge.
  let th = 0.5;
  while (th < 1.25 && L.cx + L.R * ringAt(rf, th, RING.r)[0] + s * 0.95 + 6 > L.w) th += 0.02;
  return { th, p: ringAt(rf, th, RING.r), s };
}

/**
 * The Crier's station astride the near half of the ring: a riveted module with a teal dome,
 * portholes and LEDs, a dish, a beacon mast, a docking collar; the bell hangs below it (drawn
 * live by the view, it swings when a cargo docks). Returns where the bell hangs and where the
 * beacon blinks.
 */
export function paintStation(g: Ctx, L: Layout, rf: RingFrame, seed: number): { yoke: Pt; beacon: Pt } {
  const { th, p, s } = stationAt(L, rf);
  const [sx, sy] = px(L, p);
  // Trusses along the ring on both sides.
  const a = px(L, ringAt(rf, th - 0.09, RING.r)), b = px(L, ringAt(rf, th + 0.09, RING.r));
  for (const [q, k] of [[a, 0], [b, 1]] as const) {
    ink(g, [[sx, sy - s * 0.08], [q[0], q[1] - s * 0.04]], { w: s * 0.11, color: C.ink, taper: 0, seed: seed + k, shade: false });
    ink(g, [[sx, sy - s * 0.08], [q[0], q[1] - s * 0.04]], { w: s * 0.06, color: C.steelL, taper: 0, seed: seed + 2 + k, shade: false });
  }
  const x0 = sx - s * 0.62, y0 = sy - s * 0.52, W = s * 1.24, H = s * 0.6;
  const body = roundRectPts(x0, y0, W, H, s * 0.12);
  flat(g, body.map(([x, y]) => [x + s * 0.06, y + s * 0.08] as Pt), C.ink, 0.35);
  shape(g, body, C.steel, { w: 1.4, seed: seed + 4 });
  flat(g, roundRectPts(x0 + s * 0.06, y0 + s * 0.05, W - s * 0.12, s * 0.12, s * 0.05), C.steelL, 0.8);
  hatch(g, roundRectPts(x0 + W * 0.68, y0 + s * 0.05, W * 0.3, H - s * 0.1, s * 0.05), Math.PI / 3, 2.2, { w: 0.6, alpha: 0.45, seed });
  ledStrip(g, [x0 + s * 0.2, y0 + H * 0.62], [x0 + W * 0.62, y0 + H * 0.62], 5, Math.max(1, s * 0.04), [C.led, C.ledWarm]);
  for (const [x, y] of [[x0 + s * 0.1, y0 + H - s * 0.1], [x0 + W - s * 0.1, y0 + H - s * 0.1]] as const) rivet(g, x, y, Math.max(1, s * 0.035));
  // Dome, dish, beacon mast.
  dome(g, sx - s * 0.12, y0 - s * 0.02, s * 0.3, C.teal, seed + 6, C.tealL, 3);
  dish(g, x0 + W + s * 0.02, y0 + H * 0.35, s * 0.17, seed + 7);
  antenna(g, [x0 + W * 0.82, y0 + s * 0.02], [x0 + W * 0.9, y0 - s * 0.55], Math.max(1.6, s * 0.07), C.coral, seed + 8);
  // The docking collar, lower left, where the cargo pods come in.
  shape(g, ellipsePts(x0 + s * 0.12, y0 + H + s * 0.02, s * 0.13, s * 0.08, seed + 9, 0, 20), C.steelD, { w: 1.2, seed: seed + 9 });
  ink(g, ellipsePts(x0 + s * 0.12, y0 + H + s * 0.02, s * 0.09, s * 0.05, seed + 10, 0, 18), { closed: true, w: 1.2, color: C.coral, shade: false, seed: seed + 10 });
  // The bell's yoke.
  const yoke: Pt = [sx + s * 0.02, y0 + H];
  shape(g, [[yoke[0] - s * 0.14, yoke[1] - s * 0.02], [yoke[0] + s * 0.14, yoke[1] - s * 0.02], [yoke[0] + s * 0.08, yoke[1] + s * 0.06], [yoke[0] - s * 0.08, yoke[1] + s * 0.06]], C.brass, { w: 1.1, seed: seed + 11 });
  const beacon: Pt = [x0 + W * 0.9, y0 - s * 0.55];
  light(g, beacon[0], beacon[1], Math.max(1, s * 0.035), C.ledRed);
  return { yoke: [yoke[0], yoke[1] + s * 0.05], beacon };
}
