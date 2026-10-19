// pacing.test.ts — the first three hours of a new base, played by the pacing bot (D146, bot.ts) on
// lands 1–3 of today's map: by a player who asks for the goals' hints and does what they say, and by
// one who only follows the objectives and the guide's arrow. Each run is deterministic (the same
// land, founding minute and content give the same game), so the bounds below hold until a balance
// change moves them: they sit at the measured values plus headroom (docs/pacing.md). A balance change
// that trips one is re-measured: `PACING_OUT=scripts/pacing-now.json npx vitest run src/sim/pacing`
// writes the raw runs, `node scripts/pacing-report.mjs scripts/pacing-now.json` prints the tables.
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

const sets: Record<'hints' | 'nohints', PacingRun[]> = { hints: [], nohints: [] };

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

  afterAll(() => {
    if (process.env.PACING_OUT) writeFileSync(process.env.PACING_OUT, JSON.stringify({ sets }));
  });
});
