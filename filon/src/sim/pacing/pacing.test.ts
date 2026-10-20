// pacing.test.ts — the first three hours of a new base, played by the pacing bot (D146, bot.ts) on
// lands 1–3 of today's map: by a player who asks for the goals' hints and does what they say, and by
// one who only follows the objectives and the guide's arrow. Each run is deterministic (the same
// land, founding minute and content give the same game), so the bounds below hold until a balance
// change moves them: they sit at the measured values plus headroom (docs/pacing.md). A balance change
// that trips one is re-measured: `PACING_OUT=scripts/pacing-now.json npx vitest run src/sim/pacing`
// writes the raw runs, `node scripts/pacing-report.mjs scripts/pacing-now.json` prints the tables.
// D153: a third player, the hints player who also takes CrierBelt's delivery orders past the tutorial
// (`orders`): its first order — the tutorial's quartz — is filled, and its orders pay over the three hours.
import { afterAll, describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { QUEST_IDS } from '@/content/quests';
import { playPacing, type PacingRun } from './bot';

const LANDS = [1, 2, 3];

/**
 * Game minutes, at most (the measured value, D146, then headroom): every quest met — 42–44 with the
 * hints, 60–63 without; the Synthesis learnt (Tier 1 done) — 141–147 with the hints.
 */
const ALL_QUESTS = { hints: 60, nohints: 85 } as const;
const TIER1 = 170;
/** Every night: the Core's grid at this satisfaction at least (‰) and under 1000 ‰ this many minutes at most (measured: 1000, 0). */
const NIGHT_SAT = 900, NIGHT_BELOW = 2;
/** What the post sells in the second hour, ◉ at least (measured 1 660–1 930). */
const SALES_H2 = 1200;
/** The orders player (D153): orders filled in three hours and what they paid (◉), at least (measured 2–3 and 1 550–2 330). */
const ORDERS_FILLED = 2, ORDERS_PAID = 1000;

const sets: Record<'hints' | 'nohints' | 'orders', PacingRun[]> = { hints: [], nohints: [], orders: [] };

const lastQuest = (r: PacingRun): number => Math.max(...QUEST_IDS.map((id) => r.milestones[`quest:${id}`] ?? Infinity));

describe('pacing bot (D146): the first three hours of a new base', () => {
  for (const mode of ['hints', 'nohints'] as const) {
    it.each(LANDS)(`land %i, ${mode === 'hints' ? 'a player who asks for hints' : 'a player who never asks'}: every quest met in time, every night held, no grant, the post selling`, (land) => {
      const r = playPacing({ land, askHints: mode === 'hints' });
      sets[mode].push(r);
      const at = (k: string): string => `land ${land}, ${mode}: ${k} (${JSON.stringify(r.milestones)})`;
      // Nothing impossible on the way: no grant asked for, no wait past its cap, no plan asked for before the tree offers it.
      expect(r.problems, at('problems')).toEqual([]);
      expect(lastQuest(r), at('the last quest')).toBeLessThanOrEqual(ALL_QUESTS[mode]);
      if (mode === 'hints') expect(r.milestones.tier1 ?? Infinity, at('Tier 1')).toBeLessThanOrEqual(TIER1);
      for (const n of r.nights) {
        expect(n.minSat, at(`night ${n.n}'s lowest`)).toBeGreaterThanOrEqual(NIGHT_SAT);
        expect(n.below, at(`night ${n.n} under 100 %`)).toBeLessThanOrEqual(NIGHT_BELOW);
      }
      expect(Math.min(...r.purse), at('the purse')).toBeGreaterThanOrEqual(0);
      expect(r.hours[1]?.byKind.sales ?? 0, at('the second hour\'s sales')).toBeGreaterThanOrEqual(SALES_H2);
    }, 120_000);
  }

  it.each(LANDS)('land %i, a player who takes CrierBelt’s orders (D153): what it can feed through its post accepted; the first, quartz, filled in its window; the orders paid; nothing impossible', (land) => {
    const r = playPacing({ land, askHints: true, orders: true });
    sets.orders.push(r);
    const at = (k: string): string => `land ${land}, orders: ${k} (${JSON.stringify(r.orders)})`;
    expect(r.problems, at('problems')).toEqual([]);
    expect(lastQuest(r), at('the last quest')).toBeLessThanOrEqual(ALL_QUESTS.hints);
    expect(r.orders.length, at('orders accepted')).toBeGreaterThan(0);
    // Where its layout finds room for a router on the quartz line toward the post (lands 1 and 3; the
    // bot's builders find none on land 2, where it takes the glass and ore orders only), the first
    // order is the tutorial's quartz, filled in its window, and the orders pay in the second hour.
    if (!r.skipped.includes('line:post.quartz')) {
      expect(r.orders[0]?.item, at('the first order')).toBe('quartz');
      expect(r.orders[0]?.what, at('the first order filled')).toBe('filled');
      expect(r.orders.filter((o) => o.what === 'filled').length, at('orders filled')).toBeGreaterThanOrEqual(ORDERS_FILLED);
      expect(r.hours.reduce((a, h) => a + (h.byKind.delivery ?? 0), 0), at('the orders\' pay over three hours')).toBeGreaterThanOrEqual(ORDERS_PAID);
    }
    expect(Math.min(...r.purse), at('the purse')).toBeGreaterThanOrEqual(0);
  }, 120_000);

  afterAll(() => {
    if (process.env.PACING_OUT) writeFileSync(process.env.PACING_OUT, JSON.stringify({ sets }));
  });
});
