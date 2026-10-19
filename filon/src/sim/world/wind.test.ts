// wind.test.ts — the wind (D95): a pure function of the world clock and of the land as the world
// made it; logical where it blows (tops and open ground windy, the lee of a wall, a bowl calm, a
// pass funnelled); a turbine's curve; the same online and offline.
import { describe, it, expect } from 'vitest';
import { BAL } from '@/content/balance';
import { buildingDef, buildingIdx, itemIdx } from '@/content/registry';
import { CIRQUE, MAPS, WORLD_SEED } from '@/content/world';
import { CENTER, DAY_EPOCHS, WORLD_EPOCH0 } from '../constants';
import { catchUp } from '../offline/catchup';
import { weatherAt, windKw, windSite } from '../power/network';
import { windiest, windOutlook } from '../readouts/wind';
import { Sim } from '../state';
import { learnPlans, wire } from '../testkit';
import { T } from '../types';
import { FlatSource } from './grid';
import { MapGen } from './mapgen';
import { bearingOf, curveShare, meanExposure, prevailing, veerOf, windAt, windField, WindField } from './wind';

const FLOWER = buildingDef(buildingIdx('wind_flower')).gen!;
const PITCH = buildingDef(buildingIdx('pitch_turbine')).gen!;
const W = BAL.wind;

/** Bearing 0: the wind from the east (the upwind side is +x). */
const EAST = 0;

/** A flat land with: a north–south wall (level 3), a bowl (a ring of level-2 rock), a pass between two massifs along the wind. */
function land(): FlatSource {
  const r = (x: number, y: number, w: number, h: number, level: number) => ({ x, y, w, h, t: T.Rock3, level });
  return new FlatSource([], [
    r(600, 400, 4, 60, 3), // the wall
    r(790, 790, 21, 2, 2), r(790, 809, 21, 2, 2), r(790, 790, 2, 21, 2), r(809, 790, 2, 21, 2), // the bowl round (800, 800)
    r(300, 300, 60, 6, 3), r(300, 312, 60, 6, 3), // the pass: y 306–311 between them, open to the east
  ]);
}

describe('the wind (D95): the time', () => {
  it('is a pure function of the epoch and the seed, rounded to its step, within the curve × mood × gust bounds', () => {
    const e0 = WORLD_EPOCH0 + 1234;
    const lo = Math.min(...W.curve) * W.moodLow * 700, hi = Math.max(...W.curve) * W.moodHigh * 1300;
    const seen = new Set<number>();
    for (let k = 0; k < 7 * DAY_EPOCHS; k++) {
      const w = windAt(e0 + k, WORLD_SEED);
      expect(w).toBe(windAt(e0 + k, WORLD_SEED));
      expect(w % W.step).toBe(0);
      expect(w * 1e6).toBeGreaterThanOrEqual(lo - W.step * 1e6);
      expect(w * 1e6).toBeLessThanOrEqual(hi + W.step * 1e6);
      seen.add(w);
    }
    // A week holds few distinct winds (the catch-up solves its grids once per weather).
    expect(seen.size).toBeLessThan(60);
    // The gust variance research narrows the swing.
    const spread = (v: number): number => { const a = Array.from({ length: 360 }, (_, k) => windAt(e0 + k, WORLD_SEED, v)); return Math.max(...a) - Math.min(...a); };
    expect(spread(300)).toBeLessThan(spread(1000));
  });

  it('blows from the prevailing bearing most days, a little either side on some; the weather carries it', () => {
    const b = prevailing(WORLD_SEED);
    const veers = [0, 0, 0];
    for (let d = 0; d < 400; d++) veers[veerOf(d, WORLD_SEED)]!++;
    expect(veers[1]!).toBeGreaterThan(veers[0]! + veers[2]!);
    expect(veers[0]!).toBeGreaterThan(40);
    expect(veers[2]!).toBeGreaterThan(40);
    expect(bearingOf(WORLD_SEED, 1)).toBe(b);
    expect((bearingOf(WORLD_SEED, 2) - b + 64) & 63).toBe(W.veer);
    const w = weatherAt(WORLD_EPOCH0 + 77, WORLD_SEED, { gustVariance: 1000 });
    expect(w.wind).toBe(windAt(WORLD_EPOCH0 + 77, WORLD_SEED));
    expect(w.veer).toBe(veerOf(Math.floor((WORLD_EPOCH0 + 77) / DAY_EPOCHS), WORLD_SEED));
  });
});

describe('the wind (D95): a turbine\'s curve', () => {
  it('nothing below cut-in, a cube up to rated, all of it above, nothing at cut-out; the pitch turbine starts sooner and never stops', () => {
    const c = FLOWER.wind!, p = PITCH.wind!;
    expect(curveShare(c, c.cutIn - 1)).toBe(0);
    expect(curveShare(c, c.rated)).toBe(1000);
    expect(curveShare(c, c.cutOut! - 1)).toBe(1000);
    expect(curveShare(c, c.cutOut!)).toBe(0);
    let last = 0;
    for (let v = c.cutIn; v <= c.rated; v += 25) { const s = curveShare(c, v); expect(s).toBeGreaterThanOrEqual(last); last = s; }
    for (let v = 0; v <= 6000; v += 50) expect(curveShare(p, v)).toBeGreaterThanOrEqual(curveShare(c, v));
    expect(curveShare(p, 6000)).toBe(1000);
  });
});

describe('the wind (D95): the place', () => {
  const f = new WindField(land());
  const open = f.at(700, 430, EAST);

  it('open flat ground, nothing upwind: the base and the open fetch', () => {
    expect(open).toBe(W.base + W.openGain);
  });

  it('a wall: windy on its top, calm close in its lee, recovering farther off', () => {
    const top = f.at(601, 430, EAST), near = f.at(596, 430, EAST), far = f.at(572, 430, EAST);
    expect(top).toBeGreaterThan(open + 500);
    expect(near * 1000).toBeLessThan(open * 300);
    expect(far).toBeGreaterThan(near * 3);
    expect(far).toBeLessThan(open);
    // Why: the lee's reading points at the wall.
    const x = f.explain(596, 430, EAST);
    expect(x.shelter).toBe(W.shelterMax);
    expect(x.lee % 1024).toBeGreaterThanOrEqual(600);
    // Upwind of the wall it makes no difference.
    expect(f.at(640, 430, EAST)).toBe(open);
  });

  it('a bowl: calm inside, whatever the wind', () => {
    for (const b of [0, 16, 32, 48]) {
      const x = f.explain(800, 800, b);
      expect(x.basin).toBe(1000);
      expect(x.e * 1000).toBeLessThan(open * 500);
    }
  });

  it('a pass along the wind funnels it: windier than open ground; across the wind the same gap is a lee', () => {
    const along = f.explain(330, 308, EAST);
    expect(along.funnel).toBe(true);
    expect(along.e).toBeGreaterThan(open);
    const across = f.explain(330, 308, 16); // the wind from the south: the southern massif upwind
    expect(across.funnel).toBe(false);
    expect(across.e * 2).toBeLessThan(open);
  });

  it('reads the land as the world made it: a dig moves no wind; a turbine on land dug since stands at its real level', () => {
    const sim = new Sim({ worldSeed: 7, playerSeed: 11, source: land(), foundingEpoch: WORLD_EPOCH0 + 24 });
    const g = windField(sim.grid.source);
    const before = g.at(596, 430, EAST);
    sim.grid.setLevel(601, 430, 0); // a notch dug in the wall
    expect(windField(sim.grid.source).at(596, 430, EAST)).toBe(before);
    // On the wall's top, dug down to the floor: the readings at level 0 there.
    for (let y = 429; y <= 430; y++) for (let x = 600; x <= 601; x++) sim.grid.setLevel(x, y, 0);
    const site = windSite(sim.grid, 7, { def: buildingIdx('wind_flower'), x: 600, y: 429, rot: 0 });
    const onTop = windSite(new Sim({ worldSeed: 7, playerSeed: 11, source: land(), foundingEpoch: WORLD_EPOCH0 + 24 }).grid, 7, { def: buildingIdx('wind_flower'), x: 600, y: 429, rot: 0 });
    expect(site[1]).toBeLessThan(onTop[1]);
  });

  it('two fields of the same land read the same, chunk by chunk', () => {
    const a = new WindField(new MapGen(WORLD_SEED, 1)), b = new WindField(new MapGen(WORLD_SEED, 1));
    const cx = CENTER >> 5, cy = CENTER >> 5;
    expect(Array.from(a.chunk(cx, cy, 5))).toEqual(Array.from(b.chunk(cx + 0, cy, 5)));
    // Read tile by tile in another order: the same values.
    for (let i = 0; i < 64; i++) expect(b.at(cx * 32 + ((i * 7) & 31), cy * 32 + ((i * 13) & 31), 5)).toBe(a.at(cx * 32 + ((i * 7) & 31), cy * 32 + ((i * 13) & 31), 5));
  });
});

describe('the wind (D95): on the real maps', () => {
  /** A turbine's mean output over a week (kW) at an exposure (its three bearings alike). */
  const weekKw = (e: number): number => {
    let s = 0;
    const n = 7 * DAY_EPOCHS;
    for (let k = 0; k < n; k++) s += windKw(FLOWER.kw, FLOWER.wind!, [e, e, e], weatherAt(WORLD_EPOCH0 + 500 + k, WORLD_SEED, { gustVariance: 1000 }));
    return s / n;
  };

  it.each(Object.keys(MAPS).map(Number))('map %i: the Crown\'s windiest spot gives near its rating yet under half a steam boiler, the cirque\'s floor clearly less than the old cirque', (mapV) => {
    const src = new MapGen(WORLD_SEED, 1, mapV);
    const sim = new Sim({ worldSeed: WORLD_SEED, playerSeed: 1, source: src, foundingEpoch: WORLD_EPOCH0 + 24 });
    learnPlans(sim);
    const R = (src.crownOuter ?? CIRQUE.crownOuter) + 1;
    const best = windiest(sim, 'wind_flower', CENTER, CENTER, R, 1)[0]!;
    // The best spot runs near the turbine's rating over a week, and still under half a steam
    // boiler (D116: the wind is the free power, not the strong one; under a coal generator's 300 kW
    // until D143 retired it). The old model gave 120 kW × 0.25 down in the cirque.
    expect(weekKw(best[2])).toBeGreaterThan(0.8 * FLOWER.kw);
    expect(weekKw(best[2])).toBeLessThan(buildingDef(buildingIdx('steam_boiler')).gen!.kw / 2);
    const f = windField(src), b = prevailing(WORLD_SEED);
    const floor: number[] = [];
    for (let y = CENTER - 20; y <= CENTER + 20; y += 2) for (let x = CENTER - 20; x <= CENTER + 20; x += 2) if (f.level(x, y) === 0) floor.push(f.at(x, y, b));
    floor.sort((p, q) => p - q);
    expect(weekKw(floor[floor.length >> 1]!)).toBeLessThan(30 * 0.75);
    // What the view's outlook says at that spot is what a turbine standing there gives.
    const o = windOutlook(sim, 'wind_flower', best[0], best[1], 0);
    expect(o.overall).toBe(best[2]);
    expect(o.full).toBe(FLOWER.kw);
  });

  it('a turbine\'s exposure is its footprint\'s mean, by the day\'s bearing', () => {
    const src = new MapGen(WORLD_SEED, 2);
    const sim = new Sim({ worldSeed: WORLD_SEED, playerSeed: 2, source: src, foundingEpoch: WORLD_EPOCH0 + 24 });
    const f = windField(src);
    const site = windSite(sim.grid, WORLD_SEED, { def: buildingIdx('wind_flower'), x: CENTER + 25, y: CENTER - 3, rot: 0 });
    for (let v = 0; v < 3; v++) {
      const b = bearingOf(WORLD_SEED, v);
      let s = 0;
      for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) s += f.at(CENTER + 25 + i, CENTER - 3 + j, b);
      expect(site[v]).toBe(Math.floor(s / 4));
    }
    expect(meanExposure(site)).toBeGreaterThanOrEqual(Math.min(...site));
    expect(meanExposure(site)).toBeLessThanOrEqual(Math.max(...site));
  });
});

describe('the wind (D95): online ≈ offline', () => {
  /** A drill line on a grid fed by three turbines (a top, open ground, a lee): the wind decides how fast it mines. */
  function windBase(): Sim {
    const sim = new Sim({
      worldSeed: 7, playerSeed: 11, foundingEpoch: WORLD_EPOCH0 + 24,
      source: new FlatSource([{ x: 508, y: 498, w: 10, h: 6, item: itemIdx('iron_ore'), rich: 500 }], [{ x: 520, y: 506, w: 4, h: 4, t: T.Rock1, level: 1 }]),
    });
    learnPlans(sim);
    for (const [it, n] of [['iron_plate', 400], ['glass', 100], ['copper_wire', 200]] as const) sim.grant(it, n);
    const ids: number[] = [];
    for (const [def, x, y] of [['wind_flower', 520, 506], ['wind_flower', 503, 516], ['wind_flower', 516, 514]] as const) {
      const r = sim.place(def, x, y, 0);
      if (!r.ok) throw new Error(`${def} ${r.reason}`);
      ids.push(r.id!);
    }
    sim.run(1200); // kites
    wire(sim, ids);
    const d = sim.place('drill', 511, 502, 2);
    if (!d.ok) throw new Error(`drill ${d.reason}`);
    wire(sim, d.id!);
    const n = sim.placeBelts('ribbon', [[512, 504, 3], ...[0, 1, 2, 3, 4, 5].map((i) => [511, 504 + i, 2] as [number, number, 2])]);
    if (n !== 7) throw new Error(`belts ${n}`);
    sim.run(300);
    return sim;
  }

  it('the grid\'s renewables each epoch are the weather\'s, ticking or catching up; a day\'s ore within 2 %', () => {
    const a = windBase(), b = windBase();
    a.ensureCompiled();
    const turbines = a.graph.nets.flatMap((n) => n.producers).filter((p) => p.kind === 'wind');
    expect(turbines.length).toBe(3);
    expect(new Set(turbines.map((p) => p.local[1])).size).toBe(3); // three different places, three winds
    const ore0 = a.stock[itemIdx('iron_ore')]!;
    for (let m = 0; m < DAY_EPOCHS; m++) {
      a.run(600);
      const w = weatherAt(a.absEpoch(), a.worldSeed, a.mods);
      let R = 0;
      for (const p of a.graph.nets[0]!.producers) if (p.kind === 'wind') R += windKw(p.kw, p.curve!, p.local, w);
      expect(R).toBeGreaterThanOrEqual(0);
    }
    catchUp(b, DAY_EPOCHS * 600, { noDirect: true });
    expect(b.tick).toBe(a.tick);
    const got = (s: Sim): number => (s.stock[itemIdx('iron_ore')]! - ore0) / 1000;
    expect(got(a)).toBeGreaterThan(10);
    expect(Math.abs(got(b) - got(a)) / got(a)).toBeLessThan(0.02);
  });
});
