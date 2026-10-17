// purse.test.ts — the purse's journal (D102): whatever changes the ocelles books the same cents
// under what made it, so the kinds add up to the purse's real change, to the cent — online on the
// late debug base (sales, standing orders, AI tokens), with a one-off (a grant), and through the catch-up, which runs the same trade and token functions.
import { describe, expect, it } from 'vitest';
import { foundScenario } from './scenarios';
import { catchUp } from './offline/catchup';
import { PURSE_KINDS, RECURRING, type PurseLog } from './purse';
import { EPOCH, WORLD_EPOCH0 } from './constants';

const sum = (l: PurseLog): number => PURSE_KINDS.reduce((s, k) => s + l[k], 0);
const minus = (a: PurseLog, b: PurseLog): PurseLog => Object.fromEntries(PURSE_KINDS.map((k) => [k, a[k] - b[k]])) as PurseLog;

describe('the purse\'s journal', () => {
  const { sim } = foundScenario('late', { playerSeed: 1, near: WORLD_EPOCH0 + 50_000, name: 'Essai' });

  it('adds up to the purse\'s change over an hour of the late base, recurring flows and one-offs alike', () => {
    const c0 = sim.credits, l0 = { ...sim.purseLog };
    for (let t = 0; t < 60 * EPOCH; t++) sim.step();
    sim.grantCredits(12_345);
    const d = minus(sim.purseLog, l0);
    expect(sum(d)).toBe(sim.credits - c0);
    // The late base sells, buys by standing orders and pays its research's tokens: each shows.
    expect(d.sales).toBeGreaterThan(0);
    expect(d.orders).toBeLessThan(0);
    expect(d.grant).toBe(12_345);
    // The recurring part alone is what the HUD shows: the change less the one-offs.
    const recurring = PURSE_KINDS.filter((k) => RECURRING.has(k)).reduce((s, k) => s + d[k], 0);
    expect(recurring).toBe(sim.credits - c0 - 12_345);
  });

  it('adds up through the catch-up too (it runs the same trade, token and lease functions)', () => {
    const c0 = sim.credits, l0 = { ...sim.purseLog };
    catchUp(sim, 120 * EPOCH);
    expect(sum(minus(sim.purseLog, l0))).toBe(sim.credits - c0);
  });
});
