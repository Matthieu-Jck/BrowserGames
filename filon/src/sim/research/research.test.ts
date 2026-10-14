import { describe, it, expect } from 'vitest';
import { itemIdx } from '@/content/registry';
import { testSim, stockedSilo, wire } from '../testkit';
import { effectiveCost } from './runtime';
import { serialize, deserialize } from '../serialize';
import { catchUp } from '../offline/catchup';
import { replay } from '../commands';
import type { Sim } from '../state';

const J1 = (): number => itemIdx('journal_1');

/** An observatory beside the Hearth (inside its zone, wired to it), store pre-filled. */
function labSim(journals: number): { sim: Sim; lab: number } {
  const sim = testSim();
  const r = sim.place('observatory', 503, 512, 0);
  if (!r.ok) throw new Error(`observatory: ${r.reason}`);
  wire(sim, r.id!);
  sim.ensureCompiled();
  sim.stores.get(r.id!)![J1()] = journals * 1000;
  return { sim, lab: r.id! };
}

describe('research', () => {
  it('the en7 example: a specialist pays 114 atlases and 16 codex in 10.2 h, a generalist 224 and 30 in 14.28 h', () => {
    const spec = new Set(['en1', 'en2', 'en3', 'en4', 'en5', 'en6']);
    const a = effectiveCost('en7', spec);
    expect(a.cost.map((c) => c.mu / 1000)).toEqual([114, 16]);
    expect(a.ticks).toBe(10.2 * 3600 * 10);
    const gen = new Set([...spec, 'ex1', 'ex2', 'xp1', 'xp2', 'dn1', 'dn2', 'cm1', 'cm2']);
    const b = effectiveCost('en7', gen);
    expect(b.cost.map((c) => c.mu / 1000)).toEqual([224, 30]);
    expect(b.ticks).toBe(14.28 * 3600 * 10);
    // The trunk escapes the spreading penalty.
    expect(effectiveCost('tr6', gen).cost.map((c) => c.mu / 1000)).toEqual([150]);
  });

  it('cannot finish before its minimum duration, even with science to spare', () => {
    const { sim } = labSim(100);
    expect(sim.startResearch('tr1').ok).toBe(true);
    const dur = sim.projects[0]!.dur;
    expect(dur).toBe(3000);
    sim.run(dur - 1);
    expect(sim.done.has('tr1')).toBe(false);
    sim.run(1);
    expect(sim.done.has('tr1')).toBe(true);
    expect(sim.stores.get(sim.ents.sorted().find((e) => e.def !== 0 && sim.projects.length === 0 && e.x === 503)!.id)![J1()]).toBe(70_000);
  });

  it('takes longer when science runs short, and resumes as it arrives', () => {
    const { sim, lab } = labSim(10);
    sim.startResearch('tr1');
    sim.run(3500);
    expect(sim.done.has('tr1')).toBe(false);
    expect(sim.projects[0]!.paid[0]).toBe(10_000);
    sim.stores.get(lab)![J1()] = 20_000;
    sim.run(1);
    expect(sim.done.has('tr1')).toBe(true);
  });

  it('starts only with its prerequisites, a free slot and an idle observatory', () => {
    const { sim } = labSim(0);
    expect(sim.researchBlock('tr2')).toBe('prereq');
    expect(sim.startResearch('tr1').ok).toBe(true);
    expect(sim.researchBlock('tr1')).toBe('active');
    sim.done.add('tr1');
    sim.rebuildDerived();
    expect(sim.researchBlock('tr2')).toBe('slots');
    // A second desk and a second observatory allow two at once.
    for (const id of ['tr3', 'tr4', 'tr5']) sim.done.add(id);
    sim.rebuildDerived();
    expect(sim.mods.slots).toBe(2);
    expect(sim.researchBlock('tr2')).toBe('no_lab');
    expect(sim.place('observatory', 503, 515, 0).ok).toBe(true);
    expect(sim.startResearch('tr2').ok).toBe(true);
    expect(sim.projects.map((p) => p.id)).toEqual(['tr1', 'tr2']);
  });

  it('cancelling returns the science already paid', () => {
    const { sim } = labSim(100);
    sim.startResearch('tr1');
    sim.run(1500);
    const paid = sim.projects[0]!.paid[0]!;
    expect(paid).toBe(15_000);
    const before = sim.stock[J1()]!;
    expect(sim.cancelResearch('tr1')).toBe(true);
    expect(sim.stock[J1()]! - before).toBe(paid);
  });

  it('the offline catch-up completes the same research as ticking, fed by ribbon', () => {
    const sim = testSim();
    // An observatory (wired to the Hearth) over a silo of survey data; one ribbon square between:
    // the silo hands out (512,520) → (512,519), up into the observatory's inlet (512,518).
    const lab = sim.place('observatory', 512, 517, 0);
    expect(lab.ok).toBe(true);
    wire(sim, lab.id!);
    stockedSilo(sim, 512, 520, 0, 'journal_1', 200);
    expect(sim.placeBelts('ribbon', [[512, 519, 0]])).toBe(1);
    expect(sim.startResearch('tr1').ok).toBe(true);
    sim.run(5);
    const save = serialize(sim);
    const a = deserialize(save, sim.grid.source), b = deserialize(save, sim.grid.source);
    a.run(8000);
    catchUp(b, 8000, { noDirect: true });
    expect(a.done.has('tr1')).toBe(true);
    expect(b.done.has('tr1')).toBe(true);
    expect(Math.abs(a.consumed[J1()]! - b.consumed[J1()]!)).toBeLessThan(1000);
  });

  it('reconversion: the branch goes, its buildings stand dormant, notes come back after the wait', () => {
    const sim = testSim();
    for (const id of ['tr1', 'en1', 'en2', 'xp1']) sim.done.add(id);
    sim.rebuildDerived();
    sim.grant('iron_plate', 50); sim.grant('glass', 50); sim.grant('copper_wire', 50);
    const sb = sim.place('sun_bulb', 516, 504, 0);
    expect(sb.ok).toBe(true);
    expect(sim.respec('en')).toBe(true);
    expect(sim.done.has('en1') || sim.done.has('en2')).toBe(false);
    expect(sim.isDormant(sim.ents.get(sb.id!)!)).toBe(true);
    expect(sim.projects[0]!.id).toBe('respec:en');
    // The reconversion holds the only slot; another one would also wait its cooldown.
    expect(sim.researchBlock('xp2')).toBe('slots');
    expect(sim.respecBlock('xp')).toBe('cooldown');
    sim.run(sim.projects[0]!.dur);
    expect(sim.projects.length).toBe(0);
    expect(sim.notes).toBeGreaterThan(0);
    expect(sim.respecBlock('xp')).toBe('cooldown');
    // Notes pre-pay the next research.
    expect(sim.place('observatory', 503, 512, 0).ok).toBe(true);
    const notes = sim.notes;
    sim.startResearch('en1');
    expect(sim.notes).toBeLessThan(notes);
    expect(sim.projects[0]!.paid[0]).toBeGreaterThan(0);
  });
});

describe('plans (D33): the tree’s instant unlocks, paid from the Heart', () => {
  const plate = (): number => itemIdx('iron_plate');

  it('a plan unlocks at once: its cost leaves the Heart, what it unlocks can be built, the command is logged', () => {
    const sim = testSim(undefined, { plans: false });
    expect(sim.unlocked('router')).toBe(false);
    expect(sim.canPlace('router', 506, 506, 0).reason).toBe('locked');
    const before = sim.stock[plate()]!;
    expect(sim.planBlock('router')).toBeNull();
    expect(sim.unlockPlan('router')).toEqual({ ok: true, reason: null });
    expect(sim.stock[plate()]!).toBe(before - 5000); // the router's plan: 5 plates
    expect(sim.unlocked('router')).toBe(true);
    expect(sim.canPlace('router', 506, 506, 0).ok).toBe(true);
    expect(sim.log.at(-1)?.cmd).toEqual({ k: 'unlockPlan', id: 'router' });
    expect(sim.events).toContainEqual({ k: 'plan', id: 'router' });
  });

  it('refuses, with its reason, a non-plan, a missing prerequisite, a short Heart, a plan already taken — paying and logging nothing', () => {
    const sim = testSim(undefined, { plans: false });
    const log = sim.log.length, stock = Float64Array.from(sim.stock);
    expect(sim.unlockPlan('nope').reason).toBe('unknown');
    expect(sim.unlockPlan('tr1').reason).toBe('unknown'); // research starts in an observatory
    expect(sim.unlockPlan('bridge').reason).toBe('prereq'); // after the junction
    expect(sim.unlockPlan('observatory').reason).toBe('prereq'); // after the workshop
    expect(sim.log.length).toBe(log);
    expect(Array.from(sim.stock)).toEqual(Array.from(stock));
    expect(sim.unlockPlan('router').ok).toBe(true);
    expect(sim.unlockPlan('router').reason).toBe('done');
    sim.stock[plate()] = 5000; // a test shortcut: the Heart down to 5 plates
    expect(sim.planBlock('kiln')).toBe('unaffordable');
    expect(sim.unlockPlan('kiln')).toEqual({ ok: false, reason: 'unaffordable' });
    expect(sim.stock[plate()]).toBe(5000);
  });

  it('the telemetry plan brings its flag: the rates in the HUD and the stats screen', () => {
    const sim = testSim(undefined, { plans: false });
    expect(sim.mods.flags.has('telemetry')).toBe(false);
    expect(sim.unlockPlan('telemetry').ok).toBe(true);
    expect(sim.mods.flags.has('telemetry')).toBe(true);
  });

  it('research hangs from the observatory’s plan: its roots wait for it', () => {
    const sim = testSim(undefined, { plans: false });
    sim.grant('iron_plate', 100); sim.grant('glass', 20); sim.grant('copper_wire', 20);
    expect(sim.researchBlock('tr1')).toBe('prereq');
    expect(sim.researchBlock('ex1')).toBe('prereq');
    for (const id of ['kiln', 'workshop', 'observatory']) expect(sim.unlockPlan(id).ok, id).toBe(true);
    expect(sim.researchBlock('tr1')).toBe('no_lab'); // now only an observatory is missing
  });

  it('unlocks replay to the same state hash, and survive save → load', () => {
    const a = testSim(undefined, { plans: false });
    a.grant('iron_plate', 100); a.grant('copper_wire', 10);
    for (const id of ['telemetry', 'router', 'junction', 'kiln']) expect(a.unlockPlan(id).ok, id).toBe(true);
    expect(a.place('router', 506, 506, 0).ok).toBe(true);
    a.run(120);
    expect(a.unlockPlan('bridge').ok).toBe(true);
    a.run(30);
    const b = testSim(undefined, { plans: false });
    replay(b, a.log, a.tick);
    expect([...b.done].sort()).toEqual([...a.done].sort());
    expect(b.log.length).toBe(a.log.length);
    expect(b.hash()).toBe(a.hash());
    const c = deserialize(JSON.parse(JSON.stringify(serialize(a))), a.grid.source);
    expect([...c.done].sort()).toEqual(['bridge', 'junction', 'kiln', 'router', 'telemetry']);
    expect(c.mods.flags.has('telemetry')).toBe(true);
    expect(c.hash()).toBe(a.hash());
    // The hash sees the tree: the same base without one plan hashes differently.
    const d = deserialize(JSON.parse(JSON.stringify(serialize(a))), a.grid.source);
    d.done.delete('bridge');
    expect(d.hash()).not.toBe(a.hash());
  });
});
