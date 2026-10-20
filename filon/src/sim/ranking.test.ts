// ranking.test.ts — « Classement des concessions » (D153, systems/ranking.ts): the forty other claims
// on a ladder of values from the seeds alone, growing — the young fastest, the leaders slowest —; the
// standings ordered, the player's rank among them; drawn up at a base's first boundary, then every
// world hour, online and in the catch-up alike; a climb an event naming the claims passed; hard to top
// (the leaders grow too) but steady to climb.
import { describe, it, expect } from 'vitest';
import { BAL } from '@/content/balance';
import { COLONY_PROFILES } from '@/content/colonies';
import { WORLD_SEED } from '@/content/world';
import { makeColonies } from '@/market/colonies';
import { EPOCH } from './constants';
import { catchUp } from './offline/catchup';
import { deserialize, serialize } from './serialize';
import { rivals, rivalValue, standings } from './systems/ranking';
import { drillToHearth, steadyPower, testSim, testSource } from './testkit';

const DAY = 1440;

describe('the claims’ standings (D153)', () => {
  it('the forty claims of the market stand on a ladder from a claim just begun to the leader, the foot growing fastest', () => {
    const r = rivals(WORLD_SEED);
    const cols = makeColonies(WORLD_SEED);
    expect(r).toHaveLength(cols.length);
    r.forEach((x, i) => expect(x.colony).toBe(i));
    // Each colony's growth follows its profile's (the market's own).
    const byV0 = [...r].sort((a, b) => a.v0 - b.v0);
    expect(byV0[0]!.v0).toBe(BAL.ranking.floor);
    for (let k = 1; k < byV0.length; k++) expect(byV0[k]!.v0).toBe(Math.floor((byV0[k - 1]!.v0 * BAL.ranking.step) / 1000));
    expect(byV0.at(-1)!.v0).toBeGreaterThan(100_000_000); // the leader: over a million ◉
    const rel = (x: (typeof r)[number]): number => (x.g * BAL.ranking.growthRef) / Math.round(COLONY_PROFILES[cols[x.colony]!.profile].growth * 1000);
    expect(rel(byV0[0]!)).toBeGreaterThan(rel(byV0.at(-1)!) * 5);
    // Another world places them otherwise; the same world always alike.
    expect(rivals(WORLD_SEED + 1).map((x) => x.v0)).not.toEqual(r.map((x) => x.v0));
    expect(rivals(WORLD_SEED)).toBe(r);
  });

  it('their values grow from the founding, with a gentle day-to-day wobble', () => {
    for (const x of rivals(WORLD_SEED)) {
      expect(Math.abs(rivalValue(WORLD_SEED, x, 0) - x.v0)).toBeLessThanOrEqual((x.v0 * BAL.ranking.wobble) / 1000 + 1);
      expect(rivalValue(WORLD_SEED, x, 30 * DAY)).toBeGreaterThan(rivalValue(WORLD_SEED, x, 0));
      // An hour moves a claim by little: the standings change slowly.
      const h = rivalValue(WORLD_SEED, x, 61), h0 = rivalValue(WORLD_SEED, x, 1);
      expect(Math.abs(h - h0)).toBeLessThan(x.v0 / 20);
    }
  });

  it('the standings: every claim, the richest first; a new base last, steady to climb, hard to top', () => {
    const sim = testSim();
    const rankAt = (min: number, ocelles: number): number => standings(sim, sim.foundingEpoch + min, ocelles * 100).rank;
    const s = standings(sim, sim.foundingEpoch + 60, 1_000 * 100);
    expect(s.rows).toHaveLength(41);
    for (let k = 1; k < s.rows.length; k++) expect(s.rows[k - 1]!.value).toBeGreaterThanOrEqual(s.rows[k]!.value);
    expect(s.rows[s.rank - 1]!.colony).toBe(-1);
    // A new claim (~1 000 ◉, D153's measures) is last; the tutorial's base (~3 000) passes a few within the hour;
    // a base of a few hours (~25 000 ◉) stands mid-table; the leaders keep ahead of a million.
    expect(rankAt(5, 1_000)).toBe(41);
    expect(rankAt(60, 3_000)).toBeLessThanOrEqual(39);
    expect(rankAt(180, 25_000)).toBeGreaterThanOrEqual(20);
    expect(rankAt(180, 25_000)).toBeLessThanOrEqual(30);
    expect(rankAt(30 * DAY, 2_000_000)).toBeGreaterThan(1);
    // Each step up asks more, but a growing base keeps climbing.
    expect(rankAt(DAY, 100_000)).toBeLessThan(rankAt(DAY, 50_000));
  });

  it('drawn up at the first boundary, then each world hour; a climb is an event naming the claims passed', () => {
    const sim = testSim();
    sim.run(EPOCH);
    const first = sim.ranking.epoch;
    expect(first).toBe(sim.absEpoch());
    expect(sim.ranking.rank).toBe(41);
    // Not again before the world's next hour.
    while ((sim.absEpoch() + 1) % BAL.ranking.everyMin !== 0) sim.run(EPOCH);
    expect(sim.ranking.epoch).toBe(first);
    // A richer claim at the next hour: it climbs, and says whom it passed.
    sim.grantCredits(20_000 * 100);
    sim.events.length = 0;
    sim.run(EPOCH);
    expect(sim.ranking.epoch % BAL.ranking.everyMin).toBe(0);
    expect(sim.ranking.rank).toBeLessThan(41);
    expect(sim.ranking.best).toBe(sim.ranking.rank);
    const ev = sim.events.find((e) => e.k === 'rank');
    expect(ev).toMatchObject({ k: 'rank', rank: sim.ranking.rank, prev: 41, of: 41 });
    expect((ev as { passed: number[] }).passed).toHaveLength(41 - sim.ranking.rank);
    // Kept in the save (a statistic: not in the hash).
    const back = deserialize(JSON.parse(JSON.stringify(serialize(sim))), testSource());
    expect(back.ranking).toEqual(sim.ranking);
  });

  it('offline as online: two hours caught up draw up the same standings', () => {
    const build = () => { const s = testSim(); s.skipTutorial(); steadyPower(s); drillToHearth(s); s.run(300); return s; };
    const on = build(), off = build();
    on.run(72_000);
    catchUp(off, 72_000, { noDirect: true });
    expect(off.ranking).toEqual(on.ranking);
    expect(on.ranking.epoch % BAL.ranking.everyMin).toBe(0);
  });
});
