import { describe, it, expect } from 'vitest';
import { grantCost, testSim, wire } from '../testkit';
import { solvePower } from './solve';
import { sunPermille } from './network';
import { serialize, deserialize } from '../serialize';
import { catchUp } from '../offline/catchup';
import { DAY_EPOCHS, WORLD_EPOCH0 } from '../constants';
import type { Sim } from '../state';

/** An accumulator beside the Hearth (inside its zone, wired to it). */
function gourdSim(): { sim: Sim; gourd: number } {
  const sim = testSim();
  sim.done.add('tr1'); sim.done.add('tr3');
  sim.rebuildDerived();
  grantCost(sim, 'accumulator', 2);
  const g = sim.place('accumulator', 516, 512, 0);
  if (!g.ok) throw new Error(`gourd: ${g.reason}`);
  wire(sim, g.id!);
  return { sim, gourd: g.id! };
}

describe('power', () => {
  it('the merit order: renewables, then fuel (load-following), then accumulators; satisfaction in 25‰ steps', () => {
    expect(solvePower(100, 300, 0, 0, 1000, 50)).toEqual({ sat: 1000, dispatch: 0, accDelta: 50, served: 100 });
    expect(solvePower(400, 300, 300, 0, 1000, 50).dispatch).toBe(334);
    const r = solvePower(500, 300, 0, 10, 1000, 50);
    expect(r.accDelta).toBe(-10);
    expect(r.sat % 25).toBe(0);
    expect(r.sat).toBeLessThan(1000);
  });

  it('an accumulator fills from the surplus, never past its capacity', () => {
    const { sim, gourd } = gourdSim();
    const cap = 1200 * 600;
    sim.run(600);
    const e1 = sim.accEnergy.get(gourd) ?? 0;
    expect(e1).toBeGreaterThan(0);
    expect(e1).toBeLessThanOrEqual(300 * 600);
    sim.run(4000);
    expect(sim.accEnergy.get(gourd)).toBe(cap);
  });

  it('accumulators store and give back the same energy offline as ticking', () => {
    const { sim, gourd } = gourdSim();
    sim.run(10);
    const save = serialize(sim);
    const a = deserialize(save, sim.grid.source), b = deserialize(save, sim.grid.source);
    a.run(1800);
    catchUp(b, 1800, { noDirect: true });
    expect(b.accEnergy.get(gourd)).toBe(a.accEnergy.get(gourd));
  });

  it('the sun: a third of the day is night (nothing at all), the dawn and dusk ramp', () => {
    const day = Array.from({ length: DAY_EPOCHS }, (_, i) => sunPermille(WORLD_EPOCH0 + i));
    expect(day.filter((s) => s === 0).length).toBe(12);
    expect(Math.max(...day)).toBe(1000);
    expect(day.some((s) => s > 0 && s < 1000)).toBe(true);
  });
});
