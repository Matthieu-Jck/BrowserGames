// fog-d148.test.ts — save 22 → 23 (D148; owner, 2026-10-19: « make it so that there's no fog of war
// anywhere »): no fog of war. A save of version 22 holds the explored discs D117's fog had lifted
// (`explored`: the founding's, a Core level's, one round each parcel held and each building stood up
// at the fog's edge); the step drops them and nothing else, and the base opens with the whole world
// known. Played on forged saves: a small base with discs far out, and the late debug base on map 4.
// The check that nothing else changed: the loaded base has the very hash of the same base saved today.
import { describe, it, expect } from 'vitest';
import { CENTER, WORLD_EPOCH0 } from '@/sim/constants';
import { remapSave } from '@/sim/save-remap';
import { foundScenario } from '@/sim/scenarios';
import { deserialize, serialize, SAVE_VERSION, type SaveData } from '@/sim/serialize';
import type { Sim } from '@/sim/state';
import { testSim } from '@/sim/testkit';
import { parcelAt } from '@/sim/world/land';
import { fogLifted, migrate, MIGRATIONS } from './migrate';

/** A version-22 save of `sim` holding `explored` as a save of then did. */
function forge(sim: Sim, explored: Array<[number, number, number]>): Record<string, unknown> {
  const d = JSON.parse(JSON.stringify(serialize(sim))) as SaveData & Record<string, unknown>;
  return { ...d, v: 22, explored };
}

/** The forged save through the chain, the remap and the load, as `rebuild` opens it (persist/colony.ts). */
function open(data: Record<string, unknown>, sim: Sim): Sim {
  const m = migrate(data as unknown as { v: number });
  expect(m.from).toBe(22);
  expect(m.data.v).toBe(SAVE_VERSION);
  expect('explored' in m.data).toBe(false);
  const r = remapSave(m.data);
  expect(r.note).toBeNull();
  return deserialize(r.data, sim.grid.source);
}

describe('save 22 → 23 (D148): no fog of war', () => {
  it('the step drops the explored discs and nothing else', () => {
    expect(SAVE_VERSION).toBe(23);
    expect(MIGRATIONS[22]).toBe(fogLifted);
    const d = { v: 22, stock: [1, 2], done: ['kiln'], hearthLevel: 3, explored: [[512, 512, 68], [600, 480, 32], [700, 700, 40]] };
    expect(fogLifted(d)).toEqual({ v: 22, stock: [1, 2], done: ['kiln'], hearthLevel: 3 });
    // A save that never held any (or an odd one) goes through as it was.
    expect(fogLifted({ v: 22, stock: [1] })).toEqual({ v: 22, stock: [1] });
  });

  it('a small base with discs far out loads as the same base, saves without them, and builds far away', () => {
    const sim = testSim();
    expect(sim.place('silo', 520, 504, 0).ok).toBe(true);
    sim.run(50);
    const back = open(forge(sim, [[CENTER, CENTER, 44], [CENTER + 40, CENTER, 32], [CENTER + 90, CENTER - 20, 12]]), sim);
    expect(back.hash()).toBe(sim.hash());
    const again = serialize(back) as unknown as Record<string, unknown>;
    expect('explored' in again).toBe(false);
    expect(again.v).toBe(SAVE_VERSION);
    // Far past anything those discs held: a pole stands (a kite flies it out).
    back.grant('iron_plate', 10);
    back.grant('copper_wire', 10);
    let x = CENTER + 260;
    while (back.land.neighbour(parcelAt(x, CENTER + 250)) >= 0) x += 23; // off a neighbouring base's land (D110)
    const c = back.canPlace('mast', x, CENTER + 250, 0);
    expect(c.ok, c.reason).toBe(true);
  });

  it('the late debug base on map 4, saved with its discs, loads with nothing else changed and runs on', () => {
    const { sim } = foundScenario('late', { playerSeed: 1, near: WORLD_EPOCH0 + 1000, name: 'Essai', mapV: 4 });
    const discs: Array<[number, number, number]> = [[CENTER, CENTER, 92]];
    for (let k = 0; k < 40; k++) discs.push([CENTER - 200 + k * 10, CENTER + ((k * 37) % 120) - 60, 12 + (k % 5) * 8]);
    const back = open(forge(sim, discs), sim);
    expect(back.hash()).toBe(sim.hash());
    back.run(3000);
    sim.run(3000);
    expect(back.hash()).toBe(sim.hash());
  }, 30_000);
});
