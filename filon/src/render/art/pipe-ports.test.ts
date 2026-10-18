// pipe-ports.test.ts — water ports as pipework (D142): which ports the art draws as pipework
// (the content's `fluid` ports, or the entrance the water really comes in by), the rule that picks
// that entrance, and the night lights — a variant lights up exactly where its building's own look
// does, so the lights view (found from the default art) stays right; the plan's pipework and the
// conduit's coupling bake no lamp.
import { describe, it, expect } from 'vitest';
import { BUILDING_IDS, buildingDef, buildingIdx, isBeltDef } from '@/content/registry';
import type { BuildingId } from '@/content/buildings';
import type { BuildingDef } from '@/content/types';
import { sideIndex, type Rot } from '@/sim/types';
import { artOf } from './recipes/fx';
import { drawBuilding } from './recipes/buildings';
import { drawBuildingTop } from './recipes/buildings-top';
import { IsoFrame, portIso } from './iso-shapes';
import { Frame } from './shapes';
import { DRY, NONE, WET, drawCoupling, homeEntrance, pipeAt, pipePortIso, pipePortTop, pipeProbe, wetAlternatives, wetEntrance } from './pipe-ports';

const def = (id: string): BuildingDef => buildingDef(buildingIdx(id));
const DRINKERS = ['steam_boiler', 'brickworks', 'ceramic_oven'] as const;
const ROTS: readonly Rot[] = [0, 1, 2, 3];

/** The ports a drawing draws as pipework, as `x,y,side,io` (unrotated), sorted. */
function piped(draw: () => void): string[] {
  const got: string[] = [];
  pipeProbe.fn = (x, y, side, io) => { got.push(`${x},${y},${side},${io}`); };
  try { draw(); } finally { pipeProbe.fn = null; }
  return got.sort();
}
const key = (b: BuildingDef, i: number): string => { const p = b.ports[i]!; return `${p.x},${p.y},${sideIndex[p.side]},${p.io}`; };

describe('water ports (D142)', () => {
  it('the content’s water ports are pipework: a pump’s outlet, a drinker’s water entrance; or the entrance the water comes in by', () => {
    expect(pipeAt(def('pump'), 0)).toBe(true);
    expect(pipeAt(def('hp_pump'), 0)).toBe(true);
    for (const id of DRINKERS) {
      const b = def(id), home = homeEntrance(b);
      expect(home, id).toBeGreaterThanOrEqual(0);
      expect(b.ports.map((_, i) => pipeAt(b, i)), id).toEqual(b.ports.map((_, i) => i === home));
      expect(wetAlternatives(b), id).toEqual([0]); // its other entrance (the coal's, the sand's, the stone's)
      expect(b.ports.map((_, i) => pipeAt(b, i, 0)), id).toEqual(b.ports.map((_, i) => i === 0));
    }
    // A ribbon-fed machine: no pipework, no variant, whatever is asked.
    expect(def('kiln').ports.some((_, i) => pipeAt(def('kiln'), i) || pipeAt(def('kiln'), i, 0))).toBe(false);
    expect(wetAlternatives(def('kiln'))).toEqual([]);
    expect(wetAlternatives(def('pump'))).toEqual([]);
  });

  it('the pipework goes where the water comes in: its own entrance unless water comes by another, or a dry line takes its own', () => {
    const b = def('brickworks'); // entrances 0 (sand) and 1 (water, its own)
    const at = (j0: number, j1: number): number => wetEntrance(b, (i) => (i === 0 ? j0 : i === 1 ? j1 : NONE));
    expect(at(NONE, NONE)).toBe(-1); // nothing joined yet: its own
    expect(at(DRY, WET)).toBe(-1); // as meant
    expect(at(NONE, WET)).toBe(-1);
    expect(at(WET, DRY)).toBe(0); // swapped: the water by the sand's entrance
    expect(at(WET, NONE)).toBe(0);
    expect(at(WET, WET)).toBe(-1); // water by both: its own still
    expect(at(NONE, DRY)).toBe(0); // the sand by its own: the water must come by the other
    expect(at(DRY, DRY)).toBe(-1); // no water at all: nothing to say
    expect(wetEntrance(def('kiln'), () => WET)).toBe(-1); // drinks no water
  });

  it('every building’s art draws pipework on its water ports only, in both views and every turn; a variant on the entrance it names', () => {
    for (const id of BUILDING_IDS) {
      if (isBeltDef(id)) continue;
      const b = def(id);
      const want = b.ports.flatMap((p, i) => (p.fluid ? [key(b, i)] : [])).sort();
      for (const rot of ROTS) {
        expect(piped(() => artOf((ctx) => { drawBuilding(id as BuildingId, rot, () => ({ ctx, canvas: null })); })), `${id} iso ${rot}`).toEqual(want);
        expect(piped(() => artOf((ctx) => { drawBuildingTop(id as BuildingId, rot, () => ({ ctx, canvas: null })); })), `${id} plan ${rot}`).toEqual(want);
      }
    }
    for (const id of DRINKERS) {
      const b = def(id);
      for (const rot of ROTS) for (const wet of wetAlternatives(b)) {
        const want = [key(b, wet), ...b.ports.flatMap((p, i) => (p.fluid && p.io === 'out' ? [key(b, i)] : []))].sort();
        expect(piped(() => artOf((ctx) => { drawBuilding(id, rot, () => ({ ctx, canvas: null }), 1, wet); })), `${id} iso ${rot} w${wet}`).toEqual(want);
        expect(piped(() => artOf((ctx) => { drawBuildingTop(id, rot, () => ({ ctx, canvas: null }), 1, wet); })), `${id} plan ${rot} w${wet}`).toEqual(want);
      }
    }
  });

  it('a variant’s night lights are its own look’s: the valve’s lamp sits on the hatch’s LED, in its colour', () => {
    // One port alone: the intake's pipework lights exactly where (and as) its hatch would.
    const f = new IsoFrame(2, 2, 0, 1.5);
    for (const side of [0, 1, 2, 3]) {
      const [x, y] = [[0, 0], [1, 0], [1, 1], [0, 1]][side]!;
      const hatch = artOf((ctx) => portIso(ctx, f, x!, y!, side, 'in', 0.3, 1)).emitters;
      const pipe = artOf((ctx) => pipePortIso(ctx, f, x!, y!, side, 'in', 0.3, 1)).emitters;
      expect(pipe.length, `side ${side}`).toBe(1);
      expect(pipe[0]!.glow).toBe(hatch[0]!.glow);
      expect(pipe[0]!.x).toBeCloseTo(hatch[0]!.x, 0);
      expect(pipe[0]!.y).toBeCloseTo(hatch[0]!.y, 0);
    }
    // A whole drinker: its variants' lamps where its own look's are.
    const spots = (id: BuildingId, rot: Rot, wet: number): string[] => artOf((ctx) => { drawBuilding(id, rot, () => ({ ctx, canvas: null }), 1, wet); })
      .emitters.map((e) => `${Math.round(e.x)},${Math.round(e.y)},${e.glow}`).sort();
    for (const id of DRINKERS) for (const rot of ROTS) for (const wet of wetAlternatives(def(id))) expect(spots(id, rot, wet), `${id} ${rot}`).toEqual(spots(id, rot, -1));
  });

  it('the plan’s pipework and the conduit’s coupling bake no lamp', () => {
    const f = new Frame(64, 14, 1, 1, 0);
    for (const io of ['in', 'out'] as const) expect(artOf((ctx) => pipePortTop(ctx, f, 0, 0, 2, io, 1)).emitters).toEqual([]);
    expect(artOf((ctx) => drawCoupling(ctx, 13)).emitters).toEqual([]);
  });
});
