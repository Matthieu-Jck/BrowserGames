// belt-lift.test.ts — how high an item rides and where the traction elevators' cars are (owner,
// 2026-10-13: "the item arrives, gets lifted, advances again, and then the elevator goes down
// again"): at its tile's top on the floor and on rock; across an elevator's low tile it reaches the
// car, waits on it while it rises (or sinks) a terrace, then rolls on, meeting the tiles on either
// side at their own height; the car follows it, then goes back alone; a step down onto a building
// is a slide; among the volumes an item sorts by the tile it rides over (its front-most one, when no
// higher and not built on), after its elevator, inside an incinerator's pit once it tips in.
import { describe, it, expect } from 'vitest';
import { buildingDef, buildingIdx } from '@/content/registry';
import { Entities, footprint } from '@/sim/entities';
import { Grid, tileIndex, type TerrainSource } from '@/sim/world/grid';
import { CHUNK } from '@/sim/constants';
import { T, type Ent, type Rot } from '@/sim/types';
import { STEP_LEVELS } from '../relief';
import { BeltLift, DOWN, ITEM_DZ, RETURN_SHARE, RETURN_TICKS, UP, returnTicks, type LiftWorld, type Placed } from './belt-lift';
import { PIT_Z } from './pits';
import { beltZ, buildingZ, liftZ, rockZ } from './stand';

class Field implements TerrainSource {
  constructor(private readonly at: (x: number, y: number) => number) {}
  fill(cx: number, cy: number, terrain: Uint8Array, _ore: Uint8Array, _rich: Uint16Array, _height?: Uint8Array, _biome?: Uint8Array, level?: Uint8Array): void {
    for (let j = 0; j < CHUNK; j++) {
      for (let i = 0; i < CHUNK; i++) {
        const l = this.at(cx * CHUNK + i, cy * CHUNK + j);
        terrain[j * CHUNK + i] = l > 0 ? T.Rock2 : T.Sand;
        if (level) level[j * CHUNK + i] = l;
      }
    }
  }
}

/** Sand, and rock at land level 1 (a level-2 top) west of x = 500 on rows 470–499; `extra` overrides. */
function world(extra: (x: number, y: number) => number | undefined = () => undefined) {
  const grid = new Grid(new Field((x, y) => extra(x, y) ?? (x < 500 && x >= 470 && y >= 470 && y < 500 ? 1 : 0)));
  const ents = new Entities();
  const put = (def: string, x: number, y: number, rot: Rot = 0): Ent => {
    const e = ents.add({ def: buildingIdx(def), x, y, rot, cfg: 0, builtAt: 0 });
    const [w, h] = footprint(e.def, e.rot);
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) grid.occ[tileIndex(i, j)] = e.id;
    return e;
  };
  return { grid, ents, put };
}

const at = (lift: BeltLift, x: number, y: number): Placed => lift.place(x, y, { x: 0, y: 0, lv: 0, shaft: false });
/** An empty car's way back on a world with no lines compiled: at the lift's own pace (D141). */
const RET = returnTicks(600 / buildingDef(buildingIdx('traction_ribbon')).belt!.perMin);

describe('belt lift: where items ride', () => {
  it('at their tile’s top, on the floor and on the rock', () => {
    const w = world();
    const lift = new BeltLift();
    lift.rebuild(w);
    expect(at(lift, 510.5, 480.5)).toMatchObject({ x: 510.5, y: 480.5, lv: 0, shaft: false });
    expect(at(lift, 490.5, 480.5).lv).toBe(STEP_LEVELS);
  });

  it('climbing: to the car, up with it standing still, then on over the edge; the car goes back down alone', () => {
    const w = world();
    // A traction ribbon on the floor at (500, 480) facing west (3), onto a ribbon on the rock.
    w.put('traction_ribbon', 500, 480, 3);
    w.put('ribbon', 499, 480, 3);
    const lift = new BeltLift();
    lift.rebuild(w);
    // Its progress a across the tile runs from x = 501 (in) to x = 500 (the wall).
    const P = (a: number): Placed => at(lift, 501 - a, 480.5);
    expect(P(0.0001)).toMatchObject({ lv: 0, shaft: true });
    expect(P(0.0001).x).toBeCloseTo(501, 3);
    expect(P(0.9999).x).toBeCloseTo(500, 3);
    expect(P(0.9999).lv).toBeCloseTo(STEP_LEVELS, 3);
    // On the car: it stands still on the plane while it rises.
    const xs = new Set<number>(), lvs: number[] = [];
    for (let a = UP.a1 + 0.01; a < UP.a2; a += 0.05) { const p = P(a); xs.add(Math.round(p.x * 1e6)); lvs.push(p.lv); }
    expect(xs.size).toBe(1);
    for (let i = 1; i < lvs.length; i++) expect(lvs[i]!).toBeGreaterThanOrEqual(lvs[i - 1]!);
    // Never backwards along its way.
    let prev = -Infinity;
    for (let a = 0; a < 1; a += 0.02) { const x = P(a).x; expect(-x).toBeGreaterThanOrEqual(prev - 1e-9); prev = -x; }
    // The car rides with it, and once it is gone goes back down within the return time.
    lift.settle(0);
    P((UP.a1 + UP.a2) / 2);
    const mid = lift.carAt(500, 480);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(STEP_LEVELS);
    lift.settle(1);
    expect(lift.carAt(500, 480)).toBeCloseTo(mid, 6); // held this frame: where the item put it
    P(0.95);
    lift.settle(2);
    expect(lift.carAt(500, 480)).toBe(STEP_LEVELS); // at the top until the item is off
    lift.settle(2 + RET / 2);
    expect(lift.carAt(500, 480)).toBeCloseTo(STEP_LEVELS / 2, 6);
    lift.settle(2 + RET);
    expect(lift.carAt(500, 480)).toBe(0);
  });

  it('coming down onto a ribbon: on to the car at the top, down with it, then on; the car waits at the top', () => {
    const w = world();
    // A traction ribbon on the rock at (499, 481) facing east (1), down onto a ribbon on the floor.
    w.put('traction_ribbon', 499, 481, 1);
    w.put('ribbon', 500, 481, 1);
    const lift = new BeltLift();
    lift.rebuild(w);
    expect(at(lift, 499.9, 481.5).lv).toBe(STEP_LEVELS); // flat on the high tile up to the edge
    const P = (a: number): Placed => at(lift, 500 + a, 481.5);
    expect(P(0).lv).toBe(STEP_LEVELS); // meets the high tile's top at the edge
    expect(P(0.9999).lv).toBe(0);
    expect(P(0.9999).x).toBeCloseTo(501, 3);
    expect(lift.carAt(500, 481)).toBe(STEP_LEVELS); // waiting at the top
    lift.settle(0);
    P((DOWN.a1 + DOWN.a2) / 2);
    expect(lift.carAt(500, 481)).toBeLessThan(STEP_LEVELS);
    lift.settle(1);
    P((DOWN.a2 + DOWN.free) / 2);
    lift.settle(2);
    expect(lift.carAt(500, 481)).toBe(0); // held at the foot while the item clears it
    lift.settle(2 + RET);
    expect(lift.carAt(500, 481)).toBe(STEP_LEVELS);
  });

  it('the car’s way back follows its line’s pace (D141): home within half a step, at every tier', () => {
    // At most RETURN_TICKS, and RETURN_SHARE of a step: an express line's 2.5-tick steps leave it one tick.
    expect(returnTicks(20)).toBe(RETURN_TICKS);
    expect(returnTicks(10)).toBe(RETURN_SHARE * 10);
    for (const steps of [10, 5, 2.5]) expect(returnTicks(steps)).toBeLessThanOrEqual(steps / 2);
    // A climbing lift on an express line (its chain's steps read off the graph): the car is home a tick after the item left it.
    const w = world();
    w.put('traction_ribbon', 500, 480, 3);
    w.put('ribbon', 499, 480, 3);
    const express = { stepTicks: 2.5 };
    const lw: LiftWorld = { ...w, graph: { jumps: new Map(), chainByTile: new Map([[tileIndex(500, 480), express], [tileIndex(499, 480), express]]) } };
    const lift = new BeltLift();
    lift.rebuild(lw);
    const P = (a: number): Placed => at(lift, 501 - a, 480.5);
    lift.settle(0);
    P(0.95);
    lift.settle(0.5);
    expect(lift.carAt(500, 480)).toBe(STEP_LEVELS);
    lift.settle(0.5 + returnTicks(2.5));
    expect(lift.carAt(500, 480)).toBe(0); // home before the next item reaches it, half a step (1.25 ticks) after
  });

  it('coming down onto a building: no shaft, a slide down the ribbon’s last stretch', () => {
    const w = world();
    w.put('traction_ribbon', 499, 482, 1);
    w.put('router', 500, 482, 0);
    const lift = new BeltLift();
    lift.rebuild(w);
    expect(at(lift, 499.5, 482.5)).toMatchObject({ lv: STEP_LEVELS, shaft: false });
    expect(at(lift, 499.9999, 482.5).lv).toBeCloseTo(0, 3);
    expect(at(lift, 500.5, 482.5).lv).toBe(0);
  });

  it('among the volumes: by the tile it rides over, its front-most one when it may overhang it', () => {
    // A tall block (land level 3: a level-6 top) at x 485–489, y 485–489 in the level-1 rock.
    const w = world((x, y) => (x >= 485 && x < 490 && y >= 485 && y < 490 ? 3 : undefined));
    w.put('ribbon', 475, 475, 2);
    w.put('ribbon', 475, 476, 2);
    const lift = new BeltLift();
    lift.rebuild(w);
    const L = STEP_LEVELS;
    // On a ribbon on the rock: after its piece, before the columns in front.
    expect(lift.itemZ(475.5, 475.5, L, true, 0)).toBeCloseTo(beltZ(475, 475) + ITEM_DZ.belt, 9);
    expect(lift.itemZ(475.5, 475.5, L, true, 0)).toBeLessThan(rockZ(476, 475));
    // Crossing onto the next tile of the plateau (towards the viewer): already that tile's, so its top never clips it.
    expect(lift.itemZ(475.5, 475.9, L, true, 0)).toBeCloseTo(beltZ(475, 476) + ITEM_DZ.belt, 9);
    // Against higher rock in front: its own tile's, so the block (drawn after) hides it.
    expect(lift.itemZ(485.5, 484.9, L, true, 0)).toBeCloseTo(beltZ(485, 484) + ITEM_DZ.belt, 9);
    expect(lift.itemZ(485.5, 484.9, L, true, 0)).toBeLessThan(rockZ(485, 485));
    expect(lift.itemZ(484.9, 484.9, L, true, 0)).toBeCloseTo(beltZ(484, 484) + ITEM_DZ.belt, 9); // the corner too
    // On the floor, away from any pit: drawn with the ribbons.
    expect(lift.itemZ(510.5, 480.5, 0, false, 0)).toBeNaN();
  });

  it('down a step away from the viewer: over the high rock while on the car at the top, behind it once it sinks', () => {
    // The tile (490, 481) a terrace up (a level-4 top) over (490, 480): a traction ribbon there runs north, down onto a ribbon.
    const w = world((x, y) => (x === 490 && y === 481 ? 2 : undefined));
    w.put('traction_ribbon', 490, 481, 0);
    w.put('ribbon', 490, 480, 0);
    const lift = new BeltLift();
    lift.rebuild(w);
    const hi = 2 * STEP_LEVELS;
    const key = (a: number): number => { const p = at(lift, 490.5, 481 - a); return lift.itemZ(p.x, p.y, p.lv, p.lv > 0 || p.shaft, 0); };
    // Just onto the car at the top, its back still over the high tile: after that column (it shows over the edge).
    const top = at(lift, 490.5, 481 - 0.05);
    expect(top).toMatchObject({ shaft: true });
    expect(top.lv).toBeCloseTo(hi, 6);
    expect(key(0.05)).toBeGreaterThan(rockZ(490, 481));
    // Sinking with the car: its elevator's, over the elevator's front frame, under the high column in front.
    const mid = (DOWN.a1 + DOWN.a2) / 2;
    expect(at(lift, 490.5, 481 - mid).lv).toBeLessThan(hi);
    expect(key(mid)).toBeCloseTo(liftZ(490, 480) + ITEM_DZ.lift, 9);
    expect(key(mid)).toBeGreaterThan(liftZ(490, 480) + 0.02);
    expect(key(mid)).toBeLessThan(rockZ(490, 481));
    // A building in front of the elevator covers it.
    expect(key(mid)).toBeLessThan(buildingZ(491, 481, 2, 2));
  });

  it('into an incinerator: over its pit on the near half, between its back and its flame on the far half and once it tips in', () => {
    const w = world();
    const inc = w.put('incinerator', 520, 480, 0);
    w.put('ribbon', 520, 481, 0);
    const lift = new BeltLift();
    lift.rebuild(w);
    const z = buildingZ(inc.x, inc.y, 1, 1);
    expect(lift.itemZ(520.5, 481.1, 0, false, 0)).toBeCloseTo(z + PIT_Z.over, 9); // overhanging it from the ribbon
    expect(lift.itemZ(520.5, 480.6, 0, false, 0)).toBeCloseTo(z + PIT_Z.over, 9);
    expect(lift.itemZ(520.5, 480.55, 0, false, 0.5)).toBeCloseTo(z + PIT_Z.fall, 9);
    expect(lift.itemZ(520.5, 480.3, 0, false, 0)).toBeCloseTo(z + PIT_Z.fall, 9); // on the far chute: the flame is in front
    expect(z + PIT_Z.fall).toBeLessThan(z + PIT_Z.flame);
    expect(z + PIT_Z.fall).toBeLessThan(z + PIT_Z.front);
    expect(lift.itemZ(520.5, 481.7, 0, false, 0)).toBeNaN(); // clear of it: with the ribbons
  });
});
