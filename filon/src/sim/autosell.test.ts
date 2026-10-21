// autosell.test.ts — auto-sell (cm_autosell, D127; D164, owner, 2026-10-21: « the core can only store
// 10k of each item. If an item arrives and would be 10'001, it's sold instead with a tax of 50% »):
// the switch as a logged command (an older log's threshold reads as on); what comes beyond the Core's
// cap set aside as it arrives and sold at the minute's end at the bid less half, on the ledger and in
// the purse's journal; the Core never holding more than its cap, its line never backing up; saves
// (what was set aside included, an older save's threshold read as on); and the catch-up, bit for bit.
import { describe, it, expect } from 'vitest';
import { BAL } from '@/content/balance';
import { itemIdx } from '@/content/registry';
import { afterFee, valueCents } from '@/market/pricing';
import { replay } from './commands';
import { EPOCH } from './constants';
import type { ReservoirNode } from './flow/nodes';
import { catchUp } from './offline/catchup';
import { deserialize, serialize } from './serialize';
import type { Sim } from './state';
import { UNCAPPED } from './systems/trade';
import { drillToHearth, steadyPower, testSim, testSource, IRON } from './testkit';

/** Auto-sell learnt outside the commands (a research: a test colony is not replayed from its founding). */
const learn = (sim: Sim): Sim => { sim.done.add('cm_autosell'); sim.rebuildDerived(); return sim; };
/** Ticks to the next minute's end (its trade, the sale included, runs on the tick that reaches it). */
const toEnd = (sim: Sim): number => EPOCH - (sim.tick % EPOCH);
/** Give the Core `n` whole items of an item in all (a grant, logged). */
const fill = (sim: Sim, item: string, n: number): void => sim.grant(item, n - Math.floor(sim.stock[itemIdx(item)]! / 1000));
const autoLines = (sim: Sim) => sim.trade.ledger.filter((l) => l.kind === 'autoSell');
/** A base whose drill brings ore to a Core already full of it. */
const fullOfOre = (auto: boolean): Sim => {
  const s = learn(testSim());
  s.skipTutorial();
  steadyPower(s);
  drillToHearth(s);
  fill(s, 'iron_ore', s.hearthCap() / 1000);
  if (auto) expect(s.setAutoSell('iron_ore', true)).toBe(true);
  return s;
};

describe('auto-sell (D127, D164)', () => {
  it('is switched on and off by a logged command, only once researched, and replays; an older log’s threshold reads as on', () => {
    const a = testSim();
    a.skipTutorial();
    expect(a.setAutoSell('iron_plate', true), 'not researched').toBe(false);
    learn(a);
    expect(a.setAutoSell('iron_plate', true)).toBe(true);
    expect(a.setAutoSell('iron_plate', true), 'nothing changes').toBe(false);
    expect(a.setAutoSell('water', true), 'a fluid never reaches the Crier').toBe(false);
    expect(a.setAutoSell('glass', true)).toBe(true);
    expect(a.setAutoSell('glass', false)).toBe(true);
    expect(a.setAutoSell('glass', false), 'already off').toBe(false);
    expect([...a.trade.autoSell.keys()]).toEqual([itemIdx('iron_plate')]);
    expect(a.log.filter((l) => l.cmd.k === 'autoSell').map((l) => l.cmd)).toEqual([
      { k: 'autoSell', item: 'iron_plate', at: 0 }, { k: 'autoSell', item: 'glass', at: 0 }, { k: 'autoSell', item: 'glass', at: null },
    ]);
    fill(a, 'iron_plate', a.hearthCap() / 1000);
    a.run(3 * EPOCH);
    const b = learn(testSim());
    replay(b, a.log, a.tick);
    expect(b.hash()).toBe(a.hash());
    expect(autoLines(b)).toEqual(autoLines(a));
    // A log from before D164 held a threshold: on.
    const c = learn(testSim());
    replay(c, [{ tick: c.tick, cmd: { k: 'autoSell', item: 'iron_ore', at: 2000 } }]);
    expect(c.trade.autoSell.has(IRON())).toBe(true);
  });

  it('sets aside what comes beyond the cap as it arrives, and sells it at the minute’s end at the bid less half', () => {
    const sim = fullOfOre(true);
    const cap = sim.hearthCap();
    sim.run(toEnd(sim));
    sim.trade.ledger.length = 0;
    const credits = sim.credits, journal = sim.purseLog.autoSell, sold0 = sim.trade.soldTotal[IRON()]!;
    // A minute tick by tick: the Core holds its cap, never more; what came beyond waits to be sold.
    let bid = 0;
    for (let k = 0; k < EPOCH; k++) {
      if (k === EPOCH - 1) bid = sim.prices.bid[IRON()]!;
      sim.run(1);
      expect(sim.stock[IRON()]!).toBeLessThanOrEqual(cap);
    }
    expect(sim.stock[IRON()]).toBe(cap);
    const [l] = autoLines(sim);
    expect(l, 'one sale at the minute’s end').toBeDefined();
    expect(l!.mu % 1000).toBe(0);
    expect(l!.mu).toBeGreaterThan(0);
    const cents = afterFee(valueCents(l!.mu, bid, 'sell'), 'sell', BAL.autoSell.fee);
    expect(l!.cents).toBe(cents);
    expect(sim.credits - credits).toBe(cents);
    expect(sim.purseLog.autoSell - journal).toBe(cents);
    expect(sim.trade.soldTotal[IRON()]! - sold0).toBe(l!.mu);
    // Half the bid: less than a sale from the Core's stock (its 40 %, D126).
    expect(cents).toBeLessThan(afterFee(valueCents(l!.mu, bid, 'sell'), 'sell', BAL.coreSellFee));
    expect(sim.trade.autoPend.get(IRON()) ?? 0).toBeLessThan(1000); // a part of an item waits
  });

  it('never backs its line up: the full Core refuses the ore, the auto-sold one takes it all (D164)', () => {
    const full = fullOfOre(false), sold = fullOfOre(true);
    sold.ensureCompiled();
    expect((sold.graph.hearth as ReservoirNode).capOf(IRON())).toBe(UNCAPPED); // taken beyond the cap
    expect((sold.graph.hearth as ReservoirNode).capOf(itemIdx('iron_plate'))).toBe(sold.hearthCap());
    const p0 = [full.produced[IRON()]!, sold.produced[IRON()]!];
    for (let m = 0; m < 5; m++) {
      full.run(EPOCH);
      sold.run(EPOCH);
      expect(sold.stock[IRON()]).toBe(sold.hearthCap());
    }
    expect(full.stock[IRON()]).toBe(full.hearthCap());
    const madeFull = full.produced[IRON()]! - p0[0]!, madeSold = sold.produced[IRON()]! - p0[1]!;
    expect(madeSold).toBeGreaterThan(madeFull + 20_000);
    expect(autoLines(sold).length).toBeGreaterThanOrEqual(5);
    // Switched off, the cap is back.
    expect(sold.setAutoSell('iron_ore', false)).toBe(true);
    sold.ensureCompiled();
    expect((sold.graph.hearth as ReservoirNode).capOf(IRON())).toBe(sold.hearthCap());
  });

  it('keeps its settings and what it set aside through a save; an older save’s threshold reads as on; acts only while researched', () => {
    const sim = learn(testSim());
    sim.setAutoSell('iron_plate', true);
    sim.setAutoSell('glass', true);
    sim.trade.autoPend.set(itemIdx('glass'), 2500);
    const back = deserialize(JSON.parse(JSON.stringify(serialize(sim))), testSource());
    expect([...back.trade.autoSell]).toEqual([...sim.trade.autoSell]);
    expect([...back.trade.autoPend]).toEqual([[itemIdx('glass'), 2500]]);
    expect(back.hash()).toBe(sim.hash());
    // A save from before D127 has no field: nothing switched on; one from before D164 held a threshold.
    const old = serialize(learn(testSim()));
    expect(old.trade!.autoSell).toBeUndefined();
    expect(deserialize(old, testSource()).trade.autoSell.size).toBe(0);
    old.trade!.autoSell = [[itemIdx('glass'), 4000]];
    expect([...deserialize(old, testSource()).trade.autoSell]).toEqual([[itemIdx('glass'), 0]]);
    // Without the research the setting stays but sells nothing and lifts no cap.
    sim.trade.autoPend.clear();
    sim.done.delete('cm_autosell');
    sim.rebuildDerived();
    sim.ensureCompiled();
    expect((sim.graph.hearth as ReservoirNode).capOf(itemIdx('iron_plate'))).toBe(sim.hearthCap());
    fill(sim, 'iron_plate', sim.hearthCap() / 1000 + 50);
    sim.run(2 * EPOCH);
    expect(autoLines(sim)).toHaveLength(0);
  });

  it('online ≈ offline: an auto-sold line over two hours, bit for bit — the same sales, ocelles and state', () => {
    const build = (): Sim => {
      const s = learn(testSim());
      s.skipTutorial();
      steadyPower(s);
      drillToHearth(s);
      fill(s, 'iron_ore', s.hearthCap() / 1000 - 40); // the cap reached a little way in
      s.setAutoSell('iron_ore', true);
      s.setAutoSell('iron_plate', true); // none comes: nothing to sell, its cap lifted all the same
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
    expect([...off.trade.autoPend]).toEqual([...on.trade.autoPend]);
    expect(off.hash()).toBe(on.hash());
    expect(rep.incidents.filter((i) => i.kind === 'storageFull')).toEqual([]);
  });
});
