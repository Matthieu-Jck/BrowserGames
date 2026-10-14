import { describe, it, expect } from 'vitest';
import { WORLD_SEED } from '@/content/world';
import { buildingIdx, itemIdx, CRECIPES } from '@/content/registry';
import { WORLD_EPOCH0 } from './constants';
import { recipeOf } from './cfg';
import { foundScenario } from './scenarios';
import { serialize, deserialize, type SaveData } from './serialize';
import { contentTable, FIELDS, remapSave, TRADE_FIELDS, type ContentTable, type Retired } from './save-remap';
import { MapGen } from './world/mapgen';

const SEED = 2;
const source = (): MapGen => new MapGen(WORLD_SEED, SEED);
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const NONE: Retired = { renamed: { items: {}, buildings: {}, recipes: {} }, costs: {} };

/** A late base that has run a while: full ribbons, buffers, stores, trade. */
const { sim } = foundScenario('late', { playerSeed: SEED, near: WORLD_EPOCH0 + 1000, name: 'Essai' });
sim.run(3000);
const saved: SaveData = clone(serialize(sim));

/** Today's table, reordered (a probe item first, everything else reversed): what an older build could have written. */
function shuffled(): ContentTable {
  const t = contentTable();
  const order = t.recipes.map((_, i) => t.recipes.length - 1 - i);
  return {
    items: ['zz_probe', ...[...t.items].reverse()],
    buildings: [...t.buildings].reverse(),
    recipes: order.map((i) => t.recipes[i]!),
    recipeSigs: order.map((i) => t.recipeSigs[i]!),
  };
}

describe('saves carry their content table (D47)', () => {
  it('every field of a real save is declared, in the trade section too', () => {
    for (const k of Object.keys(saved)) expect(FIELDS, k).toHaveProperty(k);
    for (const k of Object.keys(saved.trade ?? {})) expect(TRADE_FIELDS, k).toHaveProperty(k);
    expect(saved.content).toEqual(contentTable());
  });

  it('a save written by this content loads as it is', () => {
    expect(remapSave(saved).data).toBe(saved);
    expect(remapSave(saved).note).toBeNull();
  });

  it('a save written under another order loads back to the same state', () => {
    const old = remapSave(saved, shuffled(), NONE);
    expect(old.note).toBeNull();
    // The reordering touches every index-bearing field the base fills in.
    // (Outlets count when one names an item: trade posts no longer set theirs, D62, and a closed one is −1 in any order.)
    const filled = (v: unknown, k = ''): boolean => v !== undefined && JSON.stringify(v) !== '[]' && JSON.stringify(v) !== '{}'
      && (k !== 'portItems' || (v as Array<[number, number[]]>).some(([, items]) => items.some((i) => i >= 0)));
    for (const [k, kind] of Object.entries(FIELDS)) {
      const a = saved[k as keyof SaveData], b = old.data[k as keyof SaveData];
      if (kind === 'index' && k !== 'trade' && k !== 'oreDiff' && k !== 'nodes' && filled(a, k)) expect(JSON.stringify(b), k).not.toBe(JSON.stringify(a));
    }
    // Node states hold items only in routing blocks (a machine's buffers follow its recipe's slots).
    if (saved.nodes.some(([, s]) => ((s as { item?: number } | null)?.item ?? -1) >= 0)) expect(JSON.stringify(old.data.nodes)).not.toBe(JSON.stringify(saved.nodes));
    for (const k of ['ents', 'stock', 'chains', 'nodes', 'produced', 'stores'] as const) expect(filled(saved[k]), k).toBe(true);
    expect(deserialize(clone(old.data), source()).hash()).toBe(sim.hash());
  });

  it('a renamed item follows its new id; without the rename, what was held is counted lost', () => {
    const plates = itemIdx('iron_plate');
    expect(saved.stock[plates]).toBeGreaterThan(0);
    const old = clone(saved);
    old.content!.items[plates] = 'old_plate';
    const renamed = remapSave(old, contentTable(), { ...NONE, renamed: { ...NONE.renamed, items: { old_plate: 'iron_plate' } } });
    expect(renamed.note).toBeNull();
    expect(deserialize(renamed.data, source()).hash()).toBe(sim.hash());
    const dropped = remapSave(old, contentTable(), NONE);
    const lost = dropped.note?.lost.find((l) => l.id === 'old_plate');
    expect(lost?.mu).toBeGreaterThanOrEqual(saved.stock[plates]!);
    expect(deserialize(dropped.data, source()).stock[plates]).toBe(0);
  });

  it('a building taken out of the game comes down, refunded, its buffers handed to the Heart', () => {
    const kiln = buildingIdx('kiln');
    const n = saved.ents.filter((v, i) => i % 7 === 1 && v === kiln).length;
    expect(n).toBeGreaterThan(0);
    const old = clone(saved);
    old.content!.buildings[kiln] = 'old_kiln';
    const r = remapSave(old, contentTable(), { ...NONE, costs: { old_kiln: [['iron_plate', 7]] } });
    expect(r.note?.removed).toEqual([{ id: 'old_kiln', n, refunded: true }]);
    const back = deserialize(r.data, source());
    expect([...back.ents.sorted()].filter((e) => e.def === kiln)).toHaveLength(0);
    expect(back.stock[itemIdx('iron_plate')]).toBeGreaterThanOrEqual(saved.stock[itemIdx('iron_plate')]! + n * 7000);
  });

  it('a machine whose recipe changed is cleared, its buffers handed to the Heart', () => {
    const kiln = buildingIdx('kiln');
    const at = saved.ents.findIndex((v, i) => i % 7 === 1 && v === kiln && recipeOf(saved.ents[i + 4]!) > 0);
    expect(at).toBeGreaterThan(0);
    const r = recipeOf(saved.ents[at + 4]!) - 1;
    const old = clone(saved);
    old.content!.recipeSigs[r] = 'iron_ore>zz_probe';
    const out = remapSave(old, contentTable(), NONE);
    expect(out.note?.reset).toEqual([CRECIPES[r]!.id]);
    const back = deserialize(out.data, source());
    expect([...back.ents.sorted()].filter((e) => e.def === kiln && recipeOf(e.cfg) === r + 1)).toHaveLength(0);
  });
});
