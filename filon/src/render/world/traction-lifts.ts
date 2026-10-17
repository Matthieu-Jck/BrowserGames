// traction-lifts.ts — the traction ribbons' elevators up the terraces' walls, baked on demand (as
// world/sky-decks.ts bakes the skybridge spans): for each way and sense (climbing, coming down)
// the first time it shows up, its three iso parts (art/recipes/lifts.ts `drawLift`: the back, the
// car the views move up and down, the front, on one 1 × 2 frame) and its plan mark
// (`drawLiftTop`), on one DynAtlas of their own, kept for the session (24 iso frames and two plan
// marks at most). Which ribbons get one (`liftOfBelt`) is read from the land: a traction ribbon
// whose next tile's top is one terrace above or below its own. The buildings view lays them; the
// items view rides the items up them and says where each car is (belt-lift.ts).
//
// The conduits' falls share the sheet (D114: a conduit's water pours one terrace down, never up):
// a conduit whose next tile stands one terrace lower and takes its water (`fallOfConduit`, the
// sim's own rule) gets a downpipe against the wall on its low side (art/recipes/falls.ts
// `drawFall`, one iso frame a way) and a plan mark (`drawFallTop`), laid as a lift's.
import { BUILDING_KIND, buildingDef } from '@/content/registry';
import { WORLD } from '@/sim/constants';
import { DX, DY, type Ent, type Rot } from '@/sim/types';
import { DynAtlas, type DynFrame } from '../art/dyn-atlas';
import type { Ctx } from '../art/ink';
import { drawLift, drawLiftTop, LIFT_TOP_PX, type LiftPart } from '../art/recipes/lifts';
import { drawFall, drawFallTop, FALL_TOP_PX } from '../art/recipes/falls';
import { STEP_LEVELS, tileTop, type ReliefLand } from '../relief';

/** A lift's frames: its iso parts (atlas px at 2× world: scale `LIFT_ISO_K`), its plan mark (`LIFT_TOP_PX` a tile). */
export interface LiftFrames { back: DynFrame; car: DynFrame; front: DynFrame; plan: DynFrame }
export const LIFT_ISO_K = 0.5, LIFT_PLAN_K = 1 / LIFT_TOP_PX;

const sheet = new DynAtlas();
const baked = new Map<string, LiftFrames>();
const marks = new Map<boolean, DynFrame>();

function canvasOf(w: number, h: number): { ctx: Ctx; canvas: HTMLCanvasElement } {
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(w);
  canvas.height = Math.ceil(h);
  const ctx = canvas.getContext('2d')!;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  return { ctx, canvas };
}

/** A lift's frames for a way and sense, baked the first time. */
export function liftFrames(rot: Rot, up: boolean): LiftFrames {
  const key = `${rot}:${up ? 'u' : 'd'}`;
  const got = baked.get(key);
  if (got) return got;
  const part = (p: LiftPart): DynFrame => {
    const d = drawLift(p, rot, up, canvasOf);
    const c = d.canvas as HTMLCanvasElement;
    return sheet.add(`${p}:${key}`, c.width, c.height, d.frame.ox, d.frame.oy, (ctx) => ctx.drawImage(c, 0, 0));
  };
  const S = LIFT_TOP_PX;
  const frames: LiftFrames = {
    back: part('back'), car: part('car'), front: part('front'),
    plan: marks.get(up) ?? sheet.add(`p:${up ? 'u' : 'd'}`, S, S, S / 2, S / 2, (ctx) => drawLiftTop(ctx, up)),
  };
  sheet.flush();
  baked.set(key, frames);
  marks.set(up, frames.plan);
  return frames;
}

/**
 * A traction ribbon handing on a terrace up or down: its tile and way, the sense, the low tile
 * (the one the shaft stands on: its own when it climbs, the next when it comes down) and that
 * tile's top (relief levels). `shaft`: there is room for the elevator — always when it climbs;
 * coming down, only onto a ribbon (a building on the low tile leaves none: the items then slide
 * down the ribbon's last stretch, belt-lift.ts).
 */
export interface Lift { x: number; y: number; rot: Rot; up: boolean; lowX: number; lowY: number; low: number; shaft: boolean }

/** The lift of a traction ribbon, if the tile it faces holds something one terrace above or below it; else null. */
export function liftOfBelt(land: ReliefLand, occupant: (x: number, y: number) => number, e: Pick<Ent, 'def' | 'x' | 'y' | 'rot'>): Lift | null {
  if (BUILDING_KIND[e.def] !== 'belt' || !buildingDef(e.def).lift) return null;
  const gx = e.x + DX[e.rot]!, gy = e.y + DY[e.rot]!;
  if (gx < 0 || gy < 0 || gx >= WORLD || gy >= WORLD) return null;
  const next = occupant(gx, gy);
  if (next < 0) return null;
  const a = tileTop(land, e.x, e.y), b = tileTop(land, gx, gy);
  if (Math.abs(a - b) !== STEP_LEVELS) return null;
  const up = b > a;
  return { x: e.x, y: e.y, rot: e.rot, up, lowX: up ? e.x : gx, lowY: up ? e.y : gy, low: Math.min(a, b), shaft: up || BUILDING_KIND[next] === 'belt' };
}

/** A fall's frames: its iso downpipe (atlas px at 2× world: scale `LIFT_ISO_K`), its plan mark (`FALL_TOP_PX` a tile: `LIFT_PLAN_K`). */
export interface FallFrames { pipe: DynFrame; plan: DynFrame }
const falls = new Map<string, FallFrames>();
let fallMark: DynFrame | null = null;

/** A fall's frames for a way and a drop (levels), baked the first time. */
export function fallFrames(rot: Rot, h: number): FallFrames {
  const key = `${rot}:${h}`;
  const got = falls.get(key);
  if (got) return got;
  const d = drawFall(rot, h, canvasOf), c = d.canvas as HTMLCanvasElement;
  const S = FALL_TOP_PX;
  const frames: FallFrames = {
    pipe: sheet.add(`fall:${key}`, c.width, c.height, d.frame.ox, d.frame.oy, (ctx) => ctx.drawImage(c, 0, 0)),
    plan: fallMark ?? sheet.add('fall:p', S, S, S / 2, S / 2, (ctx) => drawFallTop(ctx)),
  };
  sheet.flush();
  falls.set(key, frames);
  fallMark = frames.plan;
  return frames;
}

/** A conduit pouring one terrace down: its tile and way, the low tile it pours into and that tile's top, the drop (relief levels). */
export interface Fall { x: number; y: number; rot: Rot; lowX: number; lowY: number; low: number; h: number }

/**
 * The fall of a conduit, if its water pours down (D114, the sim's rule: compile.ts): the tile ahead
 * stands exactly one terrace lower and holds what takes water — a conduit, or a building whose
 * intake may face it (not a ribbon); else null.
 */
export function fallOfConduit(land: ReliefLand, occupant: (x: number, y: number) => number, e: Pick<Ent, 'def' | 'x' | 'y' | 'rot'>): Fall | null {
  if (BUILDING_KIND[e.def] !== 'conduit') return null;
  const gx = e.x + DX[e.rot]!, gy = e.y + DY[e.rot]!;
  if (gx < 0 || gy < 0 || gx >= WORLD || gy >= WORLD) return null;
  if (land.level(gx, gy) !== land.level(e.x, e.y) - 1) return null;
  const next = occupant(gx, gy);
  if (next < 0) return null;
  const k = BUILDING_KIND[next];
  if (k === 'belt' || k === 'bridge' || k === 'crossing' || k === 'fork') return null;
  const a = tileTop(land, e.x, e.y), b = tileTop(land, gx, gy);
  if (a <= b) return null;
  return { x: e.x, y: e.y, rot: e.rot, lowX: gx, lowY: gy, low: b, h: a - b };
}
