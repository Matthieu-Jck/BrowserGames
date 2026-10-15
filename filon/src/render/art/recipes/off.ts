// off.ts — a building's picture switched off (D83), drawn by its own recipe: through `unlitCtx`
// (its lamps dark glass, their halos gone; the recipe itself leaves out its fire and steam,
// `isUnlit`), then greyed and darkened (`switchOff`). The same frame and anchor as the lit sprite
// it replaces (atlas.ts: the whole canvas), so the buildings view swaps one texture for the other.
import type { BuildingId } from '@/content/buildings';
import type { Rot } from '@/sim/types';
import type { Ctx } from '../ink';
import { switchOff, unlitCtx } from '../unlit';
import { drawBuilding, drawBuildingMoving } from './buildings';
import { drawBuildingTop, drawBuildingTopMoving } from './buildings-top';

/**
 * Draw a building switched off into `ctx` (a canvas of its sprite's size, w × h): its iso or plan
 * picture, or with `body` a moving building's body alone (its part is drawn apart, moving.ts).
 */
export function drawOff(ctx: CanvasRenderingContext2D, id: BuildingId, rot: Rot, iso: boolean, body: boolean, w: number, h: number): void {
  const make = (): { ctx: Ctx; canvas: unknown } => ({ ctx: unlitCtx(ctx), canvas: ctx.canvas });
  if (iso) { if (body) drawBuildingMoving(id, rot, 0, make); else drawBuilding(id, rot, make); }
  else if (body) drawBuildingTopMoving(id, rot, 0, make);
  else drawBuildingTop(id, rot, make);
  switchOff(ctx, Math.ceil(w), Math.ceil(h));
}
