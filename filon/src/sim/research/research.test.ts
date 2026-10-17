import { describe, it, expect } from 'vitest';
import { itemIdx } from '@/content/registry';
import { BAL } from '@/content/balance';
import { DEPTH_COST, PLAN_IDS, PLANS, treePrereq } from '@/content/research';
import { flowStepAtLeast, tokenFlowSteps } from '../systems/research';
import { testSim, stockedSilo, steadyPower, wire } from '../testkit';
import { effectiveCost } from './runtime';
import { serialize, deserialize } from '../serialize';
import { catchUp } from '../offline/catchup';
import { exec, replay } from '../commands';
import type { Sim } from '../state';

const DF = (): number => itemIdx('journal_1');
const MD = (): number => itemIdx('journal_2');

/** A research lab beside the Heart (on the claim's land, wired to it), its store pre-filled with data files (Mechanics Data too: Tier 2). */
function labSim(files: number, mech = 0): { sim: Sim; lab: number } {
  const sim = testSim();
  // The Face Cutter's plan (D101: a plan now; Mechanics no longer hangs from it), taken outside commands.
  sim.done.add('ex_quartz');
  sim.rebuildDerived();
  const r = sim.place('observatory', 503, 512, 0);
  if (!r.ok) throw new Error(`observatory: ${r.reason}`);
  wire(sim, r.id!);
  sim.ensureCompiled();
  sim.stores.get(r.id!)![DF()] = files * 1000;
  sim.stores.get(r.id!)![MD()] = mech * 1000;
  return { sim, lab: r.id! };
}

/** Research nodes granted outside commands (such a colony is not replayed), like `steadyPower`'s. */
function learn(sim: Sim, ...ids: string[]): void {
  for (const id of ids) sim.done.add(id);
  sim.rebuildDerived();
}

/**
 * Tier 2 open: Tier 1 whole — the Synthesis and every node it needs (D93) —, the Core at level 3
 * (D118, outside commands like `learn`) and two expertises chosen. Its first trunk node, Earthworks
 * (`tr2`), takes 60 Survey Data, 20 Mechanics Data and 15 000 tokens, at a pace of 8 minutes.
 */
function tierTwo(sim: Sim): void {
  learn(sim, ...treePrereq('tr_synth'), 'tr_synth');
  sim.hearthLevel = 3;
  sim.expertise.slots = [{ id: 'estate', at: 0, on: false }, { id: 'haulage', at: 0, on: false }];
}

/** A server by the Heart, wired, at full power (steady geothermal): 2 000 tokens a minute. */
function server(sim: Sim, x = 512, y = 503): number {
  learn(sim, 'an_servers');
  sim.grant('circuit', 10); sim.grant('copper_wire', 10); sim.grant('oscillator', 4); sim.grant('iron_plate', 20); // its clocks (D87)
  const s = sim.place('server', x, y, 0);
  if (!s.ok) throw new Error(`server: ${s.reason}`);
  wire(sim, s.id!);
  return s.id!;
}

/** On to the next minute's boundary. */
const toBoundary = (sim: Sim): void => sim.run(600 - (sim.tick % 600) || 600);

describe('research (D68, D69, D118): data files, AI tokens as a flow, tiers by the Core', () => {
  it('a node costs its table\'s price, whatever else the claim owns (D72: no spread penalty, no lineage discount)', () => {
    // A Tier 3 node uses three kinds of data (D71): Survey Data, a third as much Mechanics Data, a
    // twelfth as many atlases.
    const a = effectiveCost('en_bigwind');
    expect(a.tokens).toBe(1_200_000);
    expect(a.cost.map((c) => c.mu / 1000)).toEqual([1920, 640, 160]);
    expect(effectiveCost('en_tower').aim).toBe(1440 * 600); // the pace the launch dialog aims at (D118: no minimum time)
    expect(effectiveCost('tr2').tokens).toBe(15_000);
    expect(DEPTH_COST[9]!.tokens).toBe(6_000_000);
    // A Tier 2 node started by a claim that owns Tier 1–2 research in every other family: its table's price.
    const { sim } = labSim(0);
    tierTwo(sim);
    const closure = (id: string): string[] => [id, ...treePrereq(id).flatMap(closure)];
    learn(sim, ...closure('en_heavyacc').slice(1), ...['ex3', 'dn_wiremill', 'cm_floor', 'an_relay', 'xp_bigsilo'].flatMap(closure));
    expect(sim.startResearch('en_heavyacc')).toEqual({ ok: true, reason: null });
    const p = sim.projects.find((q) => q.id === 'en_heavyacc')!;
    const base = effectiveCost('en_heavyacc');
    expect(p.cost).toEqual(base.cost);
    expect([p.tokens, p.tokIn, p.dur]).toEqual([base.tokens, 0, 0]);
  });

  it('Tier 1 takes data alone (D118): done the tick its data is in the lab — no time, no tokens, nothing billed', () => {
    const { sim, lab } = labSim(100);
    const credits = sim.credits;
    expect(effectiveCost('tr1')).toMatchObject({ tokens: 0, aim: 0 });
    expect(sim.startResearch('tr1').ok).toBe(true);
    expect(sim.projects[0]).toMatchObject({ dur: 0, tokens: 0 });
    sim.run(1);
    expect(sim.done.has('tr1')).toBe(true);
    expect(sim.stores.get(lab)![DF()]).toBe(94_000); // its 6 Survey Data
    toBoundary(sim);
    expect(sim.tokenStats.totalUsed).toBe(0);
    expect(sim.credits).toBe(credits);
  });

  it('waits for its data and finishes the tick the rest arrives; an unpowered lab takes none', () => {
    const { sim, lab } = labSim(3);
    sim.startResearch('tr1');
    sim.run(500);
    expect(sim.done.has('tr1')).toBe(false);
    expect(sim.projects[0]!.paid[0]).toBe(3_000);
    // Its wire cut: the lab has no power and takes nothing.
    expect(sim.unlink(sim.hearthId, lab)).toBe(true);
    sim.stores.get(lab)![DF()] = 20_000;
    sim.run(5);
    expect(sim.projects[0]!.paid[0]).toBe(3_000);
    wire(sim, lab);
    sim.run(1);
    expect(sim.done.has('tr1')).toBe(true);
  });

  it('starts only with its prerequisites, the Core at its tier\'s level (D118), two expertises for Tier 2, a free slot, an idle lab and, to buy tokens, a purse out of the red', () => {
    const { sim } = labSim(0);
    expect(sim.researchBlock('tr2')).toBe('prereq');
    expect(sim.startResearch('tr1').ok).toBe(true);
    expect(sim.researchBlock('tr1')).toBe('active');
    learn(sim, 'tr1');
    expect(sim.researchBlock('tr2')).toBe('prereq'); // the Synthesis closes Tier 1 first (D93)
    learn(sim, 'tr_synth');
    expect(sim.researchBlock('tr2')).toBe('core'); // the Core at level 1: Tier 2 waits for level 3 (D118)
    sim.hearthLevel = 2;
    expect(sim.researchBlock('tr2')).toBe('core');
    sim.hearthLevel = 3;
    expect(sim.researchBlock('tr2')).toBe('expertise'); // and two expertises chosen open Tier 2
    sim.expertise.slots = [{ id: 'estate', at: 0, on: false }, { id: 'haulage', at: 0, on: false }];
    expect(sim.researchBlock('tr2')).toBe('slots');
    learn(sim, 'tr3', 'tr4', 'tr5');
    expect(sim.mods.slots).toBe(2);
    expect(sim.researchBlock('tr2')).toBe('no_lab');
    expect(sim.place('observatory', 503, 515, 0).ok).toBe(true);
    sim.credits = -1;
    expect(sim.researchBlock('tr2')).toBe('debt'); // it may buy tokens: not from a purse in the red
    sim.credits = 100;
    expect(sim.startResearch('tr2').ok).toBe(true);
    expect(sim.projects.map((p) => p.id)).toEqual(['tr1', 'tr2']);
  });

  it('each tier waits for its Core level (D118: 3, 4, 5), each level the player\'s behind the trunk node that opens the tier; a tier a claim already holds a node of stays open', () => {
    expect(BAL.tierCoreLevel).toEqual([1, 3, 4, 5]);
    expect(BAL.hearthUpgrades.map((u) => u.unlock)).toEqual(['start', 'tr_synth', 'tr6', 'tr8']);
    const { sim } = labSim(0);
    tierTwo(sim);
    learn(sim, 'tr2', 'tr3', 'tr4', 'tr6');
    expect(sim.tierCoreOpen(2)).toBe(true);
    expect(sim.tierCoreOpen(3)).toBe(false);
    expect(sim.researchBlock('tr7')).toBe('core'); // a Tier 3 trunk node too
    sim.hearthLevel = 4;
    expect(sim.researchBlock('tr7')).toBeNull();
    expect(sim.tierCoreOpen(4)).toBe(false);
    // A claim from before D118, its Core still at 3 but a Tier 3 node learnt: Tier 3 stays open to it.
    sim.hearthLevel = 3;
    learn(sim, 'en_heavyacc', 'en4', 'en_solarfarm');
    expect(sim.tierCoreOpen(3)).toBe(true);
    expect(sim.researchBlock('tr7')).toBeNull();
  });

  it('Tier 2+: its data and then its tokens; the flow bought for it is billed each minute and stops by itself once it has them (D118)', () => {
    const { sim, lab } = labSim(100, 100);
    tierTwo(sim);
    sim.credits = 1_000_000;
    expect(sim.startResearch('tr2', 0, 5000).ok).toBe(true);
    expect(sim.log.at(-1)?.cmd).toEqual({ k: 'research', id: 'tr2', lab, buy: 5000 });
    sim.run(1);
    expect(sim.projects[0]!.paid).toEqual([60_000, 20_000]); // its data at once: no minimum time
    expect(sim.done.has('tr2')).toBe(false); // its 15 000 tokens to come
    toBoundary(sim);
    expect(sim.projects[0]!.tokIn).toBe(5000);
    expect(sim.tokenStats).toMatchObject({ used: 5000, bought: 5000, fromServers: 0, cents: 5000 }); // 50 ◉ at 10 ◉ the thousand
    toBoundary(sim);
    toBoundary(sim);
    expect(sim.done.has('tr2')).toBe(true); // done at the minute its last tokens came in
    expect(sim.tokenStats.totalBought).toBe(15_000);
    expect(sim.credits).toBe(1_000_000 - 15_000);
    toBoundary(sim);
    expect(sim.tokenStats.totalBought).toBe(15_000); // the flow went with it
  });

  it('the flow can change while it runs (logged), never beyond what the project needs', () => {
    const { sim } = labSim(100, 100);
    tierTwo(sim);
    sim.startResearch('tr2');
    expect(sim.projects[0]!.buy).toBe(0);
    toBoundary(sim);
    expect(sim.projects[0]!.tokIn).toBe(0); // no server, nothing bought: it waits for tokens
    expect(sim.setTokenBuy('tr2', 1000)).toBe(true);
    expect(sim.log.at(-1)?.cmd).toEqual({ k: 'tokenBuy', id: 'tr2', perMin: 1000 });
    expect(exec(sim, { k: 'tokenBuy', id: 'tr2', perMin: 99_999_999 })).toBe(true);
    expect(sim.projects[0]!.buy).toBe(15_000); // capped at its need
    expect(sim.setTokenBuy('tr2', -5)).toBe(false);
    expect(sim.setTokenBuy('nope', 5)).toBe(false);
    toBoundary(sim);
    expect(sim.done.has('tr2')).toBe(true);
  });

  it('cancelling leaves the data already paid in the lab; the tokens delivered are spent', () => {
    const { sim, lab } = labSim(100, 100);
    tierTwo(sim);
    sim.startResearch('tr2', 0, 3000);
    toBoundary(sim);
    expect(sim.projects[0]!.tokIn).toBe(3000);
    expect(sim.cancelResearch('tr2')).toBe(true);
    expect(sim.stores.get(lab)![DF()]).toBe(100_000);
    expect(sim.stores.get(lab)![MD()]).toBe(100_000);
    toBoundary(sim);
    expect(sim.tokenStats.totalBought).toBe(3000);
  });

  it('a purse in the red holds the bought flow until it is back above zero; the data and the servers go on (D118)', () => {
    const { sim } = labSim(100, 100);
    steadyPower(sim);
    server(sim);
    tierTwo(sim);
    learn(sim, 'tr3', 'tr4', 'tr5'); // a second slot
    expect(sim.place('observatory', 503, 515, 0).ok).toBe(true);
    sim.ensureCompiled();
    toBoundary(sim);
    sim.credits = 500; // 5 ◉: less than a minute of the flow
    expect(sim.startResearch('tr2', 0, 5000).ok).toBe(true);
    toBoundary(sim);
    expect(sim.credits).toBe(500 - 5000); // 5 000 tokens bought on top of the server's 2 000
    expect(sim.researchHeld).toBe(true);
    expect(sim.events).toContainEqual({ k: 'researchHeld', held: true });
    expect(sim.projects[0]!.tokIn).toBe(7000);
    expect(sim.researchBlock('tr6')).toBe('debt'); // no new project that may buy
    toBoundary(sim);
    expect(sim.projects[0]!.tokIn).toBe(9000); // the server's minute alone: nothing bought
    expect(sim.credits).toBe(-4500);
    sim.credits += 100_000;
    toBoundary(sim); // buys again — what it still needs past the server's share — the hold lifted
    expect(sim.researchHeld).toBe(false);
    expect(sim.done.has('tr2')).toBe(true);
    expect(sim.credits).toBe(-4500 + 100_000 - 4000);
  });

  it('servers go to the projects in the order they started, the oldest first; each one\'s bought flow tops it up; what nobody needs is lost', () => {
    const { sim } = labSim(500, 200);
    steadyPower(sim);
    server(sim);
    toBoundary(sim);
    toBoundary(sim); // a minute with no research: 2 000 tokens made, all lost
    expect(sim.tokenStats.supply).toBe(2000);
    expect(sim.tokenStats.used).toBe(0);
    tierTwo(sim);
    const closure = (id: string): string[] => [id, ...treePrereq(id).flatMap(closure)];
    learn(sim, ...closure('en_heavyacc').slice(1), 'tr3', 'tr4', 'tr5');
    const lab2 = sim.place('observatory', 503, 515, 0);
    expect(lab2.ok).toBe(true);
    wire(sim, lab2.id!);
    sim.ensureCompiled();
    sim.stores.get(lab2.id!)![DF()] = 200_000; sim.stores.get(lab2.id!)![MD()] = 200_000;
    expect(sim.startResearch('tr2').ok).toBe(true); // first: the servers' 2 000 a minute
    expect(sim.startResearch('en_heavyacc', 0, 3000).ok).toBe(true); // second: its own 3 000 bought
    const credits = sim.credits;
    toBoundary(sim);
    expect(sim.projects.map((p) => p.tokIn)).toEqual([2000, 3000]);
    expect(sim.tokenStats).toMatchObject({ supply: 2000, fromServers: 2000, bought: 3000 });
    expect(sim.credits).toBe(credits - 3000);
    for (let m = 0; m < 6; m++) toBoundary(sim);
    expect(sim.done.has('tr2')).toBe(false); // 14 000 of its 15 000
    toBoundary(sim); // Earthworks takes its last 1 000; the server's other 1 000 pass on to the next
    expect(sim.done.has('tr2')).toBe(true);
    expect(sim.projects[0]!.tokIn).toBe(8 * 3000 + 1000);
  });

  it('the flow the launch dialog proposes: the tokens over the tier\'s pace, less the servers it would get, up the ladder (D118)', () => {
    expect(tokenFlowSteps(2600)).toEqual([0, 500, 750, 1000, 1500, 2000, 3000]);
    expect(flowStepAtLeast(1875)).toBe(2000);
    const { sim } = labSim(100, 100);
    tierTwo(sim);
    expect(sim.tokenBuyDefault('tr1')).toBe(0); // Tier 1: no tokens
    expect(sim.tokenBuyDefault('tr2')).toBe(2000); // 15 000 over 8 minutes: 1 875 → 2 000
    steadyPower(sim);
    server(sim);
    sim.run(2);
    expect(sim.tokenBuyDefault('tr2')).toBe(0); // the server's 2 000 a minute suffice
    expect(sim.tokenBuyDefault('tr3')).toBe(7500); // 60 000 over 8: 7 500 − 2 000 → 7 500
    sim.startResearch('tr2');
    expect(sim.tokenBuyDefault('tr3')).toBe(7500); // the servers taken by Earthworks: all of it bought
  });

  it('the Core holds at most 200 of each data item (D118): its own files stop at the cap, offline as online to the file; a save above it keeps it', () => {
    const make = (start: number): Sim => {
      const sim = testSim();
      learn(sim, 'an_data');
      sim.hearthLevel = 2; // its outlet mounted: 3 Survey Data a minute, outside commands like `learn`
      sim.stock[DF()] = start;
      return sim;
    };
    const sim = make(150_000);
    expect(sim.hearthCapOf(DF())).toBe(BAL.hearthDataCap * 1000);
    expect(sim.hearthCapOf(MD())).toBe(200_000);
    expect(sim.hearthCapOf(itemIdx('iron_plate'))).toBe(sim.hearthCap());
    const save = serialize(sim);
    const a = deserialize(save, sim.grid.source), b = deserialize(save, sim.grid.source);
    a.run(36_000);
    catchUp(b, 36_000, { noDirect: true });
    for (const s of [a, b]) {
      expect(s.stock[DF()]).toBe(200_000); // the cap, not a file more
      expect(s.produced[DF()]).toBe(50_000); // only what it had room for
    }
    expect(b.hash()).toBe(a.hash());
    // A save holding more keeps it: nothing vanishes, nothing more is made.
    const over = make(300_000);
    over.run(1200);
    expect(over.stock[DF()]).toBe(300_000);
    expect(over.produced[DF()]).toBe(0);
  });

  it('at the Core\'s data cap a line bringing data waits (back-pressure); offline the Core stops near the same cap, nothing lost', () => {
    const sim = testSim();
    learn(sim, 'an_data');
    sim.hearthLevel = 2;
    sim.stock[DF()] = 150_000;
    const silo = stockedSilo(sim, 511, 502, 2, 'journal_1', 100);
    expect(sim.placeBelts('ribbon', [[511, 504, 2], [511, 505, 2], [511, 506, 2], [511, 507, 2], [511, 508, 2], [511, 509, 2]])).toBe(6);
    sim.run(5);
    const save = serialize(sim);
    const a = deserialize(save, sim.grid.source), b = deserialize(save, sim.grid.source);
    const held0 = a.totalHeld(DF()), made0 = a.produced[DF()]!;
    a.run(36_000);
    catchUp(b, 36_000, { noDirect: true });
    for (const s of [a, b]) {
      expect(s.stock[DF()]).toBe(200_000);
      expect(s.stores.get(silo)![DF()]).toBeGreaterThan(0); // the line backed up: the silo keeps the rest
      expect(s.totalHeld(DF()) - held0).toBe(s.produced[DF()]! - made0); // nothing vanishes
    }
    // Who fills the last room differs within the catch-up's margin at a bound (BAL.reservoirMargin).
    expect(Math.abs(a.produced[DF()]! - b.produced[DF()]!)).toBeLessThanOrEqual(BAL.reservoirMargin * 1000);
  });

  it('the Research Queue: a lab moves on to the node queued for it', () => {
    const { sim, lab } = labSim(200);
    learn(sim, 'an_queue', 'tr_synth'); // a Tier 2 node learnt: Tier 2 is open (D93, D118: a claim from before)
    expect(sim.queueResearch(lab, 'nope')).toBe(false); // a known node, not learnt yet
    sim.startResearch('tr1');
    expect(sim.queueResearch(lab, 'tr2')).toBe(true);
    sim.run(3000);
    expect(sim.done.has('tr1')).toBe(true);
    expect(sim.projects.map((p) => p.id)).toEqual(['tr2']);
    expect(sim.projects[0]!.buy).toBe(0); // a queued start buys nothing: the servers' alone (D118)
    expect(sim.labQueue.size).toBe(0);
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

  it('online ≈ offline: data by ribbon, the Heart’s files, servers and a bought flow, the minute’s tokens (D118)', () => {
    const sim = testSim();
    steadyPower(sim);
    learn(sim, 'an_data', 'ex_quartz'); // the Face Cutter's plan too (D101)
    tierTwo(sim);
    learn(sim, 'tr3', 'tr4', 'tr5'); // two slots
    sim.hearthLevel = 3; // its data outlet mounted (D86), outside commands like `learn`
    // A lab (3×3, D84) over a silo of data files, one ribbon square between (the silo hands out north).
    const lab = sim.place('observatory', 512, 516, 0);
    expect(lab.ok).toBe(true);
    wire(sim, lab.id!);
    stockedSilo(sim, 512, 520, 0, 'journal_1', 200);
    expect(sim.placeBelts('ribbon', [[512, 519, 0]])).toBe(1);
    server(sim, 503, 512);
    sim.grant('iron_plate', 30); sim.grant('glass', 20); sim.grant('copper_wire', 10);
    const lab2 = sim.place('observatory', 516, 516, 0);
    expect(lab2.ok).toBe(true);
    wire(sim, lab2.id!);
    sim.ensureCompiled();
    sim.stores.get(lab.id!)![MD()] = 20_000; // Earthworks' Mechanics Data in already; its Survey Data by the ribbon
    sim.stores.get(lab2.id!)![DF()] = 90_000; sim.stores.get(lab2.id!)![MD()] = 30_000;
    sim.credits = 2_000_000; // 20 000 ◉: the flows bought for both
    expect(sim.startResearch('tr2', lab.id!, 1000).ok).toBe(true); // 15 000 tokens: 2 000 of the server's and 1 000 bought a minute
    expect(sim.startResearch('en_heavyacc', lab2.id!, 20_000).ok).toBe(true); // beside it: 100 000 bought, then the server's once Earthworks is done
    sim.run(5);
    const save = serialize(sim);
    const a = deserialize(save, sim.grid.source), b = deserialize(save, sim.grid.source);
    a.run(8000);
    catchUp(b, 8000, { noDirect: true });
    for (const s of [a, b]) expect([...s.done].filter((id) => id === 'en_heavyacc' || id === 'tr2').sort()).toEqual(['en_heavyacc', 'tr2']);
    expect(b.tokenStats.totalUsed).toBe(a.tokenStats.totalUsed);
    expect(b.tokenStats.totalBought).toBe(a.tokenStats.totalBought);
    expect(b.credits).toBe(a.credits);
    expect(b.consumed[DF()]).toBe(a.consumed[DF()]);
    expect(b.consumed[MD()]).toBe(a.consumed[MD()]);
    expect(b.stock[DF()]).toBe(a.stock[DF()]);
    expect(b.stores.get(lab.id!)![DF()]).toBe(a.stores.get(lab.id!)![DF()]);
    expect(b.hash()).toBe(a.hash());
  });

  it('online ≈ offline: a Tier 2 project waiting on its data, then on its tokens, finishes at the same minute', () => {
    const sim = testSim();
    steadyPower(sim);
    learn(sim, 'ex_quartz');
    tierTwo(sim);
    const lab = sim.place('observatory', 512, 516, 0);
    expect(lab.ok).toBe(true);
    wire(sim, lab.id!);
    stockedSilo(sim, 512, 520, 0, 'journal_1', 120);
    expect(sim.placeBelts('ribbon', [[512, 519, 0]])).toBe(1);
    server(sim, 503, 512);
    sim.ensureCompiled();
    sim.stores.get(lab.id!)![MD()] = 30_000;
    expect(sim.startResearch('tr3', lab.id!, 500).ok).toBe(true); // Ceramics: 90 + 30 data, 60 000 tokens at 2 500 a minute
    sim.run(3);
    const save = serialize(sim);
    const a = deserialize(save, sim.grid.source), b = deserialize(save, sim.grid.source);
    const doneAt = (s: Sim, run: (n: number) => void): number => {
      for (let t = 0; t < 40; t++) { run(600); if (s.done.has('tr3')) return s.tick; }
      return -1;
    };
    const ta = doneAt(a, (n) => a.run(n)), tb = doneAt(b, (n) => { catchUp(b, n, { noDirect: true }); });
    expect(ta).toBeGreaterThan(0);
    expect(tb).toBe(ta);
    expect(b.credits).toBe(a.credits);
    expect(b.tokenStats.totalBought).toBe(a.tokenStats.totalBought);
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
    // In passes, prerequisites first: a plan may hang from a later path's (the Face Cutter, on
    // Production since D117, from the trade post).
    const left = PLAN_IDS.filter((id) => PLANS[id].lane !== 'gate');
    for (let pass = 0; left.length && pass < 4; pass++) {
      for (const id of [...left]) {
        if (!PLANS[id].prereq.every((q) => sim.done.has(q))) continue;
        for (const [it, n] of PLANS[id].cost) sim.grant(it, n);
        expect(sim.unlockPlan(id).ok, id).toBe(true);
        left.splice(left.indexOf(id), 1);
      }
    }
    expect(left).toEqual([]);
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
