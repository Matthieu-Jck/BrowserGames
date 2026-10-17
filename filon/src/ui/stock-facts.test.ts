// stock-facts.test.ts — the Stock panel's facts (D96): every item in a section, and the badge's
// rule — an item the Heart holds none of while a building or an open plan costs it ran out; one it
// holds too little of for an open plan is short; plenty of everything: nothing lacks.
import { describe, expect, it } from 'vitest';
import { ITEM_IDS, itemIdx, N_ITEMS } from '@/content/registry';
import { testSim } from '@/sim/testkit';
import { groupOf, shortages, STOCK_GROUPS } from './stock-facts';

describe('the Stock panel\'s sections', () => {
  it('puts every item in one section, by kind', () => {
    for (let i = 0; i < N_ITEMS; i++) expect(STOCK_GROUPS.map((g) => g.id), ITEM_IDS[i]).toContain(groupOf(i));
    expect(groupOf(itemIdx('iron_ore'))).toBe('raw');
    expect(groupOf(itemIdx('coal'))).toBe('raw');
    expect(groupOf(itemIdx('iron_plate'))).toBe('material');
    expect(groupOf(itemIdx('gear'))).toBe('part');
    expect(groupOf(itemIdx('journal_1'))).toBe('data');
    expect(groupOf(itemIdx('sporeglass'))).toBe('rare');
    for (const g of STOCK_GROUPS) expect(groupOf(itemIdx(g.icon)), g.id).toBe(g.id);
  });
});

describe('shortages', () => {
  it('nothing lacks with plenty of everything', () => {
    const sim = testSim(undefined, { plans: false });
    for (let i = 0; i < N_ITEMS; i++) sim.stock[i] = 1_000_000 * 1000;
    expect(shortages(sim)).toEqual([]);
  });
  it('an item the Heart holds none of, which the starting kit costs, ran out', () => {
    const sim = testSim(undefined, { plans: false });
    const plate = itemIdx('iron_plate');
    sim.stock[plate] = 0;
    const s = shortages(sim).find((x) => x.item === plate);
    expect(s?.out).toBe(true);
    expect(s!.missing).toBeGreaterThan(0);
  });
  it('an item held, but less than an open plan costs, is short (not out), told for its nearest need', () => {
    const sim = testSim(undefined, { plans: false });
    for (let i = 0; i < N_ITEMS; i++) sim.stock[i] = 1_000_000 * 1000;
    const plate = itemIdx('iron_plate');
    sim.stock[plate] = 1000; // one plate: every open plan wants more
    const s = shortages(sim).find((x) => x.item === plate);
    expect(s).toBeDefined();
    expect(s!.out).toBe(false);
    expect(s!.for.k).toBe('plan');
    // The nearest need: no open plan wants fewer plates than this shortfall says.
    expect(s!.missing).toBeGreaterThan(0);
  });
  it('a plan taken is no longer a need', () => {
    const sim = testSim(); // every plan learnt
    for (let i = 0; i < N_ITEMS; i++) sim.stock[i] = 50 * 1000;
    expect(shortages(sim).every((s) => s.for.k === 'building')).toBe(true);
  });
});
