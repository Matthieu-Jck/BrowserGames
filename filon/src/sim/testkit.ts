// testkit.ts — helpers shared by engine tests and benches: a flat test world with deposits
// around the Hearth (512, 512) and small factory layouts. Power is wired (D25): a building
// runs only once a wire joins it to a grid with supply — `wire` strings them in tests (the
// testkit deposits all lie within the Hearth's 8-tile reach). The Hearth has no outputs
// (D34): a line that must start from a stock starts from a `stockedSilo`.
import { itemIdx } from '@/content/registry';
import { PLAN_IDS } from '@/content/research';
import { ReservoirNode } from './flow/nodes';
import { FlatSource } from './world/grid';
import { Sim } from './state';
import { T, type Rot } from './types';
import { WORLD_EPOCH0 } from './constants';

export const IRON = (): number => itemIdx('iron_ore');
export const SAND = (): number => itemIdx('sand');
export const COAL = (): number => itemIdx('coal');
export const COPPER = (): number => itemIdx('copper_ore');

/** A 3×3 vent south-east of the Hearth, inside its zone and its 8-tile reach (`steadyPower` taps it). */
export const TEST_VENT = { x: 521, y: 517, w: 3, h: 3 } as const;

/** Deposits: iron north of the Hearth, coal west, copper south; rich 500 = 5/min/tile (no sand: it is the ground, a sand collector takes it anywhere). A vent. */
export function testSource(extra: ConstructorParameters<typeof FlatSource>[0] = []): FlatSource {
  return new FlatSource([
    { x: 508, y: 498, w: 10, h: 6, item: IRON(), rich: 500 },
    { x: 498, y: 506, w: 6, h: 10, item: COAL(), rich: 300 },
    { x: 508, y: 522, w: 10, h: 4, item: COPPER(), rich: 500 },
    ...extra,
  ], [{ ...TEST_VENT, t: T.Vent }]);
}

/**
 * A fresh colony at a fixed founding epoch (noon of world day 0). Engine tests test mechanics,
 * not the unlock tree (D33): it starts with every plan learnt, granted outside commands like
 * `steadyPower`'s en5 (a replay onto another `testSim()` starts alike). `{ plans: false }`: only
 * the starting kit (drill, ribbon, pole), as a new player has — the tree's and the
 * tutorial's own tests.
 */
export function testSim(extra?: ConstructorParameters<typeof FlatSource>[0], opts: { plans?: boolean } = {}): Sim {
  const sim = new Sim({ worldSeed: 7, playerSeed: 11, source: testSource(extra), foundingEpoch: WORLD_EPOCH0 + 24 });
  if (opts.plans ?? true) learnPlans(sim);
  return sim;
}

/** Every plan learnt at once, outside commands and free (test colonies, the bench; not replayable). */
export function learnPlans(sim: Sim): void {
  for (const id of PLAN_IDS) sim.done.add(id);
  sim.rebuildDerived();
}

/** Straight ribbon from (x, y) moving in direction rot for n tiles. */
export function line(x: number, y: number, rot: Rot, n: number): Array<[number, number, Rot]> {
  const dx = [0, 1, 0, -1][rot]!, dy = [-1, 0, 1, 0][rot]!;
  return Array.from({ length: n }, (_, i) => [x + dx * i, y + dy * i, rot] as [number, number, Rot]);
}

/**
 * Wire `from` (a pillar or the Hearth; default the Hearth) to each of `to`, through the
 * `link` command; throws with the refusal so a test layout that cannot be wired fails loudly.
 */
export function wire(sim: Sim, to: number | readonly number[], from = sim.hearthId): void {
  for (const id of typeof to === 'number' ? [to] : to) {
    const r = sim.link(from, id);
    if (!r.ok) throw new Error(`wire ${from} → ${id}: ${r.reason}`);
  }
}

/**
 * A steady 1.5 MW, day and night: Geothermal Power (en5) granted outside commands (such a colony is
 * not replayed), a tap on the test vent, wired to the Hearth. For tests that need a grid whose
 * supply never changes — bit-exact catch-ups — now that the Hearth's own panel follows the sun.
 * Returns the tap's id.
 */
export function steadyPower(sim: Sim): number {
  sim.done.add('en5');
  sim.rebuildDerived();
  sim.grant('ceramic', 20); sim.grant('thermal_core', 4); sim.grant('circuit', 10);
  const t = sim.place('fumarole_tap', TEST_VENT.x, TEST_VENT.y, 0);
  if (!t.ok) throw new Error(`fumarole tap: ${t.reason}`);
  wire(sim, t.id!);
  return t.id!;
}

/**
 * Drill on iron at (511,502) facing S, wired to the Hearth, a ribbon west then south into the
 * Hearth's north input (511,510). Returns the drill id.
 */
export function drillToHearth(sim: Sim): number {
  const d = sim.place('drill', 511, 502, 2);
  if (!d.ok) throw new Error(`drill: ${d.reason}`);
  wire(sim, d.id!);
  const n = sim.placeBelts('ribbon', [[512, 504, 3], ...line(511, 504, 2, 6)]);
  if (n !== 7) throw new Error(`belts placed ${n}`);
  return d.id!;
}

/**
 * A silo at (x, y) holding n of one item: the stand-in for "a stock that feeds a line", now that
 * the Hearth has no outputs (D34). Rot 0 hands out north, from (x, y) and (x+1, y) into (x, y−1)
 * and (x+1, y−1). The stock is written outside commands (such a colony is not replayed), like
 * `steadyPower`'s research. Returns the silo's id.
 */
export function stockedSilo(sim: Sim, x: number, y: number, rot: Rot, item: string, n: number): number {
  const s = sim.place('silo', x, y, rot);
  if (!s.ok) throw new Error(`silo: ${s.reason}`);
  sim.ensureCompiled();
  const it = itemIdx(item);
  sim.stores.get(s.id!)![it] = n * 1000;
  (sim.graph.nodeByEnt.get(s.id!) as ReservoirNode).locked = it;
  return s.id!;
}
