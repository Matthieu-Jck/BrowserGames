import { describe, it, expect } from 'vitest';
import { itemIdx } from '@/content/registry';
import { DEPTH_COST, PLAN_IDS, PLANS, treePrereq } from '@/content/research';
import { testSim, stockedSilo, steadyPower, wire } from '../testkit';
import { effectiveCost } from './runtime';
import { serialize, deserialize } from '../serialize';
import { catchUp } from '../offline/catchup';
import { exec, replay } from '../commands';
import type { Sim } from '../state';

const DF = (): number => itemIdx('journal_1');

/** A research lab beside the Heart (on the claim's land, wired to it), its store pre-filled with data files. */
function labSim(files: number): { sim: Sim; lab: number } {
  const sim = testSim();
  // The Face Cutter's plan (D101: a plan now; Mechanics no longer hangs from it), taken outside commands.
  sim.done.add('ex_quartz');
  sim.rebuildDerived();
  const r = sim.place('observatory', 503, 512, 0);
  if (!r.ok) throw new Error(`observatory: ${r.reason}`);
  wire(sim, r.id!);
  sim.ensureCompiled();
  sim.stores.get(r.id!)![DF()] = files * 1000;
  return { sim, lab: r.id! };
}

/** Research nodes granted outside commands (such a colony is not replayed), like `steadyPower`'s. */
function learn(sim: Sim, ...ids: string[]): void {
  for (const id of ids) sim.done.add(id);
  sim.rebuildDerived();
}

/** Tokens billed (D105: from the Server Room on), so a project's tokens are counted and paid for. */
const billed = (sim: Sim): void => learn(sim, 'an_servers');

/**
 * Tier 2 open (D93): Tier 1 whole — the Synthesis and every node it needs — and two expertises
 * chosen. Its first trunk node, Earthworks (`tr2`), runs 8 minutes on 15 000 tokens: 1 875 a minute.
 */
function tierTwo(sim: Sim): void {
  learn(sim, ...treePrereq('tr_synth'), 'tr_synth');
  sim.expertise.slots = [{ id: 'estate', at: 0, on: false }, { id: 'haulage', at: 0, on: false }];
}

describe('research (D68, D69): data files, AI tokens, tiers', () => {
  it('a node costs its table\'s price, whatever else the claim owns (D72: no spread penalty, no lineage discount)', () => {
    // A Tier 3 node uses three kinds of data (D71): Survey Data, a third as much Mechanics Data, a
    // twelfth as many atlases.
    const a = effectiveCost('en_bigwind');
    expect(a.tokens).toBe(1_200_000);
    expect(a.cost.map((c) => c.mu / 1000)).toEqual([1920, 640, 160]);
    expect(effectiveCost('en_tower').ticks).toBe(1440 * 600);
    expect(effectiveCost('tr2').tokens).toBe(15_000);
    expect(DEPTH_COST[9]!.tokens).toBe(6_000_000);
    // A Tier 2 node started by a claim that owns Tier 1–2 research in every other family: its table's price.
    const { sim } = labSim(0);
    billed(sim);
    const closure = (id: string): string[] => [id, ...treePrereq(id).flatMap(closure)];
    learn(sim, ...closure('en_heavyacc').slice(1), ...['ex3', 'dn_wiremill', 'cm_floor', 'an_relay', 'xp_bigsilo'].flatMap(closure));
    expect(sim.startResearch('en_heavyacc')).toEqual({ ok: true, reason: null });
    const p = sim.projects.find((q) => q.id === 'en_heavyacc')!;
    const base = effectiveCost('en_heavyacc');
    expect(p.cost).toEqual(base.cost);
    expect([p.tokens, p.dur]).toEqual([base.tokens, base.ticks]);
  });

  it('cannot finish before its minimum duration; it uses its data files and, by the minute, its tokens', () => {
    const { sim, lab } = labSim(100);
    billed(sim);
    const credits = sim.credits;
    expect(sim.startResearch('tr1').ok).toBe(true);
    const dur = sim.projects[0]!.dur;
    expect(dur).toBe(effectiveCost('tr1').ticks);
    expect(dur).toBe(600); // a minute: Tier 1 is short (D107)
    sim.run(dur - 1);
    expect(sim.done.has('tr1')).toBe(false);
    sim.run(1);
    expect(sim.done.has('tr1')).toBe(true);
    expect(sim.stores.get(lab)![DF()]).toBe(94_000); // its 6 Survey Data
    // 8 000 tokens at CrierBelt's 10 ◉ the thousand, billed minute by minute: 80 ◉.
    expect(sim.tokenStats.totalBought).toBe(8000);
    expect(credits - sim.credits).toBe(8000);
  });

  it('takes longer when data runs short, and resumes as it arrives', () => {
    const { sim, lab } = labSim(3);
    sim.startResearch('tr1');
    sim.run(sim.projects[0]!.dur + 500);
    expect(sim.done.has('tr1')).toBe(false);
    expect(sim.projects[0]!.paid[0]).toBe(3_000);
    sim.stores.get(lab)![DF()] = 20_000;
    sim.run(1);
    expect(sim.done.has('tr1')).toBe(true);
  });

  it('starts only with its prerequisites, a free slot, an idle lab and a purse out of the red', () => {
    const { sim } = labSim(0);
    expect(sim.researchBlock('tr2')).toBe('prereq');
    expect(sim.startResearch('tr1').ok).toBe(true);
    expect(sim.researchBlock('tr1')).toBe('active');
    learn(sim, 'tr1');
    expect(sim.researchBlock('tr2')).toBe('prereq'); // the Synthesis closes Tier 1 first (D93)
    learn(sim, 'tr_synth');
    expect(sim.researchBlock('tr2')).toBe('expertise'); // and two expertises chosen open Tier 2
    sim.expertise.slots = [{ id: 'estate', at: 0, on: false }, { id: 'haulage', at: 0, on: false }];
    expect(sim.researchBlock('tr2')).toBe('slots');
    learn(sim, 'tr3', 'tr4', 'tr5');
    expect(sim.mods.slots).toBe(2);
    expect(sim.researchBlock('tr2')).toBe('no_lab');
    expect(sim.place('observatory', 503, 515, 0).ok).toBe(true);
    sim.credits = -1;
    expect(sim.researchBlock('tr2')).toBe('debt');
    sim.credits = 100;
    expect(sim.startResearch('tr2').ok).toBe(true);
    expect(sim.projects.map((p) => p.id)).toEqual(['tr1', 'tr2']);
  });

  it('cancelling leaves the data already paid in the lab; the tokens used are spent', () => {
    const { sim, lab } = labSim(100);
    billed(sim);
    sim.startResearch('tr1');
    sim.run(300); // half its minute: half its 6 Survey Data, half its 8 000 tokens
    expect(sim.projects[0]!.paid[0]).toBe(3_000);
    expect(sim.cancelResearch('tr1')).toBe(true);
    expect(sim.stores.get(lab)![DF()]).toBe(100_000);
    sim.run(600);
    expect(sim.tokenStats.totalBought).toBe(4000);
  });

  it('a purse in the red holds research until it is back above zero', () => {
    const { sim } = labSim(100);
    billed(sim);
    tierTwo(sim);
    sim.credits = 500; // 5 ◉: less than a minute of Earthworks' tokens (1 875 a minute)
    expect(sim.startResearch('tr2').ok).toBe(true);
    sim.run(600 - (sim.tick % 600)); // to the boundary
    sim.run(600);
    expect(sim.credits).toBeLessThan(0);
    expect(sim.researchHeld).toBe(true);
    expect(sim.events).toContainEqual({ k: 'researchHeld', held: true });
    const el = sim.projects[0]!.el;
    sim.run(600);
    expect(sim.projects[0]!.el).toBe(el); // held: no progress, no tokens
    sim.credits += 100_000;
    sim.run(600); // the next boundary lifts the hold
    expect(sim.researchHeld).toBe(false);
    sim.run(600);
    expect(sim.projects[0]?.el ?? Infinity).toBeGreaterThan(el);
  });

  it('servers cover the tokens first; CrierBelt bills the rest; what they make and nobody uses is lost', () => {
    const { sim } = labSim(100);
    steadyPower(sim);
    learn(sim, 'an_servers');
    sim.grant('circuit', 10); sim.grant('copper_wire', 10); sim.grant('oscillator', 4); // its clocks (D87)
    const s = sim.place('server', 512, 503, 0);
    expect(s.ok).toBe(true);
    wire(sim, s.id!);
    sim.run(600 - (sim.tick % 600));
    sim.run(600); // a minute with no research: 2 000 tokens made, all lost
    expect(sim.tokenStats.supply).toBe(2000);
    expect(sim.tokenStats.used).toBe(0);
    const credits = sim.credits;
    tierTwo(sim);
    expect(sim.startResearch('tr2').ok).toBe(true); // 1 875 tokens a minute: the server covers them
    sim.run(600 - (sim.tick % 600));
    sim.run(600);
    expect(sim.tokenStats.used).toBe(1875);
    expect(sim.tokenStats.fromServers).toBe(1875);
    expect(sim.tokenStats.bought).toBe(0);
    expect(sim.credits).toBe(credits);
  });

  it('the Heart makes Survey Data from its level 2, research or not (D101: 2 a minute, Data Processing 1 more), out of its one outlet (D86)', () => {
    const sim = testSim();
    learn(sim, 'an_data');
    const d0 = sim.stock[DF()]!;
    // Its outlet: the south side of its south-east corner tile (514, 514) faces (514, 515).
    expect(sim.placeBelts('ribbon', [[514, 515, 2], [514, 516, 2], [514, 517, 2]])).toBe(3);
    // Level 1: no outlet mounted on that corner — the port stands, the line on it gets nothing, and
    // a save of that base opens the same.
    sim.run(1200);
    expect(sim.heartDataRate()).toBe(0);
    expect(sim.produced[DF()]).toBe(0);
    expect(sim.stock[DF()]).toBe(d0);
    const back = deserialize(serialize(sim), sim.grid.source);
    back.run(600);
    expect(back.produced[DF()]).toBe(0);
    // Level 2 (D101: the player's own upgrade, in plates, glass and copper wire): 2 a minute and Data
    // Processing's 1, no power needed, out by the ribbon.
    back.grant('iron_plate', 300); back.grant('glass', 100); back.grant('copper_wire', 100);
    expect(back.upgradeHearth().ok).toBe(true);
    expect(back.heartDataRate()).toBe(3000);
    back.run(600);
    expect(back.produced[DF()]).toBe(3000);
    back.run(1800);
    expect(back.produced[DF()]).toBe(12_000);
    expect(back.stock[DF()]! - d0).toBeLessThan(12_000); // some left by the ribbon (a dead end: it fills up)
    // Without Data Processing (D101: the first lab runs on the Core's own data): 2 a minute.
    const plain = testSim();
    plain.hearthLevel = 2; // outside commands, like `learn`
    expect(plain.heartDataRate()).toBe(2000);
  });

  it('the Research Queue: a lab moves on to the node queued for it', () => {
    const { sim, lab } = labSim(200);
    learn(sim, 'an_queue', 'tr_synth'); // a Tier 2 node learnt: Tier 2 is open (D93)
    expect(sim.queueResearch(lab, 'nope')).toBe(false); // a known node, not learnt yet
    sim.startResearch('tr1');
    expect(sim.queueResearch(lab, 'tr2')).toBe(true);
    sim.run(3000);
    expect(sim.done.has('tr1')).toBe(true);
    expect(sim.projects.map((p) => p.id)).toEqual(['tr2']);
    expect(sim.labQueue.size).toBe(0);
  });

  it('online ≈ offline: data by ribbon, the Heart’s files, servers, the minute’s bill', () => {
    const sim = testSim();
    steadyPower(sim);
    learn(sim, 'an_servers', 'an_data', 'ex_quartz'); // the Face Cutter's plan too (D101)
    sim.hearthLevel = 2; // its data outlet mounted (D86), outside commands like `learn`
    // A lab (3×3, D84) over a silo of data files, one ribbon square between (the silo hands out north).
    const lab = sim.place('observatory', 512, 516, 0);
    expect(lab.ok).toBe(true);
    wire(sim, lab.id!);
    stockedSilo(sim, 512, 520, 0, 'journal_1', 200);
    expect(sim.placeBelts('ribbon', [[512, 519, 0]])).toBe(1);
    sim.grant('circuit', 10); sim.grant('copper_wire', 10); sim.grant('oscillator', 4); // its clocks (D87)
    const s = sim.place('server', 503, 512, 0);
    expect(s.ok).toBe(true);
    wire(sim, s.id!);
    expect(sim.startResearch('tr1').ok).toBe(true);
    sim.run(5);
    const save = serialize(sim);
    const a = deserialize(save, sim.grid.source), b = deserialize(save, sim.grid.source);
    a.run(8000);
    catchUp(b, 8000, { noDirect: true });
    expect(a.done.has('tr1')).toBe(true);
    expect(b.done.has('tr1')).toBe(true);
    expect(b.tokenStats.totalUsed).toBe(a.tokenStats.totalUsed);
    expect(b.tokenStats.totalBought).toBe(a.tokenStats.totalBought);
    expect(b.credits).toBe(a.credits);
    expect(Math.abs(a.consumed[DF()]! - b.consumed[DF()]!)).toBeLessThan(1000);
    expect(b.stock[DF()]).toBe(a.stock[DF()]);
  });

  it('reconversion is retired (D107): its command does nothing; a save’s reconversion under way runs out, pays its notes, and they pre-pay research', () => {
    const sim = testSim();
    learn(sim, 'tr1', 'en_pitch', 'en2', 'xp_swift');
    sim.grant('iron_plate', 50); sim.grant('glass', 50); sim.grant('copper_wire', 50);
    const sb = sim.place('sun_bulb', 516, 504, 0);
    expect(sb.ok).toBe(true);
    // The command a log may still hold: nothing goes, nothing starts, nothing is logged.
    const log = sim.log.length;
    expect(exec(sim, { k: 'respec', branch: 'en' })).toBe(false);
    expect(sim.done.has('en_pitch') && sim.done.has('en2')).toBe(true);
    expect(sim.projects.length).toBe(0);
    expect(sim.log.length).toBe(log);
    // A save from before, its Energy reconverted and the wait under way: the family gone, its
    // panel dormant, the project holding a slot, no lab.
    sim.done.delete('en_pitch'); sim.done.delete('en2');
    sim.projects.push({ id: 'respec:en', lab: 0, cost: [], paid: [], dur: 600, el: 0, notes: 5000 });
    sim.rebuildDerived();
    const back = deserialize(serialize(sim), sim.grid.source);
    expect(back.isDormant(back.ents.get(sb.id!)!)).toBe(true);
    expect(back.projects[0]!.id).toBe('respec:en');
    back.run(600);
    expect(back.projects.length).toBe(0);
    expect(back.notes).toBe(5000);
    // Notes pre-pay the next research's data files.
    expect(back.place('observatory', 503, 512, 0).ok).toBe(true);
    back.startResearch('en_pitch');
    expect(back.notes).toBeLessThan(5000);
    expect(back.projects[0]!.paid[0]).toBeGreaterThan(0);
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
    expect(sim.unlockPlan('tr1').reason).toBe('unknown'); // research starts in a lab
    expect(sim.unlockPlan('bridge').reason).toBe('prereq'); // after the junction
    expect(sim.unlockPlan('observatory').reason).toBe('prereq'); // after the data collector
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

  it('research hangs from the lab’s plan: its roots wait for it', () => {
    const sim = testSim(undefined, { plans: false });
    sim.grant('iron_plate', 100); sim.grant('glass', 20); sim.grant('copper_wire', 20);
    expect(sim.researchBlock('tr1')).toBe('prereq');
    expect(sim.researchBlock('ex_sifter')).toBe('prereq');
    // The lab's plan is the gate (D71): it waits for every other plan.
    expect(sim.unlockPlan('observatory').reason).toBe('prereq');
    for (const id of PLAN_IDS) if (PLANS[id].lane !== 'gate') { for (const [it, n] of PLANS[id].cost) sim.grant(it, n); expect(sim.unlockPlan(id).ok, id).toBe(true); }
    expect(sim.researchBlock('tr1')).toBe('prereq');
    expect(sim.unlockPlan('observatory').ok).toBe(true);
    expect(sim.researchBlock('tr1')).toBe('no_lab'); // now only a lab is missing (D101: Mechanics straight after the lab's plan)
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
    const d = deserialize(JSON.parse(JSON.stringify(serialize(a))), a.grid.source);
    d.done.delete('bridge');
    expect(d.hash()).not.toBe(a.hash());
  });
});
