// post-entrance.test.ts — a trade post's entrance takes its cargo's items too (D131; owner,
// 2026-10-18: « j'ai l'impression que le tradepost est bloqué si l'on essaie de mettre en entrée une
// ressource que l'on est en train d'importer, mais ça ne devrait pas être le cas. Tant pis pour le
// joueur »). Until then (D64) the entrance refused its cargo and a line bringing an item the post
// imported backed up there. Now the entrance takes every tradable item into a store of its own
// (`sim.selling`), sold at the minute's end, and the container keeps the purchases for the exit: the
// line runs, what it brings is sold, what was bought leaves by the exit — never the one for the other.
// Also: an older save's one store split as it was, and the catch-up against ticking.
import { describe, it, expect } from 'vitest';
import { itemIdx } from '@/content/registry';
import { EPOCH } from './constants';
import { catchUp } from './offline/catchup';
import { deserialize, serialize } from './serialize';
import type { Sim } from './state';
import { sellingOf } from './systems/trade';
import { stockedSilo, testSim, testSource, IRON } from './testkit';

/**
 * A post against the Core's east side (5×5, D62), fed at its entrance (517,514) from the south by a
 * silo of iron ore, its exit (517,510) led round into the Core's north inlet; it imports iron ore too
 * — the very item its entrance is fed. Returns the post's and the silo's ids.
 */
function rig(order = true): { sim: Sim; post: number; silo: number } {
  const sim = testSim();
  const p = sim.place('trade_post', 515, 510, 0);
  if (!p.ok) throw new Error(`trade post: ${p.reason}`);
  const silo = stockedSilo(sim, 517, 516, 0, 'iron_ore', 9000); // hands out north into (517,515)
  if (sim.placeBelts('ribbon', [[517, 515, 0]]) !== 1) throw new Error('feed');
  if (sim.placeBelts('ribbon', [[517, 509, 3], [516, 509, 3], [515, 509, 3], [514, 509, 3], [513, 509, 3], [512, 509, 2]]) !== 6) throw new Error('exit');
  sim.skipTutorial();
  if (order) {
    sim.grantCredits(1_000_000);
    if (typeof sim.addImport(p.id!, 'iron_ore', 10, 1_000_000) !== 'number') throw new Error('order');
  }
  sim.ensureCompiled();
  return { sim, post: p.id!, silo };
}

const siloOre = (s: Sim, silo: number): number => s.stores.get(silo)![IRON()]! / 1000;

describe('a trade post’s entrance takes what it imports too (D131)', () => {
  it('an imported item fed into the entrance is sold and never blocks; the cargo still leaves by the exit, never sold', () => {
    const { sim, post, silo } = rig();
    expect(sim.cargoOf(post)).toEqual([IRON()]);
    expect(sim.graph.postIn.get(post)!.accepts!.has(IRON())).toBe(true);
    const ore0 = siloOre(sim, silo), core0 = sim.stock[IRON()]!;
    sim.run(20 * EPOCH);
    // The line ran all along: about a ribbon's 60 a minute left the silo, not the few a full entrance would let by.
    const fed = ore0 - siloOre(sim, silo);
    expect(fed).toBeGreaterThan(20 * 50);
    // Every one the entrance took was sold (the minute's lift is 120: room for both), the purchases apart.
    const sold = sim.trade.soldTotal[IRON()]! / 1000, bought = sim.trade.boughtTotal[IRON()]! / 1000;
    expect(bought).toBeGreaterThan(100);
    expect(sold).toBeGreaterThan(fed - 70); // what is still on the ribbon or at the entrance, at most
    expect(sold).toBeLessThanOrEqual(fed);
    expect(sim.trade.ledger.filter((l) => l.kind === 'export' && l.item === IRON()).reduce((a, l) => a + l.mu, 0) / 1000).toBe(sold);
    // What was bought came out by the exit into the Core, or waits in the container, or is on the exit's ribbon or the way.
    const container = sim.stores.get(post)![IRON()]! / 1000;
    const flying = sim.trade.inflight.filter((f) => f.item === IRON()).reduce((a, f) => a + f.mu, 0) / 1000;
    const inCore = (sim.stock[IRON()]! - core0) / 1000;
    expect(inCore + container + flying).toBeGreaterThan(bought - 8); // the exit ribbon's six tiles and a stage
    expect(inCore + container + flying).toBeLessThanOrEqual(bought);
    // The two stores never mix: the entrance's holds only what came by its line, the container only purchases.
    expect(sellingOf(sim, post)[IRON()]! / 1000).toBeLessThanOrEqual(fed - sold);
  });

  it('before D131 the same line backed up: without the order the entrance takes it (the same), and with it the line is not slower', () => {
    const a = rig(true), b = rig(false);
    a.sim.run(10 * EPOCH);
    b.sim.run(10 * EPOCH);
    expect(siloOre(a.sim, a.silo)).toBe(siloOre(b.sim, b.silo));
    expect(a.sim.trade.soldTotal[IRON()]).toBe(b.sim.trade.soldTotal[IRON()]);
  });

  it('an older save’s one store is split as it was: its cargo stays in the container, the rest is what its entrance brought', () => {
    const { sim, post } = rig();
    const plate = itemIdx('iron_plate');
    sim.stores.get(post)![IRON()] = 30_000; // cargo: bought, waiting for the exit
    sellingOf(sim, post)[plate] = 12_000;   // brought by the entrance
    const d = serialize(sim);
    expect(d.selling).toBeDefined();
    // As a save from before D131 wrote it: one store, both in it, no `selling`.
    const old = JSON.parse(JSON.stringify(d)) as typeof d;
    const st = old.stores.find(([id]) => id === post)![1];
    st[plate] = 12_000;
    delete old.selling;
    const back = deserialize(old, testSource());
    expect(back.stores.get(post)![IRON()]).toBe(30_000);
    expect(back.stores.get(post)![plate]).toBe(0);
    expect(back.selling.get(post)![plate]).toBe(12_000);
    expect(back.selling.get(post)![IRON()]).toBe(0);
    expect(back.hash()).toBe(sim.hash());
    // And today's save comes back as it was.
    expect(deserialize(JSON.parse(JSON.stringify(d)), testSource()).hash()).toBe(sim.hash());
  });

  it('a post taken down gives both stores back to the Core', () => {
    const { sim, post } = rig();
    const coal = itemIdx('coal'); // nothing the post itself is built of: its refund is apart
    sellingOf(sim, post)[coal] = 7_000;
    sim.stores.get(post)![IRON()] = 4_000;
    const c0 = sim.stock[coal]!, i0 = sim.stock[IRON()]!;
    const e = sim.ents.get(post)!;
    expect(sim.remove(e.x, e.y)).toBe(true);
    expect(sim.stock[coal]! - c0).toBe(7_000);
    expect(sim.stock[IRON()]! - i0).toBeGreaterThanOrEqual(4_000);
    expect(sim.selling.has(post)).toBe(false);
  });

  it('online ≈ offline: an item both imported and fed in, two hours — the same sales, purchases, ocelles and stores', () => {
    const a = rig().sim, b = rig().sim;
    a.run(300); b.run(300);
    expect(b.hash()).toBe(a.hash());
    a.run(72_000);
    catchUp(b, 72_000, { noDirect: true });
    expect(b.tick).toBe(a.tick);
    const post = a.tradePosts()[0]!.id;
    expect(a.trade.soldTotal[IRON()]).toBeGreaterThan(5_000_000);
    expect(a.trade.boughtTotal[IRON()]).toBeGreaterThan(1_000_000);
    if (process.env.CATCHUP_REPORT) {
      const v = (s: Sim): string => [s.trade.soldTotal[IRON()], s.trade.boughtTotal[IRON()], s.credits, s.stock[IRON()], s.stores.get(post)![IRON()], sellingOf(s, post)[IRON()]].join(' ');
      console.log(`D131 twin: hash ${a.hash() === b.hash() ? 'equal' : 'differs'}; sold bought credits core container entrance — online ${v(a)} · offline ${v(b)}`);
    }
    // Within a few items, as the other trade absences (trade.test.ts): the exit's line and the
    // container's deliveries spread over their minute offline (docs/offline.md) move a few items' phase.
    const near = (x: number, y: number, tol: number, what: string): void => { expect(Math.abs(x - y), what).toBeLessThanOrEqual(tol); };
    near(b.trade.soldTotal[IRON()]!, a.trade.soldTotal[IRON()]!, 2_000, 'sold');
    near(b.trade.boughtTotal[IRON()]!, a.trade.boughtTotal[IRON()]!, 2_000, 'bought');
    near(b.credits, a.credits, 500, 'ocelles (centi-◉)');
    near(b.stock[IRON()]!, a.stock[IRON()]!, 10_000, 'the Core’s ore');
    near(b.stores.get(post)![IRON()]!, a.stores.get(post)![IRON()]!, 10_000, 'the container');
    near(sellingOf(b, post)[IRON()]!, sellingOf(a, post)[IRON()]!, 10_000, 'the entrance');
  });
});
