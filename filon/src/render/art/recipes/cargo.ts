// cargo.ts — CrierBelt's freight machines as inked drawings, shared by the world views (Pixi
// textures baked from them) and the orbital view (canvas sprites):
//
// · the cargo craft of the orbital view: a stubby ice-blue pod with a coral nose cone and band,
//   ice fins, a brass nozzle and a cyan porthole;
// · its exhaust, shared by every machine here: a flat warm teardrop flame (no gradient:
//   concentric flat fills, like `light`), the halo round a nozzle, steam / dust puffs as
//   cartoon clouds — lobes inked as a union, a hatched belly on the shadow side;
// · the CrierBelt sky-crane (`drawCrane`): a square frame between four retro engines, winches
//   for four cables, a hub wearing the CrierBelt mark. ONE drawing for the intro's crane that
//   lowers the Heart (`SKY_CRANE`, world/landing-view.ts) and the trade post's cargo drone
//   (`CARGO_DRONE`, world/cargo-view.ts), so they read as the same company's machines; a
//   `CraneGeom` sizes it, and the sky-crane's numbers are the ones its art was drawn with;
// · the Crier's freight container the cargo drone hauls (`drawContainer`), drawable sunk into
//   the deck by any depth so the post's lift can bring it up or take it in, and the iris in the
//   deck it goes through (`drawHatch`).
//
// Pure Canvas2D, no DOM or Pixi: everything takes a context and a size or an IsoFrame.
import { C, mix } from '../tokens';
import { ellipsePts, flat, hatch, ink, pathOf, shape, type Ctx, type Pt } from '../ink';
import { light } from '../shapes';
import { ILH, IsoFrame, Scene, box, crierMarkFace, crierMarkIso, faceHazard, faceLeds, facePanel, facePt, faceQuad, latheIso, pipeIso, type RRect } from '../iso-shapes';
import { makeRng } from '@/core/rng';

/** The craft's box in units of its length: half width (fins included) and height. */
export const CRAFT = { halfW: 0.34, h: 1.0 } as const;

/**
 * The craft standing nose up. (x, y) is the nozzle exit (bottom centre); it rises `u` px above
 * it (the nose tip) and spreads ±0.34·u sideways (the fins). Light from the top-left: the right
 * side of the hull is hatched.
 */
export function drawCargoCraft(ctx: Ctx, x: number, y: number, u: number, seed = 1): void {
  const P = (dx: number, dy: number): Pt => [x + dx * u, y + dy * u];
  const w = Math.max(0.9, u * 0.035); // outline width
  // Fins behind the hull, then the nozzle bell.
  for (const s of [-1, 1]) {
    const fin: Pt[] = [P(s * 0.12, -0.42), P(s * 0.33, -0.16), P(s * 0.32, -0.03), P(s * 0.12, -0.14)];
    shape(ctx, fin, s < 0 ? C.ice : C.steelL, { w, seed: seed + 3 + s });
  }
  const bell: Pt[] = [P(-0.085, -0.14), P(0.085, -0.14), P(0.135, 0), P(-0.135, 0)];
  shape(ctx, bell, C.brass, { w, seed: seed + 5 });
  flat(ctx, ellipsePts(x, y - u * 0.012, u * 0.11, u * 0.03, seed, 0, 14), C.steelDD, 0.9);
  // The hull: a cylinder with an ogive nose.
  const hull: Pt[] = [];
  const r = 0.155, top = -0.64, tip = -1.0;
  hull.push(P(-r, -0.12));
  for (let i = 0; i <= 10; i++) {
    const k = i / 10;
    const yy = top + (tip - top) * k;
    hull.push(P(-r * Math.cos(k * Math.PI * 0.5) ** 0.75, yy));
  }
  for (let i = 10; i >= 0; i--) {
    const k = i / 10;
    const yy = top + (tip - top) * k;
    hull.push(P(r * Math.cos(k * Math.PI * 0.5) ** 0.75, yy));
  }
  hull.push(P(r, -0.12));
  flat(ctx, hull, C.ice);
  // The coral nose cone, clipped to the hull above the cone line.
  const nose: Pt[] = hull.filter(([, yy]) => yy <= y - 0.78 * u);
  if (nose.length > 2) flat(ctx, nose, C.coral);
  // A coral band and the shadow side.
  flat(ctx, [P(-r, -0.43), P(r, -0.43), P(r, -0.36), P(-r, -0.36)], C.coralD);
  const shadowSide: Pt[] = [P(0.045, -0.9), P(r + 0.02, -0.66), P(r + 0.02, -0.1), P(0.045, -0.1)];
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(hull[0]![0], hull[0]![1]);
  for (const p of hull) ctx.lineTo(p[0], p[1]);
  ctx.closePath();
  ctx.clip();
  hatch(ctx, shadowSide, Math.PI / 3, Math.max(1.6, u * 0.055), { w: Math.max(0.6, u * 0.018), alpha: 0.5, seed });
  ctx.restore();
  // Lit edge on the left, the porthole, the outline.
  ink(ctx, [P(-0.095, -0.66), P(-0.095, -0.2)], { w: Math.max(0.7, u * 0.025), color: '#ffffff', alpha: 0.75, shade: false, taper: 0.2, seed: seed + 7 });
  ink(ctx, hull, { closed: true, w, seed: seed + 8 });
  shape(ctx, ellipsePts(x, y - 0.56 * u, u * 0.062, u * 0.062, seed + 9, 0, 16), C.steelD, { w: w * 0.8, shade: false, jitter: 0 });
  light(ctx, x, y - 0.56 * u, Math.max(0.8, u * 0.034), C.glowCyan);
}

/**
 * The thruster flame below (x, y), pointing down: flat warm teardrops from a soft halo to a
 * white-hot core. `k` (0–1.4) stretches it (ignition, full burn, flicker).
 */
export function drawFlame(ctx: Ctx, x: number, y: number, u: number, k = 1): void {
  const drop = (len: number, half: number): Pt[] => {
    const pts: Pt[] = [];
    for (let i = 0; i <= 16; i++) {
      const a = Math.PI + (i / 16) * Math.PI; // the round top half, left to right
      pts.push([x + Math.cos(a) * half, y + Math.sin(a) * half * 0.6]);
    }
    pts.push([x + half * 0.5, y + len * 0.55], [x, y + len], [x - half * 0.5, y + len * 0.55]);
    return pts;
  };
  flat(ctx, ellipsePts(x, y + u * 0.08 * k, u * 0.22, u * 0.16, 2, 0, 18), C.glowPeach, 0.28);
  flat(ctx, drop(u * 0.62 * k, u * 0.15), C.glowPeach, 0.55);
  flat(ctx, drop(u * 0.42 * k, u * 0.105), C.ledWarm, 0.95);
  flat(ctx, drop(u * 0.2 * k, u * 0.055), '#fffaf0', 1);
}

/**
 * A steam puff of radius ~r centred on (cx, cy): 4–6 lobes, inked as one cloud (ink discs
 * first, then the paper fill a little smaller on top, so only the outer rim shows), a few
 * hatch strokes on the lower-right belly.
 */
export function drawPuff(ctx: Ctx, cx: number, cy: number, r: number, seed = 1, fill: string = C.salt): void {
  const rng = makeRng(seed * 7919 + 13);
  const lobes: Array<[number, number, number]> = [[cx, cy, r * 0.62]];
  const n = 4 + Math.floor(rng.next() * 3);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rng.next() * 0.8;
    const d = r * (0.32 + rng.next() * 0.16);
    lobes.push([cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.85, r * (0.36 + rng.next() * 0.16)]);
  }
  const rim = Math.max(0.8, r * 0.09);
  ctx.save();
  ctx.fillStyle = C.ink;
  ctx.globalAlpha *= 0.85;
  for (const [x, y, rr] of lobes) { ctx.beginPath(); ctx.arc(x, y, rr + rim, 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();
  ctx.save();
  ctx.fillStyle = fill;
  ctx.beginPath();
  for (const [x, y, rr] of lobes) { ctx.moveTo(x + rr, y); ctx.arc(x, y, rr, 0, Math.PI * 2); }
  ctx.fill();
  ctx.clip();
  // The belly in shadow: hatching on the lower right, a lit bump on the upper left.
  const belly: Pt[] = [[cx - r * 0.2, cy + r * 1.1], [cx + r * 1.2, cy - r * 0.2], [cx + r * 1.3, cy + r * 1.3]];
  hatch(ctx, belly, Math.PI / 4, Math.max(1.4, r * 0.24), { w: Math.max(0.5, r * 0.055), alpha: 0.3, seed });
  ctx.restore();
  flat(ctx, ellipsePts(cx - r * 0.25, cy - r * 0.3, r * 0.2, r * 0.13, seed + 2, 0, 12, -0.5), '#ffffff', 0.8);
}

/**
 * The warm halo round a burning nozzle, for a 64 px texture centred on (cx, cy): flat discs
 * from wide and faint to small, meant to be added to what is under it.
 */
export function drawHalo(ctx: Ctx, cx: number, cy: number): void {
  for (const r of [31, 26, 21, 16, 11, 7]) flat(ctx, ellipsePts(cx, cy, r, r, 2, 0, 32), C.glowPeach, 0.12);
}

// ── the CrierBelt sky-crane ───────────────────────────────────────────────────────

/**
 * A crane's build, in the frame of the payload footprint (w × h tiles) it is drawn round: the
 * frame's beams run `eng` outside the payload's edges, between the engines on its corners.
 */
export interface CraneGeom {
  /** The canvas: margin round the payload (tiles) and headroom (levels) of its IsoFrame (`craneFrame`). */
  readonly margin: number;
  readonly head: number;
  /** Inset of the engines' axes from the payload's corners (negative: outside it), and of the winches. */
  readonly eng: number;
  readonly hook: number;
  /** Heights (levels): the nozzles' exit, the frame's underside and top, the hub's top. */
  readonly zNozzle: number;
  readonly zFrame0: number;
  readonly zFrame1: number;
  readonly zHub: number;
  /** Size of the parts (pods, beams, winches, hub, mark, lights) against the sky-crane's (1). */
  readonly k: number;
}

/** The intro's sky-crane (D31), round the Heart's 5 × 5 footprint, its frame high over the dome. */
export const SKY_CRANE: CraneGeom = { margin: 0.8, head: 7.8, eng: -0.3, hook: 0.3, zNozzle: 5.55, zFrame0: 6.5, zFrame1: 6.82, zHub: 7.15, k: 1 };

/**
 * The trade post's cargo drone: the same machine at 0.9 scale round a square bay as wide as the
 * deck (`DRONE_BAY`), so it straddles the post; drawn from its nozzles up (z 0 = their exit),
 * the view flies it.
 */
export const CARGO_DRONE: CraneGeom = { margin: 0.62, head: 1.6, eng: -0.28, hook: 0.15, zNozzle: 0, zFrame0: 0.855, zFrame1: 1.143, zHub: 1.44, k: 0.9 };
/** The cargo drone's payload square (tiles): its engines stand on its corners, pushed `eng` out. */
export const DRONE_BAY = 2.2;

/** The corners of a w × h footprint, inset by d: N, E, S, W on screen (rot 0). */
export const craneCorners = (w: number, h: number, d: number): Array<[number, number]> => [[d, d], [w - d, d], [w - d, h - d], [d, h - d]];

/** The IsoFrame a crane round a w × h payload is drawn in (never rotated: it is symmetric). */
export const craneFrame = (w: number, h: number, g: CraneGeom): IsoFrame => new IsoFrame(w + 2 * g.margin, h + 2 * g.margin, 0, g.head);

/** Height (levels) where the cables leave the winches. */
export const craneCableZ = (g: CraneGeom): number => g.zFrame0 - 0.2 * g.k;

/**
 * A CrierBelt crane round a w × h payload, in `craneFrame(w, h, g)`: a riveted square frame
 * between four retro engines (teal pods, brass collars, dark bells; a red light to port, green
 * to starboard), a hub with the CrierBelt mark, spokes and gussets, hazard stripes, the winches
 * the cables hang from. No cast shadows: it flies. With `SKY_CRANE` this is, stroke for stroke,
 * the crane the intro was drawn with; any other geometry scales its parts by `g.k`.
 */
export function drawCrane(ctx: Ctx, f: IsoFrame, w: number, h: number, seed: number, g: CraneGeom): void {
  const { margin: M, eng: ENG, hook: HOOK, zNozzle: ZN, zFrame0: Z0, zFrame1: Z1, zHub: ZH, k } = g;
  const L = (x: number, y: number): [number, number] => [x + M, y + M];
  const sc = new Scene();
  const frame = { top: C.steel, left: mix(C.steel, C.ink, 0.3), right: mix(C.steel, C.ink, 0.5) };
  const b = 0.13 * k;
  const [e0, e1x, e1y] = [ENG, w - ENG, h - ENG];
  // Engines on the corners.
  for (const [i, [x, y]] of craneCorners(w, h, ENG).entries()) {
    const [lx, ly] = L(x, y);
    sc.add(f.depth(lx, ly), () => {
      // Bottom up, each part's cap hidden by the next: the bell, the pod, a brass collar, the pod's top.
      latheIso(ctx, f, lx, ly, [[ZN, 0.25 * k], [ZN + 0.3 * k, 0.13 * k]], C.steelD, seed + i, { shadow: false, seams: false });
      latheIso(ctx, f, lx, ly, [[ZN + 0.3 * k, 0.27 * k], [ZN + 0.38 * k, 0.31 * k], [Z0 - 0.02 * k, 0.31 * k]], C.teal, seed + 10 + i, { shadow: false });
      latheIso(ctx, f, lx, ly, [[Z0 - 0.02 * k, 0.335 * k], [Z0 + 0.16 * k, 0.335 * k]], C.brass, seed + 20 + i, { shadow: false, seams: false });
      latheIso(ctx, f, lx, ly, [[Z0 + 0.16 * k, 0.31 * k], [Z1 + 0.12 * k, 0.31 * k], [Z1 + 0.24 * k, 0.22 * k]], C.teal, seed + 30 + i, { shadow: false });
      const nav = i === 3 ? C.ledRed : i === 1 ? C.ledGreen : C.ledWarm;
      light(ctx, ...f.p(lx - 0.16 * k, ly + 0.2 * k, Z1 - 0.05 * k), 2.4 * k, nav);
    });
  }
  // The frame's four beams, between the engines.
  const beams: Array<[number, number, number, number]> = [
    [e0 + 0.28 * k, e0 - b, e1x - 0.28 * k, e0 + b], [e1x - b, e0 + 0.28 * k, e1x + b, e1y - 0.28 * k],
    [e0 + 0.28 * k, e1y - b, e1x - 0.28 * k, e1y + b], [e0 - b, e0 + 0.28 * k, e0 + b, e1y - 0.28 * k],
  ];
  for (const [i, [x0, y0, x1, y1]] of beams.entries()) {
    const [a0, b0] = L(x0, y0), [a1, b1] = L(x1, y1);
    sc.add(f.depth((a0 + a1) / 2, (b0 + b1) / 2), () => {
      const rr = box(ctx, f, a0, b0, a1, b1, Z0, Z1, frame, seed + 30 + i, { shadow: false, outline: 1.8 });
      if (i === 2) faceHazard(ctx, f, rr, 'L', 0.1, 0.9, Z0 + 0.06 * k, Z1 - 0.06 * k, seed + 40);
      if (i === 1) faceHazard(ctx, f, rr, 'R', 0.1, 0.9, Z0 + 0.06 * k, Z1 - 0.06 * k, seed + 41);
    });
  }
  // Winches under the frame, where the cables hang.
  for (const [i, [x, y]] of craneCorners(w, h, HOOK).entries()) {
    const [lx, ly] = L(x, y);
    sc.add(f.depth(lx, ly) + 0.01, () => box(ctx, f, lx - 0.13 * k, ly - 0.13 * k, lx + 0.13 * k, ly + 0.13 * k, Z0 - 0.22 * k, Z0, { top: C.brass }, seed + 50 + i, { shadow: false, outline: 1.4 }));
  }
  // Gussets: each engine's arm in to its winch (from the pod's skin, not its axis).
  const hooks = craneCorners(w, h, HOOK);
  for (const [i, [x, y]] of craneCorners(w, h, ENG).entries()) {
    const [kx, ky] = hooks[i]!;
    const d = Math.hypot(kx - x, ky - y) || 1;
    const [ax, ay] = L(x + ((kx - x) / d) * 0.3 * k, y + ((ky - y) / d) * 0.3 * k), [bx, by] = L(kx, ky);
    sc.add(f.depth((ax + bx) / 2, (ay + by) / 2), () => pipeIso(ctx, f, [[ax, ay, Z0 + 0.12 * k], [bx, by, Z0 + 0.12 * k]], 6 * k, C.steel, seed + 80 + i, false));
  }
  // The hub and its spokes, from its faces to the beams' middles.
  const [hx, hy] = L(w / 2, h / 2);
  const HUB = 0.55 * k;
  for (const [i, [x, y, sx, sy]] of ([[w / 2, e0, 0, -1], [e1x, h / 2, 1, 0], [w / 2, e1y, 0, 1], [e0, h / 2, -1, 0]] as const).entries()) {
    const [lx, ly] = L(x, y);
    const ax = hx + sx * HUB, ay = hy + sy * HUB;
    sc.add(f.depth((lx + ax) / 2, (ly + ay) / 2), () => pipeIso(ctx, f, [[ax, ay, Z0 + 0.18 * k], [lx, ly, Z0 + 0.18 * k]], 5 * k, C.steelL, seed + 60 + i, false));
  }
  sc.add(f.depth(hx, hy) + 0.02, () => {
    const rr = box(ctx, f, hx - HUB, hy - HUB, hx + HUB, hy + HUB, Z0 - 0.1 * k, ZH, { top: C.steelL, left: C.steel, right: mix(C.steel, C.ink, 0.45) }, seed + 70, { shadow: false });
    faceLeds(ctx, f, rr, 'L', Z0 + 0.2 * k, 0.25, 0.75, 3, [C.led, C.ledWarm, C.led], 2 * k);
    crierMarkIso(ctx, f, hx, hy, ZH, 0.4 * k, seed + 71);
  });
  sc.run();
}

// ── the Crier's freight container and the deck's lift iris ────────────────────────

/** The container: length along x, depth along y (tiles), height (levels). It passes through the deck's iris (`IRIS`). */
export const CONTAINER = { w: 1.44, d: 0.88, h: 1.3 } as const;
/** Its lifting eyes, inset from the top corners (tiles): the drone's cables hook there. */
const EYE = 0.07;
/**
 * The deck's lift: an iris that opens on a round well (radius, tiles) wide enough for the
 * container's corners to pass, inside a rim of retracted blades; all of it inside the deck
 * (radius 0.98, recipes/buildings.ts `trade_post`).
 */
export const IRIS = 0.86;
export const IRIS_RIM = 0.07;

/** The container's IsoFrame (its own footprint, headroom for its height). */
export const containerFrame = (): IsoFrame => new IsoFrame(CONTAINER.w, CONTAINER.d, 0, CONTAINER.h + 0.15);
/** Its lifting eyes (local tiles, on its roof): N, E, S, W on screen, like the crane's winches. */
export const containerEyes = (): Array<[number, number]> => craneCorners(CONTAINER.w, CONTAINER.d, EYE);
/** The iris's IsoFrame: 2 × 2 tiles, the well's axis at its centre (1, 1). */
export const hatchFrame = (): IsoFrame => new IsoFrame(2, 2, 0, 0.1);

/**
 * The freight container standing on z 0 — or `sunk` levels down the deck's iris: only what
 * stands above the deck is drawn (clipped along its near bottom edges, and the cut inked, where
 * it goes into the well), so the lift can bring it up or take it in by steps. Coral
 * corrugated steel between dark corner posts, a paper panel with the CrierBelt mark on its long
 * side, a hazard band and a green status LED on its end, brass lifting eyes on the roof's
 * corners. No cast shadow: it flies; the view lays one under it.
 */
export function drawContainer(ctx: Ctx, f: IsoFrame, sunk: number, seed: number): void {
  const { w: W, d: D, h: H } = CONTAINER;
  const z0 = -sunk, z1 = H - sunk;
  if (z1 <= 0) return;
  const w0 = f.p(0, D, 0), s0 = f.p(W, D, 0), e0 = f.p(W, 0, 0);
  ctx.save();
  if (sunk > 0) {
    // What is above the deck: the side over the near bottom edges (W → S → E) at z 0.
    pathOf(ctx, [[w0[0] - 6, w0[1] - 3], s0, [e0[0] + 6, e0[1] - 3], [e0[0] + 6, -1e4], [w0[0] - 6, -1e4]]);
    ctx.clip();
  }
  const rr = box(ctx, f, 0, 0, W, D, z0, z1, { top: mix(C.coral, C.paper, 0.14), left: C.coral, right: C.coralD }, seed, { shadow: false, outline: 2 });
  // Corrugated sides between dark corner posts.
  for (const face of ['L', 'R'] as const) {
    const len = face === 'L' ? rr[2] - rr[0] : rr[3] - rr[1];
    const n = Math.max(4, Math.round(len / 0.1));
    const rib = mix(face === 'L' ? C.coral : C.coralD, C.ink, 0.4);
    for (let i = 1; i < n; i++) ink(ctx, [facePt(f, rr, face, i / n, z0 + 0.05), facePt(f, rr, face, i / n, z1 - 0.05)], { w: 1.1, color: rib, alpha: 0.75, shade: false, taper: 0, jitter: 0, seed: seed + 10 + i });
    const post = 0.04 / len;
    flat(ctx, faceQuad(f, rr, face, 0, post, z0, z1), C.steelD);
    flat(ctx, faceQuad(f, rr, face, 1 - post, 1, z0, z1), C.steelD);
  }
  // The CrierBelt panel on the long side; a hazard band and the status LED on the end.
  facePanel(ctx, f, rr, 'L', 0.3, 0.7, z0 + 0.2, z1 - 0.2, C.paper, seed + 30);
  crierMarkFace(ctx, f, rr, 'L', 0.5, (z0 + z1) / 2, 0.17, seed + 31);
  faceHazard(ctx, f, rr, 'R', 0.14, 0.86, z0 + 0.1, z0 + 0.3, seed + 40);
  light(ctx, ...facePt(f, rr, 'R', 0.8, z1 - 0.22), 2.2, C.ledGreen);
  // The roof: seams across, the lifting eyes.
  for (let i = 1; i < 4; i++) {
    const x = (W * i) / 4;
    ink(ctx, [f.p(x, 0.05, z1), f.p(x, D - 0.05, z1)], { w: 1, color: mix(C.coral, C.ink, 0.5), alpha: 0.5, shade: false, taper: 0, jitter: 0, seed: seed + 50 + i });
  }
  for (const [i, [x, y]] of containerEyes().entries()) {
    const [px, py] = f.p(x, y, z1);
    shape(ctx, ellipsePts(px, py, 3.4, 1.9, seed + 60 + i, 0, 14), C.brass, { w: 1, shade: false, jitter: 0 });
    flat(ctx, ellipsePts(px, py + 0.2, 1.5, 0.8, seed + 64 + i, 0, 10), C.ink, 0.85);
  }
  // The silhouette again, over the corner posts.
  inkBox(ctx, f, rr, z0, z1, seed + 70);
  ctx.restore();
  if (sunk > 0) ink(ctx, [w0, s0, e0], { w: 1.6, alpha: 0.75, shade: false, taper: 0, jitter: 0, seed: seed + 72 });
}

/** A box's near edge and silhouette, inked again over what was painted on its faces. */
function inkBox(ctx: Ctx, f: IsoFrame, rr: RRect, z0: number, z1: number, seed: number): void {
  const [a0, b0, a1, b1] = rr;
  ink(ctx, [f.pr(a1, b1, z1), f.pr(a1, b1, z0)], { w: 1.4, seed, taper: 0 });
  ink(ctx, [f.pr(a0, b0, z1), f.pr(a1, b0, z1), f.pr(a1, b0, z0), f.pr(a1, b1, z0), f.pr(a0, b1, z0), f.pr(a0, b1, z1)], { closed: true, w: 2, seed: seed + 1 });
}

/**
 * The deck's lift, open, in `hatchFrame()` on the deck's top (z 0): the iris's blades drawn back
 * into a rim in hazard stripes round a dark round well, its far wall seen through the opening
 * (guide rails, cold LEDs along the lip). The view dilates it open and shut by scaling it.
 */
export function drawHatch(ctx: Ctx, f: IsoFrame, seed: number): void {
  const c = f.p(f.w / 2, f.h / 2, 0);
  const [ox, oy] = f.ell(IRIS + IRIS_RIM), [hx, hy] = f.ell(IRIS);
  const depth = ILH;
  const outer = ellipsePts(c[0], c[1], ox, oy, seed, 0, 64), hole = ellipsePts(c[0], c[1], hx, hy, seed + 1, 0, 64);
  flat(ctx, outer, C.hazard);
  hatch(ctx, outer, Math.PI / 4, 7, { w: 2.8, alpha: 0.85, seed });
  flat(ctx, hole, C.steelDD);
  // The far wall: the band under the opening's far rim, down to the well's depth; shaded on the right.
  const rim: Pt[] = [];
  for (let i = 0; i <= 32; i++) { const a = Math.PI + (i / 32) * Math.PI; rim.push([c[0] + Math.cos(a) * hx, c[1] + Math.sin(a) * hy]); }
  const wall: Pt[] = [...rim, ...rim.slice().reverse().map(([x, y]) => [x, y + depth] as Pt)];
  ctx.save();
  pathOf(ctx, hole);
  ctx.clip();
  flat(ctx, wall, mix(C.steelD, C.steelL, 0.15));
  const right: Pt[] = [[c[0] + hx * 0.2, c[1] - hy - 2], [c[0] + hx + 2, c[1] - hy - 2], [c[0] + hx + 2, c[1] + depth + 2], [c[0] + hx * 0.2, c[1] + depth + 2]];
  ctx.save();
  pathOf(ctx, wall);
  ctx.clip();
  flat(ctx, right, mix(C.steelDD, C.ink, 0.2), 0.7);
  hatch(ctx, right, Math.PI / 3, 3.2, { alpha: 0.35, seed: seed + 2 });
  ctx.restore();
  for (let i = 2; i <= 30; i += 4) {
    const [x, y] = rim[i]!;
    ink(ctx, [[x, y], [x, y + depth]], { w: 1, color: C.steelL, alpha: 0.4, shade: false, taper: 0, jitter: 0, seed: seed + 10 + i });
  }
  // The floor's edge, where the wall meets it.
  ink(ctx, rim.map(([x, y]) => [x, y + depth] as Pt), { w: 1.2, color: C.ink, alpha: 0.6, shade: false, taper: 0, jitter: 0, seed: seed + 3 });
  ctx.restore();
  for (let i = 4; i <= 28; i += 6) light(ctx, rim[i]![0], rim[i]![1] + 3, 1.6, C.led);
  ink(ctx, hole, { closed: true, w: 1.4, shade: false, jitter: 0, seed: seed + 4 });
  ink(ctx, outer, { closed: true, w: 1.8, jitter: 0, seed: seed + 5 });
}
