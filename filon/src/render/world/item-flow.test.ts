// item-flow.test.ts — the ribbons' paths (item-flow.ts): bends round the corner, a block's path
// through its centre, a junction's hump over the north–south line and none under the east–west one.
// How items are placed on them, frame by frame, is cell-flow.test.ts.
import { describe, it, expect } from 'vitest';
import { testSim, line } from '@/sim/testkit';
import { opposite, type Ent, type Rot } from '@/sim/types';
import { tileIndex } from '@/sim/world/grid';
import type { Sim } from '@/sim/state';
import { HUMP_Z, buildPieces, piecePoint, makePiece, overJunction, pieceAt } from './item-flow';
import { junctionHump } from '../art/recipes/buildings';

/** The views' rule for a ribbon tile (buildings-view's beltPiece, which pulls in Pixi). */
function beltPiece(sim: Sim, e: Ent): { corner: boolean; rot: Rot } {
  const r = e.rot;
  const fed = sim.graph?.feedDirs.get(tileIndex(e.x, e.y)) ?? 0;
  if (!fed || fed & (1 << opposite(r))) return { corner: false, rot: r };
  const sides = ([((r + 1) & 3), ((r + 3) & 3)] as Rot[]).filter((s) => fed & (1 << s));
  return sides.length === 1 ? { corner: true, rot: opposite(sides[0]!) } : { corner: false, rot: r };
}

function layout(build: (sim: Sim) => void): { sim: Sim } {
  const sim = testSim();
  sim.grant('iron_plate', 500); sim.grant('copper_wire', 200); sim.grant('glass', 100); sim.grant('gear', 50);
  build(sim);
  for (const e of sim.ents.map.values()) e.builtAt = 0;
  sim.markDirty();
  sim.ensureCompiled();
  return { sim };
}

const N = 0 as Rot, S = 2 as Rot, E = 1 as Rot, W = 3 as Rot;

/**
 * Two junctions, each crossed both ways: at (512, 503) the north–south line runs south over its
 * bridge and the east–west one east under it; at (512, 520) north over it and west under it.
 * Every line ends in the Heart.
 */
function junctionLayout(): { sim: Sim } {
  return layout((sim) => {
    sim.placeBelts('ribbon', line(512, 497, S, 6));
    expect(sim.place('crossing', 512, 503, S).ok).toBe(true);
    sim.placeBelts('ribbon', line(512, 504, S, 6));
    sim.placeBelts('ribbon', line(505, 503, E, 7));
    sim.placeBelts('ribbon', [...line(513, 503, E, 5), ...line(518, 503, S, 8), ...line(518, 511, W, 4)]);
    expect(sim.placeBelts('ribbon', line(512, 524, N, 4))).toBe(4);
    expect(sim.place('crossing', 512, 520, E).ok).toBe(true);
    sim.placeBelts('ribbon', line(512, 519, N, 5));
    expect(sim.placeBelts('ribbon', line(519, 520, W, 7))).toBe(7);
    expect(sim.placeBelts('ribbon', [...line(511, 520, W, 6), ...line(505, 520, N, 8), ...line(505, 512, E, 5)])).toBe(19);
  });
}

describe('ribbon paths', () => {
  it('pieces: a bend goes round the corner, a block path through its centre', () => {
    const b = makePiece(0, 0, E, S); // in from the west, out to the south
    const [x0, y0] = piecePoint(b, 0);
    expect(x0).toBeCloseTo(0, 9); expect(y0).toBeCloseTo(0.5, 9);
    const [x1, y1] = piecePoint(b, 1);
    expect(x1).toBeCloseTo(0.5, 9); expect(y1).toBeCloseTo(1, 9);
    const [xm, ym] = piecePoint(b, 0.5);
    expect(Math.hypot(xm - 0, ym - 1)).toBeCloseTo(0.5, 9); // on the quarter circle round the corner (0, 1)
  });

  it('a junction is a little bridge: pieces over it ride its hump, pieces under it stay flat', () => {
    const { sim } = junctionLayout();
    const pieces = buildPieces(sim, beltPiece, 20);
    const P = { x: 0, y: 0, z: 0, o: 0 };
    // The north–south line (south, into (512, 503)): flat on its own tile, then up onto the bridge,
    // at the crown mid-junction, on the art's own profile all the way across.
    const over = pieces.get(tileIndex(512, 502))!;
    pieceAt(over, 0.25, P); expect(P.z).toBe(0);
    pieceAt(over, 0.75, P); expect(P.y).toBeCloseTo(503.5, 9); expect(P.z).toBeCloseTo(HUMP_Z, 9);
    for (let k = 0; k <= 10; k++) { pieceAt(over, 0.5 + k / 20, P); expect(P.z).toBeCloseTo(HUMP_Z * junctionHump(k / 10), 9); }
    // Drawn over the bridge from a little before it to a little after it (the next ribbon's start).
    pieceAt(over, 0.2, P); expect(P.o).toBe(0);
    pieceAt(over, 0.4, P); expect(P.o).toBe(1);
    pieceAt(over, 1, P); expect(P.o).toBe(1); expect(P.z).toBe(0);
    const past = pieces.get(tileIndex(512, 504))!;
    pieceAt(past, 0.1, P); expect(P.o).toBe(1); expect(P.z).toBe(0);
    pieceAt(past, 0.6, P); expect(P.o).toBe(0);
    // The other way (north, into (512, 520)) alike.
    const back = pieces.get(tileIndex(512, 521))!;
    pieceAt(back, 0.75, P); expect(P.y).toBeCloseTo(520.5, 9); expect(P.z).toBeCloseTo(HUMP_Z, 9); expect(P.o).toBe(1);
    // The east–west lines run under both: flat, never drawn over.
    for (const t of [tileIndex(511, 503), tileIndex(513, 520)]) {
      for (let k = 0; k <= 10; k++) { pieceAt(pieces.get(t)!, k / 10, P); expect(P.z).toBe(0); expect(P.o).toBe(0); }
    }
    expect([N, E, S, W].map(overJunction)).toEqual([true, false, true, false]);
    // The profile: flat at both ends, symmetric, a flat crown.
    expect(junctionHump(0)).toBe(0); expect(junctionHump(1)).toBe(0); expect(junctionHump(0.5)).toBe(1);
    for (let k = 1; k < 20; k++) expect(junctionHump(k / 20)).toBeCloseTo(junctionHump(1 - k / 20), 12);
  });

});
