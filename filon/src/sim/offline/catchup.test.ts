import { describe, it, expect } from 'vitest';
import { N_ITEMS, itemIdx } from '@/content/registry';
import { testSim, drillToHearth, line, steadyPower, stockedSilo, wire, IRON, COAL } from '../testkit';
import { catchUp } from './catchup';
import { makeRng } from '@/core/rng';
import { timed } from '@/core/cpu-time';
import type { Sim } from '../state';

/**
 * A kiln north of the Hearth fed by two silos — `ore` iron ore below it, `coal` coal east of it
 * (the Hearth gives nothing, D34) — and its plates back home. Returns the silos' ids.
 */
function kilnLine(sim: Sim, ore: number, coal: number): { ore: number; coal: number } {
  const k = sim.place('kiln', 512, 503, 0);
  if (!k.ok) throw new Error(`kiln ${k.reason}`);
  sim.setRecipe(k.id!, 'iron_plate');
  const ids = {
    ore: stockedSilo(sim, 512, 507, 0, 'iron_ore', ore), // out (512,507) → (512,506); (513,506) stays empty
    coal: stockedSilo(sim, 516, 505, 3, 'coal', coal), // facing west: out (516,505) → (515,505)
  };
  const n1 = sim.placeBelts('ribbon', line(512, 506, 0, 2)); // up into the kiln's (512,504)
  const n2 = sim.placeBelts('ribbon', [[515, 505, 3], [514, 505, 3], [513, 505, 0]]); // into (513,504)
  const n3 = sim.placeBelts('ribbon', [[512, 502, 3], ...line(511, 502, 2, 8)]); // plates → (511,510) N input
  if (n1 !== 2 || n2 !== 3 || n3 !== 9) throw new Error(`belts ${n1} ${n2} ${n3}`);
  return ids;
}

/** What a store holds of an item (items). */
const held = (s: Sim, id: number, item: number): number => s.stores.get(id)![item]! / 1000;

/** Coal drill on the west deposit feeding the Hearth's west input (510,511). */
function peatDrill(sim: Sim): void {
  const d = sim.place('drill', 500, 510, 1);
  if (!d.ok) throw new Error(`coal drill ${d.reason}`);
  const n = sim.placeBelts('ribbon', [...line(502, 510, 1, 7), [509, 510, 2], [509, 511, 1]]);
  if (n !== 9) throw new Error(`coal belts ${n}`);
  // Two poles (each wires itself to the nearest pillar or Hearth), then a wire to the drill.
  const m1 = sim.place('mast', 507, 509, 0), m2 = sim.place('mast', 502, 512, 0);
  if (!m1.ok || !m2.ok) throw new Error('masts');
  wire(sim, d.id!, m2.id!);
}

function twin(build: (s: Sim) => void): [Sim, Sim] {
  const a = testSim(), b = testSim();
  build(a); build(b);
  a.ensureCompiled(); b.ensureCompiled();
  return [a, b];
}

const stocks = (s: Sim): number[] => Array.from(s.stock);

describe('offline catch-up', () => {
  it('reproduces a single steady regime bit-exactly (drill → ribbon → Hearth, 1 h)', () => {
    // A steady supply: the Hearth's panel alone would follow the sun into the night.
    const [on, off] = twin((s) => { steadyPower(s); drillToHearth(s); s.run(300); });
    on.run(36000);
    const rep = catchUp(off, 36000, { noDirect: true });
    expect(off.tick).toBe(on.tick);
    expect(stocks(off)).toEqual(stocks(on));
    expect(off.hash()).toBe(on.hash());
    expect(rep.warmups).toBeLessThan(6);
  });

  it('matches online play when a silo runs dry mid-absence (kiln line, 2 h)', () => {
    let silos = { ore: 0, coal: 0 };
    const [on, off] = twin((s) => { silos = kilnLine(s, 1000, 1000); s.run(300); });
    on.run(72000);
    catchUp(off, 72000, { noDirect: true });
    const plate = itemIdx('iron_plate');
    // Ore and coal (one of each per plate) run out after ~67 min: plates ≈ 1 000 + start stock, both ways.
    expect(held(on, silos.ore, IRON())).toBeLessThan(25);
    expect(held(off, silos.ore, IRON())).toBeLessThan(25);
    expect(Math.abs(off.stock[plate]! - on.stock[plate]!) / 1000).toBeLessThanOrEqual(25);
    expect(Math.abs(held(off, silos.coal, COAL()) - held(on, silos.coal, COAL()))).toBeLessThanOrEqual(25);
  });

  it('conserves items through the catch-up (Δstock matches what the regimes moved)', () => {
    const [, off] = twin((s) => { kilnLine(s, 300, 100); });
    const before = Array.from({ length: N_ITEMS }, (_, i) => off.totalHeld(i));
    catchUp(off, 36000, { noDirect: true });
    const after = Array.from({ length: N_ITEMS }, (_, i) => off.totalHeld(i));
    // Ore + coal consumed become plates: 1 ore + 1 coal → 1 plate.
    const dOre = before[IRON()]! - after[IRON()]!;
    const dPlate = after[itemIdx('iron_plate')]! - before[itemIdx('iron_plate')]!;
    expect(Math.abs(dOre - dPlate)).toBeLessThanOrEqual(3000);
  });

  it('a week-long absence of a small base computes quickly (ore runs dry, coal fills up)', () => {
    let silos = { ore: 0, coal: 0 };
    const [, off] = twin((s) => { silos = kilnLine(s, 1000, 1000); peatDrill(s); });
    // CPU time (core/cpu-time.ts): the suites running beside it in the parallel phase do not count.
    const { value: rep, ms, wall } = timed(() => catchUp(off, 7 * 24 * 36000, { noDirect: true }));
    expect(ms, `${ms.toFixed(0)} ms of CPU (${wall.toFixed(0)} ms on the wall)`).toBeLessThan(4000);
    console.log(`week catch-up: ${ms.toFixed(0)} ms of CPU (${wall.toFixed(0)} on the wall), ${rep.warmups} warm-ups, mode ${rep.mode}`);
    expect(off.tick).toBe(7 * 24 * 36000);
    expect(held(off, silos.ore, IRON())).toBeLessThan(25);
    // Coal: 12/min into the Hearth, which gives nothing → it fills up and stops taking it.
    expect(off.stock[COAL()]! / 1000).toBeGreaterThan(4900);
    expect(off.stock[COAL()]! / 1000).toBeLessThanOrEqual(5000);
    expect(rep.incidents.some((i) => i.kind === 'storageFull' && i.item === COAL())).toBe(true);
    expect(rep.toTick).toBe(off.tick);
  });
});

describe('steady regimes', () => {
  it('steady layouts lock into an exact period, jams included', async () => {
    const { buildGroups } = await import('../graph/groups');
    const { makeCtx } = await import('../flow/step');
    const { Scratch, warmUp } = await import('./steady');
    const s = testSim();
    kilnLine(s, 1000, 1000); peatDrill(s);
    s.ensureCompiled();
    const ctx = makeCtx(s.graph, s.graph.nets.length, N_ITEMS);
    for (const grp of buildGroups(s.graph)) {
      const reg = warmUp(s.graph, grp, ctx, { res: new Map(), sat: new Map(), disp: new Map() }, s.tick, 'k', new Scratch());
      expect(reg.exact, `group ${grp.id}`).toBe(true);
      expect(reg.p).toBeLessThanOrEqual(2400);
    }
  });
});

/** Copper drill south → wire mill → Hearth south input. */
function chimeMill(sim: Sim): void {
  const d = sim.place('drill', 511, 522, 0);
  const m = sim.place('wire_mill', 511, 516, 0);
  if (!d.ok || !m.ok) throw new Error(`mill ${m.reason}`);
  wire(sim, [d.id!, m.id!]);
  sim.setRecipe(m.id!, 'copper_wire');
  sim.placeBelts('ribbon', line(511, 521, 0, 4));
  sim.placeBelts('ribbon', [[511, 515, 0]]);
}

/** Sand drill east → Hearth east input (514,511). */
function sandEast(sim: Sim): void {
  const d = sim.place('sand_collector', 522, 510, 3);
  if (!d.ok) throw new Error(`sand ${d.reason}`);
  wire(sim, d.id!);
  sim.placeBelts('ribbon', line(521, 511, 3, 7));
}

const REPORT = !!(globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.CATCHUP_REPORT;

describe('online ≈ offline on random bases', () => {
  for (let seed = 1; seed <= 12; seed++) {
    it(`seed ${seed}: catch-up ends with the same stocks as ticking (±2 items / 0.5%)`, () => {
      const rng = makeRng(seed * 7919);
      const north = rng.pick(['drill', 'kiln', 'none'] as const);
      const west = rng.chance(0.6), south = rng.chance(0.6), east = north !== 'kiln' && rng.chance(0.6);
      const grants: Array<[string, number]> = [
        ['iron_ore', rng.int(0, 2000)], ['coal', rng.int(0, 1000)], ['copper_ore', rng.int(0, 400)],
      ];
      const warm = rng.int(0, 3000);
      const N = rng.int(1, 4) * 36000 + rng.int(0, 5999);
      const build = (s: Sim): void => {
        if (north === 'drill') drillToHearth(s);
        if (north === 'kiln') kilnLine(s, Math.min(1000, grants[0]![1]), Math.min(1000, grants[1]![1]));
        if (west) peatDrill(s);
        if (south) chimeMill(s);
        if (east) sandEast(s);
        for (const [it, n] of grants) s.grant(it, n);
        s.run(warm);
      };
      const [on, off] = twin(build);
      on.run(N);
      const rep = catchUp(off, N, { noDirect: true });
      expect(off.tick).toBe(on.tick);
      let worst = 0;
      let wi = -1;
      for (let i = 0; i < N_ITEMS; i++) { const d = Math.abs(on.stock[i]! - off.stock[i]!) / 1000; if (d > worst) { worst = d; wi = i; } }
      if (REPORT && wi >= 0) console.log(`  item ${wi}: online ${(on.stock[wi]! / 1000).toFixed(2)} offline ${(off.stock[wi]! / 1000).toFixed(2)}`);
      if (REPORT) console.log(`seed ${seed} ${north} w${+west} s${+south} e${+east} N=${(N / 36000).toFixed(2)}h: worst Δ ${worst.toFixed(2)} items, ${rep.warmups} warm-ups, ${rep.mode}`);
      for (let i = 0; i < N_ITEMS; i++) {
        const a = on.stock[i]! / 1000, b = off.stock[i]! / 1000;
        const flow = Math.abs(on.produced[i]! - 0) / 1000 + Math.abs(on.consumed[i]!) / 1000;
        const tol = Math.max(2, 0.005 * flow);
        expect(Math.abs(a - b), `item ${i}: online ${a.toFixed(1)} vs offline ${b.toFixed(1)} (${north} w${+west} s${+south} e${+east})`).toBeLessThanOrEqual(tol);
      }
    });
  }
});

describe('offline power', () => {
  /** A drill on the Hearth's grid that two skydocks (reservoirs, 200 kW each) push into a brownout. */
  function brownBase(): Sim {
    const sim = testSim();
    for (const id of ['tr1', 'tr2', 'tr3', 'tr4', 'tr6']) sim.done.add(id);
    sim.rebuildDerived();
    for (const [it, n] of [['iron_plate', 400], ['ceramic', 200], ['gear', 200], ['lens', 40]] as const) sim.grant(it, n);
    drillToHearth(sim);
    for (const [x, y] of [[503, 504], [516, 504]] as const) {
      const r = sim.place('skydock', x, y, 0);
      if (!r.ok) throw new Error(`skydock ${r.reason}`);
      wire(sim, r.id!);
    }
    sim.run(20);
    return sim;
  }

  it('reservoir buildings (docks, observatories, excavators) draw power offline too', () => {
    const a = brownBase(), b = brownBase();
    expect(a.netPower[0]!.sat).toBeLessThan(1000); // online: the docks brown the grid out
    const ore0 = a.stock[IRON()]!;
    a.run(3 * 36_000);
    catchUp(b, 3 * 36_000, { noDirect: true });
    const got = (s: Sim): number => (s.stock[IRON()]! - ore0) / 1000;
    expect(got(a)).toBeGreaterThan(100);
    expect(Math.abs(got(b) - got(a)) / got(a)).toBeLessThan(0.02);
  });

  it('an accumulator that runs dry stops covering the deficit offline too', () => {
    const withGourd = (): Sim => {
      const sim = brownBase();
      sim.grant('empty_cell', 10); sim.grant('circuit', 10);
      const g = sim.place('accumulator', 506, 516, 0);
      if (!g.ok) throw new Error(`gourd ${g.reason}`);
      wire(sim, g.id!);
      sim.ensureCompiled();
      sim.accEnergy.set(g.id!, 600 * 600); // half full: it covers the deficit for a few minutes
      return sim;
    };
    const a = withGourd(), b = withGourd();
    const ore0 = a.stock[IRON()]!;
    // Long enough for the accumulator to run dry, short enough that no weather step hides a stale mode.
    a.run(9000);
    catchUp(b, 9000, { noDirect: true });
    const got = (s: Sim): number => (s.stock[IRON()]! - ore0) / 1000;
    expect([...a.accEnergy.values()][0]).toBe(0);
    expect([...b.accEnergy.values()][0]).toBe(0);
    expect(Math.abs(got(b) - got(a)) / got(a)).toBeLessThan(0.02);
  });
});
