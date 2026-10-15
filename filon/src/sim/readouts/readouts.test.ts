import { describe, it, expect } from 'vitest';
import { drillToHearth, line, testSim, wire } from '../testkit';
import type { Sim } from '../state';
import { forecast, gridReports, powerMarks } from './power';
import { prodMarks, stopWhy } from './production';
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
