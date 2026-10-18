import { describe, it, expect } from 'vitest';
import { itemIdx } from '@/content/registry';
import { BAL } from '@/content/balance';
import { DEPTH_COST, PLAN_IDS, PLANS, RESEARCH, treePrereq, type ResearchId } from '@/content/research';
import { flowStepAtLeast, launchSources, serverRate, tokenFlowSteps } from '../systems/research';
import { BUILDINGS } from '@/content/buildings';
import { testSim, steadyPower, wire } from '../testkit';
import { effectiveCost } from './runtime';
import { serialize, deserialize } from '../serialize';
import { catchUp } from '../offline/catchup';
import { exec, replay } from '../commands';
import type { Sim } from '../state';

/** A research lab beside the Heart (on the claim's land, wired to it): it takes nothing in (D122). */
function labSim(): { sim: Sim; lab: number } {
  const sim = testSim();
  // The Face Cutter's plan (D101: a plan now; Mechanics no longer hangs from it), taken outside commands.
  sim.done.add('ex_quartz');
  sim.rebuildDerived();
  const r = sim.place('observatory', 503, 512, 0);
  if (!r.ok) throw new Error(`observatory: ${r.reason}`);
  wire(sim, r.id!);
  sim.ensureCompiled();
  return { sim, lab: r.id! };
}

/** Research nodes granted outside commands (such a colony is not replayed), like `steadyPower`'s. */
function learn(sim: Sim, ...ids: string[]): void {
  for (const id of ids) sim.done.add(id);
  sim.rebuildDerived();
}

/** A node's resources granted to the Core (D122: paid from it at launch). */
function stockFor(sim: Sim, ...ids: string[]): void {
  for (const id of ids) for (const [it, n] of RESEARCH[id as ResearchId].cost) sim.grant(it, n);
}

/**
 * Tier 2 open: Tier 1 whole — the Synthesis and every category of Tier 1, so each of Tier 2 is open
 * (D128) —, the Core at level 3 (D118, outside commands like `learn`; its compute 2 000 tokens a
 * minute with Overclocking, D122) and two expertises chosen. The Quarry's first node, Earthworks
 * (`tr2`), takes 40 gears and 60 plates at launch and 15 000 tokens, at a pace of 8 minutes.
 */
function tierTwo(sim: Sim): void {
  learn(sim, ...(Object.keys(RESEARCH) as ResearchId[]).filter((id) => RESEARCH[id].tier === 1));
  sim.hearthLevel = 3;
  sim.expertise.slots = [{ id: 'estate', at: 0, on: false }, { id: 'haulage', at: 0, on: false }];
}

/** A server by the Heart, wired, at full power (steady geothermal): 2 000 tokens a minute. */
function server(sim: Sim, x = 512, y = 503): number {
  learn(sim, 'an_servers');
  for (const [it, n] of BUILDINGS.server.cost) sim.grant(it, n); // its price, whatever it is (its clocks: D87)
  const s = sim.place('server', x, y, 0);
  if (!s.ok) throw new Error(`server: ${s.reason}`);
  wire(sim, s.id!);
  return s.id!;
}

/** On to the next minute's boundary. */
const toBoundary = (sim: Sim): void => sim.run(600 - (sim.tick % 600) || 600);

describe('research (D68, D69, D118, D122): AI tokens as a flow and resources at launch, tiers by the Core', () => {
  it('a node costs its table\'s price, whatever else the claim owns (D72: no spread penalty, no lineage discount)', () => {
    // A Tier 3 node: its tokens and its own resources (D122: what it unlocks hints at them).
    const a = effectiveCost('en_bigwind');
    expect(a.tokens).toBe(1_200_000);
    expect(a.cost.map((c) => [c.item, c.mu])).toEqual([[itemIdx('thermal_core'), 15_000], [itemIdx('steel'), 100_000]]); // D123: its frame in steel
    expect(effectiveCost('en_tower').aim).toBe(1440 * 600); // the pace the launch dialog aims at (D118: no minimum time)
    expect(effectiveCost('tr2').tokens).toBe(15_000);
    expect(DEPTH_COST[9]!.tokens).toBe(6_000_000);
    // A Tier 2 node started by a claim that owns Tier 1–2 research in every other family: its table's price.
    const { sim } = labSim();
    tierTwo(sim);
    const closure = (id: string): string[] => [id, ...treePrereq(id).flatMap(closure)];
    learn(sim, ...closure('en_heavyacc').slice(1), ...['ex3', 'dn_wiremill', 'cm_floor', 'an_data', 'xp_bigsilo'].flatMap(closure));
    stockFor(sim, 'en_heavyacc');
    expect(sim.startResearch('en_heavyacc')).toEqual({ ok: true, reason: null });
    const p = sim.projects.find((q) => q.id === 'en_heavyacc')!;
    const base = effectiveCost('en_heavyacc');
    expect(p.cost).toEqual(base.cost);
    expect(p.paid).toEqual(base.cost.map((c) => c.mu)); // paid at launch
    expect([p.tokens, p.tokIn, p.dur]).toEqual([base.tokens, 0, 0]);
  });

  it('a node pays its resources from the Core at launch, then takes its tokens: Tier 1 on the Core\'s compute alone, in minutes (D122)', () => {
    const { sim } = labSim();
    sim.hearthLevel = 2; // its compute bay mounted: 1 000 tokens a minute, outside commands like `learn`
    expect(sim.coreComputeRate()).toBe(1000);
    stockFor(sim, 'tr1');
    const plate = itemIdx('iron_plate'), wireIt = itemIdx('copper_wire');
    const [p0, w0, c0] = [sim.stock[plate]!, sim.stock[wireIt]!, sim.consumed[plate]!];
    const credits = sim.credits;
    expect(effectiveCost('tr1')).toMatchObject({ tokens: 2000, aim: 2 * 600 });
    expect(sim.startResearch('tr1').ok).toBe(true);
    expect([p0 - sim.stock[plate]!, w0 - sim.stock[wireIt]!]).toEqual([30_000, 10_000]); // 30 plates, 10 wire
    expect(sim.consumed[plate]! - c0).toBe(30_000);
    expect(sim.projects[0]).toMatchObject({ dur: 0, tokens: 2000, tokIn: 0 });
    toBoundary(sim);
    expect(sim.projects[0]!.tokIn).toBe(1000);
    expect(sim.tokenStats).toMatchObject({ fromCore: 1000, fromServers: 0, bought: 0, core: 1000 });
    toBoundary(sim);
    expect(sim.done.has('tr1')).toBe(true); // two minutes: no data, no ribbon
    expect(sim.credits).toBe(credits); // nothing bought
  });

  it('a lab without power takes no tokens at the minute\'s end; its resources stay paid', () => {
    const { sim, lab } = labSim();
    sim.hearthLevel = 2;
    stockFor(sim, 'tr1');
    sim.startResearch('tr1');
    toBoundary(sim);
    expect(sim.projects[0]!.tokIn).toBe(1000);
    expect(sim.unlink(sim.hearthId, lab)).toBe(true);
    toBoundary(sim);
    expect(sim.projects[0]!.tokIn).toBe(1000); // no power in the minute: nothing delivered, the Core's tokens lost
    expect(sim.tokenStats.used).toBe(0);
    wire(sim, lab);
    toBoundary(sim);
    expect(sim.done.has('tr1')).toBe(true);
  });

  it('starts only with its prerequisites, the Core at its tier\'s level (D118), two expertises for Tier 2, a free slot, an idle lab, its resources in the Core; a bought flow not from a purse in the red', () => {
    const { sim } = labSim();
    expect(sim.researchBlock('tr2')).toBe('prereq');
    sim.stock[itemIdx('iron_plate')] = 10_000; // a test shortcut: 10 plates in the Core
    expect(sim.researchBlock('tr1')).toBe('unaffordable'); // its 30 plates not in the Core (D122)
    stockFor(sim, 'tr1');
    expect(sim.researchBlock('tr1')).toBe('reserve'); // in the Core, but CrierBelt's restart reserve keeps them (D36), as for a plan
    sim.grant('iron_plate', 200);
    expect(sim.startResearch('tr1').ok).toBe(true);
    expect(sim.researchBlock('tr1')).toBe('active');
    learn(sim, 'tr1');
    expect(sim.researchBlock('tr2')).toBe('prereq'); // the Synthesis closes Tier 1 first (D93)
    learn(sim, 'tr_synth');
    expect(sim.researchBlock('tr2')).toBe('gate'); // the Quarry waits for Extraction finished (D128)
    learn(sim, 'ex_fastdrill', 'ex_brick');
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
    expect(sim.researchBlock('tr2')).toBe('unaffordable');
    stockFor(sim, 'tr2');
    sim.credits = -1;
    expect(sim.researchBlock('tr2')).toBeNull(); // the free flows need no purse…
    expect(sim.startResearch('tr2', 0, 500)).toEqual({ ok: false, reason: 'debt' }); // …a bought one does
    sim.credits = 100;
    expect(sim.startResearch('tr2').ok).toBe(true);
    expect(sim.projects.map((p) => p.id)).toEqual(['tr1', 'tr2']);
  });

  it('each tier waits for its Core level (D118: 3, 4, 5), each level the player\'s behind the trunk node that opens the tier; a tier a claim already holds a node of stays open', () => {
    expect(BAL.tierCoreLevel).toEqual([1, 3, 4, 5]);
    expect(BAL.hearthUpgrades.map((u) => u.unlock)).toEqual(['start', 'tr_synth', 'tr6', 'tr8']);
    const { sim } = labSim();
    tierTwo(sim);
    learn(sim, 'tr2', 'tr3', 'tr4', 'tr6');
    learn(sim, 'an_servers', 'an_queue', 'tr5'); // the Servers finished: Computing, the Third Desk's, opens (D128)
    stockFor(sim, 'tr7');
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

  it('Tier 2+: the free flows and the flow bought for it, billed each minute, which stops by itself once it has its tokens (D118)', () => {
    const { sim, lab } = labSim();
    tierTwo(sim); // the Core's compute: 2 000 a minute
    stockFor(sim, 'tr2');
    sim.credits = 1_000_000;
    expect(sim.startResearch('tr2', 0, 5000).ok).toBe(true);
    expect(sim.log.at(-1)?.cmd).toEqual({ k: 'research', id: 'tr2', lab, buy: 5000 });
    toBoundary(sim);
    expect(sim.projects[0]!.tokIn).toBe(7000);
    expect(sim.tokenStats).toMatchObject({ used: 7000, fromCore: 2000, bought: 5000, cents: 5000 }); // 50 ◉ at 10 ◉ the thousand
    toBoundary(sim);
    expect(sim.done.has('tr2')).toBe(false); // 14 000 of its 15 000
    toBoundary(sim);
    expect(sim.done.has('tr2')).toBe(true); // done at the minute its last tokens came in: the Core's alone, nothing bought
    expect(sim.tokenStats.totalBought).toBe(10_000);
    expect(sim.credits).toBe(1_000_000 - 10_000);
    toBoundary(sim);
    expect(sim.tokenStats.totalBought).toBe(10_000); // the flow went with it
  });

  it('the flow can change while it runs (logged), never beyond what the project needs', () => {
    const { sim } = labSim();
    tierTwo(sim);
    stockFor(sim, 'tr2');
    sim.startResearch('tr2');
    expect(sim.projects[0]!.buy).toBe(0);
    toBoundary(sim);
    expect(sim.projects[0]!.tokIn).toBe(2000); // the Core's compute alone
    expect(sim.setTokenBuy('tr2', 1000)).toBe(true);
    expect(sim.log.at(-1)?.cmd).toEqual({ k: 'tokenBuy', id: 'tr2', perMin: 1000 });
    expect(exec(sim, { k: 'tokenBuy', id: 'tr2', perMin: 99_999_999 })).toBe(true);
    expect(sim.projects[0]!.buy).toBe(15_000); // capped at its need
    expect(sim.setTokenBuy('tr2', -5)).toBe(false);
    expect(sim.setTokenBuy('nope', 5)).toBe(false);
    toBoundary(sim);
    expect(sim.done.has('tr2')).toBe(true);
    expect(sim.tokenStats.bought).toBe(11_000);
  });

  it('cancelling hands its resources back to the Core (D122); the tokens delivered are spent', () => {
    const { sim } = labSim();
    tierTwo(sim);
    stockFor(sim, 'tr2');
    const gear = itemIdx('gear'), g0 = sim.stock[gear]!;
    sim.startResearch('tr2', 0, 3000);
    expect(sim.stock[gear]).toBe(g0 - 40_000);
    toBoundary(sim);
    expect(sim.projects[0]!.tokIn).toBe(5000);
    expect(sim.cancelResearch('tr2')).toBe(true);
    expect(sim.stock[gear]).toBe(g0);
    toBoundary(sim);
    expect(sim.tokenStats.totalBought).toBe(3000);
  });

  it('a purse in the red holds the bought flow until it is back above zero; the free flows go on (D118)', () => {
    const { sim } = labSim();
    steadyPower(sim);
    server(sim);
    tierTwo(sim);
    learn(sim, 'tr3', 'tr4', 'tr5', 'workshop'); // a second slot; Optics' electronics workshop (D129)
    expect(sim.place('observatory', 503, 515, 0).ok).toBe(true);
    sim.ensureCompiled();
    toBoundary(sim);
    stockFor(sim, 'tr2', 'tr6');
    sim.credits = 500; // 5 ◉: less than a minute of the flow
    expect(sim.startResearch('tr2', 0, 5000).ok).toBe(true);
    toBoundary(sim);
    expect(sim.credits).toBe(500 - 5000); // 5 000 tokens bought on top of the Core's 2 000 and the server's 2 000
    expect(sim.researchHeld).toBe(true);
    expect(sim.events).toContainEqual({ k: 'researchHeld', held: true });
    expect(sim.projects[0]!.tokIn).toBe(9000);
    expect(sim.startResearch('tr6', 0, 500)).toEqual({ ok: false, reason: 'debt' }); // no new flow bought
    toBoundary(sim);
    expect(sim.projects[0]!.tokIn).toBe(13_000); // the free flows alone: nothing bought
    expect(sim.credits).toBe(-4500);
    sim.credits += 100_000;
    toBoundary(sim); // its last 2 000 from the free flows: nothing bought, the hold lifted
    expect(sim.researchHeld).toBe(false);
    expect(sim.done.has('tr2')).toBe(true);
    expect(sim.credits).toBe(-4500 + 100_000);
  });

  it('the free flows go to the projects in the order they started, the oldest first — the Core\'s compute, then the servers; each one\'s bought flow tops it up; what nobody needs is lost', () => {
    const { sim } = labSim();
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
    stockFor(sim, 'tr2', 'en_heavyacc');
    expect(sim.startResearch('tr2').ok).toBe(true); // first: the Core's 2 000 and the server's 2 000 a minute
    expect(sim.startResearch('en_heavyacc', 0, 3000).ok).toBe(true); // second: its own 3 000 bought
    const credits = sim.credits;
    toBoundary(sim);
    expect(sim.projects.map((p) => p.tokIn)).toEqual([4000, 3000]);
    expect(sim.tokenStats).toMatchObject({ supply: 2000, core: 2000, fromCore: 2000, fromServers: 2000, bought: 3000 });
    expect(sim.credits).toBe(credits - 3000);
    for (let m = 0; m < 2; m++) toBoundary(sim);
    expect(sim.done.has('tr2')).toBe(false); // 12 000 of its 15 000
    toBoundary(sim); // Earthworks takes its last 3 000; the other 1 000 pass on to the next
    expect(sim.done.has('tr2')).toBe(true);
    expect(sim.projects[0]!.tokIn).toBe(3 * 3000 + 1000 + 3000);
  });

  it('the flow the launch dialog proposes: the tokens over the tier\'s pace, less the free flows it would get, up the ladder (D118, D122)', () => {
    expect(tokenFlowSteps(2600)).toEqual([0, 500, 750, 1000, 1500, 2000, 3000]);
    expect(flowStepAtLeast(1875)).toBe(2000);
    const { sim } = labSim();
    tierTwo(sim);
    expect(sim.tokenBuyDefault('tr1')).toBe(0); // Tier 1: 2 000 over 2 minutes, the Core's compute suffices
    sim.hearthLevel = 2; // its compute 1 500 a minute
    expect(sim.tokenBuyDefault('tr2')).toBe(500); // 15 000 over 8 minutes: 1 875 − 1 500 → 500
    sim.hearthLevel = 3;
    expect(sim.tokenBuyDefault('tr2')).toBe(0); // its 2 000 suffice
    steadyPower(sim);
    server(sim);
    sim.run(2);
    expect(sim.tokenBuyDefault('tr3')).toBe(5000); // 60 000 over 8: 7 500 − the Core's 2 000 and the server's 2 000 → 5 000
    stockFor(sim, 'tr2');
    sim.startResearch('tr2');
    expect(sim.tokenBuyDefault('tr3')).toBe(7500); // the free flows taken by Earthworks: all of it bought
    // The bank (D122) pays at the first boundary, the oldest first: Earthworks' 11 000 left after the
    // free 4 000, then 29 000 of Ceramics' — the rest, 31 000, in the 7 minutes left at the free 4 000
    // and a flow of 500 (D128: a reserve is spent before anything is bought; the old default, blind to
    // the bank while a project ran, bought 7 500 a minute).
    sim.tokenBank = 40_000;
    expect(sim.tokenBuyDefault('tr3')).toBe(500);
    sim.tokenBank = 1_000_000;
    expect(sim.tokenBuyDefault('tr3')).toBe(0); // the reserve covers it all
  });

  it('where a new project\'s tokens would come from (D128): the free flows after the projects before it, the bank at the first boundary, its bought flow', () => {
    // Nothing running, no bank: the free flows alone, 2 500 a minute — 15 000 in 6 minutes.
    expect(launchSources(2500, [], 0, { tokens: 15_000, buy: 0 })).toEqual({ bank: 0, free: 15_000, bought: 0, short: 0, minutes: 6 });
    // The reserve covers it all: in at the first boundary, the free flows untouched beyond that minute.
    expect(launchSources(2500, [], 1_000_000, { tokens: 15_000, buy: 1000 })).toEqual({ bank: 12_500, free: 2500, bought: 0, short: 0, minutes: 1 });
    // A project before it takes the free flows first (12 500 left of it: 5 minutes, its own flow
    // meanwhile), then they pass on: 2 500 + 1 000 a minute for the last 10 000.
    const busy = launchSources(2500, [{ need: 12_500, buy: 0 }], 0, { tokens: 15_000, buy: 1000 });
    expect(busy).toEqual({ bank: 0, free: 7500, bought: 7500, short: 0, minutes: 5 + 3 });
    // The bank pays the oldest first: 2 500 left for the new one.
    expect(launchSources(2500, [{ need: 12_500, buy: 0 }], 12_500, { tokens: 15_000, buy: 0 }).bank).toBe(2500);
    // No flow at all: never.
    expect(launchSources(0, [], 0, { tokens: 100, buy: 0 })).toEqual({ bank: 0, free: 0, bought: 0, short: 100, minutes: Infinity });
  });

  it('the Core\'s compute (D122): none at level 1, its level\'s from 2, the Analytics research and Archiving on top; no power, no ribbon, lost when nobody needs it', () => {
    const sim = testSim();
    expect(sim.coreComputeRate()).toBe(0);
    learn(sim, 'an_data');
    expect(sim.coreComputeRate()).toBe(0); // no compute bay yet: Overclocking has nothing to raise
    sim.hearthLevel = 2;
    expect(sim.coreComputeRate()).toBe(1500);
    sim.hearthLevel = 5;
    expect(sim.coreComputeRate()).toBe(BAL.coreCompute[4]! + 500);
    learn(sim, 'an_mining');
    expect(sim.coreComputeRate()).toBe(BAL.coreCompute[4]! + 2500);
    sim.expertise.ranks.set('archiving', 1);
    sim.expertise.slots = [{ id: 'archiving', at: 0, on: true }, null];
    sim.rebuildDerived();
    expect(sim.coreComputeRate()).toBe(Math.floor((BAL.coreCompute[4]! + 2500) * 1.1));
    toBoundary(sim);
    expect(sim.tokenStats).toMatchObject({ core: sim.coreComputeRate(), used: 0 }); // no project: lost
  });

  it('the autonomous lab computes like a server, project or not (D122)', () => {
    const sim = testSim();
    steadyPower(sim);
    learn(sim, 'an_autolab');
    for (const [it, n] of [['circuit', 40], ['lens', 10], ['ceramic', 30]] as const) sim.grant(it, n);
    const a = sim.place('auto_lab', 503, 512, 0);
    expect(a.ok).toBe(true);
    wire(sim, a.id!);
    sim.ensureCompiled();
    expect(serverRate(sim, () => 1000)).toBe(5000);
    toBoundary(sim);
    toBoundary(sim);
    expect(sim.tokenStats.supply).toBe(5000);
  });

  it('the Research Queue: a lab moves on to the node queued for it — at a project\'s end, or the minute its resources are in (D122)', () => {
    const { sim, lab } = labSim();
    sim.hearthLevel = 2;
    learn(sim, 'an_queue', 'tr_synth'); // a Tier 2 node learnt: Tier 2 is open (D93, D118: a claim from before)
    learn(sim, 'ex_fastdrill', 'ex_brick'); // Extraction finished: the Quarry, Earthworks', open (D128)
    expect(sim.queueResearch(lab, 'nope')).toBe(false); // a known node, not learnt yet
    stockFor(sim, 'tr1');
    sim.startResearch('tr1');
    expect(sim.queueResearch(lab, 'tr2')).toBe(true);
    sim.run(3000);
    expect(sim.done.has('tr1')).toBe(true);
    expect(sim.projects.length).toBe(0); // its gears and plates not in the Core: it waits
    expect(sim.labQueue.size).toBe(1);
    stockFor(sim, 'tr2');
    toBoundary(sim);
    expect(sim.projects.map((p) => p.id)).toEqual(['tr2']);
    expect(sim.projects[0]!.buy).toBe(0); // a queued start buys nothing: the free flows alone (D118)
    expect(sim.labQueue.size).toBe(0);
  });

  it('online ≈ offline: the Core\'s compute, a server, the bank and two bought flows, two labs, the minute\'s tokens (D118, D122)', () => {
    const sim = testSim();
    steadyPower(sim);
    learn(sim, 'an_data', 'ex_quartz'); // the Face Cutter's plan too (D101)
    tierTwo(sim);
    learn(sim, 'tr3', 'tr4', 'tr5'); // two slots
    const lab = sim.place('observatory', 512, 516, 0);
    expect(lab.ok).toBe(true);
    wire(sim, lab.id!);
    server(sim, 503, 512);
    sim.grant('iron_plate', 30); sim.grant('glass', 20); sim.grant('copper_wire', 10);
    const lab2 = sim.place('observatory', 516, 516, 0);
    expect(lab2.ok).toBe(true);
    wire(sim, lab2.id!);
    sim.ensureCompiled();
    stockFor(sim, 'tr2', 'en_heavyacc');
    sim.tokenBank = 20_000;
    sim.credits = 2_000_000; // 20 000 ◉: the flows bought for both
    expect(sim.startResearch('tr2', lab.id!, 1000).ok).toBe(true); // 15 000 tokens: the free flows, the bank and 1 000 bought a minute
    expect(sim.startResearch('en_heavyacc', lab2.id!, 20_000).ok).toBe(true); // beside it: 100 000 bought, then the free flows once Earthworks is done
    sim.run(5);
    const save = serialize(sim);
    const a = deserialize(save, sim.grid.source), b = deserialize(save, sim.grid.source);
    a.run(8000);
    catchUp(b, 8000, { noDirect: true });
    for (const s of [a, b]) expect([...s.done].filter((id) => id === 'en_heavyacc' || id === 'tr2').sort()).toEqual(['en_heavyacc', 'tr2']);
    expect(b.tokenStats.totalUsed).toBe(a.tokenStats.totalUsed);
    expect(b.tokenStats.totalBought).toBe(a.tokenStats.totalBought);
    expect(b.tokenBank).toBe(a.tokenBank);
    expect(b.credits).toBe(a.credits);
    expect(b.hash()).toBe(a.hash());
  });

  it('online ≈ offline: a Tier 2 project on the free flows and a bought one finishes at the same minute; a queued one starts at the same minute', () => {
    const sim = testSim();
    steadyPower(sim);
    learn(sim, 'ex_quartz', 'an_queue');
    tierTwo(sim);
    const lab = sim.place('observatory', 512, 516, 0);
    expect(lab.ok).toBe(true);
    wire(sim, lab.id!);
    server(sim, 503, 512);
    sim.ensureCompiled();
    stockFor(sim, 'tr3', 'tr2');
    expect(sim.startResearch('tr3', lab.id!, 500).ok).toBe(true); // Ceramics: 60 000 tokens at 2 000 + 2 000 + 500 a minute
    expect(sim.queueResearch(lab.id!, 'tr2')).toBe(true);
    sim.run(3);
    const save = serialize(sim);
    const a = deserialize(save, sim.grid.source), b = deserialize(save, sim.grid.source);
    const doneAt = (s: Sim, id: string, run: (n: number) => void): number => {
      for (let t = 0; t < 40; t++) { run(600); if (s.done.has(id)) return s.tick; }
      return -1;
    };
    const ta = doneAt(a, 'tr3', (n) => a.run(n)), tb = doneAt(b, 'tr3', (n) => { catchUp(b, n, { noDirect: true }); });
    expect(ta).toBeGreaterThan(0);
    expect(tb).toBe(ta);
    expect(b.projects.map((p) => p.id)).toEqual(a.projects.map((p) => p.id));
    expect(b.credits).toBe(a.credits);
    expect(b.tokenStats.totalBought).toBe(a.tokenStats.totalBought);
    expect(b.hash()).toBe(a.hash());
  });

  it('reconversion is retired (D107): its command does nothing; a save’s reconversion under way runs out, pays its notes, and they pay research\'s tokens', () => {
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
    // Notes pay the next research's tokens (D122: at CrierBelt's price; its resources are the Core's).
    expect(back.place('observatory', 503, 512, 0).ok).toBe(true);
    stockFor(back, 'en_pitch');
    back.startResearch('en_pitch');
    expect(back.notes).toBe(5000 - 2000);
    expect(back.projects[0]!.tokIn).toBe(2000);
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
    expect(sim.unlockPlan('observatory').reason).toBe('prereq'); // after every plan (D71)
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
