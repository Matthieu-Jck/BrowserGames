// junctions-d158.test.ts — save 23 → 24 (D158; owner, 2026-10-19: « the junction should prevent
// putting something other than a ribbon on the two sides where the junction brings the items »): a
// junction's rotation turns its deck now (north–south for rot 0 and 2, east–west for 1 and 3), where
// every junction was drawn north–south whatever its rotation. The step sets each junction a save holds
// upright (rot 0), found by the save's own building table, so it keeps its look and nothing else moves.
// Played on a forged save: the late debug base, its junctions turned every way as a save of then held
// them; the check that nothing else changed is the hash of the same base with its junctions upright.
import { describe, it, expect } from 'vitest';
import { buildingIdx } from '@/content/registry';
import { WORLD_EPOCH0 } from '@/sim/constants';
import { remapSave } from '@/sim/save-remap';
import { foundScenario } from '@/sim/scenarios';
import { deserialize, serialize, SAVE_VERSION, type SaveData } from '@/sim/serialize';
import { uprightJunctions } from '@/sim/testkit';
import { junctionsUpright, migrate, MIGRATIONS } from './migrate';

describe('save 23 → 24 (D158): every junction set upright', () => {
  it('the step sets each junction’s rotation to 0, by the save’s own building table, and nothing else', () => {
    expect(SAVE_VERSION).toBeGreaterThanOrEqual(24);
    expect(MIGRATIONS[23]).toBe(junctionsUpright);
    const content = { items: [], buildings: ['ribbon', 'crossing', 'router'], recipes: [], recipeSigs: [] };
    // id, def, x, y, rot, cfg, builtAt: a ribbon, a junction turned 3, a router, a junction turned 2.
    const d = { v: 23, content, ents: [1, 0, 10, 10, 1, 0, 0, 2, 1, 11, 10, 3, 0, 0, 3, 2, 12, 10, 1, 0, 0, 4, 1, 13, 10, 2, 0, 5] };
    expect(junctionsUpright(d)).toEqual({ ...d, ents: [1, 0, 10, 10, 1, 0, 0, 2, 1, 11, 10, 0, 0, 0, 3, 2, 12, 10, 1, 0, 0, 4, 1, 13, 10, 0, 0, 5] });
    expect(d.ents[11]).toBe(3); // the save itself untouched
    // Nothing to turn, or no junction in its table: the save as it was.
    const upright = { v: 23, content, ents: [2, 1, 11, 10, 0, 0, 0] };
    expect(junctionsUpright(upright)).toBe(upright);
    const none = { v: 23, content: { ...content, buildings: ['ribbon', 'router'] }, ents: [1, 1, 10, 10, 3, 0, 0] };
    expect(junctionsUpright(none)).toBe(none);
  });

  it('the late debug base, saved as version 23 with its junctions turned every way, loads upright and runs on as that base', () => {
    const { sim } = foundScenario('late', { playerSeed: 1, near: WORLD_EPOCH0 + 1000, name: 'Essai', mapV: 4 });
    const crossing = buildingIdx('crossing');
    expect([...sim.ents.map.values()].filter((e) => e.def === crossing).length).toBeGreaterThan(3);
    const d = JSON.parse(JSON.stringify(serialize(sim))) as SaveData;
    // As a version-23 save held them: each junction turned some way (a drag's own, the tool's).
    for (let i = 0; i < d.ents.length; i += 7) if (d.ents[i + 1] === crossing) d.ents[i + 4] = d.ents[i]! % 4;
    const m = migrate({ ...d, v: 23 });
    expect(m.from).toBe(23);
    expect(m.data.v).toBe(SAVE_VERSION);
    const r = remapSave(m.data);
    expect(r.note).toBeNull();
    const back = deserialize(r.data, sim.grid.source);
    expect([...back.ents.map.values()].filter((e) => e.def === crossing).every((e) => e.rot === 0)).toBe(true);
    uprightJunctions(sim);
    expect(back.hash()).toBe(sim.hash());
    back.run(3000);
    sim.run(3000);
    expect(back.hash()).toBe(sim.hash());
  }, 30_000);
});
