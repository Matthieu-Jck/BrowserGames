// young-d138.test.ts — D138: what made a young base's catch-up slow, and the silo lock that leaked
// out of it. A fuel generator's dispatch and a drill's rate are stepped (online and offline alike)
// so their whole items repeat within a warm-up; a warm-up locks only its own virtual copy of a silo,
// and the catch-up frees a silo that runs dry as online does.
import { describe, it, expect } from 'vitest';
import { buildingIdx, itemIdx } from '@/content/registry';
import { DISPATCH_STEP, DRILL_STEP_MU } from '../constants';
import { drillRate } from '../graph/compile';
import { solvePower } from '../power/solve';
import { ReservoirNode } from '../flow/nodes';
import type { Grid } from '../world/grid';
import type { Ent } from '../types';
import { testSim, line, stockedSilo, IRON } from '../testkit';
import { catchUp } from './catchup';
import type { Sim } from '../state';

/** A kiln fed by a silo of `ore` iron ore and one of `coal` coal, its plates into the Core (as catchup.test.ts's `kilnLine`). */
function kilnLine(sim: Sim, ore: number, coal: number): { ore: number; coal: number } {
  const k = sim.place('kiln', 512, 503, 0);
  if (!k.ok) throw new Error(`kiln ${k.reason}`);
  sim.setRecipe(k.id!, 'iron_plate');
  const ids = { ore: stockedSilo(sim, 512, 507, 0, 'iron_ore', ore), coal: stockedSilo(sim, 516, 505, 3, 'coal', coal) };
  const n = sim.placeBelts('ribbon', line(512, 506, 0, 2)) + sim.placeBelts('ribbon', [[515, 505, 3], [514, 505, 3], [513, 505, 0]])
    + sim.placeBelts('ribbon', [[512, 502, 3], ...line(511, 502, 2, 8)]);
  if (n !== 14) throw new Error(`belts ${n}`);
  return ids;
}

const lockOf = (s: Sim, id: number): number => (s.graph.nodeByEnt.get(id) as ReservoirNode).locked;

describe('a young base catches up fast (D138)', () => {
  it('a fuel generator is dispatched in 25 ‰ steps, rounded up: the share its need calls, never less', () => {
    for (const [D, R, F] of [[400, 300, 300], [1000, 0, 3000], [301, 300, 1000], [999, 0, 1000]] as const) {
      const { dispatch } = solvePower(D, R, F, 0, 0, 0);
      expect(dispatch % DISPATCH_STEP).toBe(0);
      expect(dispatch * F).toBeGreaterThanOrEqual((D - R) * 1000); // it covers the need
      expect((dispatch - DISPATCH_STEP) * F).toBeLessThan((D - R) * 1000); // by less than a step
    }
  });

  it('a drill on a capped deposit gives a whole number of quarter items a minute', () => {
    const sim = testSim();
    const ore = itemIdx('iron_ore');
    // Four tiles of 2 270 mu an epoch each: 9 080, 9.08 ore a minute — a whole-item pattern of 25
    // minutes before D138; floored to 9 000, nine a minute.
    const grid = { ore: () => ore, capMuPerEpoch: () => 2270 } as unknown as Grid;
    const e: Ent = { id: 1, def: buildingIdx('drill'), x: 500, y: 500, rot: 0, cfg: 0, builtAt: 0 } as Ent;
    const r = drillRate(grid, e, sim.mods);
    expect(r.item).toBe(ore);
    expect(r.rateEp % DRILL_STEP_MU).toBe(0);
    expect(r.rateEp).toBe(9000);
    // Ore Cutting (an expertise, D93) multiplies, then the rate is floored again.
    const r2 = drillRate(grid, e, { ...sim.mods, drillRate: 1150 });
    expect(r2.rateEp % DRILL_STEP_MU).toBe(0);
    expect(r2.rateEp).toBe(10250); // 10 442 floored
  });

  it('a silo that runs dry during an absence is free again, as online (its lock no longer leaks out of the warm-ups)', () => {
    let silos = { ore: 0, coal: 0 };
    const make = (): Sim => { const s = testSim(); silos = kilnLine(s, 200, 1000); s.ensureCompiled(); s.run(300); return s; };
    const on = make(), off = make();
    expect(lockOf(on, silos.ore)).toBe(IRON());
    on.run(36000);
    catchUp(off, 36000, { noDirect: true });
    // 200 ore at the kiln's pace run out within the hour: online the silo is free the tick it empties.
    expect(on.stores.get(silos.ore)![IRON()]).toBe(0);
    expect(lockOf(on, silos.ore)).toBe(-1);
    expect(off.stores.get(silos.ore)![IRON()]).toBe(0);
    expect(lockOf(off, silos.ore)).toBe(-1);
    // The coal silo, still holding coal, keeps its lock both ways.
    expect(lockOf(off, silos.coal)).toBe(lockOf(on, silos.coal));
  });

  it('an empty silo a line fills during an absence is locked to that line\'s item, both ways', () => {
    const make = (): { s: Sim; silo: number } => {
      const s = testSim();
      const silo = s.place('silo', 512, 503, 0);
      if (!silo.ok) throw new Error(`silo ${silo.reason}`);
      // A kiln-less line: the ore silo's 300 ore run into the empty one, which takes them in.
      const src = stockedSilo(s, 512, 507, 0, 'iron_ore', 300);
      if (s.placeBelts('ribbon', line(512, 506, 0, 2)) !== 2) throw new Error('belts');
      s.ensureCompiled();
      void src;
      return { s, silo: silo.id! };
    };
    const a = make(), b = make();
    expect(lockOf(a.s, a.silo)).toBe(-1);
    a.s.run(36000);
    catchUp(b.s, 36000, { noDirect: true });
    expect(lockOf(a.s, a.silo)).toBe(IRON());
    expect(lockOf(b.s, b.silo)).toBe(IRON());
    expect(b.s.stores.get(b.silo)![IRON()]).toBe(a.s.stores.get(a.silo)![IRON()]);
  });
});
