// entry-rot.test.ts — a directional routing block dropped on a ribbon (D98): it takes the way the
// items *enter* that tile, its back to what feeds it, so on a curve its front and sides cover the
// ribbon's way out and the line keeps flowing through it; the ghost (the build tool's preview)
// shows that same rotation; R turns it from there, and the player's rotation then wins over the
// ribbon's, logged with the placement so a replay turns it alike.
import { describe, it, expect } from 'vitest';
import { BUILDING_IDS } from '@/content/registry';
import { Tools } from '@/input/tools';
import { replay } from './commands';
import { flows } from './systems/quests';
import { drillToHearth, line, testSim, wire, IRON } from './testkit';
import type { Sim } from './state';
import type { Rot } from './types';

/** A drill on iron at (511,502) facing south, wired: its output faces (512,504). */
function drill(sim: Sim): number {
  const d = sim.place('drill', 511, 502, 2);
  if (!d.ok) throw new Error(`drill: ${d.reason}`);
  wire(sim, d.id!);
  return d.id!;
}

/** Turning right: from the drill's output east, then south at (513,504) into the Heart's north input (513,510). */
const RIGHT: Array<[number, number, Rot]> = [[512, 504, 1], ...line(513, 504, 2, 6)];

/** The ore reaches the Heart through the line (and whatever block stands on it), and keeps arriving. */
function delivers(sim: Sim, from: number): void {
  sim.ensureCompiled();
  expect(flows(sim, from, sim.hearthId)).toBe(true);
  const ore0 = sim.stock[IRON()]!;
  sim.run(1200);
  expect(sim.stock[IRON()]! - ore0).toBeGreaterThan(10_000);
}

describe('a routing block dropped on a ribbon takes the way its items enter (D98)', () => {
  it('on a straight run: the ribbon\'s own way, whatever rotation was asked', () => {
    const sim = testSim();
    const d = drillToHearth(sim); // (512,504) west, then (511,504..509) south
    expect(sim.placementRot('router', 511, 506, 1)).toBe(2);
    expect(sim.place('router', 511, 506, 1).ok).toBe(true);
    expect(sim.entityAt(511, 506)!.rot).toBe(2);
    delivers(sim, d);
  });

  it('on a left curve (west, then south): its back to the feed in the east, the way out on its left side', () => {
    const sim = testSim();
    const d = drillToHearth(sim);
    // The ribbon at (511,504) points south (its way out); the items come in moving west.
    expect(sim.entityAt(511, 504)!.rot).toBe(2);
    for (const asked of [0, 1, 2, 3] as Rot[]) expect(sim.placementRot('router', 511, 504, asked)).toBe(3);
    for (const def of ['sorter', 'inverted_sorter', 'overflow_gate', 'underflow_gate']) expect(sim.placementRot(def, 511, 504, 0), def).toBe(3);
    // Neither the distributor nor the unloader is directional: they keep what was asked.
    expect(sim.placementRot('unloader', 511, 504, 1)).toBe(1);
    expect(sim.place('router', 511, 504, 0).ok).toBe(true);
    expect(sim.entityAt(511, 504)!.rot).toBe(3);
    delivers(sim, d);
  });

  it('on a right curve (east, then south): its back to the feed in the west, the way out on its right side', () => {
    const sim = testSim();
    const d = drill(sim);
    expect(sim.placeBelts('ribbon', RIGHT)).toBe(RIGHT.length);
    expect(sim.placementRot('router', 513, 504, 2)).toBe(1);
    expect(sim.place('sorter', 513, 504, 2).ok).toBe(true); // a sorter with no item: everything to the sides
    expect(sim.entityAt(513, 504)!.rot).toBe(1);
    delivers(sim, d);
  });

  it('fed from behind and from a side: the feed straight behind wins (the line\'s own way)', () => {
    const sim = testSim();
    drillToHearth(sim);
    // A second line from the west into (511,506), whose ribbon points south: fed from the north and the west.
    expect(sim.placeBelts('ribbon', line(506, 506, 1, 5))).toBe(5);
    expect(sim.placementRot('router', 511, 506, 0)).toBe(2);
    // A line's first tile (fed by nothing yet): the ribbon's own way.
    expect(sim.placementRot('router', 506, 506, 0)).toBe(1);
  });

  it('the ghost shows it; R turns it from there and the player\'s rotation wins, logged so a replay places it alike', () => {
    const sim = testSim();
    drillToHearth(sim);
    const tools = new Tools(() => sim);
    tools.select('router', 0);
    tools.move(511, 504);
    expect(tools.preview().pieces.map((p) => [p.def, p.x, p.y, p.rot, p.ok])).toEqual([['router', 511, 504, 3, true]]); // the curve's entry, as placed
    tools.rotate(1);
    expect(tools.preview().pieces[0]!.rot).toBe(0); // turned from what the ghost showed
    tools.move(511, 507); // over the straight run too, the player's rotation holds now
    expect(tools.preview().pieces[0]!.rot).toBe(0);
    tools.move(511, 504);
    const log0 = sim.log.length;
    expect(tools.down(511, 504, 0)).toEqual({ placed: 1 });
    const r = sim.entityAt(511, 504)!;
    expect([BUILDING_IDS[r.def], r.rot]).toEqual(['router', 0]);
    expect(sim.log.slice(log0).map((l) => l.cmd)).toEqual([{ k: 'place', def: 'router', x: 511, y: 504, rot: 0, cfg: 0, turned: true }]);
    // A placement the turn did not change logs nothing more: the rotation alone places it again.
    tools.select('router', 2); // taken in hand again: the ribbon's way is the default once more
    tools.move(511, 507);
    expect(tools.preview().pieces[0]!.rot).toBe(2);
    expect(tools.down(511, 507, 0)).toEqual({ placed: 1 });
    expect(sim.log[sim.log.length - 1]!.cmd).toEqual({ k: 'place', def: 'router', x: 511, y: 507, rot: 2, cfg: 0 });
    sim.run(300);
    const b = testSim();
    replay(b, sim.log, sim.tick);
    expect(b.entityAt(511, 504)!.rot).toBe(0);
    expect(b.entityAt(511, 507)!.rot).toBe(2);
    expect(b.hash()).toBe(sim.hash());
  });
});
