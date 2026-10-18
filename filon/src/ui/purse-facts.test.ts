// purse-facts.test.ts — the purse's figure is real (D102; owner: « il y a écrit −700 mais je
// gagne de l'argent »). Read from the engine's journal once a game minute, the headline is the
// purse's actual recurring change over the last hour, an hour; the lines (each post's sales by
// item, each standing order, the tokens with the servers' share, the fee, the rental, the rent)
// add up to it exactly; one-offs are told apart and never in it; a ledger that no longer holds a
// minute's lines leaves an « other trade » line, so the sum still holds. On the late debug base,
// over a real hour of play, the headline is the purse's change to the rounding of its lines.
import { describe, expect, it } from 'vitest';
import { itemIdx } from '@/content/registry';
import { EPOCH, WORLD_EPOCH0 } from '@/sim/constants';
import { foundScenario } from '@/sim/scenarios';
import { testSim } from '@/sim/testkit';
import type { Sim } from '@/sim/state';
import { PurseHistory, purseSummary } from './purse-facts';

/** A minute of a rigged base: the purse changed by `cents` of `kind`, booked as the engine does. */
function minute(sim: Sim, h: PurseHistory, flows: Array<[kind: 'sales' | 'orders' | 'tokens' | 'rent' | 'grant' | 'spotSell' | 'autoSell', cents: number, item?: number]>): void {
  sim.tick += EPOCH;
  for (const [kind, cents, item] of flows) {
    sim.credits += cents;
    sim.purseLog[kind] += cents;
    if (kind === 'sales' || kind === 'orders' || kind === 'spotSell') {
      sim.trade.ledger.push({ epoch: sim.absEpoch(), post: 9, item: item ?? 0, kind: kind === 'sales' ? 'export' : kind === 'orders' ? 'import' : 'spotSell', mu: 3000, cents });
    }
    if (kind === 'autoSell') sim.trade.ledger.push({ epoch: sim.absEpoch(), post: sim.hearthId, item: item ?? 0, kind: 'autoSell', mu: 2000, cents });
    if (kind === 'tokens') { sim.tokenStats.totalUsed += 1600; sim.tokenStats.totalBought += 1200; }
  }
  h.sample(sim);
}

const lineSum = (s: ReturnType<typeof purseSummary>): number => s.lines.reduce((a, l) => a + l.perHour, 0);

describe('the purse\'s figure', () => {
  it('waits for a minute, then reads what the minutes seen so far say, an hour', () => {
    const sim = testSim(), h = new PurseHistory();
    h.sample(sim);
    expect(purseSummary(sim, h).minutes).toBe(0);
    minute(sim, h, [['sales', 500, itemIdx('iron_plate')]]);
    const s = purseSummary(sim, h);
    expect(s.minutes).toBe(1);
    expect(s.total).toBe(500 * 60);
  });

  it('is the purse\'s real recurring change over the last hour; the lines add up to it; one-offs stay apart', () => {
    const sim = testSim(), h = new PurseHistory();
    const plate = itemIdx('iron_plate'), glass = itemIdx('glass');
    sim.trade.orders.push({ id: 4, post: 9, item: glass, perMin: 3, active: true } as never);
    h.sample(sim);
    // Ninety minutes: sales every minute, the order buying one minute in three (it switches with
    // the price), tokens, a rent each hour; a grant and a spot sale in the last hour.
    for (let m = 1; m <= 90; m++) {
      const f: Parameters<typeof minute>[2] = [['sales', 1200, plate], ['tokens', -40]];
      if (m % 3 === 0) f.push(['orders', -2500, glass]);
      if (m % 60 === 0) f.push(['rent', -900]);
      if (m === 70) f.push(['grant', 50_000], ['spotSell', 7_000, plate]);
      minute(sim, h, f);
    }
    const s = purseSummary(sim, h);
    expect(s.minutes).toBe(60);
    const from = h.samples[h.samples.length - 61]!, now = h.samples[h.samples.length - 1]!;
    // The purse's own change over that hour, less its one-offs: the headline, to the cent.
    expect(s.total).toBe(now.credits - from.credits - 50_000 - 7_000);
    expect(lineSum(s)).toBe(s.total);
    expect(s.oneOffs).toEqual([{ kind: 'spotSell', cents: 7_000 }, { kind: 'grant', cents: 50_000 }]);
    // The lines: the plates sold (3 a minute), the order (one minute in three), the token flow bought with the free share.
    const sale = s.lines.find((l) => l.kind === 'sale')!;
    expect(sale).toMatchObject({ item: plate, post: 9, perHour: 1200 * 60, perMin: 3 });
    expect(s.lines.find((l) => l.kind === 'order')).toMatchObject({ order: 4, item: glass, perHour: -2500 * 20, perMin: 1 });
    // The bought flow's tokens a minute (D118), the free share of all research's tokens on its chip (D122: the Core's compute, the servers).
    expect(s.lines.find((l) => l.kind === 'tokens')).toMatchObject({ perHour: -40 * 60, perMin: 1200, free: 250 });
    expect(s.lines.find((l) => l.kind === 'rent')!.perHour).toBe(-900);
    expect(s.drain).toMatchObject({ kind: 'order' });
    expect(s.spark.length).toBe(91);
  });

  it('a ledger that no longer holds every line leaves « other trade », and the lines still add up', () => {
    const sim = testSim(), h = new PurseHistory();
    h.sample(sim);
    for (let m = 1; m <= 10; m++) minute(sim, h, [['sales', 1000, itemIdx('iron_plate')]]);
    sim.trade.ledger.splice(0, 4); // the oldest four minutes' lines gone (the ledger keeps its last 2 000)
    const s = purseSummary(sim, h);
    expect(s.lines.find((l) => l.kind === 'trade')!.perHour).toBe(4000 * 6);
    expect(lineSum(s)).toBe(s.total);
    expect(s.total).toBe(1000 * 60);
  });

  it('the Core\'s auto-sales (D127) are lines of their own, by item, the most first, in the sum; their journal\'s rest goes to « other trade »', () => {
    const sim = testSim(), h = new PurseHistory();
    const plate = itemIdx('iron_plate'), ore = itemIdx('iron_ore');
    h.sample(sim);
    for (let m = 1; m <= 20; m++) minute(sim, h, [['sales', 1000, plate], ['autoSell', 300, ore], ['autoSell', m % 2 ? 900 : 0, plate]]);
    const s = purseSummary(sim, h);
    const auto = s.lines.filter((l) => l.kind === 'auto');
    expect(auto.map((l) => l.item)).toEqual([plate, ore]);
    expect(auto.map((l) => l.perHour)).toEqual([900 * 10 * 3, 300 * 60]);
    expect(auto[1]!.perMin).toBe(2);
    expect(auto.every((l) => l.post === undefined)).toBe(true); // not a post's: a section of its own
    expect(lineSum(s)).toBe(s.total);
    expect(s.total).toBe((1000 + 300) * 60 + 900 * 30);
    sim.trade.ledger.splice(0, sim.trade.ledger.findIndex((l) => l.kind === 'autoSell' && l.item === ore) + 1); // the first minute's lines gone
    const t = purseSummary(sim, h);
    expect(lineSum(t)).toBe(t.total);
    expect(t.lines.find((l) => l.kind === 'trade')!.perHour).toBeGreaterThan(0);
  });

  it('on the late debug base, over a real hour of play, the headline is the purse\'s change', () => {
    const { sim } = foundScenario('late', { playerSeed: 1, near: WORLD_EPOCH0 + 50_000, name: 'Essai' });
    const h = new PurseHistory();
    h.sample(sim);
    for (let m = 0; m < 62; m++) {
      for (let t = 0; t < EPOCH; t++) sim.step();
      h.sample(sim);
    }
    const s = purseSummary(sim, h);
    const from = h.samples[h.samples.length - 61]!, now = h.samples[h.samples.length - 1]!;
    expect(s.minutes).toBe(60);
    // No one-off in that hour: the purse's whole change, to the rounding of each line (a centi-◉ each).
    expect(s.oneOffs).toEqual([]);
    expect(Math.abs(s.total - (now.credits - from.credits))).toBeLessThanOrEqual(s.lines.length);
    expect(lineSum(s)).toBe(s.total);
    expect(s.lines.some((l) => l.kind === 'sale') && s.lines.some((l) => l.kind === 'order')).toBe(true);
  });
});
