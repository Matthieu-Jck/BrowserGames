// cargo-flight.test.ts — the cargo drone's choreography at a trade post: the deck's centre turns
// with the footprint as the post's art turns it; both sequences run without a jump; the
// container only goes through the deck while the iris is open, hangs exactly a cable's length
// under the drone, leaves the deck only once hooked and lands with its swing died out; the drone
// never sinks into its load; both sequences end with nothing left on screen, and the next drone
// at the same deck starts once the deck is clear.
import { describe, it, expect } from 'vitest';
import type { Rot } from '@/sim/types';
import { IsoFrame } from '../art/iso-shapes';
import { LH } from '../iso';
import {
  DECK_X, DECK_Y, HOVER, LIFTOFF, TOUCHDOWN, deckCentre, endOf, followAfter, newPose, poseAt, type CargoSide, type Pose,
} from './cargo-flight';

const SIDES: readonly CargoSide[] = ['sell', 'buy'];
const STEP = 1 / 240;

/** Every pose of a sequence, from a little before its start to a little after its end. */
function run(side: CargoSide): Array<{ t: number; p: Pose }> {
  const out: Array<{ t: number; p: Pose }> = [];
  for (let t = -0.5; t <= endOf(side) + 0.1; t += STEP) out.push({ t, p: { ...poseAt(side, t, newPose()) } });
  return out;
}

describe('cargo drone: the deck', () => {
  it('turns with the footprint as IsoFrame turns the trade post’s art, and stays by its centre', () => {
    for (const rot of [0, 1, 2, 3] as Rot[]) {
      const [x, y] = deckCentre({ x: 100, y: 200, w: 3, h: 3, rot });
      const [rx, ry] = new IsoFrame(3, 3, rot, 1).r(DECK_X, DECK_Y);
      expect(x).toBeCloseTo(100 + rx, 9);
      expect(y).toBeCloseTo(200 + ry, 9);
      expect(Math.hypot(x - 101.5, y - 201.5)).toBeLessThan(0.06);
    }
  });
});

describe('cargo drone: the sequences', () => {
  for (const side of SIDES) {
    const seq = run(side);

    it(`${side}: nothing jumps from one frame to the next`, () => {
      for (let i = 1; i < seq.length; i++) {
        const a = seq[i - 1]!.p, b = seq[i]!.p, t = seq[i]!.t.toFixed(3);
        expect(Math.abs(b.drone - a.drone), `drone @${t}`).toBeLessThan(4);
        expect(Math.abs(b.load - a.load), `load @${t}`).toBeLessThan(4);
        for (const k of ['emerge', 'hatch', 'cable', 'droneA', 'loadA', 'burn'] as const) expect(Math.abs(b[k] - a[k]), `${k} @${t}`).toBeLessThan(0.05);
        expect(Math.abs(b.swing - a.swing), `swing @${t}`).toBeLessThan(0.01);
        expect(Math.abs(b.drift - a.drift), `drift @${t}`).toBeLessThan(0.02);
      }
    });

    it(`${side}: the container goes through the deck only while the iris is open`, () => {
      for (const { t, p } of seq) {
        expect(p.load, `@${t}`).toBeGreaterThanOrEqual(0);
        if (p.emerge < 0.999 && p.loadA > 0.01) expect(p.hatch, `@${t}`).toBeGreaterThan(0.98);
        if (p.emerge < 0.999) expect(p.load, `@${t}`).toBe(0);
      }
    });

    it(`${side}: the load hangs a cable's length under the drone, which never sinks into it`, () => {
      for (const { t, p } of seq) {
        if (p.hung) {
          expect(p.cable, `@${t}`).toBe(1);
          expect(p.drone - p.load, `@${t}`).toBeCloseTo(HOVER, 6);
        }
        if (p.droneA > 0.01 && p.emerge > 0) expect(p.drone - p.load, `@${t}`).toBeGreaterThan(HOVER - 4);
        expect(p.burn).toBeGreaterThanOrEqual(0);
        expect(p.burn).toBeLessThanOrEqual(1.5);
        expect(Math.abs(p.swing)).toBeLessThan(0.15);
      }
    });

    it(`${side}: it ends with nothing left on screen`, () => {
      const p = poseAt(side, endOf(side) - 1e-3, newPose());
      expect(p.droneA).toBeLessThan(0.01);
      expect(p.hatch).toBeLessThan(0.01);
      if (side === 'sell') expect(p.loadA).toBeLessThan(0.01);
      else expect(p.emerge).toBeLessThanOrEqual(0);
    });

    it(`${side}: the next drone at this deck starts once the deck is clear and this one is high`, () => {
      const at = followAfter(side);
      expect(at).toBeLessThan(endOf(side));
      const p = poseAt(side, at, newPose());
      expect(p.hatch).toBeLessThan(0.01);
      expect(p.drone).toBeGreaterThan(10 * LH);
      if (side === 'sell') expect(p.load).toBeGreaterThan(8 * LH);
      else expect(p.loadA).toBeLessThan(0.01);
    });
  }

  it('sell: the lift brings the container up before the drone hooks it, and it leaves the deck only once hooked', () => {
    const seq = run('sell');
    const up = seq.find(({ p }) => p.emerge >= 1)!.t;
    const reached = seq.find(({ p }) => p.cable >= 1)!.t;
    const off = seq.find(({ p }) => p.load > 0)!.t;
    expect(up).toBeLessThan(reached);
    expect(reached).toBeLessThan(off);
    expect(off).toBeCloseTo(LIFTOFF, 2);
    for (const { p } of seq) if (p.load > 0) expect(p.hung).toBe(true);
  });

  it('buy: the container lands with its swing died out, stays down, and the drone leaves it unhooked', () => {
    const seq = run('buy');
    const p = poseAt('buy', TOUCHDOWN, newPose());
    expect(p.load).toBeCloseTo(0, 6);
    expect(Math.abs(p.swing)).toBeLessThan(1e-3);
    for (const { t, p: q } of seq) {
      if (t >= TOUCHDOWN) expect(q.load).toBe(0);
      // Climbing away (above its hover): never with the load on.
      if (t > TOUCHDOWN && q.drone > HOVER + 0.5) expect(q.hung).toBe(false);
    }
    expect(seq.some(({ p: q }) => q.hung && Math.abs(q.swing) > 0.02)).toBe(true);
  });

  it('fills the pose it is given (no allocation per frame)', () => {
    const p = newPose();
    for (const side of SIDES) expect(poseAt(side, 3, p)).toBe(p);
  });
});
