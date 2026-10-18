// pipe-ports.ts — water ports drawn as pipework (D142; owner, 2026-10-18: « the conduit and
// waterpump exit should have a specific style that looks more like conduit. and everything that
// uses water »). A ribbon's port is a painted hatch (turquoise intake, coral nozzle, its LED); a
// water port — a pump's outlet, a water drinker's water entrance, content `PortDef.fluid` — is a
// short steel pipe stub out of the wall in the conduit's own colours: a collar where it leaves the
// machine, a glazed band showing the water (the conduit's deep-teal line and its glint), a bolted
// flange at its mouth, and a valve standing on it, its handwheel turquoise on an intake, coral on
// an outlet (the hatches' code). Where a conduit meets any port, its end is capped by a bolted
// coupling across the line (`drawCoupling`, a ribbon piece the views lay at that edge), so the
// joint reads as a pipe joint in both views.
//
// The engine never reads the flag: either entrance of a water drinker still takes water (D114),
// so a base built before D142 keeps working whichever entrance it waters. The look follows the
// water instead: `wetEntrance` names the entrance that wears the pipework given what joins each
// (a conduit, a dry line, nothing) — the content's own unless the water comes in by another, or a
// dry line takes the content's and another is free — and the atlas bakes that variant
// (`wetAlternatives`, atlas.ts `wetKey`), the buildings view picking it from the graph
// (world/water-ports.ts). The valve's hub is a lamp exactly where the hatch's LED is, the same
// colour, so a building's night lights (found by re-running its default art, recipes/fx.ts) sit
// right in every variant.
import type { BuildingDef } from '@/content/types';
import { C, mix } from './tokens';
import { castShadow, ellipsePts, flat, ink, shape, type Ctx, type Pt } from './ink';
import { light, rivet, type Frame } from './shapes';
import { drumIso, type IsoFrame } from './iso-shapes';

/** What joins an entrance: nothing, a dry line (a ribbon, a machine's outlet), water (a conduit, a pump). */
export const NONE = 0, DRY = 1, WET = 2;

/** A water drinker's water entrance by content (its `fluid` in-port), or −1. */
export const homeEntrance = (def: BuildingDef): number => def.ports.findIndex((p) => p.io === 'in' && p.fluid);

/**
 * Does port `i` of a building wear pipework, its water coming in by entrance `wet` (a port index;
 * −1: the content's own)? `wet` counts only for a building that drinks water.
 */
export function pipeAt(def: BuildingDef, i: number, wet = -1): boolean {
  const p = def.ports[i];
  if (!p) return false;
  if (p.io === 'out') return !!p.fluid;
  return wet >= 0 && homeEntrance(def) >= 0 ? i === wet : !!p.fluid;
}

/** The other entrances a drinker's water may come in by: the variants the atlas bakes (none for any other building). */
export function wetAlternatives(def: BuildingDef): number[] {
  const home = homeEntrance(def);
  return home < 0 ? [] : def.ports.flatMap((p, i) => (p.io === 'in' && i !== home ? [i] : []));
}

/**
 * Which entrance wears the pipework, given what joins each (`joined(i)`: NONE, DRY or WET): −1
 * (the content's own) when the water comes in there, or nothing decides otherwise; else the first
 * other entrance water comes in by; else, when a dry line takes the content's, the first other
 * entrance still free — where the water would have to come. Never anything but −1 for a building
 * that drinks no water.
 */
export function wetEntrance(def: BuildingDef, joined: (i: number) => number): number {
  const home = homeEntrance(def);
  if (home < 0 || joined(home) === WET) return -1;
  const others = wetAlternatives(def);
  const wet = others.find((i) => joined(i) === WET);
  if (wet !== undefined) return wet;
  if (joined(home) === DRY) return others.find((i) => joined(i) === NONE) ?? -1;
  return -1;
}

/**
 * The stub's measures, in tiles along the port's way out from the footprint's edge (t) and levels
 * (z): its axis height and radius, where it starts inside the wall and ends outside (an outlet
 * reaches further, as a nozzle does), its collar and flange radii, the valve's stem and wheel.
 * `hub`: where the valve's lamp is — the ribbon hatch's LED point (iso-shapes.ts `portIso`).
 */
export const PIPE = { zc: 0.26, r: 0.11, tIn: -0.14, tOutIn: 0.18, tOutOut: 0.24, collar: 0.14, flange: 0.15, wheel: 0.165, hubT: 0.02, hubDz: 0.35 } as const;

/** The glazed band's water and glint (the conduit's line, recipes/belts.ts); the flange's pale steel. */
const WATER = C.deep, WATER_D = C.deepD, FLANGE = mix(C.steelL, '#ffffff', 0.18);
/** The handwheel by the port's way: turquoise in, coral out (the hatches' code). */
const wheelOf = (io: 'in' | 'out'): string => (io === 'out' ? C.coral : C.turq);

const DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0];

/** Test hook: when set, every water port the art draws reports itself (local tile, unrotated side, way; iso or plan). */
export const pipeProbe: { fn: ((x: number, y: number, side: number, io: 'in' | 'out', iso: boolean) => void) | null } = { fn: null };

/**
 * A water port in iso at tile (px, py), side `side` (unrotated), on a machine whose slab is `z`
 * levels high: the pipe stub out of the wall, its far end first (painter's order along it), the
 * valve over it. The same frame and conventions as `portIso`, which it stands in for.
 */
export function pipePortIso(ctx: Ctx, f: IsoFrame, px: number, py: number, side: number, io: 'in' | 'out', z = 0.3, seed = 1): void {
  pipeProbe.fn?.(px, py, side, io, true);
  const dx = DX[side & 3]!, dy = DY[side & 3]!;
  const mx = px + 0.5 + dx * 0.5, my = py + 0.5 + dy * 0.5; // the edge's middle
  const axis: 'x' | 'y' = dx !== 0 ? 'x' : 'y';
  const at = (t: number): [number, number] => [mx + dx * t, my + dy * t];
  const { zc, r, tIn } = PIPE, tOut = io === 'out' ? PIPE.tOutOut : PIPE.tOutIn;
  const outNear = f.depth(...at(1)) > f.depth(...at(0)); // does its mouth face the viewer?
  const drum = (t0: number, t1: number, rr: number, col: string, s: number, bands?: readonly number[]): void => {
    const [cx, cy] = at((t0 + t1) / 2);
    drumIso(ctx, f, cx, cy, zc, rr, Math.abs(t1 - t0) / 2, axis, col, seed + s, { hub: false, shadow: s === 1, bands });
  };
  const collar = (): void => drum(tIn, tIn + 0.05, PIPE.collar, C.steelD, 3);
  /** A point on the disc across the pipe at t, angle a (0: across, π/2: up), k of radius rr. */
  const onDisc = (t: number, a: number, rr: number): Pt => {
    const [cx, cy] = at(t), h = Math.cos(a) * rr, v = Math.sin(a) * rr * 2;
    return axis === 'x' ? f.p(cx, cy + h, zc + v) : f.p(cx + h, cy, zc + v);
  };
  const flange = (): void => {
    drum(tOut - 0.05, tOut, PIPE.flange, FLANGE, 4);
    // Facing the viewer, its mouth shows the water in its bore (the conduit couples on there).
    const tf = outNear ? tOut : tOut - 0.05;
    if (outNear) {
      const bore = Array.from({ length: 20 }, (_, i) => onDisc(tf, (i / 20) * Math.PI * 2, r * 0.7));
      flat(ctx, bore, WATER);
      ink(ctx, bore, { closed: true, w: 1.3, shade: false, taper: 0, jitter: 0, seed: seed + 8 });
      ink(ctx, [onDisc(tf, Math.PI * 0.62, r * 0.42), onDisc(tf, Math.PI * 0.9, r * 0.42)], { w: 1.3, color: '#ffffff', alpha: 0.8, shade: false, taper: 0, jitter: 0, seed: seed + 9 });
    }
    // Its bolts round the mouth, on the face that looks at the viewer: four brass heads.
    for (let k = 0; k < 4; k++) { const p = onDisc(tf, Math.PI / 4 + (k * Math.PI) / 2, PIPE.flange * 0.8); rivet(ctx, p[0], p[1], 1.7, C.brassL); }
  };
  const stub = (): void => {
    drum(tIn + 0.02, tOut - 0.03, r, C.steelL, 1);
    // The glazed band: the water seen through the pipe, a ring of the conduit's teal with its glint.
    const g0 = 0.02, g1 = 0.1;
    drum(g0, g1, r * 1.04, WATER, 5);
    const [gx, gy] = at((g0 + g1) / 2);
    const top = (k: number): Pt => (axis === 'x' ? f.p(gx + (k * (g1 - g0)) / 2, gy - r * 0.35, zc + r * 1.5) : f.p(gx - r * 0.35, gy + (k * (g1 - g0)) / 2, zc + r * 1.5));
    ink(ctx, [top(-0.8), top(0.8)], { w: 1.6, color: '#ffffff', alpha: 0.75, shade: false, taper: 0, jitter: 0, seed: seed + 6 });
  };
  // Far end first: an outlet facing away shows its flange behind the stub, its collar in front.
  if (outNear) { collar(); stub(); flange(); } else { flange(); stub(); collar(); }
  valveIso(ctx, f, ...at(PIPE.hubT), zc + r * 2, z + PIPE.hubDz, io, seed + 7);
}

/** The valve on a pipe: a dark stem from the pipe's top `z0` up to its handwheel at `z1`, the wheel's ring and spokes, its lamp for a hub. */
function valveIso(ctx: Ctx, f: IsoFrame, x: number, y: number, z0: number, z1: number, io: 'in' | 'out', seed: number): void {
  const a = f.p(x, y, z0 - 0.04), b = f.p(x, y, z1);
  ink(ctx, [a, b], { w: 4.6, color: C.ink, shade: false, taper: 0, jitter: 0, seed });
  ink(ctx, [a, b], { w: 2.4, color: C.steelD, shade: false, taper: 0, jitter: 0, seed: seed + 1 });
  const [ex, ey] = f.ell(PIPE.wheel);
  const ring = ellipsePts(b[0], b[1], ex, ey, seed, 0, 28);
  castShadow(ctx, ring, 4, 0.2);
  const col = wheelOf(io);
  for (let k = 0; k < 4; k++) {
    const t = Math.PI / 4 + (k * Math.PI) / 2;
    const rim: Pt = [b[0] + Math.cos(t) * ex, b[1] + Math.sin(t) * ey];
    ink(ctx, [b, rim], { w: 3.4, color: C.ink, shade: false, taper: 0, jitter: 0, seed: seed + 2 + k });
    ink(ctx, [b, rim], { w: 1.6, color: mix(col, C.ink, 0.25), shade: false, taper: 0, jitter: 0, seed: seed + 6 + k });
  }
  ink(ctx, ring, { closed: true, w: 5.4, color: C.ink, shade: false, taper: 0, jitter: 0, seed: seed + 10 });
  ink(ctx, ring, { closed: true, w: 3, color: col, shade: false, taper: 0, jitter: 0, seed: seed + 11 });
  // The lit half of the rim (the light comes from the top left).
  ink(ctx, ring.filter(([px, py]) => px < b[0] + ex * 0.2 && py < b[1] + ey * 0.2).sort((p, q) => p[0] - q[0]), { w: 1.1, color: mix(col, '#ffffff', 0.5), shade: false, taper: 0, jitter: 0, seed: seed + 12 });
  // The hub: a lamp in the water's colour, where a hatch has its LED.
  light(ctx, b[0], b[1], 2, C.led);
}

/**
 * A water port in plan (a building's plan sprite, buildings-top.ts) at tile (x, y), side `side`
 * (unrotated): the stub seen from above with its water line, the collar at the wall, the bolted
 * flange at its mouth, and the handwheel — a ring and its four spokes, the strongest mark of a
 * valve from above. No ribbon chevron: the shape says pipe.
 */
export function pipePortTop(ctx: Ctx, f: Frame, x: number, y: number, side: number, io: 'in' | 'out', seed = 1): void {
  pipeProbe.fn?.(x, y, side, io, false);
  const mid: Record<number, Pt> = { 0: [x + 0.5, y], 1: [x + 1, y + 0.5], 2: [x + 0.5, y + 1], 3: [x, y + 0.5] };
  const [mx, my] = mid[side & 3]!;
  const c = f.p(mx, my), S = f.l(1);
  const d = DIRV[f.dir(side)]!, tx = -d[1], ty = d[0];
  const P = (t: number, u: number): Pt => [c[0] + d[0] * t * S + tx * u * S, c[1] + d[1] * t * S + ty * u * S];
  const quad = (t0: number, t1: number, u: number): Pt[] => [P(t0, -u), P(t1, -u), P(t1, u), P(t0, u)];
  const { tIn } = PIPE, r = PIPE.r * 1.1, tOut = io === 'out' ? PIPE.tOutOut : PIPE.tOutIn;
  const w = Math.max(1.2, f.l(0.028));
  // The stub, its shadow under it, the water line along it.
  const body = quad(tIn, tOut - 0.03, r);
  castShadow(ctx, body, S * 0.05, 0.25);
  shape(ctx, body, C.steelL, { w, seed, shade: false });
  flat(ctx, quad(tIn + 0.03, tOut - 0.05, r * 0.42), WATER);
  ink(ctx, [P(tIn + 0.04, -r * 0.18), P(tOut - 0.06, -r * 0.18)], { w: Math.max(1, S * 0.022), color: '#ffffff', alpha: 0.7, shade: false, taper: 0, jitter: 0, seed: seed + 1 });
  ink(ctx, [P(tIn + 0.03, r * 0.42), P(tOut - 0.05, r * 0.42)], { w: Math.max(0.8, S * 0.014), color: WATER_D, alpha: 0.9, shade: false, taper: 0, jitter: 0, seed: seed + 2 });
  // The collar at the wall and the flange at the mouth, bolted at both ends.
  shape(ctx, quad(tIn, tIn + 0.05, PIPE.collar), C.steelD, { w, seed: seed + 3, shade: false, jitter: 0 });
  const fl = quad(tOut - 0.055, tOut, PIPE.flange + 0.02);
  castShadow(ctx, fl, S * 0.04, 0.25);
  shape(ctx, fl, FLANGE, { w, seed: seed + 4, shade: false, jitter: 0 });
  for (const u of [-1, 1]) { const b = P(tOut - 0.028, u * PIPE.flange * 0.78); rivet(ctx, b[0], b[1], Math.max(1.2, S * 0.024), C.brassL); }
  // The handwheel over the stub, a little back from the mouth so the flange shows past it.
  const h = P(PIPE.hubT - 0.07, 0), R = PIPE.wheel * S, col = wheelOf(io);
  const ring = ellipsePts(h[0], h[1], R, R, seed + 5, 0, 24);
  castShadow(ctx, ring, S * 0.05, 0.22);
  for (let k = 0; k < 4; k++) {
    const t = Math.PI / 4 + (k * Math.PI) / 2;
    const rim: Pt = [h[0] + Math.cos(t) * R, h[1] + Math.sin(t) * R];
    ink(ctx, [h, rim], { w: Math.max(2.2, S * 0.05), color: C.ink, shade: false, taper: 0, jitter: 0, seed: seed + 6 + k });
    ink(ctx, [h, rim], { w: Math.max(1, S * 0.024), color: mix(col, C.ink, 0.25), shade: false, taper: 0, jitter: 0, seed: seed + 10 + k });
  }
  ink(ctx, ring, { closed: true, w: Math.max(3, S * 0.075), color: C.ink, shade: false, taper: 0, jitter: 0, seed: seed + 14 });
  ink(ctx, ring, { closed: true, w: Math.max(1.8, S * 0.044), color: col, shade: false, taper: 0, jitter: 0, seed: seed + 15 });
  rivet(ctx, h[0], h[1], Math.max(1.4, S * 0.03), C.brassL);
}

/** Outward unit vectors of the sides on screen (0 N, 1 E, 2 S, 3 W). */
const DIRV: ReadonlyArray<Pt> = [[0, -1], [1, 0], [0, 1], [-1, 0]];

/**
 * A conduit's end at a port (a ribbon piece, BELT_PX square, the joint at the top edge; the views
 * turn it to the port's side): a bolted coupling across the line just past its rails — two steel
 * flanges with a dark gasket between and a brass bolt at each end — the water line running into
 * a round socket under it. Over the conduit's straight, corner or inlet piece (recipes/belts.ts:
 * the band is 0.6 of a tile, its rails 6 px).
 */
export function drawCoupling(ctx: Ctx, seed: number, S = 64): void {
  const x0 = S * 0.2, x1 = S * 0.8, rail = 6;
  const a = x0 - rail - 3, b = x1 + rail + 3;
  const bar = (y0: number, y1: number, col: string, s: number): void => {
    const q: Pt[] = [[a, y0], [b, y0], [b, y1], [a, y1]];
    flat(ctx, q.map(([x, y]) => [x + 1.5, y + 2] as Pt), C.ink, 0.25);
    shape(ctx, q, col, { w: 1.6, seed: seed + s, shade: false, jitter: 0 });
  };
  // The socket: the water line widening into the coupling.
  flat(ctx, ellipsePts(S / 2, 9, 10, 6, seed, 0, 18), WATER_D);
  bar(0.5, 5, C.steel, 1);
  flat(ctx, [[a + 2, 5], [b - 2, 5], [b - 2, 7], [a + 2, 7]], C.ink, 0.85);
  bar(7, 12, C.steelL, 2);
  ink(ctx, [[a + 2, 8.2], [b - 2, 8.2]], { w: 1.1, color: '#ffffff', alpha: 0.55, shade: false, taper: 0, jitter: 0, seed: seed + 3 });
  for (const x of [a + 3.4, S / 2 - 11, S / 2 + 11, b - 3.4]) rivet(ctx, x, 6, 1.9, C.brassL);
}
