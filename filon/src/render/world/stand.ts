// stand.ts — how high a building stands and where it sorts among the cliffs: the one answer its
// sprites, its moving part, its cast shadow, its night lights, its wires, the build ghost and the
// picking share (D44). Pure: no Pixi.
//
// A building stands at the height of the tiles under it — relief.ts `tileTop`, the ONE height
// function every lift reads (today the relief's own terraces, the very ones the relief sprites and
// the painted relief are drawn at, so it meets the rock top at any zoom: no floating, no sinking) —
// the highest under its footprint: 0 on the floor, which is where everything stands but the
// buildings that may stand on the mountains (content `onRock`: the wind turbine, the pole, the
// pylon, the survey beacon). A level shows as `level·LH` px up in iso, as a shift of `level·SHIFT`
// tiles along −x −y on a ground plane, and as nothing in plan.
//
// Ribbons and conduits have no stand: each piece lies on its own tile's top (`tileTop`). On the
// floor it lies on the ground plane with the other ribbons; on rock it is drawn on the column's top
// among the volumes, sorted by `beltZ` — after its own column, before whatever stands in front —
// and a traction ribbon's lift up a terrace's wall by `liftZ` (owner, 2026-10-13: ribbons on the
// mountains were drawn at the floor, under the rock).
//
// Its depth key (docs/render.md §7.4: 4 × doubled depth + kind) sorts it after every column under
// it — by its FRONT tile, not its centre, or the column under its front corner would cover it — and
// on past the columns ahead of it that stand no higher than it, as far as its cast shadow can fall
// (`reach`): the shadow lies on that rock just under the building (key − 0.3) and the rock never
// covers it. Columns no higher than a building and ahead of it never overlap it on screen, so
// passing them changes nothing else. The reach stops short of a higher column (rock in front of it
// still hides it) and of a building on the floor (it stays in front), and leaves the lifted
// buildings ahead of it after it.
//
// The buildings view works the stands out once per rebuild (`computeStands`, on every structural
// change) and keeps each with its entity object; the other views read them back (`standOf`,
// `liftOf`): nothing re-reads the land per frame.
import { BUILDING_IDS, BUILDING_KIND } from '@/content/registry';
import type { BuildingId } from '@/content/buildings';
import { WORLD } from '@/sim/constants';
import { footprint } from '@/sim/entities';
import type { Ent, Rot } from '@/sim/types';
import { isoHead } from '../art/recipes/buildings';
import { tileTop, type ReliefLand } from '../relief';
import { shadowReach } from './cast-shadows';

/** Where a building stands: the relief level under it (0: the floor) and its depth key among the volumes (`objects` zIndex). */
export interface Stand { readonly level: number; readonly z: number }

/** The depth keys of the shared sortable layer (`objects`, docs/render.md §7.4): 4 × (2 × depth) + kind. A rock column (kind 0). */
export const rockZ = (x: number, y: number): number => 8 * (x + y);

/** A building on the floor: 4 × (2 × centre depth of the footprint) + 1. */
export const buildingZ = (x: number, y: number, w: number, h: number): number => 4 * (2 * x + w - 1 + 2 * y + h - 1) + 1;

/**
 * The depth key of a building standing above the floor: after the columns of its front tile's
 * diagonal and of `reach` diagonals beyond, before the floor buildings of the last one (kind 0.5).
 */
export const standZ = (x: number, y: number, w: number, h: number, reach: number): number => 8 * (x + w - 1 + y + h - 1 + reach) + 0.5;

/**
 * Plan: the hint of a building's height — a short ink shadow on the map, down-right of it as the
 * art's shadows fall, longer the higher it stands. Its offset (tiles, along x and y alike).
 */
export const riseOffset = (level: number): number => 0.05 + 0.016 * level;

/** The level a footprint stands at: the highest terrace under it (0 on the floor). */
export function footLevel(level: (x: number, y: number) => number, x: number, y: number, w: number, h: number): number {
  let top = 0;
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) { const l = level(i, j); if (l > top) top = l; }
  return top;
}

/** Ribbons and conduits lie flat on their tile's top (belt pieces): they have no stand. */
export const flat = (def: number): boolean => BUILDING_KIND[def] === 'belt' || BUILDING_KIND[def] === 'conduit';

/** A ribbon piece on a rock top (kind 0.5): after the columns of its diagonal, before those in front. */
export const beltZ = (x: number, y: number): number => 8 * (x + y) + 0.5;

/**
 * A traction ribbon's lift, keyed by the LOW tile of its step (it stands there, against the high
 * one's wall): after that tile's own ribbon (it rises over it), before the columns in front — so a
 * high column in front of it (the wall facing away from the camera) hides all but its head.
 */
export const liftZ = (lowX: number, lowY: number): number => 8 * (lowX + lowY) + 0.7;

/**
 * The plan layer's bands (`plan` is sorted too; a building's sprites at 0, in the order laid): the
 * plan copies of ribbons on rock (and of junctions' passages), the elevators' marks over them, the
 * items riding them over those (items-view.ts) — all under the plan buildings, as on the floor.
 */
export const PLAN_Z = { belt: -2, mark: -1.5, items: -1 } as const;

/** The level a building of `def` would stand at, its rotated footprint's origin at (x, y): the build ghost's lift. */
export function standLevel(land: ReliefLand, def: number, x: number, y: number, rot: Rot): number {
  if (flat(def)) return 0;
  const [w, h] = footprint(def, rot);
  return footLevel((i, j) => tileTop(land, i, j), x, y, w, h);
}

/** How high a placed entity is drawn: its stand's level, or for a ribbon its tile's top. */
export function drawnLevel(land: ReliefLand, e: Pick<Ent, 'def' | 'x' | 'y'>): number {
  return flat(e.def) ? tileTop(land, e.x, e.y) : STANDS.get(e)?.level ?? 0;
}

/** Each lifted building's stand, by entity object (so two colonies — a debug base and the player's — never mix). */
const STANDS = new WeakMap<object, Stand>();

/** A placed building's stand, as the buildings view last worked it out (undefined: it stands on the floor). */
export const standOf = (e: object): Stand | undefined => STANDS.get(e);

/** How high a placed building stands (levels; 0 on the floor). */
export const liftOf = (e: object): number => STANDS.get(e)?.level ?? 0;

/** A placed building's depth key among the volumes: its stand's above the floor, `buildingZ` on it. */
export function depthKey(e: Pick<Ent, 'def' | 'x' | 'y' | 'rot'>): number {
  const s = STANDS.get(e);
  if (s) return s.z;
  const [w, h] = footprint(e.def, e.rot);
  return buildingZ(e.x, e.y, w, h);
}

/** What the stands read of a colony (a Sim): its land and occupancy, its buildings. */
export interface StandWorld {
  readonly grid: ReliefLand & { readonly occ: Int32Array };
  readonly ents: { sorted(): readonly Ent[]; get(id: number): Ent | undefined };
}

interface Lifted { e: Ent; level: number; w: number; h: number; front: number }

/**
 * The stand of every building standing above the floor (on each rebuild of the buildings view),
 * kept with its entity for the other views and returned by id. Lifted buildings are worked out
 * front to back, so each one's reach can keep it behind the lifted buildings ahead of it.
 */
export function computeStands(world: StandWorld): Map<number, Stand> {
  const out = new Map<number, Stand>();
  const top = (x: number, y: number): number => tileTop(world.grid, x, y);
  // The reach scans look at the same tiles again and again: their tops are kept for this rebuild.
  const memo = new Map<number, number>();
  const level = (x: number, y: number): number => {
    if (x < 0 || y < 0 || x >= WORLD || y >= WORLD) return 0;
    const k = y * WORLD + x;
    let l = memo.get(k);
    if (l === undefined) memo.set(k, (l = top(x, y)));
    return l;
  };
  const up: Lifted[] = [];
  for (const e of world.ents.sorted()) {
    if (flat(e.def)) continue;
    const [w, h] = footprint(e.def, e.rot);
    const l = footLevel(top, e.x, e.y, w, h);
    if (l > 0) up.push({ e, level: l, w, h, front: e.x + w - 1 + e.y + h - 1 });
    else STANDS.delete(e);
  }
  up.sort((a, b) => b.front - a.front || a.e.id - b.e.id);
  for (const b of up) {
    const s: Stand = { level: b.level, z: standZ(b.e.x, b.e.y, b.w, b.h, reachOf(world, b, level, out)) };
    out.set(b.e.id, s);
    STANDS.set(b.e, s);
  }
  return out;
}

/**
 * How many diagonals past its front tile a lifted building may sort (its shadow shows over that
 * rock): as far as its longest shadow falls, scanning the tiles ahead whose columns could overlap
 * the building or its shadow on screen (its footprint's screen span widened by a tile each side
 * for the art, and by the shadow's reach on the light's side). Stops short of a higher column and
 * of a building on the floor; stays behind the lifted buildings ahead (their keys are known).
 */
function reachOf(world: StandWorld, b: Lifted, level: (x: number, y: number) => number, done: ReadonlyMap<number, Stand>): number {
  const { e } = b;
  const ext = shadowReach(isoHead(BUILDING_IDS[e.def] as BuildingId));
  let reach = Math.ceil(ext) + 1;
  // Screen columns as u = x − y: a tile spans u ± 1, so tiles within 1 of the footprint's span can overlap it.
  const u0 = e.x - (e.y + b.h - 1) - 2, u1 = e.x + b.w - 1 - e.y + 2 + Math.ceil(ext);
  for (let k = 1; k <= reach; k++) {
    const d = b.front + k;
    for (let u = u0 + ((u0 + d) & 1); u <= u1; u += 2) {
      const i = (d + u) / 2, j = (d - u) / 2;
      if (level(i, j) > b.level) return Math.min(reach, k - 1); // rock in front of it still hides it
      if (i < 0 || j < 0 || i >= WORLD || j >= WORLD) continue;
      const o = world.grid.occ[j * WORLD + i]!;
      if (!o || o === e.id) continue;
      const ahead = done.get(o);
      if (ahead) { reach = Math.min(reach, (ahead.z - 0.5) / 8 - b.front - 1); continue; } // a lifted building ahead stays after it
      const oe = world.ents.get(o);
      if (!oe || !flat(oe.def)) return Math.min(reach, k - 1); // a building on the floor ahead stays in front
    }
  }
  return reach;
}
