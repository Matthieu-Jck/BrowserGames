// depth-sort.test.ts — D130: where an item on the ribbons sorts among the volumes against what it
// meets, part by part, on both axes (owner, 2026-10-18: « quand est-ce qu'il devrait être devant
// les items sur les ribbons, quand est-ce qu'ils devraient être derrière, et quelle partie
// surtout »). A junction: its deck's riders between its back and its front, the tiles by it over
// it in front and between its parts behind, its tunnel's under both and out of the near mouth over
// it all; a silo in front of it hides them. A skybridge piece: its riders between its back and its
// front, over the whole ramp in front of its gantry's beam, on N–S and E–W lines alike. A building's
// near faces: an item on the floor within `FACE_REACH` of its south or east face sorts after all it
// lays, farther off with the ribbons; never by its back faces, on a routing block's intake side,
// or on a glazed ribbon. The art's parts partition its drawing (every fill in exactly one of back and front).
// A conduit's raised pipe (D145, `pipeZ`): in front of a building's near faces, behind its back faces,
// under a skybridge's deck, after an item on the ribbon beside it on its own diagonal and before one on
// the next, after its rock column and before the one in front; a lifted building's reach stops at it.
import { describe, it, expect } from 'vitest';
import { buildingIdx } from '@/content/registry';
import { Entities, footprint } from '@/sim/entities';
import { Grid, tileIndex, type TerrainSource } from '@/sim/world/grid';
import { CHUNK } from '@/sim/constants';
import { T, type Ent, type Rot } from '@/sim/types';
import { drawJunctionPart, drawSkyPiece, type SkyPiece } from '../art/recipes/buildings';
import type { Ctx } from '../art/ink';
import { BeltLift, FACE_REACH, ITEM_DZ } from './belt-lift';
import { FRONT_DZ, PIPE_DZ, beltZ, buildingZ, computeStands, deckSquareZ, depthKey, pipeZ, rampZ, rockZ } from './stand';

/** Sand, and a rock plateau (land level 1) on x 600–609, y 600–609. */
class Land implements TerrainSource {
  fill(cx: number, cy: number, terrain: Uint8Array, _ore: Uint8Array, _rich: Uint16Array, _height?: Uint8Array, _biome?: Uint8Array, level?: Uint8Array): void {
    for (let j = 0; j < CHUNK; j++) for (let i = 0; i < CHUNK; i++) {
      const x = cx * CHUNK + i, y = cy * CHUNK + j, rock = x >= 600 && x < 610 && y >= 600 && y < 610;
      terrain[j * CHUNK + i] = rock ? T.Rock2 : T.Sand;
      if (level) level[j * CHUNK + i] = rock ? 1 : 0;
    }
  }
}

/** Sand (and a plateau); buildings put on it; the skybridge pairs' leaps (`graph.jumps`, start tile → far end tile). */
function world() {
  const grid = new Grid(new Land());
  const ents = new Entities();
  const jumps = new Map<number, number>();
  const put = (def: string, x: number, y: number, rot: Rot = 0): Ent => {
    const e = ents.add({ def: buildingIdx(def), x, y, rot, cfg: 0, builtAt: 0 });
    const [w, h] = footprint(e.def, e.rot);
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) grid.occ[tileIndex(i, j)] = e.id;
    return e;
  };
  const pair = (x: number, y: number, rot: Rot, gx: number, gy: number): [Ent, Ent] => {
    const a = put('skybridge', x, y, rot), b = put('skybridge', gx, gy, rot);
    jumps.set(tileIndex(x, y), tileIndex(gx, gy));
    return [a, b];
  };
  return { grid, ents, graph: { jumps }, put, pair };
}

const lifted = (w: ReturnType<typeof world>): BeltLift => { const l = new BeltLift(); l.rebuild(w); return l; };
/** An item on the floor (not lifted, not falling). */
const floorZ = (l: BeltLift, x: number, y: number): number => l.itemZ(x, y, 0, false, 0);
/** Strictly between a piece's back (at `k`) and its front (`k + FRONT_DZ`). */
const between = (z: number, k: number): void => { expect(z).toBeGreaterThan(k); expect(z).toBeLessThan(k + FRONT_DZ); };

describe('D130 depth sort: a junction', () => {
  it('its deck’s riders between its back and its front, both ways along the deck', () => {
    const w = world();
    const j = w.put('crossing', 520, 480);
    for (const r of [479, 481]) w.put('ribbon', 520, r, 0);
    const l = lifted(w);
    const k = depthKey(j);
    expect(k).toBe(buildingZ(520, 480, 1, 1));
    for (const y of [480.05, 480.3, 480.5, 480.7, 480.8]) between(l.junctionZ(520.5, y), k);
    // Its front-most point on the ribbon in front: still its own junction's.
    between(l.junctionZ(520.5, 480.95), k);
  });

  it('on the ribbon by it: over all of it in front (south), between its parts behind (north)', () => {
    const w = world();
    const j = w.put('crossing', 520, 480);
    for (const r of [479, 481]) w.put('ribbon', 520, r, 0);
    const l = lifted(w);
    const k = depthKey(j);
    const south = l.junctionZ(520.5, 481.2);
    expect(south).toBeGreaterThan(k + FRONT_DZ);
    expect(south).toBeGreaterThanOrEqual(beltZ(520, 481) + ITEM_DZ.belt);
    between(l.junctionZ(520.5, 479.8), k);
    // Nothing by it: no junction key.
    expect(l.junctionZ(530.5, 480.5)).toBeNaN();
  });

  it('a run of junctions: a rider whose front-most point is on the next one sorts between that one’s parts', () => {
    const w = world();
    w.put('crossing', 520, 480);
    const next = w.put('crossing', 520, 481);
    const l = lifted(w);
    between(l.junctionZ(520.5, 480.9), depthKey(next));
  });

  it('what stands in front hides its riders: a silo south-east of it, a skybridge deck over it', () => {
    const w = world();
    const j = w.put('crossing', 520, 480);
    const silo = w.put('silo', 521, 481);
    const l = lifted(w);
    for (const y of [480.1, 480.5, 480.9]) expect(l.junctionZ(520.5, y)).toBeLessThan(depthKey(silo));
    expect(l.junctionZ(520.5, 480.5)).toBeLessThan(deckSquareZ(520, 480, 0)); // a skybridge's deck square over it
    expect(depthKey(silo)).toBeGreaterThan(depthKey(j) + FRONT_DZ);
  });

  it('its tunnel (E–W): under both parts inside, over it all once out of the near (east) mouth, on the floor farther on and behind', () => {
    const w = world();
    const j = w.put('crossing', 520, 480);
    for (const x of [519, 521, 522]) w.put('ribbon', x, 480, 1);
    const l = lifted(w);
    const k = depthKey(j);
    for (const x of [520.1, 520.5, 520.8]) {
      const z = floorZ(l, x, 480.5);
      expect(z).not.toBeNaN();
      expect(z).toBeLessThan(k);
    }
    expect(floorZ(l, 521.1, 480.5)).toBeGreaterThan(k + FRONT_DZ);
    expect(floorZ(l, 521.5, 480.5)).toBeGreaterThan(k + FRONT_DZ);
    expect(floorZ(l, 521 + FACE_REACH + 0.05, 480.5)).toBeNaN();
    expect(floorZ(l, 519.5, 480.5)).toBeNaN(); // west of it: under it on the floor
    expect(floorZ(l, 520.5, 479.5)).toBeNaN(); // north of it too
  });
});

describe('D130 depth sort: a skybridge’s pieces, on both axes', () => {
  /** Ends at a and b (along `rot`), the squares between them. */
  const cases: Array<{ rot: Rot; a: [number, number]; b: [number, number] }> = [
    { rot: 0, a: [550, 485], b: [550, 481] }, // north
    { rot: 2, a: [550, 481], b: [550, 485] }, // south
    { rot: 1, a: [560, 490], b: [564, 490] }, // east
    { rot: 3, a: [564, 490], b: [560, 490] }, // west
  ];
  for (const { rot, a, b } of cases) {
    it(`${'NESW'[rot]}: the deck’s riders between its back and its front; a ramp’s behind its gantry’s beam between, in front of it over the whole piece`, () => {
      const w = world();
      const [s, f] = w.pair(a[0], a[1], rot, b[0], b[1]);
      const l = lifted(w);
      const ns = (rot & 1) === 0;
      // The middle square of the deck.
      const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
      between(l.spanZ(mx + 0.5, my + 0.5), deckSquareZ(mx, my, 0));
      // Each ramp: its gantry's beam across the square's middle.
      for (const e of [s, f]) {
        const k = rampZ(e);
        const pt = (d: number): [number, number] => (ns ? [e.x + 0.5, e.y + 0.5 + d] : [e.x + 0.5 + d, e.y + 0.5]);
        between(l.spanZ(...pt(-0.25)), k);
        expect(l.spanZ(...pt(0.25))).toBeGreaterThan(k + FRONT_DZ);
      }
    });
  }

  it('on the ribbon by an end: over it all when the end is behind, between its parts when the end is in front', () => {
    const w = world();
    const [s, f] = w.pair(550, 485, 0, 550, 481); // north: the start in front (south), the far end behind
    const l = lifted(w);
    expect(l.spanZ(550.5, 486.2)).toBeGreaterThan(rampZ(s) + FRONT_DZ); // south of the start: in front of it
    between(l.spanZ(550.5, 480.8), rampZ(f)); // north of the far end: behind it
  });
});

describe('D130 depth sort: a building’s near faces', () => {
  it('a 3×3 silo: after it within reach of its south and east faces, with the ribbons farther off and by its back faces', () => {
    const w = world();
    const silo = w.put('big_silo', 530, 470);
    const l = lifted(w);
    const k = depthKey(silo);
    // South face (y = 473), east face (x = 533): after all it lays (a moving part, an overlay, a chosen item: ≤ 0.4 after it).
    for (const z of [floorZ(l, 531.5, 473.1), floorZ(l, 531.5, 473 + FACE_REACH - 0.05), floorZ(l, 533.1, 471.5), floorZ(l, 533 + FACE_REACH - 0.05, 471.5)]) {
      expect(z).toBeGreaterThan(k + 0.4);
    }
    // Its south-east corner tile is not by a face.
    expect(floorZ(l, 533.2, 473.2)).toBeNaN();
    // Farther off, and by its north and west faces (it is in front): with the ribbons, under it.
    expect(floorZ(l, 531.5, 473 + FACE_REACH + 0.05)).toBeNaN();
    expect(floorZ(l, 533 + FACE_REACH + 0.05, 471.5)).toBeNaN();
    expect(floorZ(l, 531.5, 469.8)).toBeNaN();
    expect(floorZ(l, 529.8, 471.5)).toBeNaN();
  });

  it('in front of it but behind what stands in front of the item', () => {
    const w = world();
    w.put('silo', 530, 470);
    const front = w.put('silo', 530, 473); // a row south of the first one's south row (472 → 473)
    const l = lifted(w);
    expect(floorZ(l, 530.5, 472.2)).toBeLessThan(depthKey(front));
  });

  it('a routing block: out of its front and side slots, not on its intake’s side (in under its hopper)', () => {
    const w = world();
    // Facing N (in from the S), E, S, W (in from the E); a distributor (mouths on every side).
    const n = w.put('router', 540, 470, 0), e = w.put('sorter', 550, 470, 1), s = w.put('overflow_gate', 560, 470, 2), wb = w.put('router', 570, 470, 3);
    const d = w.put('distributor', 580, 470, 0);
    const l = lifted(w);
    const south = (b: Ent): number => floorZ(l, b.x + 0.5, b.y + 1.2), east = (b: Ent): number => floorZ(l, b.x + 1.2, b.y + 0.5);
    expect(south(n)).toBeNaN();
    expect(east(n)).toBeGreaterThan(depthKey(n));
    for (const b of [e, s]) { expect(south(b)).toBeGreaterThan(depthKey(b)); expect(east(b)).toBeGreaterThan(depthKey(b)); }
    expect(south(wb)).toBeGreaterThan(depthKey(wb));
    expect(east(wb)).toBeNaN();
    expect(floorZ(l, 580.5, 472.2)).toBeGreaterThan(depthKey(d));
    expect(floorZ(l, 582.2, 471.5)).toBeGreaterThan(depthKey(d));
  });

  it('only at the building’s own height: not on the floor below a building standing on the rock', () => {
    const w = world();
    const high = w.put('silo', 604, 608); // on the plateau's south row pair (608–609): its south face over the cliff
    const low = w.put('silo', 612, 604); // on the floor east of the plateau
    computeStands(w);
    const l = lifted(w);
    expect(floorZ(l, 604.5, 610.2)).toBeNaN(); // the floor at the cliff's foot: with the ribbons
    expect(floorZ(l, 612.5, 606.2)).toBeGreaterThan(depthKey(low));
    expect(depthKey(high)).not.toBe(buildingZ(604, 608, 2, 2)); // it stands on the rock
  });

  it('not on a glazed ribbon (its hood covers it)', () => {
    const w = world();
    w.put('silo', 545, 470);
    w.put('glazed_ribbon', 545, 472, 2);
    const l = lifted(w);
    expect(floorZ(l, 545.5, 472.2)).toBeNaN();
    expect(floorZ(l, 546.5, 472.2)).not.toBeNaN(); // the plain tile beside it is
  });
});

/** A stand-in context that counts the fills and strokes a drawing makes. */
function counter(): { ctx: Ctx; n: () => number } {
  let n = 0;
  const t: Record<string | symbol, unknown> = { fillStyle: '#000000', strokeStyle: '#000000', globalAlpha: 1, lineWidth: 1 };
  const ctx = new Proxy(t, {
    get(o, k): unknown {
      if (k === 'fill' || k === 'fillRect' || k === 'stroke') return () => { n++; };
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop: () => undefined });
      if (k in o) return o[k];
      return () => undefined;
    },
    set(o, k, v): boolean { o[k] = v; return true; },
  });
  return { ctx: ctx as unknown as Ctx, n: () => n };
}

describe('D130 depth sort: the parts the art is drawn in', () => {
  it('a junction’s back and front partition its drawing', () => {
    const count = (p: 'all' | 'back' | 'front'): number => { const c = counter(); drawJunctionPart(p, () => ({ ctx: c.ctx, canvas: null })); return c.n(); };
    const all = count('all'), back = count('back'), front = count('front');
    expect(back).toBeGreaterThan(0);
    expect(front).toBeGreaterThan(0);
    expect(back + front).toBe(all);
  });

  it('every skybridge piece’s back and front partition its drawing, in every rotation', () => {
    for (const piece of ['up', 'deck', 'down'] as SkyPiece[]) for (const rot of [0, 1, 2, 3] as Rot[]) {
      const count = (p: 'all' | 'back' | 'front'): number => { const c = counter(); drawSkyPiece(piece, rot, () => ({ ctx: c.ctx, canvas: null }), p); return c.n(); };
      const all = count('all'), back = count('back'), front = count('front');
      expect(back, `${piece}:${rot}`).toBeGreaterThan(0);
      expect(front, `${piece}:${rot}`).toBeGreaterThan(0);
      expect(back + front, `${piece}:${rot}`).toBe(all);
    }
  });
});

describe('D145 depth sort: a conduit’s raised pipe', () => {
  it('in front of a building’s south and east faces, behind its north and west ones, whatever its size and turn', () => {
    for (const [def, rot] of [['silo', 0], ['steam_boiler', 0], ['steam_boiler', 1], ['kiln', 0], ['router', 0]] as const) {
      const [w, h] = footprint(buildingIdx(def), rot as Rot), x = 500, y = 500, k = buildingZ(x, y, w, h);
      for (let i = 0; i < w; i++) {
        expect(pipeZ(x + i, y + h), `${def}:${rot} south ${i}`).toBeGreaterThan(k);
        expect(pipeZ(x + i, y - 1), `${def}:${rot} north ${i}`).toBeLessThan(k);
      }
      for (let j = 0; j < h; j++) {
        expect(pipeZ(x + w, y + j), `${def}:${rot} east ${j}`).toBeGreaterThan(k);
        expect(pipeZ(x - 1, y + j), `${def}:${rot} west ${j}`).toBeLessThan(k);
      }
    }
  });

  it('after the items on a ribbon of its own diagonal and its tile’s flat pieces, before the next diagonal’s; under a deck, between the rock columns', () => {
    const x = 520, y = 530;
    // A ribbon tile beside it (same diagonal) or behind it: its items sort before the pipe; in front of it, after.
    expect(beltZ(x + 1, y - 1) + ITEM_DZ.belt).toBeLessThan(pipeZ(x, y));
    expect(beltZ(x, y - 1) + ITEM_DZ.belt).toBeLessThan(pipeZ(x, y));
    expect(beltZ(x, y + 1) + ITEM_DZ.belt).toBeGreaterThan(pipeZ(x, y));
    // A tee's branches stay with their tile, a building of the next diagonal after all of them.
    expect(pipeZ(x, y) + PIPE_DZ).toBeLessThan(buildingZ(x + 1, y, 1, 1));
    expect(pipeZ(x, y) - PIPE_DZ).toBeGreaterThan(beltZ(x, y) + ITEM_DZ.belt);
    // A skybridge's deck over it (on the floor and up on the rock) covers it.
    expect(deckSquareZ(x, y, 0)).toBeGreaterThan(pipeZ(x, y));
    expect(deckSquareZ(x, y, 2)).toBeGreaterThan(pipeZ(x, y));
    // Up on the rock: after its own column, before the column in front.
    expect(pipeZ(x, y)).toBeGreaterThan(rockZ(x, y));
    expect(pipeZ(x, y)).toBeLessThan(rockZ(x + 1, y));
  });

  it('a building standing on the rock does not sort past a pipe in front of it (a ribbon there it may)', () => {
    const key = (what: 'conduit' | 'ribbon'): number => {
      const w = world();
      const t = w.put('wind_flower', 602, 602, 0); // 2 × 2 on the plateau (602–603)
      w.put(what, 604, 603, 0); // on the rock, east of it: in front
      return computeStands(w).get(t.id)!.z;
    };
    expect(key('conduit')).toBeLessThan(pipeZ(604, 603));
    expect(key('ribbon')).toBeGreaterThan(key('conduit'));
  });
});

