import { describe, it, expect } from 'vitest';
import { QUEST_CHECK_TICKS, QUEST_IDS, QUESTS, questProblems, type QuestDef, type QuestId } from '@/content/quests';
import { ITEM_IDS, itemIdx, recipeIdx } from '@/content/registry';
import { PLAN_IDS, PLANS } from '@/content/research';
import { recipeOf } from '../cfg';
import { replay, type Command } from '../commands';
import { EPOCH } from '../constants';
import { join, placeFed, powerLine, type Feed } from '../dev';
import { catchUp } from '../offline/catchup';
import { deserialize, serialize } from '../serialize';
import { heldIn, Sim } from '../state';
import { T, type Rot } from '../types';
import { COAL, drillToHearth, learnPlans, line, steadyPower, testSim, testSource, wire } from '../testkit';
import { FlatSource, type VeinSite } from '../world/grid';
import { parcelAt } from '../world/land';
import { WORLD_EPOCH0 } from '../constants';
import { cleanName, currentQuest, loadQuests, objectiveProgress, planOffered, questProgress, rewardItems, stepApplies } from './quests';
import { nightCover } from '../readouts/night';
import { machineRefusals } from '../readouts/core-door';
import { ForkNode } from '../flow/nodes';

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

/**
 * The test world (`testSource` with the extra coal), its quartz wall — rock at level 1 on x 460–467,
 * y 507–516, quartz in its east face — and a pond north-west of the Hearth, x 500–503, y 494–496 (D114:
 * « La vapeur »'s water).
 */
function veinSource(): VeinSource {
  const base = testSource(EXTRA);
  return new VeinSource(
    [...base.deposits, { x: 467, y: 508, w: 1, h: 8, item: itemIdx('quartz'), rich: 750 }],
    [...base.rocks, { x: 460, y: 507, w: 8, h: 10, t: T.Rock1, level: 1 }, { x: 500, y: 494, w: 4, h: 3, t: T.Shallow }],
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
 * A guided quest's step, as `ui/guide.ts` picks it: the first whose `done` does not hold (counters
 * from the founding), else its closing line. Read on a compiled graph, as the guide's 4 Hz refresh
 * does — so a step is never shown once the base already does what it asks. (The guide also never
 * shows again a step done once, D101: its memory is the UI's, not read here.)
 */
function stepNow(sim: Sim): [string | null, number] {
  sim.ensureCompiled();
  const q = currentQuest(sim);
  if (!q) return [null, -1];
  const steps = q.def.steps ?? [];
  const i = steps.findIndex((s) => stepApplies(sim, s) && !(s.done && objectiveProgress(sim, s.done).met));
  return [q.id, i < 0 ? steps.length - 1 : i];
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
 * A goal's hint as the guide shows it on request (ui/guide.ts `hintIndex`, D101): the first that
 * applies on this land and is not done (its `unless` not holding); −1 when every one holds.
 */
function hintNow(sim: Sim): [string | null, number] {
  sim.ensureCompiled();
  const q = currentQuest(sim);
  if (!q) return [null, -1];
  return [q.id, (q.def.hints ?? []).findIndex((s) => stepApplies(sim, s) && !(s.done && objectiveProgress(sim, s.done).met))];
}

/**
 * The tutorial played with real commands on the test colony, quest by quest, up to (and
 * including) quest `last` — every plan unlocked in the tree before what it unlocks is used, every
 * machine fed by its own lines (the Hearth only takes in). In a guided quest the guide's step must
 * move on exactly when the base does what it asks; in a goal (D101) its hint on request does.
 * Returns the ids of what it built.
 *
 * The factory (east of the Hearth, 510..514 × 510..514): an iron drill north into its north input;
 * a second iron drill and a coal drill on the extra deposit feed the plate smelter (a drill pair,
 * D97); a router on the coal line feeds the glass smelter, beside the sand; the smelters' lines run
 * into the Hearth's east inputs; the trade post sells glass, and its exit leads the starter
 * contract's copper ore into the wire mill's line (D101); the Core raised to level 2 (D101), every
 * plan taken, the Core's own Survey Data rides one ribbon from its outlet into the research lab.
 */
function play(sim: Sim, last: QuestId = 'synth_parts'): Record<string, number> {
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
  const hint = (quest: QuestId, i: number): void => { expect(hintNow(sim)).toEqual([quest, i]); };

  // 0 — a name.
  expect(sim.nameColony('  Bonne-Veine  ')).toBe(true);
  expect(sim.colonyName).toBe('Bonne-Veine');
  if (stop('claim')) return ids;

  // 1 — guided: the starting kit, a drill on iron, wired, a ribbon into the Hearth's north input: 10 ore in.
  at('first_strike', 0);
  ids.drill1 = drillToHearth(sim);
  at('first_strike', 3); // every step done: the closing line while the ore comes, never the ribbon again (D98)
  until(sim, 'first_strike', 8 * EPOCH);
  if (stop('first_strike')) return ids;

  // 2 — guided: the smelter's plan, the smelter, its recipe, its drill pair (coal on the extra
  // deposit, a second iron drill: no router, D101), their wires, the plates into the Hearth.
  at('bloom_kiln', 0);
  expect(sim.place('kiln', 516, 505, 2).reason).toBe('locked'); // not before its plan
  unlock('kiln');
  at('bloom_kiln', 1);
  place('kiln1', 'kiln', 516, 505, 2); // inputs north at (516|517, 504), output south at (517, 507)
  at('bloom_kiln', 2);
  expect(sim.setRecipe(ids.kiln1!, 'iron_plate')).toBe(true);
  at('bloom_kiln', 3);
  place('coal', 'drill', 520, 498, 2); // on the extra deposit; its output faces (521, 500)
  at('bloom_kiln', 4);
  lay([[521, 500, 2], [521, 501, 2], [521, 502, 3], [520, 502, 3], [519, 502, 3], [518, 502, 3], [517, 502, 2], [517, 503, 2], [517, 504, 2]]);
  at('bloom_kiln', 5);
  place('drill2', 'drill', 513, 502, 2); // its output faces (514, 504)
  at('bloom_kiln', 6);
  lay([[514, 504, 1], [515, 504, 1], [516, 504, 2]]);
  at('bloom_kiln', 7); // both lines laid: the coal drill's wire (beyond the Hearth's reach: a pole)
  place('mastC', 'mast', 516, 503); // it wires itself to the Hearth
  expect(sim.links.has(sim.hearthId, ids.mastC!)).toBe(true);
  at('bloom_kiln', 7);
  wire(sim, ids.coal!, ids.mastC);
  at('bloom_kiln', 8);
  wire(sim, ids.drill2!);
  at('bloom_kiln', 9);
  const plateLine: Array<[number, number, Rot]> = [[517, 507, 2], [517, 508, 2], [517, 509, 2], [517, 510, 2], [517, 511, 3], [516, 511, 3], [515, 511, 3]];
  lay(plateLine);
  at('bloom_kiln', 10); // the closing line
  until(sim, 'bloom_kiln', 6 * EPOCH);
  // 3 — the night (D101): the test colony's geothermal tap gives day and night alike, so the
  // Hearth's grid already holds without the sun — the goal is met as soon as it is current.
  expect(objectiveProgress(sim, { k: 'night', pct: 80 }).met).toBe(true);
  until(sim, 'first_wind', QUEST_CHECK_TICKS);
  if (stop('first_wind')) return ids;

  // 4 — goal: glass. A second smelter beside the first; sand off the bare ground beside it (two
  // sand collectors), their lines joining into its other input; its coal off the coal line
  // through a router; its glass into the Hearth's other east input. Its hint follows.
  hint('glassworks', 0);
  expect(sim.place('sand_collector', 522, 506, 0).reason).toBe('locked'); // not before its plan
  unlock('sand_collector');
  hint('glassworks', 1);
  place('kiln2', 'kiln', 520, 505, 2); // inputs north at (520|521, 504), output south at (521, 507)
  hint('glassworks', 2);
  expect(sim.setRecipe(ids.kiln2!, 'glass')).toBe(true);
  hint('glassworks', 3);
  expect(sim.place('sand_collector', 518, 498, 0).reason).toBe('needs_sand'); // on the coal deposit
  place('sand', 'sand_collector', 522, 506); // its output faces (522, 505)
  place('sandB', 'sand_collector', 523, 502, 2); // facing south: its output faces (524, 504)
  hint('glassworks', 4);
  wire(sim, [ids.sand!, ids.sandB!], ids.mastC);
  hint('glassworks', 5);
  lay([[522, 505, 0], [522, 504, 3], [521, 504, 2]]);
  lay([[524, 504, 3], [523, 504, 3]]); // the second collector's line runs into the first's
  hint('glassworks', 6); // the coal: the router's plan (another coal drill would pass this hint by)
  unlock('router');
  hint('glassworks', 7);
  place('routerCoal', 'router', 519, 502);
  lay([[519, 503, 2], [519, 504, 1], [520, 504, 2]]);
  hint('glassworks', 8);
  const glassLine = [...line(521, 507, 2, 6), ...line(521, 513, 3, 7)];
  lay(glassLine);
  hint('glassworks', -1); // every hint holds: the glass is on its way
  until(sim, 'glassworks', 6 * EPOCH);
  if (stop('glassworks')) return ids;

  // 5 — goal: steam (D114). The Steam plan; a pump on the pond's shore north-west of the Hearth, the
  // boiler beside it, a conduit from the one to the other; its coal from a drill of its own on the
  // west deposit, one ribbon north into its coal intake (from the side: the conduit runs behind it);
  // the boiler and the pump wired pole by pole (the coal drill too).
  hint('steam_power', 0);
  expect(sim.place('pump', 504, 494, 0).reason).toBe('locked'); // not before its plan
  unlock('wind_flower'); // its plan's prerequisite (D143: the coal generator's until then): the night was held by the steady tap here, not by turbines
  hint('steam_power', 0);
  unlock('steam');
  hint('steam_power', 1);
  expect(sim.place('pump', 506, 494, 0).reason).toBe('needs_water'); // two tiles off the water
  place('pump', 'pump', 504, 494, 0); // on the pond's east shore (x 503): its outlet faces (504, 493)
  hint('steam_power', 2);
  place('boiler', 'steam_boiler', 504, 490, 0); // 504–506 × 490–491: coal in at (504, 491), water in at (506, 491), both from the south
  hint('steam_power', 3);
  expect(sim.placeBelts('conduit', [[504, 493, 1], [505, 493, 1], [506, 493, 0], [506, 492, 0]])).toBe(4);
  hint('steam_power', 4);
  place('coalB', 'drill', 498, 506, 0); // on the west deposit; its output faces (498, 505)
  lay([...line(498, 505, 0, 13), ...line(498, 492, 1, 6), [504, 492, 0]]);
  hint('steam_power', 5);
  powerLine(sim, ids.boiler!);
  hint('steam_power', 6);
  powerLine(sim, ids.pump!);
  powerLine(sim, ids.coalB!);
  hint('steam_power', -1);
  until(sim, 'steam_power', 2 * EPOCH);
  if (stop('steam_power')) return ids;

  // 6 — goal: the Crier both ways. The trade post (its 5×5 pad and apron, D62) east of the glass
  // line, glass led into its entrance by a router (it sells whatever comes in, D64); the wire mill
  // on the tired vein; CrierBelt's starter contract, its ore led from the post's exit into the side
  // of the copper drill's line (D101: bought goods used).
  hint('crier_trade', 0);
  unlock('telemetry', 'trade_post');
  hint('crier_trade', 1);
  place('post', 'trade_post', 524, 509); // its entrance at (526, 513), fed from (526, 514); its exit at (526, 509), out to (526, 508)
  sim.grant('iron_plate', 2);
  place('routerSale', 'router', 521, 512); // over the glass line going south: its east side out
  lay([[522, 512, 1], [523, 512, 2], [523, 513, 2], [523, 514, 1], [524, 514, 1], [525, 514, 1], [526, 514, 0]]);
  unlock('wire_mill');
  place('copper', 'drill', 516, 523); // its output faces (516, 522)
  place('mill', 'wire_mill', 516, 519); // its input faces (516, 521), its output (516, 518)
  expect(recipeOf(sim.ents.get(ids.mill!)!.cfg)).toBe(recipeIdx('copper_wire') + 1); // its lone recipe, set at once (D83)
  powerLine(sim, ids.copper!);
  powerLine(sim, ids.mill!);
  const copperLine: Array<[number, number, Rot]> = [[516, 522, 0], [516, 521, 0]];
  lay(copperLine);
  const wireLine = [...line(516, 518, 3, 3), ...line(513, 518, 0, 4)];
  lay(wireLine);
  // The contract (D101): bought at a fixed price, it buys nothing while the post's exit leads nowhere.
  expect(typeof sim.takeStarter(ids.post!)).toBe('number');
  expect(objectiveProgress(sim, { k: 'starter' }).met).toBe(true);
  sim.run(2 * EPOCH);
  expect(sim.trade.boughtTotal[itemIdx('copper_ore')]).toBe(0);
  // It joins the copper line's first tile (516, 522) from the side: the last, at the mill's door, stays
  // fed from behind only — where « Les scories »' sorter goes (D139: a routing block takes from its back).
  const exitLine = join(sim, ids.post!, copperLine);
  expect(exitLine, 'a ribbon from the post\'s exit into the copper line').toBeTruthy();
  sim.ensureCompiled();
  expect(objectiveProgress(sim, { k: 'feeds', item: 'copper_ore', to: ['wire_mill'], from: ['trade_post'], n: 1 }).met).toBe(true);
  until(sim, 'crier_trade', 8 * EPOCH);
  if (stop('crier_trade')) return ids;

  // 7 — goal: the slag (D125, D139). No machine of the tutorial leaves any: the starter contract's ore
  // came with its slag (a slag with every five ore), out by the post's exit with the ore, and the
  // first one stopped at the wire mill's door, the copper line backed up behind it. The plans; a
  // sorter laid over that last tile takes it in (D139), set to the ore; an incinerator against its
  // free side: the slag falls in, the ore runs on into the mill.
  sim.run(2 * EPOCH);
  const atMill = machineRefusals(sim);
  expect(atMill.map((r) => [r.tile % 1024, r.tile >> 10, ITEM_IDS[r.item], r.by]), 'the slag at the mill\'s door').toEqual([[516, 521, 'slag', ids.mill]]);
  const wire0 = sim.produced[itemIdx('copper_wire')]!;
  sim.run(EPOCH);
  expect(sim.produced[itemIdx('copper_wire')], 'no wire past the slag').toBe(wire0);
  hint('slag', 0);
  unlock('sorter', 'incinerator');
  hint('slag', 1);
  place('slagSorter', 'sorter', 516, 521, 0);
  expect(sim.setForkFilter(ids.slagSorter!, 0, 'copper_ore')).toBe(true);
  sim.ensureCompiled();
  const so = sim.graph.nodeByEnt.get(ids.slagSorter!) as ForkNode;
  expect([ITEM_IDS[so.item], so.mu], 'the slag in the sorter').toEqual(['slag', 1000]);
  hint('slag', 2);
  place('slagPit', 'incinerator', 515, 521);
  hint('slag', -1);
  until(sim, 'slag', QUEST_CHECK_TICKS);
  if (stop('slag')) return ids;
  // The ore reaches the mill again; the rest of the contract's slag waits on the exit's line behind
  // its ore (the copper drill alone keeps the mill busy), for the sorter. None of it in the Core, none
  // lost: what CrierBelt sent is what the lines hold and the pit burnt.
  const SLAG = itemIdx('slag');
  sim.run(3 * EPOCH);
  expect(sim.produced[itemIdx('copper_wire')]!).toBeGreaterThan(wire0);
  expect(sim.stock[SLAG]).toBe(0);
  expect(sim.consumed[SLAG]).toBe(1000);
  expect(sim.totalHeld(SLAG) + sim.consumed[SLAG]!).toBe(sim.trade.boughtTotal[SLAG]);
  expect(sim.trade.boughtTotal[SLAG]).toBe(8000); // one with every five of the contract's 40 ore
  expect(machineRefusals(sim)).toEqual([]);

  // 8 — goal: the Core's level 2 (D101), the player's own click, paid from the Hearth's stock: plates,
  // glass and copper wire are there (the colony's spare materials, « La Criée »'s wire).
  hint('core_upgrade', 3);
  expect(sim.upgradeHearth().ok).toBe(true);
  expect(sim.hearthLevel).toBe(2);
  hint('core_upgrade', -1);
  until(sim, 'core_upgrade', QUEST_CHECK_TICKS);
  if (stop('core_upgrade')) return ids;

  // 9 — goal: « Le laboratoire » (D71, D101, D122). Every plan left, each as soon as the Hearth can
  // pay for it, then the research lab's (the gate); the lab south-east of the Hearth, wired — no
  // ribbon feeds it —; Mechanics launched, its plates and wire paid from the Core, its tokens the
  // Core's compute's.
  hint('field_journal', 0);
  const take = (p: string): void => {
    for (let t = 0; t < 30 * EPOCH && !sim.done.has(p) && !sim.unlockPlan(p).ok; t += EPOCH) sim.run(EPOCH);
    expect(sim.done.has(p), p).toBe(true);
  };
  for (const p of PLAN_IDS) if (PLANS[p].lane !== 'gate') take(p);
  hint('field_journal', 1);
  take('observatory');
  expect(sim.done.has('ex_quartz')).toBe(true); // the Face Cutter: a plan among the others (D101)
  hint('field_journal', 2);
  place('observatory', 'observatory', 518, 516); // 3×3 (D84), south-east of the Hearth
  hint('field_journal', 3);
  powerLine(sim, ids.observatory!);
  hint('field_journal', 4);
  for (let t = 0; t < 30 * EPOCH && !sim.startResearch('tr1').ok; t += EPOCH) sim.run(EPOCH); // its resources in the Core (D122)
  expect(sim.projects.map((p) => p.id).concat([...sim.done])).toContain('tr1');
  hint('field_journal', -1);
  until(sim, 'field_journal', 8 * EPOCH);
  if (stop('field_journal')) return ids;

  // 9 — goal: quartz in the wall (D87), past the Crown. The vein's parcel bought, a cutter at the
  // wall's foot (no research wait, D101: its plan was taken with the others; dropped facing away, it
  // turns its back to the rock), wired pole by pole, its quartz along one ribbon into the Hearth's
  // west input.
  hint('wall_quartz', 0);
  expect(sim.buyLand(parcelAt(468, 511))).toBeNull();
  hint('wall_quartz', 1);
  place('cutter', 'face_cutter', 468, 510, 3); // its back to the wall (x 467, y 510–511): turned to rot 1
  expect(sim.ents.get(ids.cutter!)!.rot).toBe(1);
  hint('wall_quartz', 2);
  powerLine(sim, ids.cutter!);
  hint('wall_quartz', 3);
  const quartzLine: Array<[number, number, Rot]> = [[470, 510, 2], ...line(470, 511, 1, 40)];
  lay(quartzLine); // from its output (front, east) down a tile, then east into (510, 511)
  hint('wall_quartz', -1); // the land without a vein's hint (an import order) is passed by here
  until(sim, 'wall_quartz', 6 * EPOCH);
  if (stop('wall_quartz')) return ids;

  // 10 — goal: Parts for the Synthesis (D90, after D93): the quartz workshop off the quartz and wire
  // lines, the assembly bench (D129: the electronics workshop is Tier 2's) off the wire line and the
  // plates' line past its slag sorter, each a router on the line, their oscillators and coils into
  // the Hearth; no press (D101: its gears wait for Mechanics, started in « Données d'arpentage »). The long lines are found by the layout kit. The
  // quartz workshop's own node first (D128): launched once Mechanics leaves the lab, its tokens the
  // Core's compute's, its quartz and wire from the Core.
  hint('synth_parts', 0);
  for (let t = 0; t < 30 * EPOCH && !sim.done.has('dn_quartzshop'); t += EPOCH) {
    if (!sim.projects.length) sim.startResearch('dn_quartzshop');
    sim.run(EPOCH);
  }
  expect(sim.done.has('dn_quartzshop')).toBe(true);
  hint('synth_parts', 1);
  const fed = (name: string, def: string, near: [number, number], feeds: Feed[], to: number | null): number => {
    const r = placeFed(sim, def, near, feeds, to, { r: 16, tries: 120 });
    if (!r) throw new Error(`${name} (${def} near ${near}): no spot with its lines`);
    return (ids[name] = r.id);
  };
  fed('quartzW', 'quartz_workshop', [490, 516], [{ lines: [quartzLine] }, { lines: [wireLine] }], sim.hearthId);
  // The plates off their line by a router (D139: the smelters leave no slag).
  fed('bench', 'assembly_bench', [500, 522], [{ lines: [wireLine] }, { lines: [plateLine.slice(2)] }], sim.hearthId);
  // Mechanics is learnt: two recipes, the bench waits for its choice (D83).
  hint('synth_parts', 3);
  expect(sim.setRecipe(ids.bench!, 'copper_coil')).toBe(true);
  hint('synth_parts', 4); // both fed, neither wired yet
  powerLine(sim, ids.quartzW!);
  powerLine(sim, ids.bench!);
  hint('synth_parts', -1); // their lines were laid with them: the parts on their way
  until(sim, 'synth_parts', 10 * EPOCH);
  return ids;
}

/** The commands a colony logged, by kind. */
const logged = (sim: Sim, k: Command['k']): Command[] => sim.log.filter((l) => l.cmd.k === k).map((l) => l.cmd);

describe('quests', () => {
  it('the quest table holds together (the tutorial unlocks before it uses), and checks fall on every epoch boundary', () => {
    expect(questProblems()).toEqual([]);
    expect(QUEST_IDS.length).toBe(12); // the claim's name, then eleven quests (D101: « Le Cœur grandit »; D114: « La vapeur »; D125: « Les scories »)
    expect(QUEST_IDS.filter((id) => (QUESTS[id] as QuestDef).steps).slice(1)).toEqual(['first_strike', 'bloom_kiln']); // guided: the first basics only
    expect(EPOCH % QUEST_CHECK_TICKS).toBe(0);
  });

  it('a scripted colony completes quests 0–10 in order, each once, each paid once', () => {
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
    const first = ['kiln', 'sand_collector', 'router', 'wind_flower', 'steam', 'telemetry', 'trade_post', 'wire_mill', 'sorter', 'incinerator'];
    expect(logged(sim, 'unlockPlan').map((c) => (c as { id: string }).id)).toEqual([
      ...first, ...PLAN_IDS.filter((p) => ![...first, 'observatory'].includes(p)), 'observatory',
    ]);
    // Ocelles: quests 6, 7, 8 and 10 pay 150 + 100 + 600 + 300 ◉ (on top of the trade — the starter
    // contract among the purchases, D101 —, less the research's tokens if any, D68/D105, and the
    // vein's parcel, D87).
    const t = sim.trade;
    expect(sim.credits - credits0 - (t.earned - t.spent) + sim.tokenStats.totalCents + sim.land.paid.get(parcelAt(468, 511))!).toBe((150 + 100 + 600 + 300) * 100);
    // The Core raised by the player's own command, once (D101: no quest grants a level).
    expect(logged(sim, 'hearthUp')).toHaveLength(1);
    // The register's title for the way past the Crown (D101: « Le quartz de la paroi » grants it).
    expect(sim.quests.titles).toEqual(['arpentage']);
    // Nothing is left to complete, and nothing more is paid.
    const before = sim.hash();
    expect(sim.checkQuests()).toEqual([]);
    expect(sim.completeQuest('wall_quartz')).toBe(false);
    expect(sim.hash()).toBe(before);
  }, 60_000);

  it('on a land without a quartz vein (maps 1–2, D87) the quartz quest hints at an import instead of the vein\'s steps', () => {
    const sim = testSim(EXTRA, { plans: false }); // the flat test world: no vein
    for (const id of QUEST_IDS.slice(0, idx('wall_quartz'))) expect(sim.completeQuest(id, true), id).toBe(true);
    expect(objectiveProgress(sim, { k: 'vein' }).met).toBe(true); // nothing to buy
    expect(hintNow(sim)).toEqual(['wall_quartz', 4]); // the import order (the vein's hints passed by)
    // On the vein's land the same quest starts at the parcel.
    const v = veinSim();
    for (const id of QUEST_IDS.slice(0, idx('wall_quartz'))) expect(v.completeQuest(id, true), id).toBe(true);
    expect(objectiveProgress(v, { k: 'vein' }).met).toBe(false);
    expect(hintNow(v)).toEqual(['wall_quartz', 0]);
  });

  it('« La Criée »: the starter contract buys nothing until the post\'s exit leads somewhere, and the quest wants its ore in a wire mill (D101)', () => {
    const sim = colony();
    play(sim, 'steam_power');
    expect(currentQuest(sim)?.id).toBe('crier_trade');
    learnPlans(sim);
    // The post sells glass, the mill stands fed by its own drill: two of three objectives (the glass sold, ever).
    const post = sim.place('trade_post', 524, 509, 0).id!;
    sim.grant('iron_plate', 2);
    expect(sim.place('router', 521, 512, 0).ok).toBe(true);
    expect(sim.placeBelts('ribbon', [[522, 512, 1], [523, 512, 2], [523, 513, 2], [523, 514, 1], [524, 514, 1], [525, 514, 1], [526, 514, 0]])).toBe(7);
    const copper = sim.place('drill', 516, 523, 0).id!, mill = sim.place('wire_mill', 516, 519, 0).id!;
    powerLine(sim, copper); powerLine(sim, mill);
    const copperLine: Array<[number, number, Rot]> = [[516, 522, 0], [516, 521, 0]];
    expect(sim.placeBelts('ribbon', copperLine)).toBe(2);
    expect(sim.placeBelts('ribbon', [...line(516, 518, 3, 3), ...line(513, 518, 0, 4)])).toBe(7);
    expect(hintNow(sim)).toEqual(['crier_trade', 2]); // the post's wire (its power is not an objective)
    // Signed, its exit leading nowhere: nothing bought, nothing paid (the order's 'outlet' hold).
    expect(typeof sim.takeStarter(post)).toBe('number');
    expect(sim.takeStarter(post)).toBe('taken'); // once a base
    sim.run(3 * EPOCH);
    expect(sim.trade.boughtTotal[itemIdx('copper_ore')]).toBe(0);
    expect(sim.quests.done).not.toContain('crier_trade');
    // The exit led into the side of the copper line: the ore comes and goes into the mill.
    expect(join(sim, post, copperLine)).toBeTruthy();
    until(sim, 'crier_trade', 8 * EPOCH);
    expect(sim.trade.boughtTotal[itemIdx('copper_ore')]).toBeGreaterThanOrEqual(10_000);
  }, 60_000);

  it('« Le Cœur grandit »: the player raises the Core with plates, glass and wire, no research; its compute then runs the lab (D101, D122)', () => {
    const sim = testSim(undefined, { plans: false });
    for (const id of QUEST_IDS.slice(0, idx('core_upgrade'))) expect(sim.completeQuest(id, true), id).toBe(true);
    expect(currentQuest(sim)?.id).toBe('core_upgrade');
    expect(sim.hearthLevel).toBe(1);
    learnPlans(sim);
    // A lab before the level: the Core has no compute bay yet (D122).
    const lab = sim.place('observatory', 518, 516, 0).id!;
    expect(sim.coreComputeRate()).toBe(0);
    // What is short, one hint at a time, the copper wire first; the Core's card is the target.
    const set = (it: string, n: number): void => { sim.stock[itemIdx(it)] = n * 1000; }; // outside commands
    set('copper_wire', 10); set('glass', 10); set('iron_plate', 10);
    expect(hintNow(sim)).toEqual(['core_upgrade', 0]);
    expect((QUESTS.core_upgrade as QuestDef).hints!.every((h) => h.target.k === 'hearth')).toBe(true);
    expect(sim.upgradeHearth()).toEqual({ ok: false, reason: 'unaffordable' });
    set('copper_wire', 40);
    expect(hintNow(sim)).toEqual(['core_upgrade', 1]);
    set('glass', 40);
    expect(hintNow(sim)).toEqual(['core_upgrade', 2]);
    set('iron_plate', 300); set('glass', 100); set('copper_wire', 100);
    expect(hintNow(sim)).toEqual(['core_upgrade', 3]); // the click itself
    // No research asked (Mechanics no longer gives it): one logged command.
    expect(sim.done.has('tr1')).toBe(false);
    expect(sim.upgradeHearth().ok).toBe(true);
    expect(sim.log.at(-1)!.cmd).toEqual({ k: 'hearthUp' });
    expect(hintNow(sim)).toEqual(['core_upgrade', -1]);
    sim.run(QUEST_CHECK_TICKS);
    expect(sim.quests.done).toContain('core_upgrade');
    // Level 2: its compute bay gives research 1 000 tokens a minute, and the lab runs Mechanics on
    // them (« Le laboratoire »): two minutes, no ribbon.
    expect(sim.coreComputeRate()).toBe(1000);
    powerLine(sim, lab);
    expect(sim.startResearch('tr1').ok).toBe(true);
    sim.run(3 * EPOCH);
    expect(sim.done.has('tr1')).toBe(true);
  });

  it('« Tenir la nuit » reads the Core\'s grid without the sun, at any hour (D101)', () => {
    const sim = testSim(undefined, { plans: false });
    const night = { k: 'night', pct: 80 } as const;
    // Three drills by day (270 kW): the Core's panel tops them up; its core alone (210 kW at level 1,
    // day and night: D101) would not carry them through the night.
    drillToHearth(sim);
    wire(sim, sim.place('drill', 513, 502, 2).id!);
    wire(sim, sim.place('drill', 515, 502, 2).id!);
    sim.run(20);
    const c = nightCover(sim)!;
    expect(c.solar).toBeGreaterThan(0); // founded at noon: the sun gives
    expect(c.pct).toBeLessThan(80);
    expect(objectiveProgress(sim, night)).toEqual({ have: c.pct, need: 80, met: false });
    // A geothermal tap holds day and night alike: the goal is met by day already.
    steadyPower(sim);
    sim.run(20);
    expect(nightCover(sim)!.pct).toBe(100);
    expect(objectiveProgress(sim, night).met).toBe(true);
  });

  it('a goal\'s hint for one way passes by once another way did it (D101: a second coal drill, no router)', () => {
    const sim = colony();
    play(sim, 'first_wind');
    expect(currentQuest(sim)?.id).toBe('glassworks');
    const routerHint = (QUESTS.glassworks as QuestDef).hints![6]!;
    expect(routerHint.target).toEqual({ k: 'unlock', ids: ['router'] });
    expect(stepApplies(sim, routerHint)).toBe(true);
    // The glass smelter north of the extra coal, fed by a coal drill of its own: no router needed.
    expect(sim.unlockPlan('sand_collector').ok).toBe(true);
    const kiln2 = sim.place('kiln', 522, 492, 0).id!; // inputs south at (522|523, 493), fed from (522|523, 494)
    expect(sim.setRecipe(kiln2, 'glass')).toBe(true);
    const d = sim.place('drill', 522, 496, 0).id!; // its output faces (522, 495)
    powerLine(sim, d);
    expect(sim.placeBelts('ribbon', [[522, 495, 0], [522, 494, 0]])).toBe(2);
    sim.ensureCompiled();
    expect(objectiveProgress(sim, { k: 'feeds', item: 'coal', to: ['kiln', 'kiln_compact'], n: 2 }).met).toBe(true);
    expect(stepApplies(sim, routerHint)).toBe(false); // the router's plan is no longer hinted at
    expect(sim.done.has('router')).toBe(false);
  }, 60_000);

  it('the tree offers each quest\'s few plans, then every plan (D101), and everything once the tutorial is over or skipped', () => {
    const sim = testSim(undefined, { plans: false });
    expect(planOffered(sim, 'kiln')).toBe(false); // the claim's name: no tree yet
    sim.quests.cur = idx('bloom_kiln');
    expect(['kiln', 'router', 'telemetry'].map((p) => planOffered(sim, p))).toEqual([true, false, false]);
    sim.quests.cur = idx('crier_trade');
    expect(['kiln', 'router', 'telemetry', 'trade_post', 'silo'].map((p) => planOffered(sim, p))).toEqual([true, true, true, true, false]);
    sim.quests.cur = idx('field_journal');
    expect(PLAN_IDS.every((p) => planOffered(sim, p))).toBe(true);
    // A plan taken early (the engine takes any plan: the pacing is the tree's) always shows.
    sim.quests.cur = idx('bloom_kiln');
    expect(sim.unlockPlan('router').ok).toBe(true);
    expect(planOffered(sim, 'router')).toBe(true);
    sim.quests.skipped = true;
    expect(planOffered(sim, 'silo')).toBe(true);
  });

  it('a save from the first tutorial loads into today\'s quests: each old quest maps to the one that holds it (D101)', () => {
    const OLD = ['claim', 'first_strike', 'ribbon_lines', 'bloom_kiln', 'first_wind', 'glassworks', 'crier_calls', 'tired_vein', 'first_purchase', 'beyond_crown', 'field_journal', 'wall_quartz', 'synth_parts'];
    const NOW: Record<string, string | null> = {
      claim: 'claim', first_strike: 'first_strike', ribbon_lines: 'bloom_kiln', bloom_kiln: 'bloom_kiln', first_wind: 'first_wind', glassworks: 'glassworks',
      // « Les scories » (table 5, D125) comes first for a player at « La Criée »'s end, then « Le Cœur grandit »
      // (table 3); « La vapeur » (table 4, D114) for one still in it; each passed by once a later quest was done.
      crier_calls: 'steam_power', tired_vein: 'steam_power', first_purchase: 'steam_power', beyond_crown: 'slag', field_journal: 'slag',
      wall_quartz: 'wall_quartz', synth_parts: 'synth_parts', '': null,
    };
    for (const cur of [...OLD, '']) {
      const done = cur ? OLD.slice(0, OLD.indexOf(cur)) : OLD;
      const sim = testSim();
      // An old save's quest state: no table, the old ids, baselines for the old current quest.
      loadQuests(sim, { done, doneAt: done.map((_, i) => 100 * i), cur: cur || null, base: [7], win: [-1, 0, -1, 0], named: true, titles: [] });
      expect(QUEST_IDS[sim.quests.cur] ?? null, `old ${cur || 'all done'}`).toBe(NOW[cur]);
      expect(sim.quests.done.every((id) => (QUEST_IDS as string[]).includes(id))).toBe(true);
      expect([...sim.quests.doneAt].sort((a, b) => a - b)).toEqual(sim.quests.doneAt);
      // « La Criée » is done once all three quests it holds were, at the last one's tick.
      if (!cur || OLD.indexOf(cur) > OLD.indexOf('first_purchase')) expect(sim.quests.doneAt[sim.quests.done.indexOf('crier_trade')]).toBe(100 * OLD.indexOf('first_purchase'));
      // The current quest's baselines are taken afresh (the old ones belonged to the old table).
      const objs = currentQuest(sim)?.def.objectives ?? [];
      expect(sim.quests.base.length).toBe(objs.length);
    }
    // A save from the D101 table before « Le Cœur grandit » (table 2): the same rule.
    const T2 = ['claim', 'first_strike', 'bloom_kiln', 'first_wind', 'glassworks', 'crier_trade', 'field_journal', 'wall_quartz', 'synth_parts'];
    for (const [cur, now] of [['field_journal', 'slag'], ['wall_quartz', 'wall_quartz'], ['synth_parts', 'synth_parts']] as const) {
      const done = T2.slice(0, T2.indexOf(cur));
      const sim = testSim();
      loadQuests(sim, { done, doneAt: done.map((_, i) => 100 * i), cur, base: [0, 0], win: [-1, 0, -1, 0, -1, 0, -1, 0], named: true, titles: [], table: 2 });
      expect(QUEST_IDS[sim.quests.cur], `table 2 at ${cur}`).toBe(now);
      // The quests added since (« Le Cœur grandit », « Les scories ») done only once a later one was.
      expect(sim.quests.done.includes('core_upgrade')).toBe(now !== 'slag');
      expect(sim.quests.done.includes('slag')).toBe(now !== 'slag');
      expect([...sim.quests.doneAt].sort((a, b) => a - b)).toEqual(sim.quests.doneAt);
    }
    // Today's table: a quest not done stays to do, whatever came after it.
    const t3 = testSim();
    loadQuests(t3, { done: ['claim', 'field_journal'], doneAt: [0, 5], cur: null, base: [], win: [], named: true, titles: [], table: 4 });
    expect(QUEST_IDS[t3.quests.cur]).toBe('first_strike');
    expect(t3.quests.done).not.toContain('core_upgrade');
    // Today's save keeps its own baselines (the same hash after a round trip).
    const a = colony();
    play(a, 'first_strike');
    a.run(77);
    const b = deserialize(JSON.parse(JSON.stringify(serialize(a))), veinSource());
    expect(b.quests).toEqual(a.quests);
    expect(b.hash()).toBe(a.hash());
  }, 60_000);

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
    // The kits are the buildings' own costs; « La Criée » pays copper wire, no Core level (D101: the player raises it).
    expect(rewardItems(QUESTS.first_wind.reward).map((c) => [ITEM_IDS[c.item], c.mu / 1000])).toEqual([['iron_plate', 10], ['glass', 4], ['copper_wire', 6]]); // a turbine's (D143)
    expect(rewardItems(QUESTS.crier_trade.reward).map((c) => [ITEM_IDS[c.item], c.mu / 1000])).toEqual([['copper_wire', 40]]);
    expect(sim.hearthLevel).toBe(1); // forced through, not one level granted
    // The register's title « Le quartz de la paroi » grants, whatever completed it.
    expect(sim.quests.titles).toEqual(['arpentage']);
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

  it('« La fonderie » takes a smelter fed by its own drill pair, and plates made before it count (D101: `ever`)', () => {
    const sim = colony();
    sim.nameColony('R');
    // The smelter built first, before the first drill: its plates are made during « Premier coup de pioche ».
    expect(sim.unlockPlan('kiln').ok).toBe(true);
    const kiln = sim.place('kiln', 516, 505, 2).id!;
    expect(sim.setRecipe(kiln, 'iron_plate')).toBe(true);
    const coal = sim.place('drill', 520, 498, 2).id!;
    sim.placeBelts('ribbon', [[521, 500, 2], [521, 501, 2], [521, 502, 3], [520, 502, 3], [519, 502, 3], [518, 502, 3], [517, 502, 2], [517, 503, 2], [517, 504, 2]]);
    const d2 = sim.place('drill', 513, 502, 2).id!;
    sim.placeBelts('ribbon', [[514, 504, 1], [515, 504, 1], [516, 504, 2]]);
    const mast = sim.place('mast', 516, 503, 0).id!;
    wire(sim, coal, mast);
    wire(sim, d2);
    sim.placeBelts('ribbon', [[517, 507, 2], [517, 508, 2], [517, 509, 2], [517, 510, 2], [517, 511, 3], [516, 511, 3], [515, 511, 3]]);
    sim.run(3 * EPOCH);
    expect(sim.produced[itemIdx('iron_plate')]).toBeGreaterThan(10_000);
    expect(sim.quests.cur).toBe(idx('first_strike')); // no drill into the Core yet
    drillToHearth(sim);
    until(sim, 'first_strike', 8 * EPOCH);
    until(sim, 'bloom_kiln', QUEST_CHECK_TICKS); // met already: done the next second
  }, 60_000);

  it('replaying the log reproduces the quests, their rewards and the state hash', () => {
    const a = colony();
    play(a, 'crier_trade');
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
    expect(a.unlockPlan('kiln').ok).toBe(true);
    const kiln = a.place('kiln', 516, 505, 2).id!;
    a.setRecipe(kiln, 'iron_plate');
    a.run(77);
    const b = deserialize(JSON.parse(JSON.stringify(serialize(a))), veinSource());
    expect(b.quests).toEqual(a.quests);
    expect(b.done.has('kiln')).toBe(true);
    expect(b.colonyName).toBe(a.colonyName);
    expect(b.hash()).toBe(a.hash());
    for (const s of [a, b]) {
      const coal = s.place('drill', 520, 498, 2).id!;
      s.placeBelts('ribbon', [[521, 500, 2], [521, 501, 2], [521, 502, 3], [520, 502, 3], [519, 502, 3], [518, 502, 3], [517, 502, 2], [517, 503, 2], [517, 504, 2]]);
      const d2 = s.place('drill', 513, 502, 2).id!;
      s.placeBelts('ribbon', [[514, 504, 1], [515, 504, 1], [516, 504, 2]]);
      wire(s, coal, s.place('mast', 516, 503, 0).id!);
      wire(s, d2);
      s.placeBelts('ribbon', [[517, 507, 2], [517, 508, 2], [517, 509, 2], [517, 510, 2], [517, 511, 3], [516, 511, 3], [515, 511, 3]]);
      s.run(4 * EPOCH);
    }
    expect(a.quests.done).toContain('bloom_kiln');
    expect(b.quests).toEqual(a.quests);
    expect(b.hash()).toBe(a.hash());
  }, 60_000);

  it('a quest met during an absence completes right after the catch-up (and at the next check)', () => {
    const a = colony();
    play(a, 'first_strike');
    // « La fonderie »'s smelter and drill pair, built just before leaving: its 10 plates are made while away.
    expect(a.unlockPlan('kiln').ok).toBe(true);
    const coal = a.place('drill', 520, 498, 2).id!;
    const mast = a.place('mast', 516, 503, 0).id!;
    wire(a, coal, mast);
    const kiln = a.place('kiln', 516, 505, 2).id!;
    a.setRecipe(kiln, 'iron_plate');
    const d2 = a.place('drill', 513, 502, 2).id!;
    wire(a, d2);
    a.placeBelts('ribbon', [[514, 504, 1], [515, 504, 1], [516, 504, 2]]);
    a.placeBelts('ribbon', [[521, 500, 2], [521, 501, 2], [521, 502, 3], [520, 502, 3], [519, 502, 3], [518, 502, 3], [517, 502, 2], [517, 503, 2], [517, 504, 2]]);
    a.placeBelts('ribbon', [[517, 507, 2], [517, 508, 2], [517, 509, 2], [517, 510, 2], [517, 511, 3], [516, 511, 3], [515, 511, 3]]);
    a.run(5);
    const save = JSON.stringify(serialize(a));
    const b = deserialize(JSON.parse(save), veinSource());
    const c = deserialize(JSON.parse(save), veinSource());
    const away = 12 * EPOCH;
    catchUp(b, away, { noDirect: true });
    expect(b.quests.done).not.toContain('bloom_kiln'); // the catch-up runs no quest check itself
    expect(b.checkQuests()).toContain('bloom_kiln');
    expect(b.stock[itemIdx('iron_plate')]! - c.stock[itemIdx('iron_plate')]!).toBeGreaterThan(0); // its reward (30 plates) is in
    // Without the explicit check, the first online check (within a second) finds it.
    catchUp(c, away, { noDirect: true });
    c.run(QUEST_CHECK_TICKS);
    expect(c.quests.done).toContain('bloom_kiln');
    // Online play completes it too.
    a.run(away);
    expect(a.quests.done).toContain('bloom_kiln');
  }, 60_000);

  it('ore mined during an absence counts: quest 1 completes right after the catch-up', () => {
    const a = colony();
    a.nameColony('Absente');
    drillToHearth(a);
    a.run(7);
    catchUp(a, 30 * EPOCH, { noDirect: true });
    expect(a.checkQuests()).toContain('first_strike');
    expect(a.quests.done).toContain('first_strike');
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

describe('the guide never asks again for what is done (D98)', () => {
  /** The quest colony with every plan, steady power and spare materials, named: quest 1 current. */
  const planned = (): Sim => {
    const sim = veinSim(true);
    steadyPower(sim);
    for (const [it, n] of [['iron_plate', 500], ['glass', 200], ['copper_wire', 100], ['gear', 50], ['coal', 100]] as const) sim.grant(it, n);
    expect(sim.nameColony('Ordre')).toBe(true);
    return sim;
  };
  const closing = (id: QuestId): number => (QUESTS[id] as QuestDef).steps!.length - 1;

  it('every guided quest ends on a closing line: every step done, the quest waiting for its numbers, nothing done is asked again', () => {
    for (const id of QUEST_IDS) {
      const steps = (QUESTS[id] as QuestDef).steps;
      if (steps) expect(steps[steps.length - 1]!.done, id).toBeUndefined();
    }
    // Quest 1: drill, wire, ribbon done; 10 ore still to come. The guide no longer says « Trace un ruban ».
    const sim = colony();
    expect(sim.nameColony('Ruban')).toBe(true);
    drillToHearth(sim);
    expect(stepNow(sim)).toEqual(['first_strike', closing('first_strike')]);
    expect((QUESTS.first_strike as QuestDef).steps![closing('first_strike')]!.target.k).toBe('stock');
    expect(sim.quests.done).not.toContain('first_strike');
  });

  it('steps done out of order are passed by: the ribbon laid before the drill, the drill before its wire', () => {
    const sim = colony();
    expect(sim.nameColony('Ordre')).toBe(true);
    expect(stepNow(sim)).toEqual(['first_strike', 0]);
    expect(sim.placeBelts('ribbon', [[512, 504, 3], ...line(511, 504, 2, 6)])).toBe(7); // the line first
    expect(stepNow(sim)).toEqual(['first_strike', 0]); // a drill: nothing at its start yet
    const d = sim.place('drill', 511, 502, 2).id!;
    expect(stepNow(sim)).toEqual(['first_strike', 1]); // its wire; the ribbon is there already
    wire(sim, d);
    expect(stepNow(sim)).toEqual(['first_strike', closing('first_strike')]);
    until(sim, 'first_strike', 8 * EPOCH);
  });

  it('the smelter built backwards: its lines before it, the drills before their wires — only what is missing is asked for', () => {
    const sim = planned();
    drillToHearth(sim);
    sim.completeQuest('first_strike', true);
    expect(stepNow(sim)).toEqual(['bloom_kiln', 1]); // every plan is known: the smelter
    // The plates' line, the coal's line and the iron's, before the smelter they lead to and from.
    expect(sim.placeBelts('ribbon', [[517, 507, 2], [517, 508, 2], [517, 509, 2], [517, 510, 2], [517, 511, 3], [516, 511, 3], [515, 511, 3]])).toBe(7);
    expect(sim.placeBelts('ribbon', [[521, 500, 2], [521, 501, 2], [521, 502, 3], [520, 502, 3], [519, 502, 3], [518, 502, 3], [517, 502, 2], [517, 503, 2], [517, 504, 2]])).toBe(9);
    expect(sim.placeBelts('ribbon', [[514, 504, 1], [515, 504, 1], [516, 504, 2]])).toBe(3);
    expect(stepNow(sim)).toEqual(['bloom_kiln', 1]); // still the smelter: the rest waits on it
    const kiln = sim.place('kiln', 516, 505, 2).id!;
    expect(stepNow(sim)).toEqual(['bloom_kiln', 2]); // its recipe
    expect(sim.setRecipe(kiln, 'iron_plate')).toBe(true);
    expect(stepNow(sim)).toEqual(['bloom_kiln', 3]); // the coal drill; its ribbon is there already
    const coal = sim.place('drill', 520, 498, 2).id!;
    expect(stepNow(sim)).toEqual(['bloom_kiln', 5]); // the iron drill
    const d2 = sim.place('drill', 513, 502, 2).id!;
    expect(stepNow(sim)).toEqual(['bloom_kiln', 7]); // the wires
    wire(sim, coal, sim.place('mast', 516, 503, 0).id!);
    wire(sim, d2);
    expect(stepNow(sim)).toEqual(['bloom_kiln', closing('bloom_kiln')]); // never « un ruban… » again
    until(sim, 'bloom_kiln', 6 * EPOCH);
  });

  it('a line counts whatever it is made of: a swift stretch, a router on its curve, a bridge pair over a crossing line', () => {
    const sim = planned();
    sim.done.add('xp_swift'); // an expertise's ribbon, granted outside commands (this colony is not replayed)
    sim.rebuildDerived();
    const d = sim.place('drill', 511, 502, 2).id!;
    wire(sim, d);
    expect(sim.placeBelts('swift_ribbon', [[512, 504, 3], [511, 504, 2]])).toBe(2); // west, then south: a curve
    expect(sim.place('router', 511, 504, 0).ok).toBe(true); // on the curve it takes the way the ore enters (D98)
    expect(sim.entityAt(511, 504)!.rot).toBe(3);
    expect(sim.place('skybridge', 511, 505, 2).ok).toBe(true);
    expect(sim.placeBelts('ribbon', line(507, 506, 1, 9))).toBe(9); // a line across, under the leap
    expect(sim.place('skybridge', 511, 507, 2).ok).toBe(true);
    expect(sim.placeBelts('ribbon', line(511, 508, 2, 2))).toBe(2); // into the Heart's north input
    expect(stepNow(sim)).toEqual(['first_strike', closing('first_strike')]);
    expect(objectiveProgress(sim, { k: 'delivers', defs: ['drill'], n: 1 }).met).toBe(true);
    until(sim, 'first_strike', 8 * EPOCH); // and the ore really arrives
  });
});
