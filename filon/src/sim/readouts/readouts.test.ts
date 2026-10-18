import { describe, it, expect } from 'vitest';
import { drillToHearth, grantCost, line, testSim, wire } from '../testkit';
import type { Sim } from '../state';
import { forecast, gridReports, idleCount, needsNoPower, powerMarks } from './power';
import { buildingIdx } from '@/content/registry';
import { prodMarks, stopWhy } from './production';
import { weakGrid, workOf } from '../systems/work';
import { RibbonSampler, ribbonSummary } from './ribbons';
import { sunPermille } from '../power/network';

/** A drill on the copper south of the Core onto three tiles of ribbon that end on bare ground; returns the last tile. */
function deadEnd(sim: Sim): number {
  const d = sim.place('drill', 514, 522, 2);
  if (!d.ok) throw new Error(`drill: ${d.reason}`);
  wire(sim, d.id!);
  const n = sim.placeBelts('ribbon', line(515, 524, 2, 3));
  if (n !== 3) throw new Error(`belts placed ${n}`);
  return 526 * 1024 + 515;
}

describe('readouts (D88): what the specialised views show, read from the sim and never changing it', () => {
  it('Électricité: the Core’s grid by source, served in full; its forecast follows the sun (nothing from it at night)', () => {
    const sim = testSim();
    drillToHearth(sim);
    sim.run(20);
    const grids = gridReports(sim);
    const home = sim.graph.netOfEnt.get(sim.hearthId)!;
    const g = grids.find((x) => x.net === home)!;
    expect(g.kw.core).toBeGreaterThan(0); // the Core's isotope core, steady
    expect(g.demand).toBeGreaterThan(0); // the drill draws
    expect(g.top[0]?.ent).toBeGreaterThan(0);
    const f = forecast(sim, home);
    expect(f.length).toBe(36);
    for (const s of f) if (sunPermille(s.ep) === 0) expect(s.kw.solar).toBe(0);
    expect(f.some((s) => s.kw.solar > 0)).toBe(true);
    // Reading changes nothing: no command logged, the same state.
    const h = sim.hash(), n = sim.log.length;
    gridReports(sim); powerMarks(sim);
    expect(sim.hash()).toBe(h);
    expect(sim.log.length).toBe(n);
  });

  it('Électricité: a building with no wire carries the flag, a source its output, the Core no pillar ring', () => {
    const sim = testSim();
    const drill = drillToHearth(sim);
    for (const o of sim.linksOf(drill)) sim.unlink(drill, o);
    sim.run(5);
    const marks = powerMarks(sim);
    expect(marks.find((m) => m.ent === drill)?.flag).toBe('unwired');
    const core = marks.find((m) => m.ent === sim.hearthId)!;
    expect(core.role.k).toBe('source');
    if (core.role.k === 'source') expect(core.role.src).toBe('core');
    wire(sim, drill);
    sim.run(5);
    expect(powerMarks(sim).find((m) => m.ent === drill)?.flag).toBe(null);
  });

  it('Électricité (owner, 2026-10-16): each building in its group — the Core and a turbine produce, an accumulator stores, a wired drill consumes, an unwired one is not linked, a pole none; ribbons and stores need no power', () => {
    const sim = testSim();
    sim.done.add('tr3'); sim.rebuildDerived(); // the accumulator (research, granted outside the commands)
    for (const [it, n] of [['iron_plate', 200], ['glass', 40], ['copper_wire', 60], ['ceramic', 20], ['empty_cell', 10], ['circuit', 10]] as const) sim.grant(it, n);
    grantCost(sim, 'accumulator'); // its price today (D123)
    const drill = drillToHearth(sim);
    const turbine = sim.place('wind_flower', 517, 516, 0), acc = sim.place('accumulator', 504, 516, 0), loose = sim.place('drill', 512, 522, 2), pole = sim.place('mast', 520, 512, 0);
    for (const r of [turbine, acc, loose, pole]) expect(r.ok, r.reason).toBe(true);
    wire(sim, [turbine.id!, acc.id!]);
    sim.run(1200); // kites
    const group = (id: number) => powerMarks(sim).find((m) => m.ent === id)?.group;
    expect(group(sim.hearthId)).toBe('producer');
    expect(group(turbine.id!)).toBe('producer');
    expect(group(acc.id!)).toBe('storage');
    expect(group(drill)).toBe('consumer');
    expect(group(loose.id!)).toBe('unlinked');
    expect(group(pole.id!)).toBe(null);
    expect(needsNoPower(buildingIdx('ribbon'))).toBe(true);
    expect(needsNoPower(buildingIdx('silo'))).toBe(true);
    expect(needsNoPower(buildingIdx('drill'))).toBe(false);
    // The idle count leaves the ribbons out: none but ribbons here.
    expect(idleCount(sim)).toBe(0);
    expect(sim.place('silo', 500, 520, 0).ok).toBe(true);
    expect(idleCount(sim)).toBe(1);
  });

  it('Production: a drill cut from the grid stops for want of a wire; wired, it works', () => {
    const sim = testSim();
    const drill = drillToHearth(sim);
    sim.run(30);
    expect(prodMarks(sim).find((m) => m.ent === drill)?.work).toBe('on');
    for (const o of sim.linksOf(drill)) sim.unlink(drill, o);
    sim.run(5);
    const e = sim.ents.get(drill)!;
    expect(stopWhy(sim, e)).toBe('unwired');
    expect(prodMarks(sim).find((m) => m.ent === drill)).toMatchObject({ work: 'off', why: 'unwired' });
  });

  it('Production: drills at work on a grid under 100 % run slowed — still at work for their look, waiting on a weak grid for the view (D91)', () => {
    const sim = testSim();
    // Five drills on the iron north of the Core, 450 kW against its 90 kW core and the sun.
    const xs = [508, 510, 512, 514, 516];
    const drills = xs.map((x) => {
      const d = sim.place('drill', x, 502, 2);
      if (!d.ok) throw new Error(`drill: ${d.reason}`);
      wire(sim, d.id!);
      return d.id!;
    });
    sim.run(10);
    const net = sim.graph.netOfEnt.get(sim.hearthId)!;
    const sat = sim.ctx.sat[net]!;
    expect(sat).toBeGreaterThan(0);
    expect(sat).toBeLessThan(1000);
    for (const id of drills) {
      const e = sim.ents.get(id)!;
      expect(workOf(sim, e)).toBe('on'); // it works: its look and D85's check are unchanged
      expect(weakGrid(sim, e)).toBe(sat);
      expect(prodMarks(sim).find((m) => m.ent === id)).toEqual({ ent: id, work: 'pause', why: 'weak', sat });
    }
    // Served in full again (four drills gone): at work, no nuance; the Core makes power, never weak.
    for (const x of xs.slice(1)) expect(sim.remove(x, 502)).toBe(true);
    sim.run(10);
    expect(sim.ctx.sat[sim.graph.netOfEnt.get(sim.hearthId)!]).toBe(1000);
    expect(weakGrid(sim, sim.ents.get(drills[0]!)!)).toBe(0);
    expect(prodMarks(sim).find((m) => m.ent === drills[0])).toMatchObject({ work: 'on', why: null, sat: 0 });
    expect(weakGrid(sim, sim.ents.get(sim.hearthId)!)).toBe(0);
  });

  it('Logistique: a line feeding the Core carries what the drill gives; a line to nowhere is a dead end that jams', () => {
    const sim = testSim();
    drillToHearth(sim);
    const s = new RibbonSampler();
    // Sampled as the views do, a few times a second of game time (a long jump — a catch-up — starts afresh).
    const play = (ticks: number): void => { for (let k = 0; k < ticks; k += 25) { sim.run(25); s.sample(sim); } };
    play(400);
    const looks = s.read(sim);
    expect(looks.length).toBeGreaterThan(0);
    const fed = looks.find((l) => !l.dead)!;
    expect(fed.util).toBeGreaterThan(0);
    expect(fed.util).toBeLessThanOrEqual(1000);
    expect(fed.jam).toBe(false);
    // A drill emptying onto a short ribbon that ends on bare ground.
    const t = deadEnd(sim);
    play(600);
    const l2 = s.read(sim).find((l) => l.chain.tiles.includes(t));
    expect(l2?.dead).toBe(true);
    expect(l2?.jam).toBe(true);
    expect(ribbonSummary(s.read(sim)).jams).toBeGreaterThan(0);
  });
});
