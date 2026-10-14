// wire-geom.test.ts — a wire hangs from its building's terminal, the point the art draws: every
// building that takes part in power has terminals, the art (iso and plan, every baked rotation)
// draws each of them, an anchor lands on one, turned exactly as the art is, lifted onto the rock
// top with a building standing on the mountains (D44); a pole picks the pin that faces the wire,
// the Heart its nearer link mast; and the catenary's sag rules hold.
import { describe, it, expect } from 'vitest';
import { BUILDING_IDS, buildingDef, buildingIdx, isBeltDef } from '@/content/registry';
import type { BuildingId } from '@/content/buildings';
import { linkable } from '@/sim/power/links';
import { CHUNK } from '@/sim/constants';
import { Entities, footprint } from '@/sim/entities';
import { Grid, tileIndex } from '@/sim/world/grid';
import { T, type Rot } from '@/sim/types';
import type { Ctx } from '../art/ink';
import { IsoFrame } from '../art/iso-shapes';
import { artOf } from '../art/recipes/fx';
import { drawBuilding, isoHead } from '../art/recipes/buildings';
import { drawBuildingTop } from '../art/recipes/buildings-top';
import { HEART_MASTS, POLE, TERMINALS, artRot, onArm, terminalProbe, terminalsOf, turnsArt } from '../art/terminals';
import { LH, tileToIso } from '../iso';
import { catenary, flowWays, footCentre, pointAlong, polyLengths, sagPx, terminalsAt, wireAnchor, wireCurve, wireEnds, wireSegments } from './wire-geom';
import { computeStands } from './stand';

const at = (def: string, x: number, y: number, rot: Rot = 0): { def: number; x: number; y: number; rot: Rot } => ({ def: buildingIdx(def), x, y, rot });
const POWERED = (BUILDING_IDS as readonly string[]).filter((id) => !isBeltDef(id) && linkable(buildingIdx(id))) as BuildingId[];
const ROTS: readonly Rot[] = [0, 1, 2, 3];

/** The clamp points a drawing reports (local tiles, levels), drawn on the light spy's stand-in context. */
function drawn(draw: (ctx: Ctx) => void): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  terminalProbe.fn = (x, y, z) => out.push([x, y, z]);
  try { artOf(draw); } finally { terminalProbe.fn = null; }
  return out;
}

describe('terminals: where the wires meet the buildings', () => {
  it('every building that takes part in power has its own terminals, on its footprint, under its head', () => {
    expect(POWERED.length).toBeGreaterThan(20);
    for (const id of POWERED) {
      expect(TERMINALS[id], id).toBeDefined();
      const def = buildingDef(buildingIdx(id));
      for (const t of terminalsOf(id)) {
        expect(t.x, id).toBeGreaterThan(0); expect(t.x, id).toBeLessThan(def.w);
        expect(t.y, id).toBeGreaterThan(0); expect(t.y, id).toBeLessThan(def.h);
        expect(t.z, id).toBeGreaterThan(0.5); expect(t.z, id).toBeLessThanOrEqual(isoHead(id));
      }
    }
  });

  it('the art draws every terminal, in iso and in plan, in every rotation it bakes', () => {
    for (const id of POWERED) {
      for (const rot of (turnsArt(id) ? ROTS : [0 as Rot])) {
        for (const [view, pts] of [
          ['iso', drawn((ctx) => { drawBuilding(id, rot, () => ({ ctx, canvas: null })); })],
          ['plan', drawn((ctx) => { drawBuildingTop(id, rot, () => ({ ctx, canvas: null })); })],
        ] as const) {
          for (const t of terminalsOf(id)) {
            const hit = pts.some(([x, y, z]) => Math.abs(x - t.x) < 1e-9 && Math.abs(y - t.y) < 1e-9 && Math.abs(z - t.z) < 1e-9);
            expect(hit, `${id} r${rot} ${view}: (${t.x}, ${t.y}, ${t.z}) not drawn`).toBe(true);
          }
        }
      }
    }
  });

  it('a building that takes no part in power wears no terminal', () => {
    const idle = (BUILDING_IDS as readonly string[]).filter((id) => !isBeltDef(id) && !linkable(buildingIdx(id))) as BuildingId[];
    expect(idle).toContain('kiln');
    // The Link tool's refused preview still points at it: its footprint centre.
    const kiln = at('kiln', 40, 40, 1), [kx, ky] = footCentre(kiln), K = wireAnchor(kiln, 0, 0);
    expect([K.x, K.y]).toEqual([kx, ky]);
    expect(K.z).toBeGreaterThan(0.5);
    for (const id of idle) {
      expect(terminalsOf(id), id).toEqual([]);
      expect(drawn((ctx) => { drawBuilding(id, 0, () => ({ ctx, canvas: null })); }), id).toEqual([]);
      expect(drawn((ctx) => { drawBuildingTop(id, 0, () => ({ ctx, canvas: null })); }), id).toEqual([]);
    }
  });

  it('a wire anchors on a terminal, turned exactly as the art turns it (iso px from the sprite anchor)', () => {
    for (const id of POWERED) {
      const def = buildingDef(buildingIdx(id));
      for (const rot of ROTS) {
        const e = at(id, 100, 200, rot);
        const f = new IsoFrame(def.w, def.h, artRot(id, rot), isoHead(id));
        const world = terminalsAt(e);
        expect(world.length, id).toBe(terminalsOf(id).length);
        for (const [i, t] of terminalsOf(id).entries()) {
          const T = world[i]!;
          // The art's point for this terminal, in world px from the sprite's anchor (atlas px × 0.5).
          const [px, py] = f.p(t.x, t.y, t.z);
          const [wx, wy] = tileToIso(T.x - e.x, T.y - e.y, T.z);
          expect(wx, `${id} r${rot}`).toBeCloseTo((px - f.ox) * 0.5, 6);
          expect(wy, `${id} r${rot}`).toBeCloseTo((py - f.oy) * 0.5, 6);
        }
        // Whatever the direction, the anchor is one of them.
        for (const [dx, dy] of [[30, 0], [0, -30], [-20, 25], [9, 9]] as const) {
          const A = wireAnchor(e, e.x + dx, e.y + dy);
          expect(world.some((T) => T.x === A.x && T.y === A.y && T.z === A.z), `${id} r${rot}`).toBe(true);
        }
      }
    }
  });

  it('a building drawn once keeps its terminals where its rot-0 art has them; a turning one turns them with its ports', () => {
    const t0 = terminalsAt(at('wind_flower', 0, 0, 0)), t1 = terminalsAt(at('wind_flower', 0, 0, 1));
    expect(t1).toEqual(t0);
    const d0 = terminalsAt(at('drill', 0, 0, 0))[0]!, d2 = terminalsAt(at('drill', 0, 0, 2))[0]!;
    expect(d2.x).toBeCloseTo(2 - d0.x, 9);
    expect(d2.y).toBeCloseTo(2 - d0.y, 9);
    // A 1×2 machine turned a quarter: its terminal follows into the 2×1 footprint.
    const m = terminalsOf('wire_mill')[0]!, m1 = terminalsAt(at('wire_mill', 0, 0, 1))[0]!;
    expect([m1.x, m1.y]).toEqual([2 - m.y, m.x]);
  });

  it('a pole hangs a wire along its crossarm from the pin at that end, a wire across it from its top pin', () => {
    const pole = at('mast', 50, 50);
    const [cx, cy] = footCentre(pole);
    const [rx, ry] = onArm(cx, cy, 6), [lx, ly] = onArm(cx, cy, -6), [fx, fy] = onArm(cx, cy, 0, 6);
    const right = wireAnchor(pole, rx, ry), left = wireAnchor(pole, lx, ly), front = wireAnchor(pole, fx, fy);
    const [pr] = onArm(POLE.cx + 50, POLE.cy + 50, POLE.pin), [pl] = onArm(POLE.cx + 50, POLE.cy + 50, -POLE.pin);
    expect(right.x).toBeCloseTo(pr, 9);
    expect(left.x).toBeCloseTo(pl, 9);
    expect([front.x, front.y]).toEqual([cx, cy]);
    expect(front.z).toBeGreaterThan(right.z);
  });

  it('a building standing on the mountains hangs its wires from its terminals lifted onto the rock top (D44)', () => {
    // A level-6 plateau east of x = 100, on a floor; the land one height.
    const grid = new Grid({
      fill(cx, cy, terrain, _o, _r, _h, _b, level) {
        for (let k = 0; k < CHUNK * CHUNK; k++) {
          const rock = cx * CHUNK + (k % CHUNK) >= 100;
          terrain[k] = rock ? T.Rock3 : T.Sand;
          if (level) level[k] = rock ? 3 : 0;
        }
      },
    });
    const ents = new Entities();
    const put = (def: string, x: number, y: number): ReturnType<Entities['add']> => {
      const e = ents.add({ def: buildingIdx(def), x, y, rot: 0, cfg: 0, builtAt: 0 });
      const [w, h] = footprint(e.def, e.rot);
      for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) grid.occ[tileIndex(i, j)] = e.id;
      return e;
    };
    const pole = put('mast', 95, 50), turbine = put('wind_flower', 104, 50);
    const L = computeStands({ grid, ents }).get(turbine.id)!.level;
    expect(L).toBe(6);
    // The same terminals as the art draws them, L levels up; the pole on the floor keeps its own.
    const flat = terminalsAt({ def: turbine.def, x: turbine.x, y: turbine.y, rot: turbine.rot }), up = terminalsAt(turbine);
    for (const [i, t] of up.entries()) expect([t.x, t.y, t.z]).toEqual([flat[i]!.x, flat[i]!.y, flat[i]!.z + L]);
    expect(terminalsAt(pole)).toEqual(terminalsAt({ def: pole.def, x: pole.x, y: pole.y, rot: pole.rot }));
    // The wire runs from the pole's pin up to the turbine's clamp: its iso end L levels (L·LH px) higher.
    const [A, B] = wireEnds(pole, turbine);
    expect(B.z).toBeGreaterThan(L);
    const pts = wireCurve(A, B), n = pts.length; // (Float32: compare to a hundredth of a px)
    const [ex, ey] = tileToIso(B.x, B.y, B.z - L);
    expect(pts[n - 2]).toBeCloseTo(ex, 2);
    expect(pts[n - 1]).toBeCloseTo(ey - L * LH, 2);
    expect(pts[1]).toBeCloseTo(tileToIso(A.x, A.y, A.z)[1], 2);
  });

  it('the Heart takes each wire on its nearer link mast; the pole beside it turns to that mast', () => {
    const heart = at('hearth', 510, 510);
    const west = at('mast', 504, 512), east = at('mast', 518, 513);
    const [W] = wireEnds(heart, west), [E] = wireEnds(heart, east);
    expect([W.x - 510, W.y - 510]).toEqual([...HEART_MASTS.at[0]!]);
    expect([E.x - 510, E.y - 510]).toEqual([...HEART_MASTS.at[1]!]);
    expect(W.z).toBe(HEART_MASTS.top);
    // Both ends of a wire, whichever end is asked first in the table's order, are terminals.
    const [A, B] = wireEnds(west, heart);
    expect(terminalsAt(west).some((t) => t.x === A.x && t.y === A.y)).toBe(true);
    expect(terminalsAt(heart).some((t) => t.x === B.x && t.y === B.y)).toBe(true);
  });
});

describe('wire geometry', () => {
  it('a wire hangs from anchor to anchor and sags most at mid-span', () => {
    const A = { x: 0, y: 0, z: 3 }, B = { x: 6, y: 0, z: 3 };
    const pts = catenary(A, B, 12, 6);
    const [ax, ay] = tileToIso(0, 0, 3), [bx, by] = tileToIso(6, 0, 3);
    expect([pts[0], pts[1]]).toEqual([ax, ay]);
    expect([pts[12], pts[13]]).toEqual([bx, by]);
    // How far under the chord each point hangs: most at mid-span (12 px), the same at t and 1 − t.
    const under = (i: number): number => pts[i * 2 + 1]! - (ay + ((by - ay) * i) / 6);
    expect(under(3)).toBeCloseTo(12, 4);
    expect(under(1)).toBeCloseTo(under(5), 4);
    expect(under(1)).toBeLessThan(under(2));
  });

  it('the sag grows with the span, is capped, and never reaches the ground, even from a low terminal', () => {
    expect(sagPx(6, 3)).toBeLessThan(sagPx(20, 3));
    expect(sagPx(200, 9)).toBe(2.5 * LH);
    expect(sagPx(30, 1)).toBeLessThanOrEqual(0.5 * LH);
    expect(sagPx(10, 0.2)).toBe(0);
    // The lowest terminal of all keeps its wire off the ground.
    const low = Math.min(...POWERED.flatMap((id) => terminalsOf(id).map((t) => t.z)));
    expect(low - sagPx(40, low) / LH).toBeGreaterThanOrEqual(0.5 - 1e-9);
    expect(wireSegments(2)).toBe(6);
    expect(wireSegments(100)).toBe(20);
  });

  it('a point a fraction of the way along a polyline, by length', () => {
    const pts = Float32Array.from([0, 0, 10, 0, 10, 30]);
    const lens = polyLengths(pts);
    expect(Array.from(lens)).toEqual([0, 10, 40]);
    const p = { x: 0, y: 0 };
    pointAlong(pts, lens, 0, p); expect(p).toEqual({ x: 0, y: 0 });
    pointAlong(pts, lens, 0.25, p); expect(p).toEqual({ x: 10, y: 0 });
    pointAlong(pts, lens, 0.5, p); expect(p).toEqual({ x: 10, y: 10 });
    pointAlong(pts, lens, 1, p); expect(p).toEqual({ x: 10, y: 30 });
  });
});

describe('the glints’ way along the wires', () => {
  it('runs from the generators towards what they feed, wire by wire; not between two generators, nor across a loop’s middle', () => {
    // Heart 1 — pole 2 — pole 3 — drill 4; a turbine 5 on pole 3; a loop 2 — 6 — 7 — 3; turbine 8 wired to the Heart.
    const w = (a: number, b: number): { a: number; b: number; way: number } => ({ a, b, way: 9 });
    const wires = [w(2, 1), w(2, 3), w(4, 3), w(5, 3), w(2, 6), w(6, 7), w(7, 3), w(1, 8)];
    flowWays(wires, (id) => id === 1 || id === 5 || id === 8);
    // Heart → pole 2 (stored 2→1: backwards); turbine 5 → pole 3; pole 3 → drill 4 (stored 4→3: backwards).
    expect(wires.map((x) => x.way)).toEqual([-1, 0, -1, 1, 1, 0, -1, 0]);
  });
});
