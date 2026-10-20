// sky-decks.ts — the skybridge pairs' spans, baked on demand. A pair's two ends share one
// drawing (an end cannot tell the start from the far end: art/recipes/buildings.ts `SKY`), so
// what the pair makes of them is drawn apart, piece by piece: the start's ramp up, the deck over
// each square between, the far end's ramp down (`SkyPiece`). For each piece and rotation the
// first time it shows up: its iso volume in two parts (`drawSkyPiece`, on the end's own frame: the
// back under the items riding it, the front — near girder, near face, a ramp's gantry — over them,
// D130), its plan sprite (`drawSkyPieceTop`) and its cast-shadow mask (`drawSkyPieceShadow` into a
// silhouette, cut at the seam through its foot as the buildings' masks are), on one DynAtlas of
// their own, kept for the session (a score of small frames at most). The buildings view lays them
// (`addDecks`). The junctions' two parts share the sheet (D130, `junctionFrames`: the little bridge's
// back under the items riding its deck, its front — near wall, arch, near parapet and posts — over
// them and over those in its tunnel), one pair a deck axis (D158: north–south, east–west).
import type { Rot } from '@/sim/types';
import { DynAtlas, type DynFrame } from '../art/dyn-atlas';
import { drawJunctionPart, drawSkyPiece, drawSkyPieceShadow, skyShadowFrame, type SkyPiece } from '../art/recipes/buildings';
import { drawSkyPieceTop, TOP_PX } from '../art/recipes/buildings-top';
import type { Ctx } from '../art/ink';
import { silhouette } from '../art/silhouette';
import { seamClip } from './cast-shadows';

/** A piece's frames: iso, its back and its front (atlas px at 2× world: scale `ISO_K`), plan (64 px a tile: scale `PLAN_K`), shadow mask (1 px a world px). */
export interface SkyFrames { back: DynFrame; front: DynFrame; plan: DynFrame; shadow: DynFrame }
export const ISO_K = 0.5, PLAN_K = 1 / TOP_PX;

const sheet = new DynAtlas();
const baked = new Map<string, SkyFrames>();

/** A canvas to draw a piece into (the recipes' `make`). */
function canvasOf(w: number, h: number): { ctx: Ctx; canvas: HTMLCanvasElement } {
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(w);
  canvas.height = Math.ceil(h);
  const ctx = canvas.getContext('2d')!;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  return { ctx, canvas };
}

/** A drawn canvas onto the sheet, anchored at (ox, oy). */
function bake(key: string, c: HTMLCanvasElement, ox: number, oy: number): DynFrame {
  return sheet.add(key, c.width, c.height, ox, oy, (ctx) => ctx.drawImage(c, 0, 0));
}

/** A piece's frames for a rotation, baked the first time; `dx`, `dy`: the light's lay (world/cast-shadows.ts). */
export function skyFrames(piece: SkyPiece, rot: Rot, dx: number, dy: number): SkyFrames {
  const key = `${piece}:${rot}`;
  const got = baked.get(key);
  if (got) return got;
  const back = drawSkyPiece(piece, rot, canvasOf, 'back'), front = drawSkyPiece(piece, rot, canvasOf, 'front');
  const plan = drawSkyPieceTop(piece, rot, canvasOf);
  const f = skyShadowFrame(rot, dx, dy);
  const [fx, fy] = f.pr(f.rw / 2, f.rh / 2, 0); // the foot: the square's centre on the ground (atlas px)
  const frames: SkyFrames = {
    back: bake(`b:${key}`, back.canvas as HTMLCanvasElement, back.frame.ox, back.frame.oy),
    front: bake(`f:${key}`, front.canvas as HTMLCanvasElement, front.frame.ox, front.frame.oy),
    plan: bake(`p:${key}`, plan.canvas as HTMLCanvasElement, plan.frame.M, plan.frame.M),
    shadow: sheet.add(`s:${key}`, f.SW / 2, f.SH / 2, f.ox / 2, f.oy / 2, (ctx) => {
      const clip = seamClip(fx / 2, fy / 2, f.SW + f.SH);
      ctx.beginPath();
      ctx.moveTo(clip[0]![0], clip[0]![1]);
      for (const [x, y] of clip) ctx.lineTo(x, y);
      ctx.closePath();
      ctx.clip();
      ctx.scale(0.5, 0.5);
      drawSkyPieceShadow(piece, rot, dx, dy, silhouette(ctx));
    }),
  };
  sheet.flush();
  baked.set(key, frames);
  return frames;
}

/** A junction's two parts (iso, atlas px at 2× world: scale `ISO_K`; one drawing a deck axis, D158). */
export interface JunctionFrames { back: DynFrame; front: DynFrame }
const junction: Array<JunctionFrames | null> = [null, null];

/** The parts of a junction turned `rot` — its deck north–south (rot 0, 2) or east–west (1, 3) — baked the first time (D130). */
export function junctionFrames(rot: Rot = 0): JunctionFrames {
  const ax = rot & 1;
  const have = junction[ax];
  if (have) return have;
  const part = (p: 'back' | 'front'): DynFrame => { const d = drawJunctionPart(p, canvasOf, ax as Rot); return bake(`j:${p}:${ax}`, d.canvas as HTMLCanvasElement, d.frame.ox, d.frame.oy); };
  const fr = { back: part('back'), front: part('front') };
  junction[ax] = fr;
  sheet.flush();
  return fr;
}
