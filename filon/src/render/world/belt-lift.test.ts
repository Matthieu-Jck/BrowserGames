// belt-lift.test.ts — how high an item rides and where the traction elevators' cars are (owner,
// 2026-10-13: "the item arrives, gets lifted, advances again, and then the elevator goes down
// again"): at its tile's top on the floor and on rock; across an elevator's low tile it reaches the
// car, waits on it while it rises (or sinks) a terrace, then rolls on, meeting the tiles on either
// side at their own height; the car follows it, then goes back alone; a step down onto a building
// is a slide; an item is drawn over the volumes unless higher rock in front covers it.
import { describe, it, expect } from 'vitest';
import { buildingIdx } from '@/content/registry';
import { Entities, footprint } from '@/sim/entities';
import { Grid, tileIndex, type TerrainSource } from '@/sim/world/grid';
import { CHUNK } from '@/sim/constants';
import { T, type Ent, type Rot } from '@/sim/types';
import { STEP_LEVELS } from '../relief';
import { BeltLift, DOWN, RETURN_TICKS, UP, type Placed } from './belt-lift';

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
    lift.settle(2 + RETURN_TICKS / 2);
    expect(lift.carAt(500, 480)).toBeCloseTo(STEP_LEVELS / 2, 6);
    lift.settle(2 + RETURN_TICKS);
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
    lift.settle(2 + RETURN_TICKS);
    expect(lift.carAt(500, 481)).toBe(STEP_LEVELS);
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

  it('over the volumes on open rock; under them behind higher rock in front', () => {
    // A tall block (land level 3: a level-6 top) at x 485–489, y 485–489 in the level-1 rock.
    const w = world((x, y) => (x >= 485 && x < 490 && y >= 485 && y < 490 ? 3 : undefined));
    const lift = new BeltLift();
    lift.rebuild(w);
    expect(lift.over(475, 475)).toBe(true);
    expect(lift.over(484, 484)).toBe(false); // the block's corner rises right in front of it
    expect(lift.over(483, 484)).toBe(false);
    expect(lift.over(487, 492)).toBe(true); // in front of the block, not behind it
  });
});
