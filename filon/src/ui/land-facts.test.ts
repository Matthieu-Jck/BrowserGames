// land-facts.test.ts — what the land panel says about a parcel (land-facts.ts): its name on the
// map from the Heart's parcel, who holds it and how, what it holds tile by tile, the buildings on
// it; and the land mode's tool (input/land-tool.ts): a click picks, Esc lets the parcel go first.
import { afterEach, describe, expect, it } from 'vitest';
import { itemIdx } from '@/content/registry';
import { setLocale } from '@/i18n/i18n';
import { LandTool } from '@/input/land-tool';
import { CENTER } from '@/sim/constants';
import { Sim } from '@/sim/state';
import { testSim, testSource } from '@/sim/testkit';
import { PARCEL, parcelAt } from '@/sim/world/land';
import { buildingsOn, ownsForGood, parcelContents, parcelLabel, parcelState, parcelUnder } from './land-facts';

const HOME = parcelAt(CENTER, CENTER);
const EAST3 = parcelAt(CENTER + 3 * PARCEL, CENTER);

describe('land facts', () => {
  afterEach(() => setLocale('fr'));

  it('names a parcel by its offset from the Heart’s, north / south first', () => {
    setLocale('fr');
    expect(parcelLabel(HOME)).toBe('Cœur');
    expect(parcelLabel(EAST3)).toBe('3 E');
    expect(parcelLabel(parcelAt(CENTER - 2 * PARCEL, CENTER - PARCEL))).toBe('1 N · 2 O');
    setLocale('en');
    expect(parcelLabel(parcelAt(CENTER - 2 * PARCEL, CENTER + PARCEL))).toBe('1 S · 2 W');
    expect(parcelLabel(HOME)).toBe('Core');
  });

  it('says who holds a parcel: the starting square, bought, leased, or for sale', () => {
    const sim = testSim();
    expect(parcelState(sim, HOME)).toBe('start');
    expect(ownsForGood('start')).toBe(true);
    const east2 = parcelAt(CENTER + 2 * PARCEL, CENTER); // touching the 3 × 3 starting square (D74)
    expect(parcelState(sim, east2)).toBe('free');
    sim.grantCredits(1_000_000);
    expect(sim.buyLand(east2)).toBeNull();
    expect(parcelState(sim, east2)).toBe('bought');
    sim.done.add('tr4');
    sim.rebuildDerived();
    const next = EAST3; // touching the parcel bought
    expect(sim.rentLand(next)).toBeNull();
    expect(parcelState(sim, next)).toBe('leased');
    expect(ownsForGood('leased')).toBe(false);
  });

  it('counts what a parcel holds, tile by tile, and each deposit by its ore — of the tiles explored', () => {
    const ore = itemIdx('copper_ore');
    const sim = new Sim({ worldSeed: 7, playerSeed: 11, foundingEpoch: testSim().foundingEpoch, source: testSource([{ x: CENTER + 12, y: CENTER - 4, w: 4, h: 4, item: ore, rich: 500 }]) });
    const east1 = parcelAt(CENTER + PARCEL, CENTER);
    const c = parcelContents(sim, east1);
    expect(c.tiles).toBe(PARCEL * PARCEL);
    expect(c.hidden).toBe(0); // inside the land explored at founding
    expect(c.floor + c.rock + c.water + c.salt + c.vent + c.dunes).toBe(c.tiles);
    expect(c.ores).toEqual([[ore, 16]]);
    // Ring 3 reaches past it: the fog keeps some tiles out of the counts.
    const far = parcelContents(sim, EAST3);
    expect(far.hidden).toBeGreaterThan(0);
    expect(far.hidden + far.floor + far.rock + far.water + far.salt + far.vent + far.dunes).toBe(far.tiles);
  });

  it('finds the buildings standing on a parcel, and clamps the pointer to the world', () => {
    const sim = testSim();
    expect(buildingsOn(sim, HOME)).not.toContain(sim.hearthId); // the Heart is never listed
    expect(parcelUnder(-5, -5)).toBe(parcelAt(0, 0));
    expect(parcelUnder(5000, 5000)).toBe(parcelAt(1023, 1023));
  });
});

describe('the land mode', () => {
  it('a click picks a parcel; Esc lets it go, then ends the mode', () => {
    const l = new LandTool();
    expect(l.click(3)).toBe(false); // off: nothing
    l.start();
    expect(l.click(3)).toBe(true);
    expect(l.click(3)).toBe(false); // the same one again
    expect(l.selected).toBe(3);
    expect(l.cancel()).toBe(true);
    expect([l.active, l.selected]).toEqual([true, -1]);
    expect(l.cancel()).toBe(true);
    expect(l.active).toBe(false);
    expect(l.cancel()).toBe(false);
  });
});
