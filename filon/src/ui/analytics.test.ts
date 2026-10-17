import { describe, it, expect } from 'vitest';
import { ANALYTICS, pathPlans, type AnalyticsFeature } from '@/content/research';
import { buildingIdx } from '@/content/registry';
import { fr } from '@/i18n/fr';
import { en } from '@/i18n/en';
import { testSim, wire } from '@/sim/testkit';
import { ANALYTICS_REVEALS, MACHINE_STATES, UnlockWatch, analyticsOn, machineStates } from './analytics';
import { captionAt, focusTiming, holeBox, mayPlay } from './focus';

describe('the Analytics path (D41): what each plan turns on', () => {
  it('each readout turns on with its own plan, in path order, and only that one', () => {
    const sim = testSim(undefined, { plans: false });
    sim.grant('iron_plate', 100); sim.grant('copper_wire', 40); sim.grant('glass', 20);
    const features = Object.keys(ANALYTICS) as AnalyticsFeature[];
    expect(features).toEqual(['rates', 'ledger', 'power', 'machines', 'wind']);
    for (const f of features) expect(analyticsOn(sim, f), f).toBe(false);
    for (const [k, f] of features.entries()) {
      expect(sim.unlockPlan(ANALYTICS[f]).ok, f).toBe(true);
      for (const [j, g] of features.entries()) expect(analyticsOn(sim, g), `${ANALYTICS[f]} → ${g}`).toBe(j <= k);
    }
  });

  it('the telemetry alone gives the HUD rates — not the Statistics screen (G), which waits for the ledger', () => {
    const sim = testSim(undefined, { plans: false });
    expect(sim.unlockPlan('telemetry').ok).toBe(true);
    expect(analyticsOn(sim, 'rates')).toBe(true);
    expect(analyticsOn(sim, 'ledger')).toBe(false);
  });

  it('every analytics plan has a reveal: a HUD hook to lift out, and CrierBelt’s line in both languages', () => {
    expect(Object.keys(ANALYTICS_REVEALS).sort()).toEqual([...pathPlans('analytics')].sort());
    for (const [id, r] of Object.entries(ANALYTICS_REVEALS)) {
      expect(r.target, id).toMatch(/^\[data-hud-[a-z]+\]$/);
      expect(fr[r.caption], id).toBeTruthy();
      expect(en[r.caption], id).toBeTruthy();
    }
  });

  it('a reveal plays once per unlock: the first look at a colony is its baseline, and a new colony starts over', () => {
    const w = new UnlockWatch(['telemetry', 'statistics']);
    const a = { done: new Set(['telemetry']) };
    expect(w.fresh(a)).toEqual([]); // already there when first seen: no reveal
    a.done.add('statistics');
    a.done.add('router'); // not watched
    expect(w.fresh(a)).toEqual(['statistics']);
    expect(w.fresh(a)).toEqual([]);
    const b = { done: new Set(['telemetry', 'statistics']) }; // a base loaded or swapped in
    expect(w.fresh(b)).toEqual([]);
  });
});

describe('the Diagnostics readout (D41): the machines by state', () => {
  it('counts the working buildings by state, worst first, with how many of each kind — as the inspector reads them', () => {
    const sim = testSim();
    const drill = sim.place('drill', 511, 502, 2);
    const kiln = sim.place('kiln', 506, 505, 1);
    expect(drill.ok && kiln.ok).toBe(true);
    sim.run(20);
    // An unwired drill reads « no wire » (not « no power »: the fix is a wire); a smelter with no recipe, « no recipe ».
    expect(machineStates(sim).map((s) => [s.state, s.n])).toEqual([['unlinked', 1], ['nojob', 1]]);
    expect([...machineStates(sim)[0]!.defs]).toEqual([[buildingIdx('drill'), 1]]);
    wire(sim, drill.id!);
    sim.run(20);
    const after = machineStates(sim);
    expect(after.some((s) => s.state === 'unlinked')).toBe(false);
    expect(after.reduce((n, s) => n + s.n, 0)).toBe(2); // ribbons, poles and the Heart are not machines
    // Worst first, always in the one order.
    const order = after.map((s) => MACHINE_STATES.indexOf(s.state));
    expect([...order].sort((x, y) => x - y)).toEqual(order);
  });
});

describe('the spotlight (D41)', () => {
  it('never plays by itself under automation; a forced shot (FL.focusReveal) does', () => {
    expect(mayPlay(true, false)).toBe(true);
    expect(mayPlay(false, false)).toBe(false);
    expect(mayPlay(false, true)).toBe(true);
  });

  it('holds two seconds before a click or a key may end it (then it waits for one); reduced motion keeps the hold and drops the movement', () => {
    const full = focusTiming(false), still = focusTiming(true);
    expect(full.holdMs).toBeGreaterThanOrEqual(2000);
    expect(still.holdMs).toBeGreaterThanOrEqual(full.holdMs);
    expect(still.inMs).toBeLessThan(full.inMs);
  });

  it('hugs the element inside the window; the caption sits under it, or over it near the bottom, always on screen', () => {
    expect(holeBox({ x: 10, y: 10, w: 100, h: 30 }, 8, 1440, 900)).toEqual({ x: 4, y: 4, w: 114, h: 44 });
    expect(captionAt({ x: 100, y: 20, w: 200, h: 40 }, 300, 80, 1440, 900)).toEqual({ x: 50, y: 78 });
    expect(captionAt({ x: 1300, y: 820, w: 100, h: 40 }, 300, 80, 1440, 900)).toEqual({ x: 1124, y: 722 });
    expect(captionAt(null, 300, 80, 1440, 900)).toEqual({ x: 570, y: 410 });
  });
});
