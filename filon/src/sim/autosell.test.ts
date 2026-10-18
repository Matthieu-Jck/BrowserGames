// autosell.test.ts — auto-sell (cm_autosell, D127; owner, 2026-10-18: « une amélioration de l'arbre
// permette de faire de la vente automatique des items qui arrivent en surplus dans le cœur »): the
// setting as a logged command within its bounds; the sale at a minute's end (the Core's surplus at
// the bid less 40 %, on the ledger and in the purse's journal); the Core taking a switched-on item
// uncapped, so its line never backs up; what it keeps (an open plan's need, a queued research's, the
// restart reserve); saves; and the catch-up, bit for bit with ticking.
import { describe, it, expect } from 'vitest';
import { BAL } from '@/content/balance';
import { PLAN_IDS, planDef } from '@/content/research';
import { itemIdx } from '@/content/registry';
import { afterFee, valueCents } from '@/market/pricing';
import { replay } from './commands';
import { EPOCH } from './constants';
import type { ReservoirNode } from './flow/nodes';
import { catchUp } from './offline/catchup';
import { deserialize, serialize } from './serialize';
import type { Sim } from './state';
import { planCost } from './systems/research';
import { UNCAPPED } from './systems/trade';
import { drillToHearth, steadyPower, testSim, testSource, IRON } from './testkit';

/** Auto-sell learnt outside the commands (a research: a test colony is not replayed from its founding). */
const learn = (sim: Sim): Sim => { sim.done.add('cm_autosell'); sim.rebuildDerived(); return sim; };
/** Ticks to the next minute's end (its trade, the sale included, runs on the tick that reaches it). */
const toEnd = (sim: Sim): number => EPOCH - (sim.tick % EPOCH);
/** Give the Core `n` whole items of an item in all (a grant, logged). */
const fill = (sim: Sim, item: string, n: number): void => sim.grant(item, n - Math.floor(sim.stock[itemIdx(item)]! / 1000));
const autoLines = (sim: Sim) => sim.trade.ledger.filter((l) => l.kind === 'autoSell');

describe('auto-sell (D127)', () => {
  it('is set by a logged command within its bounds, only once researched, and replays', () => {
    const a = testSim();
    a.skipTutorial();
    expect(a.setAutoSell('iron_plate', 1000), 'not researched').toBe(false);
    learn(a);
    const cap = a.hearthCap() / 1000;
    expect(a.setAutoSell('iron_plate', cap + 1), 'above the Core’s cap').toBe(false);
    expect(a.setAutoSell('iron_plate', BAL.autoSell.min - 1), 'below the floor').toBe(false);
    expect(a.setAutoSell('water', 1000), 'a fluid never reaches the Crier').toBe(false);
    expect(a.setAutoSell('iron_plate', 1.5), 'whole items').toBe(false);
    expect(a.setAutoSell('iron_plate', 2000)).toBe(true);
    expect(a.setAutoSell('iron_plate', 2000), 'nothing changes').toBe(false);
    expect(a.setAutoSell('iron_plate', cap)).toBe(true);
    expect(a.setAutoSell('glass', 300)).toBe(true);
    expect(a.setAutoSell('glass', null)).toBe(true);
    expect(a.setAutoSell('glass', null), 'already off').toBe(false);
    expect([...a.trade.autoSell]).toEqual([[itemIdx('iron_plate'), cap]]);
    expect(a.log.filter((l) => l.cmd.k === 'autoSell').map((l) => l.cmd)).toEqual([
      { k: 'autoSell', item: 'iron_plate', at: 2000 }, { k: 'autoSell', item: 'iron_plate', at: cap },
      { k: 'autoSell', item: 'glass', at: 300 }, { k: 'autoSell', item: 'glass', at: null },
    ]);
    fill(a, 'iron_plate', cap);
    a.setAutoSell('iron_plate', 1000);
    a.run(3 * EPOCH);
    const b = learn(testSim());
    replay(b, a.log, a.tick);
    expect(b.hash()).toBe(a.hash());
    expect(autoLines(b)).toEqual(autoLines(a));
  });

  it('sells what the Core holds beyond the threshold at the minute’s end, at the bid less the Core’s 40 %', () => {
    const sim = learn(testSim());
    sim.skipTutorial();
    const plate = itemIdx('iron_plate');
    fill(sim, 'iron_plate', 3000);
    expect(sim.setAutoSell('iron_plate', 1000)).toBe(true);
    sim.run(toEnd(sim) - 1);
    const before = sim.stock[plate]!, bid = sim.prices.bid[plate]!, credits = sim.credits, journal = sim.purseLog.autoSell;
    sim.run(1);
    const mu = before - 1_000_000;
    const cents = afterFee(valueCents(mu, bid, 'sell'), 'sell', BAL.coreSellFee);
    expect(mu).toBe(2_000_000);
    expect(sim.stock[plate]).toBe(1_000_000);
    expect(sim.credits - credits).toBe(cents);
    expect(sim.purseLog.autoSell - journal).toBe(cents);
    expect(autoLines(sim)).toEqual([{ epoch: sim.absEpoch(), post: sim.hearthId, item: plate, kind: 'autoSell', mu, cents }]);
    expect(sim.trade.soldTotal[plate]).toBe(mu);
    // A post's sale of the same would have kept 80 %: the Core's pays 60 % (D126).
    expect(cents).toBeLessThan(afterFee(valueCents(mu, bid, 'sell'), 'sell', BAL.tradeFee));
    // Nothing more while the Core holds no more than the threshold.
    sim.run(2 * EPOCH);
    expect(autoLines(sim)).toHaveLength(1);
  });

  it('takes a switched-on item in uncapped, so its line never backs up; the rest keep the Core’s cap', () => {
    const build = (auto: boolean): Sim => {
      const s = learn(testSim());
      s.skipTutorial();
      steadyPower(s);
      drillToHearth(s);
      fill(s, 'iron_ore', s.hearthCap() / 1000); // the Core full of ore
      if (auto) expect(s.setAutoSell('iron_ore', 4000)).toBe(true);
      s.run(toEnd(s));
      return s;
    };
    const full = build(false), sold = build(true);
    sold.ensureCompiled();
    const core = sold.graph.hearth as ReservoirNode;
    expect(core.capOf(IRON())).toBe(UNCAPPED);
    expect(core.capOf(itemIdx('iron_plate'))).toBe(sold.hearthCap());
    const p0 = [full.produced[IRON()]!, sold.produced[IRON()]!];
    for (let m = 0; m < 5; m++) {
      full.run(EPOCH);
      sold.run(EPOCH);
      // At each minute's end the Core holds its threshold again, what came beyond it sold.
      expect(sold.stock[IRON()]).toBe(4_000_000);
    }
    expect(full.stock[IRON()]).toBe(full.hearthCap());
    // The full Core refused the ore: its drill stood blocked once its ribbon filled; the auto-sold one ran on.
    const madeFull = full.produced[IRON()]! - p0[0]!, madeSold = sold.produced[IRON()]! - p0[1]!;
    expect(madeSold).toBeGreaterThan(madeFull + 20_000);
    expect(autoLines(sold).length).toBeGreaterThanOrEqual(5);
    // Switched off, the cap is back.
    expect(sold.setAutoSell('iron_ore', null)).toBe(true);
    sold.ensureCompiled();
    expect((sold.graph.hearth as ReservoirNode).capOf(IRON())).toBe(sold.hearthCap());
  });

  it('keeps what an open plan or a queued research costs, never more than the Core’s cap, never under the restart reserve', () => {
    // A new base (no plan taken): the open plans wait on their plates.
    const sim = learn(testSim(undefined, { plans: false }));
    const plate = itemIdx('iron_plate');
    sim.setAutoSell('iron_plate', BAL.autoSell.min);
    const open = PLAN_IDS.filter((id) => !sim.done.has(id) && planDef(id)!.prereq.every((q) => sim.done.has(q)));
    const need = Math.max(0, ...open.flatMap((id) => planCost(id).filter((c) => c.item === plate).map((c) => c.mu)));
    expect(need, 'an open plan costs plates').toBeGreaterThan(0);
    expect(sim.autoSellKeep(plate)).toBe(Math.max(sim.reserveFloor(plate), Math.min(sim.hearthCap(), Math.max(BAL.autoSell.min * 1000, need))));
    // A queued research's resources (D122): glass for the Solar Farm.
    const all = learn(testSim());
    const glass = itemIdx('glass');
    all.setAutoSell('glass', BAL.autoSell.min);
    expect(all.autoSellKeep(glass)).toBe(BAL.autoSell.min * 1000);
    all.labQueue.set(1, 'en_solarfarm');
    expect(all.autoSellKeep(glass)).toBe(120_000);
    // A threshold above what the Core may hold (an older setting) keeps the cap.
    all.trade.autoSell.set(glass, 1_000_000);
    expect(all.autoSellKeep(glass)).toBe(all.hearthCap());
  });

  it('keeps its settings through a save; acts only while researched', () => {
    const sim = learn(testSim());
    sim.setAutoSell('iron_plate', 1200);
    sim.setAutoSell('glass', 300);
    const back = deserialize(JSON.parse(JSON.stringify(serialize(sim))), testSource());
    expect([...back.trade.autoSell]).toEqual([...sim.trade.autoSell]);
    expect(back.hash()).toBe(sim.hash());
    // A save from before D127 has no field: nothing switched on.
    const old = serialize(learn(testSim()));
    expect(old.trade!.autoSell).toBeUndefined();
    expect(deserialize(old, testSource()).trade.autoSell.size).toBe(0);
    // Without the research the setting stays but sells nothing and lifts no cap.
    sim.done.delete('cm_autosell');
    sim.rebuildDerived();
    sim.ensureCompiled();
    expect((sim.graph.hearth as ReservoirNode).capOf(itemIdx('iron_plate'))).toBe(sim.hearthCap());
    fill(sim, 'iron_plate', 3000);
    sim.run(2 * EPOCH);
    expect(autoLines(sim)).toHaveLength(0);
  });

  it('online ≈ offline: an auto-sold line over two hours, bit for bit — the same sales, ocelles and state', () => {
    const build = (): Sim => {
      const s = learn(testSim());
      s.skipTutorial();
      steadyPower(s);
      drillToHearth(s);
      fill(s, 'iron_ore', 600);
      s.setAutoSell('iron_ore', 500);
      s.setAutoSell('iron_plate', 200); // the Core holds fewer: nothing to sell, its cap lifted all the same
      s.run(300);
      return s;
    };
    const on = build(), off = build();
    expect(off.hash()).toBe(on.hash());
    on.run(72_000);
    const rep = catchUp(off, 72_000, { noDirect: true });
    expect(off.tick).toBe(on.tick);
    expect(autoLines(on).length).toBeGreaterThan(100);
    expect(autoLines(off)).toEqual(autoLines(on));
    expect(off.credits).toBe(on.credits);
    expect(off.purseLog.autoSell).toBe(on.purseLog.autoSell);
    expect(Array.from(off.stock)).toEqual(Array.from(on.stock));
    expect(off.hash()).toBe(on.hash());
    expect(rep.incidents.filter((i) => i.kind === 'storageFull')).toEqual([]);
  });
});
