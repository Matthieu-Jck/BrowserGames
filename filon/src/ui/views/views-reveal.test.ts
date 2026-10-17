// views-reveal.test.ts — the specialised views (D88) come with the tutorial (D32): each with the
// quest whose trouble it shows, none before the smelter — so no selector on screen in the first
// quests — and all of them once the tutorial is over or skipped (`revealed` null). Vent (D95) is
// no quest's: it comes with the Anémométrie plan, tutorial or not.
import { describe, it, expect } from 'vitest';
import type { MapView } from '@/core/kinds';
import { QUEST_IDS } from '@/content/quests';
import { revealed } from '@/sim/systems/quests';
import { testSim } from '@/sim/testkit';
import { analyticsOn } from '../analytics';

const VIEWS: readonly Exclude<MapView, 'normal' | 'wind'>[] = ['production', 'power', 'logistics', 'land'];

describe('the views the tutorial offers', () => {
  it('none before the smelter; Production and Électricité with it (D101: the night its drills will see), Logistique with the glassworks, Terrain with the quartz', () => {
    const sim = testSim(undefined, { plans: false });
    const from: Record<string, string> = {};
    for (let q = 0; q < QUEST_IDS.length; q++) {
      sim.quests.cur = q; // a rig: the quest current, nothing else
      const rv = revealed(sim)!;
      for (const v of VIEWS) if (rv.has(`view:${v}`) && !from[v]) from[v] = QUEST_IDS[q]!;
    }
    expect(from).toEqual({ production: 'bloom_kiln', power: 'bloom_kiln', logistics: 'glassworks', land: 'wall_quartz' });
    sim.quests.cur = QUEST_IDS.indexOf('first_strike');
    expect(VIEWS.some((v) => revealed(sim)!.has(`view:${v}`))).toBe(false);
    sim.quests.cur = QUEST_IDS.length; // the tutorial over: everything shows
    expect(revealed(sim)).toBe(null);
  });

  it('Vent with the Anémométrie plan, and only with it', () => {
    const sim = testSim(undefined, { plans: false });
    expect(analyticsOn(sim, 'wind')).toBe(false);
    sim.done.add('anemometry');
    sim.rebuildDerived();
    expect(analyticsOn(sim, 'wind')).toBe(true);
  });
});
