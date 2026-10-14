// build-bar.test.ts — the build bar shows only what is unlocked (owner, D27): a tray lists the
// unlocked buildings of its category in content order, a category with nothing unlocked has no
// tab, and the hotkeys follow what is shown.
import { describe, it, expect } from 'vitest';
import type { Sim } from '@/sim/state';
import { buildingDef, buildingIdx } from '@/content/registry';
import { CATEGORIES, shownCategories, trayOf, unlockedTray } from './build-bar';
import { testSim } from '@/sim/testkit';

/** A colony that has learnt exactly `done` (plus what every colony starts with). */
const colony = (done: readonly string[]): Sim => ({ unlocked: (u: string) => u === 'start' || done.includes(u) }) as unknown as Sim;
const unlockOf = (id: string): string => buildingDef(buildingIdx(id)).unlock;

describe('build bar', () => {
  it('a tray lists only the unlocked buildings of its category, in content order', () => {
    const fresh = colony([]);
    for (const cat of CATEGORIES) {
      const shown = unlockedTray(fresh, cat);
      expect(shown, cat).toEqual(trayOf(cat).filter((id) => unlockOf(id) === 'start'));
      expect(shown.every((id) => unlockOf(id) === 'start'), cat).toBe(true);
    }
  });

  it('a building appears once its research is learnt', () => {
    const locked = trayOf('energy').find((id) => unlockOf(id) !== 'start' && unlockOf(id) !== 'never');
    expect(locked).toBeDefined();
    expect(unlockedTray(colony([]), 'energy')).not.toContain(locked);
    expect(unlockedTray(colony([unlockOf(locked!)]), 'energy')).toContain(locked);
  });

  it('a category with nothing unlocked has no tab; Shift+n counts the tabs shown', () => {
    expect(shownCategories(colony([]))).toEqual(CATEGORIES.filter((c) => trayOf(c).some((id) => unlockOf(id) === 'start')));
    const nothing = { unlocked: () => false } as unknown as Sim;
    expect(shownCategories(nothing)).toEqual([]);
  });

  it('during the tutorial the bar waits for quest 1; then its tabs follow what is unlocked, skipped or not (D32, D33)', () => {
    const sim = testSim(undefined, { plans: false }); // a new player's base: only the starting kit
    expect(shownCategories(sim)).toEqual([]); // quest 0: only the naming
    sim.nameColony('Test');
    expect(shownCategories(sim)).toEqual(['extraction', 'logistics', 'energy']); // drill, ribbon, pole
    sim.skipTutorial(); // skipping shows the whole interface, not what is still locked in the tree
    expect(shownCategories(sim)).toEqual(['extraction', 'logistics', 'energy']);
    sim.grant('iron_plate', 50);
    expect(sim.unlockPlan('router').ok).toBe(true);
    expect(shownCategories(sim)).toEqual(['extraction', 'logistics', 'distribution', 'energy']);
    expect(unlockedTray(sim, 'distribution')).toEqual(['router']);
  });

  it('at the start only the drill, the ribbon and the pole are offered; each plan adds its building to its tray', () => {
    const sim = testSim(undefined, { plans: false });
    sim.skipTutorial();
    const all = CATEGORIES.flatMap((c) => unlockedTray(sim, c));
    expect(all).toEqual(['drill', 'ribbon', 'mast']);
    sim.grant('iron_plate', 100); sim.grant('glass', 20); sim.grant('copper_wire', 20);
    for (const id of ['kiln', 'workshop', 'wind_flower']) expect(sim.unlockPlan(id).ok, id).toBe(true);
    expect(unlockedTray(sim, 'production')).toEqual(['kiln', 'workshop']);
    expect(unlockedTray(sim, 'energy')).toEqual(['mast', 'wind_flower']);
    // Not before its prerequisite (the observatory needs the workshop's plan, which it now has).
    expect(unlockedTray(sim, 'production')).not.toContain('observatory');
  });
});
