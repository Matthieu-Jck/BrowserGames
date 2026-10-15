import { describe, it, expect } from 'vitest';
import { QUEST_CHECK_TICKS, QUEST_IDS, QUESTS, questProblems, type QuestDef, type QuestId } from '@/content/quests';
import { ITEM_IDS, itemIdx, recipeIdx } from '@/content/registry';
import { PLAN_IDS, PLANS } from '@/content/research';
import { recipeOf } from '../cfg';
import { replay, type Command } from '../commands';
import { CENTER, EPOCH } from '../constants';
import { powerLine } from '../dev';
import { catchUp } from '../offline/catchup';
import { deserialize, serialize } from '../serialize';
import { heldIn, Sim } from '../state';
import { T, type Rot } from '../types';
import { COAL, drillToHearth, learnPlans, line, steadyPower, testSim, testSource, wire } from '../testkit';
import { FlatSource, type VeinSite } from '../world/grid';
import { parcelAt } from '../world/land';
import { WORLD_EPOCH0 } from '../constants';
import { cleanName, currentQuest, objectiveProgress, questProgress, rewardItems, stepApplies } from './quests';

const idx = (id: QuestId): number => QUEST_IDS.indexOf(id);

/**
 * A second coal deposit north-east of the Hearth, so the scripted factory stays on one side, every
 * line short and apart from the others (the test world's own coal lies west).
 */
const EXTRA = [{ x: 518, y: 496, w: 6, h: 6, item: COAL(), rich: 300 }];

/** The test world with a quartz vein (D87): a wall west of the Hearth, in the parcel beside the starting square, its face looking east. */
class VeinSource extends FlatSource {
  readonly quartzVein: VeinSite = { x: 467, y: 508, dx: 0, dy: 1, n: 8, look: 1, item: itemIdx('quartz') };
}

/** The test world (`testSource` with the extra coal) and its quartz wall: rock at level 1 on x 460–467, y 507–516, quartz in its east face. */
function veinSource(): VeinSource {
  const base = testSource(EXTRA);
  return new VeinSource(
    [...base.deposits, { x: 467, y: 508, w: 1, h: 8, item: itemIdx('quartz'), rich: 750 }],
    [...base.rocks, { x: 460, y: 507, w: 8, h: 10, t: T.Rock1, level: 1 }],
  );
}

/** A new player's base on the vein world (only the starting kit, or every plan). */
function veinSim(plans = false): Sim {
  const sim = new Sim({ worldSeed: 7, playerSeed: 11, source: veinSource(), foundingEpoch: WORLD_EPOCH0 + 24 });
  if (plans) learnPlans(sim);
  return sim;
}

/** Step until `ok()` holds (at most `max` ticks); returns the ticks it took. */
function runUntil(sim: Sim, ok: () => boolean, max: number): number {
  let n = 0;
  while (!ok() && n < max) { sim.step(); n++; }
  return n;
}

/** Run until quest `id` is done (fails the test if it takes longer than `max` ticks). */
function until(sim: Sim, id: QuestId, max: number): void {
  runUntil(sim, () => sim.quests.done.includes(id), max);
  expect(sim.quests.done, `quest ${id} after ${max} ticks: ${JSON.stringify(questProgress(sim))}`).toContain(id);
}

/**
 * The guide's step of the current quest, as `ui/guide.ts` picks it: the first whose `done` does
 * not hold (counters from the founding). Read on a compiled graph, as the guide's 4 Hz refresh
 * does — so a step is never shown once the base already does what it asks.
 */
function stepNow(sim: Sim): [string | null, number] {
  sim.ensureCompiled();
  const q = currentQuest(sim);
  if (!q) return [null, -1];
  const i = q.def.steps.findIndex((s) => stepApplies(sim, s) && !(s.done && objectiveProgress(sim, s.done).met));
  return [q.id, i < 0 ? q.def.steps.length - 1 : i];
}

/**
 * A new player's base on the flat test world (only the starting kit unlocked: the tree is part of
 * the tutorial), with steady power (a geothermal plant: day and night alike) and spare materials.
 */
function colony(): Sim {
  const sim = veinSim();
  steadyPower(sim);
  for (const [it, n] of [['iron_plate', 500], ['glass', 200], ['copper_wire', 100], ['coal', 100]] as const) sim.grant(it, n);
  return sim;
}

/** What `replay` needs to start where `colony()` starts (its tap's research is granted outside commands). */
function replayBase(): Sim {
  const sim = veinSim();
  sim.done.add('en5');
  sim.rebuildDerived();
  return sim;
}

/**
 * The tutorial played with real commands on the test colony, quest by quest, up to (and
 * including) quest `last` — every plan unlocked in the tree before what it unlocks is used, every
 * machine fed by its own lines (the Hearth only takes in). At each action the guide's step must
 * move on exactly when the base does what it asks. Returns the ids of what it built.
 *
 * The factory (east of the Hearth, 510..514 × 510..514): two iron drills north into its north
 * inputs; a router on the second iron line feeds the plate smelter; a coal drill on the extra
 * deposit feeds it too, and a router on the coal line feeds the glass smelter, beside the sand;
 * the smelters' lines run into the Hearth's east inputs; copper comes from the south; at the end,
 * every plan taken, a data collector's Survey Data rides one ribbon into the research lab.
 */
function play(sim: Sim, last: QuestId = 'wall_quartz'): Record<string, number> {
  const ids: Record<string, number> = {};
  const stop = (id: QuestId): boolean => idx(id) >= idx(last);
  const place = (name: string, def: string, x: number, y: number, rot: Rot = 0): number => {
    const r = sim.place(def, x, y, rot);
    if (!r.ok) throw new Error(`${name} (${def} at ${x},${y}): ${r.reason}`);
    return (ids[name] = r.id!);
  };
  const lay = (path: Array<[number, number, Rot]>): void => { expect(sim.placeBelts('ribbon', path)).toBe(path.length); };
  const unlock = (...plans: string[]): void => { for (const p of plans) expect(sim.unlockPlan(p), p).toEqual({ ok: true, reason: null }); };
  const at = (quest: QuestId, step: number): void => { expect(stepNow(sim)).toEqual([quest, step]); };

  // 0 — a name.
  expect(sim.nameColony('  Bonne-Veine  ')).toBe(true);
  expect(sim.colonyName).toBe('Bonne-Veine');
  if (stop('claim')) return ids;

  // 1 — the starting kit: a drill on iron, wired, a ribbon into the Hearth's north input: 10 ore in.
  at('first_strike', 0);
  ids.drill1 = drillToHearth(sim);
  at('first_strike', 2);
  until(sim, 'first_strike', 8 * EPOCH);
  if (stop('first_strike')) return ids;

  // 2 — the tree's first plan (telemetry: the rates appear), then a second drill and its line.
  at('ribbon_lines', 0);
  expect(sim.mods.flags.has('telemetry')).toBe(false);
  unlock('telemetry');
  expect(sim.mods.flags.has('telemetry')).toBe(true);
  at('ribbon_lines', 1);
  place('drill2', 'drill', 513, 502, 2);
  at('ribbon_lines', 2);
  wire(sim, ids.drill2!);
  at('ribbon_lines', 3);
  lay([[514, 504, 3], ...line(513, 504, 2, 6)]);
  at('ribbon_lines', 4);
  until(sim, 'ribbon_lines', 4 * EPOCH);
  if (stop('ribbon_lines')) return ids;

  // 3 — the smelter and the router: the second iron line split between the Hearth and the
  // smelter, the coal straight from its drill, the plates into the Hearth's east input.
  at('bloom_kiln', 0);
  expect(sim.place('kiln', 516, 505, 2).reason).toBe('locked'); // not before its plan
  unlock('kiln');
  at('bloom_kiln', 0); // the router is still locked
  unlock('router');
  at('bloom_kiln', 1);
  place('coal', 'drill', 520, 498, 2); // on the extra deposit; its output faces (521, 500)
  at('bloom_kiln', 2); // the coal is beyond the Hearth's reach: a pole first
  place('mastC', 'mast', 516, 503); // it wires itself to the Hearth
  expect(sim.links.has(sim.hearthId, ids.mastC!)).toBe(true);
  at('bloom_kiln', 3);
  wire(sim, ids.coal!, ids.mastC);
  at('bloom_kiln', 4);
  place('kiln1', 'kiln', 516, 505, 2); // inputs north at (516|517, 504), output south at (517, 507)
  at('bloom_kiln', 5);
  expect(sim.setRecipe(ids.kiln1!, 'iron_plate')).toBe(true);
  at('bloom_kiln', 6);
  place('routerIron', 'router', 513, 505); // over the second iron line: it replaces the ribbon (D24)
  expect(sim.entityAt(513, 505)?.id).toBe(ids.routerIron);
  at('bloom_kiln', 6); // a router alone feeds nothing yet
  lay([[514, 505, 1], [515, 505, 0], [515, 504, 1], [516, 504, 2]]);
  at('bloom_kiln', 7);
  lay([[521, 500, 2], [521, 501, 2], [521, 502, 3], [520, 502, 3], [519, 502, 3], [518, 502, 3], [517, 502, 2], [517, 503, 2], [517, 504, 2]]);
  at('bloom_kiln', 8);
  lay([[517, 507, 2], [517, 508, 2], [517, 509, 2], [517, 510, 2], [517, 511, 3], [516, 511, 3], [515, 511, 3]]);
  at('bloom_kiln', 9);
  until(sim, 'bloom_kiln', 6 * EPOCH);
  if (stop('bloom_kiln')) return ids;

  // 4 — wind turbines on a pole west of the Hearth (poles came with the coal, quest 3: this
  // quest no longer asks for one).
  at('first_wind', 0);
  unlock('wind_flower');
  at('first_wind', 1);
  place('wind1', 'wind_flower', 501, 503);
  place('wind2', 'wind_flower', 504, 500);
  at('first_wind', 2);
  place('mastW', 'mast', 507, 505);
  expect(sim.links.has(sim.hearthId, ids.mastW!)).toBe(true);
  wire(sim, [ids.wind1!, ids.wind2!], ids.mastW);
  until(sim, 'first_wind', EPOCH);
  if (stop('first_wind')) return ids;

  // 5 — glass: a second smelter beside the first; sand off the bare ground beside it (two sand
  // collectors: no deposit, the floor is sand), their lines joining into its other input; its coal
  // off the coal line through a router; its glass into the Hearth's other east input.
  at('glassworks', 0);
  expect(sim.place('sand_collector', 522, 506, 0).reason).toBe('locked'); // not before its plan
  unlock('sand_collector');
  at('glassworks', 1);
  place('kiln2', 'kiln', 520, 505, 2); // inputs north at (520|521, 504), output south at (521, 507)
  at('glassworks', 2);
  expect(sim.setRecipe(ids.kiln2!, 'glass')).toBe(true);
  at('glassworks', 3);
  expect(sim.place('sand_collector', 518, 498, 0).reason).toBe('needs_sand'); // on the coal deposit
  place('sand', 'sand_collector', 522, 506); // its output faces (522, 505)
  at('glassworks', 3); // one of the two
  place('sandB', 'sand_collector', 523, 502, 2); // facing south: its output faces (524, 504)
  at('glassworks', 4);
  wire(sim, [ids.sand!, ids.sandB!], ids.mastC);
  at('glassworks', 5);
  place('routerCoal', 'router', 519, 502);
  lay([[519, 503, 2], [519, 504, 1], [520, 504, 2]]);
  at('glassworks', 6);
  lay([[522, 505, 0], [522, 504, 3], [521, 504, 2]]);
  lay([[524, 504, 3], [523, 504, 3]]); // the second collector's line runs into the first's
  at('glassworks', 7);
  lay([...line(521, 507, 2, 6), ...line(521, 513, 3, 7)]);
  at('glassworks', 7);
  until(sim, 'glassworks', 6 * EPOCH);
  if (stop('glassworks')) return ids;

  // 6 — the trade post (its 5×5 pad and apron, D62) east of the glass line, glass led into its
  // entrance by a router (it sells whatever comes in, D64).
  at('crier_calls', 0);
  unlock('trade_post');
  at('crier_calls', 1);
  place('post', 'trade_post', 524, 509); // its entrance at (526, 513), fed from (526, 514)
  at('crier_calls', 2);
  sim.grant('iron_plate', 2);
  place('routerSale', 'router', 521, 512); // over the glass line going south: its east side out
  lay([[522, 512, 1], [523, 512, 2], [523, 513, 2], [523, 514, 1], [524, 514, 1], [525, 514, 1], [526, 514, 0]]);
  at('crier_calls', 2);
  until(sim, 'crier_calls', 6 * EPOCH);
  if (stop('crier_calls')) return ids;

  // 7 — the copper vein: a drill, a wire mill fed by it through one ribbon, the wire to the
  // Hearth's south input.
  at('tired_vein', 0);
  unlock('wire_mill');
  at('tired_vein', 1);
  place('copper', 'drill', 516, 522); // its output faces (516, 521)
  at('tired_vein', 2);
  place('mill', 'wire_mill', 516, 519); // its input faces (516, 521), its output (516, 518)
  expect(recipeOf(sim.ents.get(ids.mill!)!.cfg)).toBe(recipeIdx('copper_wire') + 1); // its lone recipe, set at once (D83)
  at('tired_vein', 3);
  powerLine(sim, ids.copper!);
  at('tired_vein', 3); // the drill and the mill wired: one step
  powerLine(sim, ids.mill!);
  at('tired_vein', 4);
  lay([[516, 521, 0]]);
  at('tired_vein', 5);
  lay([...line(516, 518, 3, 3), ...line(513, 518, 0, 4)]);
  at('tired_vein', 5);
  until(sim, 'tired_vein', 4 * EPOCH);
  if (stop('tired_vein')) return ids;

  // 8 — a standing import order of copper ore (its goods would leave by the post's exit).
  at('first_purchase', 0);
  const ask = sim.prices.ask[itemIdx('copper_ore')]!;
  expect(typeof sim.addImport(ids.post!, 'copper_ore', 10, 2 * ask)).toBe('number');
  until(sim, 'first_purchase', QUEST_CHECK_TICKS);
  if (stop('first_purchase')) return ids;

  // 9 — the survey beacon's plan, then a beacon through the Crown (the flat test world has no rock to dig).
  at('beyond_crown', 0);
  unlock('beacon');
  at('beyond_crown', 1);
  place('beacon', 'beacon', CENTER + 34, CENTER); // past the Crown's edge (r 32), inside the land revealed at founding (r 44)
  until(sim, 'beyond_crown', 2 * EPOCH);
  if (stop('beyond_crown')) return ids;

  // 10 — Survey Data (D71): every plan left, each as soon as the Hearth can pay for it, then the
  // research lab's (the gate) and the data collector it brings; the lab north of the iron drills,
  // the collector west of them, both wired; one ribbon carries the data into the lab; the Face Cutter
  // starts (D87: Mechanics comes after it), its tokens paid by the minute.
  at('field_journal', 0);
  const take = (p: string): void => {
    for (let t = 0; t < 30 * EPOCH && !sim.done.has(p) && !sim.unlockPlan(p).ok; t += EPOCH) sim.run(EPOCH);
    expect(sim.done.has(p), p).toBe(true);
  };
  for (const p of PLAN_IDS) if (PLANS[p].lane !== 'gate') take(p);
  at('field_journal', 1);
  take('observatory');
  at('field_journal', 2);
  place('observatory', 'observatory', 512, 498); // 3×3 (D84), north of the iron drills: inputs south at (512..514, 501)
  at('field_journal', 3);
  place('collector', 'data_collector', 509, 502); // its output north at (509, 501)
  at('field_journal', 4);
  wire(sim, ids.observatory!, ids.mastC);
  at('field_journal', 5);
  wire(sim, ids.collector!, ids.mastC);
  at('field_journal', 6);
  lay([[509, 501, 1], [510, 501, 1], [511, 501, 1], [512, 501, 0]]); // east from the collector's output, then up into the lab
  at('field_journal', 7);
  expect(sim.startResearch('ex_quartz').ok).toBe(true);
  at('field_journal', 8);
  until(sim, 'field_journal', 8 * EPOCH);
  if (stop('field_journal')) return ids;

  // 11 — quartz in the wall (D87): the vein's parcel bought, the Face Cutter learnt, a cutter at the
  // wall's foot (dropped facing away, it turns its back to the rock), wired pole by pole, its quartz
  // along one ribbon into the Hearth's west input.
  at('wall_quartz', 0);
  expect(sim.buyLand(parcelAt(468, 511))).toBeNull();
  at('wall_quartz', 1);
  for (let t = 0; t < 20 * EPOCH && !sim.done.has('ex_quartz'); t += EPOCH) sim.run(EPOCH);
  expect(sim.done.has('ex_quartz')).toBe(true);
  at('wall_quartz', 2);
  place('cutter', 'face_cutter', 468, 510, 3); // its back to the wall (x 467, y 510–511): turned to rot 1
  expect(sim.ents.get(ids.cutter!)!.rot).toBe(1);
  at('wall_quartz', 3);
  powerLine(sim, ids.cutter!);
  at('wall_quartz', 4);
  lay([[470, 510, 2], ...line(470, 511, 1, 40)]); // from its output (front, east) down a tile, then east into (510, 511)
  at('wall_quartz', 6); // step 5 is the land without a vein's (an import order): passed by here
  until(sim, 'wall_quartz', 6 * EPOCH);
  return ids;
}

/** The commands a colony logged, by kind. */
const logged = (sim: Sim, k: Command['k']): Command[] => sim.log.filter((l) => l.cmd.k === k).map((l) => l.cmd);

describe('quests', () => {
  it('the quest table holds together (the tutorial unlocks before it uses), and checks fall on every epoch boundary', () => {
    expect(questProblems()).toEqual([]);
    expect(QUEST_IDS.length).toBe(12);
    expect(EPOCH % QUEST_CHECK_TICKS).toBe(0);
  });

  it('a scripted colony completes quests 0–11 in order, each once, each paid once', () => {
    const sim = colony();
    const credits0 = sim.credits;
    play(sim);
    expect(sim.quests.done).toEqual(QUEST_IDS);
    if (process.env.QUEST_REPORT) console.log(QUEST_IDS.map((id, i) => `${i} ${id} @ ${(sim.quests.doneAt[i]! / EPOCH).toFixed(1)} min`).join('\n'));
    expect(sim.quests.cur).toBe(QUEST_IDS.length);
    expect([...sim.quests.doneAt].sort((a, b) => a - b)).toEqual(sim.quests.doneAt); // in time order
    // One logged completion per quest, in order, none forced; one quest event each.
    expect(logged(sim, 'quest')).toEqual(QUEST_IDS.map((id) => ({ k: 'quest', id })));
    // The tree: every plan the tutorial asked for, unlocked through the logged command.
    expect(logged(sim, 'unlockPlan').map((c) => (c as { id: string }).id)).toEqual([
      'telemetry', 'kiln', 'router', 'wind_flower', 'sand_collector', 'trade_post', 'wire_mill', 'beacon',
      ...PLAN_IDS.filter((p) => !['telemetry', 'kiln', 'router', 'wind_flower', 'sand_collector', 'trade_post', 'wire_mill', 'beacon', 'observatory'].includes(p)),
      'observatory',
    ]);
    // Ocelles: quests 6 and 10 pay 150 + 300 ◉ (on top of the trade, less the research's tokens, D68, and the vein's parcel, D87).
    const t = sim.trade;
    expect(sim.credits - credits0 - (t.earned - t.spent) + sim.tokenStats.totalCents + sim.land.paid.get(parcelAt(468, 511))!).toBe((300 + 150) * 100);
    // The title of the path taken (a beacon: the passes).
    expect(sim.quests.titles).toEqual(['arpentage']);
    // Nothing is left to complete, and nothing more is paid.
    const before = sim.hash();
    expect(sim.checkQuests()).toEqual([]);
    expect(sim.completeQuest('wall_quartz')).toBe(false);
    expect(sim.hash()).toBe(before);
  }, 60_000);

  it('on a land without a quartz vein (maps 1–2, D87) the quartz quest asks for an import instead of the vein\'s steps', () => {
    const sim = testSim(EXTRA, { plans: false }); // the flat test world: no vein
    for (const id of QUEST_IDS.slice(0, idx('wall_quartz'))) expect(sim.completeQuest(id, true), id).toBe(true);
    expect(objectiveProgress(sim, { k: 'vein' }).met).toBe(true); // nothing to buy
    sim.done.add('ex_quartz');
    sim.rebuildDerived();
    expect(stepNow(sim)).toEqual(['wall_quartz', 5]); // the import order (the vein's steps passed by)
    // On the vein's land the same quest starts at the parcel.
    const v = veinSim();
    for (const id of QUEST_IDS.slice(0, idx('wall_quartz'))) expect(v.completeQuest(id, true), id).toBe(true);
    expect(objectiveProgress(v, { k: 'vein' }).met).toBe(false);
    expect(stepNow(v)).toEqual(['wall_quartz', 0]);
  });

  it('each reward lands in the Hearth exactly once (forced completions, item by item)', () => {
    const sim = testSim();
    for (const id of QUEST_IDS) {
      const def = QUESTS[id] as QuestDef;
      const stock = Float64Array.from(sim.stock), credits = sim.credits;
      expect(sim.completeQuest(id, true)).toBe(true);
      const want = new Float64Array(stock.length);
      for (const { item, mu } of rewardItems(def.reward)) want[item] = want[item]! + mu;
      expect(Array.from(sim.stock).map((v, i) => v - stock[i]!)).toEqual(Array.from(want));
      expect(sim.credits - credits).toBe((def.reward.credits ?? 0) * 100);
      // A second completion of the same quest is refused and pays nothing.
      expect(sim.completeQuest(id, true)).toBe(false);
    }
    expect(sim.quests.done).toEqual(QUEST_IDS);
    // The kits are the buildings' own costs; the first purchase's prize is the Hearth's level-2 materials.
    expect(rewardItems(QUESTS.first_wind.reward).map((c) => [ITEM_IDS[c.item], c.mu / 1000])).toEqual([['iron_plate', 20], ['copper_wire', 4]]);
    expect(rewardItems(QUESTS.first_purchase.reward).map((c) => [ITEM_IDS[c.item], c.mu / 1000])).toEqual([['iron_plate', 200], ['gear', 50]]);
    // A forced `any` quest takes its first objective's title.
    expect(sim.quests.titles).toEqual(['taille']);
  });

  it('naming the claim completes quest 0 at once; names are trimmed and bounded', () => {
    const sim = testSim();
    expect(cleanName('  Clair \n Filon ')).toBe('Clair Filon');
    expect(cleanName('   ')).toBeNull();
    expect(cleanName('x'.repeat(33))).toBeNull();
    expect(sim.nameColony('\t')).toBe(false);
    expect(sim.quests.done).toEqual([]);
    expect(sim.nameColony('Bonne-Veine')).toBe(true);
    expect(sim.quests.done).toEqual(['claim']);
    expect(sim.log.slice(-2).map((l) => l.cmd)).toEqual([{ k: 'name', name: 'Bonne-Veine' }, { k: 'quest', id: 'claim' }]);
    // Renaming later keeps the quests as they are.
    expect(sim.nameColony('Haute-Braise')).toBe(true);
    expect(sim.colonyName).toBe('Haute-Braise');
    expect(sim.quests.done).toEqual(['claim']);
    // Quest 1 does not complete before its objectives hold.
    expect(sim.completeQuest('first_strike')).toBe(false);
  });

  it('quest 2 asks for the telemetry plan, a second wired drill and 20 more ore: about a minute of play', () => {
    const sim = colony();
    sim.nameColony('R');
    drillToHearth(sim);
    until(sim, 'first_strike', 8 * EPOCH);
    expect(sim.quests.cur).toBe(idx('ribbon_lines'));
    wire(sim, sim.place('drill', 513, 502, 2).id!);
    sim.placeBelts('ribbon', [[514, 504, 3], ...line(513, 504, 2, 6)]);
    sim.run(2 * EPOCH);
    expect(sim.quests.done).not.toContain('ribbon_lines'); // the plan is still to unlock
    expect(sim.unlockPlan('telemetry').ok).toBe(true);
    until(sim, 'ribbon_lines', QUEST_CHECK_TICKS);
  });

  it('replaying the log reproduces the quests, their rewards and the state hash', () => {
    const a = colony();
    play(a, 'tired_vein');
    a.run(321);
    const b = replayBase();
    replay(b, a.log, a.tick);
    expect(b.quests.done).toEqual(a.quests.done);
    expect(b.colonyName).toBe(a.colonyName);
    expect([...b.done].sort()).toEqual([...a.done].sort());
    expect(b.log.length).toBe(a.log.length);
    expect(b.hash()).toBe(a.hash());
  }, 60_000);

  it('a forced completion is logged and replays', () => {
    const a = testSim();
    a.nameColony('F');
    expect(a.completeQuest('first_strike', true)).toBe(true);
    a.run(50);
    expect(logged(a, 'quest')).toEqual([{ k: 'quest', id: 'claim' }, { k: 'quest', id: 'first_strike', force: true }]);
    const b = testSim();
    replay(b, a.log, a.tick);
    expect(b.quests.done).toEqual(['claim', 'first_strike']);
    expect(b.hash()).toBe(a.hash());
  });

  it('save → load keeps the quests and the tree (same hash), and goes on alike', () => {
    const a = colony();
    play(a, 'first_strike');
    expect(a.unlockPlan('telemetry').ok).toBe(true);
    wire(a, a.place('drill', 513, 502, 2).id!);
    a.placeBelts('ribbon', [[514, 504, 3], ...line(513, 504, 2, 6)]);
    a.run(77);
    const b = deserialize(JSON.parse(JSON.stringify(serialize(a))), veinSource());
    expect(b.quests).toEqual(a.quests);
    expect(b.done.has('telemetry')).toBe(true);
    expect(b.mods.flags.has('telemetry')).toBe(true);
    expect(b.colonyName).toBe(a.colonyName);
    expect(b.hash()).toBe(a.hash());
    a.run(3 * EPOCH);
    b.run(3 * EPOCH);
    expect(a.quests.done).toContain('ribbon_lines');
    expect(b.quests).toEqual(a.quests);
    expect(b.hash()).toBe(a.hash());
  }, 60_000);

  it('a quest met during an absence completes right after the catch-up (and at the next check)', () => {
    const a = colony();
    play(a, 'ribbon_lines');
    // Quest 3's smelter line, built just before leaving: its 10 plates are made while away.
    expect(a.unlockPlan('kiln').ok && a.unlockPlan('router').ok).toBe(true);
    const coal = a.place('drill', 520, 498, 2).id!;
    const mast = a.place('mast', 516, 503, 0).id!;
    wire(a, coal, mast);
    const kiln = a.place('kiln', 516, 505, 2).id!;
    a.setRecipe(kiln, 'iron_plate');
    expect(a.place('router', 513, 505, 0).ok).toBe(true);
    a.placeBelts('ribbon', [[514, 505, 1], [515, 505, 0], [515, 504, 1], [516, 504, 2]]);
    a.placeBelts('ribbon', [[521, 500, 2], [521, 501, 2], [521, 502, 3], [520, 502, 3], [519, 502, 3], [518, 502, 3], [517, 502, 2], [517, 503, 2], [517, 504, 2]]);
    a.placeBelts('ribbon', [[517, 507, 2], [517, 508, 2], [517, 509, 2], [517, 510, 2], [517, 511, 3], [516, 511, 3], [515, 511, 3]]);
    a.run(5);
    const save = JSON.stringify(serialize(a));
    const b = deserialize(JSON.parse(save), veinSource());
    const c = deserialize(JSON.parse(save), veinSource());
    const away = 12 * EPOCH;
    catchUp(b, away, { noDirect: true });
    expect(b.quests.done).not.toContain('bloom_kiln'); // the catch-up runs no quest check itself
    expect(b.checkQuests()).toEqual(['bloom_kiln']);
    expect(b.stock[itemIdx('iron_plate')]! - c.stock[itemIdx('iron_plate')]!).toBeGreaterThan(0); // its reward (30 plates) is in
    // Without the explicit check, the first online check (within a second) finds it.
    catchUp(c, away, { noDirect: true });
    c.run(QUEST_CHECK_TICKS);
    expect(c.quests.done).toContain('bloom_kiln');
    // Online play completes it too.
    a.run(away);
    expect(a.quests.done).toContain('bloom_kiln');
  }, 60_000);

  it('ore mined during an absence counts: quest 2 completes right after the catch-up', () => {
    const a = colony();
    play(a, 'first_strike');
    expect(a.unlockPlan('telemetry').ok).toBe(true);
    wire(a, a.place('drill', 513, 502, 2).id!);
    a.placeBelts('ribbon', [[514, 504, 3], ...line(513, 504, 2, 6)]);
    a.run(7);
    catchUp(a, 30 * EPOCH, { noDirect: true });
    expect(a.checkQuests()).toContain('ribbon_lines');
    expect(a.quests.done).toContain('ribbon_lines');
  }, 60_000);

  it('a drill “delivers” only once its output reaches the Heart through ribbons (the guide stops pointing then)', () => {
    const sim = testSim();
    const d = sim.place('drill', 511, 502, 2);
    wire(sim, d.id!);
    sim.ensureCompiled();
    const o = { k: 'delivers', defs: ['drill'], n: 1 } as const;
    expect(objectiveProgress(sim, o).met).toBe(false); // no ribbon yet
    sim.placeBelts('ribbon', [[512, 504, 3], ...line(511, 504, 2, 4)]); // stops two tiles short
    sim.ensureCompiled();
    expect(objectiveProgress(sim, o).met).toBe(false);
    sim.placeBelts('ribbon', line(511, 508, 2, 2)); // now it lands in the Heart's north input
    sim.ensureCompiled();
    expect(objectiveProgress(sim, o).met).toBe(true);
    expect(objectiveProgress(sim, { k: 'delivers', defs: ['drill'], item: 'coal', n: 1 }).met).toBe(false); // that drill mines iron
  });

  it('a machine is “fed” only by a production line of the item: a router splits the line between the Heart and it', () => {
    const sim = testSim();
    drillToHearth(sim); // iron into the Heart's north input along x = 511
    const kiln = sim.place('kiln', 507, 505, 1).id!; // facing east: its inputs open west, at (506, 505|506)
    sim.ensureCompiled();
    const iron = { k: 'feeds', item: 'iron_ore', to: ['kiln'], n: 1 } as const;
    expect(objectiveProgress(sim, iron).met).toBe(false);
    // A router on the line (it replaces the ribbon) and a ribbon from it around to the smelter.
    expect(sim.place('router', 511, 505, 0).ok).toBe(true);
    sim.ensureCompiled();
    expect(objectiveProgress(sim, iron).met).toBe(false); // the router alone feeds nothing
    expect(sim.placeBelts('ribbon', [[510, 505, 0], [510, 504, 3], [509, 504, 3], [508, 504, 3], [507, 504, 3], [506, 504, 2], [506, 505, 1]])).toBe(7);
    sim.ensureCompiled();
    expect(objectiveProgress(sim, iron).met).toBe(true);
    expect(objectiveProgress(sim, { k: 'delivers', defs: ['drill'], n: 1 }).met).toBe(true); // the Heart still gets its share
    expect(objectiveProgress(sim, { k: 'feeds', item: 'coal', to: ['kiln'], n: 1 }).met).toBe(false); // no coal line
    expect(objectiveProgress(sim, { k: 'feeds', item: 'iron_ore', to: ['kiln'], recipe: 'glass', n: 1 }).met).toBe(false); // set to no recipe
    expect(sim.setRecipe(kiln, 'iron_plate')).toBe(true);
    // The split shares the ore: both ends get some (no coal here, so the smelter only fills its input).
    const ore0 = sim.stockOf('iron_ore');
    sim.run(EPOCH);
    expect(heldIn(sim.graph.nodeByEnt.get(kiln)!, itemIdx('iron_ore'))).toBeGreaterThan(0);
    expect(sim.stockOf('iron_ore')).toBeGreaterThan(ore0);
  });

  it('the tree objective counts plans and research alike', () => {
    const sim = testSim(undefined, { plans: false });
    const o = { k: 'unlocked', ids: ['kiln', 'router'] } as const;
    expect(objectiveProgress(sim, o)).toEqual({ have: 0, need: 2, met: false });
    expect(sim.unlockPlan('router').ok).toBe(true);
    expect(objectiveProgress(sim, o)).toEqual({ have: 1, need: 2, met: false });
    expect(sim.unlockPlan('kiln').ok).toBe(true);
    expect(objectiveProgress(sim, o).met).toBe(true);
    expect(objectiveProgress(sim, { k: 'unlocked', ids: ['tr1'] }).met).toBe(false);
  });

  it('CrierBelt takes a fifth of every trade, and nothing lowers it (D64)', () => {
    const sim = testSim();
    sim.grant('iron_plate', 200); sim.grant('glass', 50); sim.grant('copper_wire', 50);
    expect(sim.place('trade_post', 505, 510, 0).ok).toBe(true);
    const plate = itemIdx('iron_plate');
    expect(sim.mods.tradeFee).toBe(200);
    const paid = sim.quoteSpot(plate, 'sell', 50).cents;
    for (const id of QUEST_IDS) sim.completeQuest(id, true);
    expect(sim.quoteSpot(plate, 'sell', 50).cents).toBe(paid);
  });
});
