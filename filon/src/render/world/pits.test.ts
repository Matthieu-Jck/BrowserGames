// pits.test.ts — the incinerator's pit in the world (D51; owner, 2026-10-14: "a hole in the ground
// with a flame that activates when an item falls in it"): an item a ribbon hands to it rides up the
// chute, tips over the lip and is gone into the dark before its glide ends (so a full line's next
// item never overwrites it mid-fall); the fire flares once for every item that falls in, driven by
// the real engine at 60 frames a second, and dies down when nothing comes; nothing in it jumps.
import { describe, it, expect } from 'vitest';
import { itemIdx } from '@/content/registry';
import { line, stockedSilo, testSim } from '@/sim/testkit';
import { opposite, type Ent, type Rot } from '@/sim/types';
import { tileIndex } from '@/sim/world/grid';
import type { Sim } from '@/sim/state';
import { CellFlow } from './cell-flow';
import { buildPieces } from './item-flow';
import { PIT_WAY, PitFire, flameLevel, heatAt, pitPath } from './pits';

/** The views' rule for a ribbon tile (buildings-view's beltPiece, which pulls in Pixi). */
function beltPiece(sim: Sim, e: Ent): { corner: boolean; rot: Rot } {
  const r = e.rot;
  const fed = sim.graph?.feedDirs.get(tileIndex(e.x, e.y)) ?? 0;
  if (!fed || fed & (1 << opposite(r))) return { corner: false, rot: r };
  const sides = ([((r + 1) & 3), ((r + 3) & 3)] as Rot[]).filter((s) => fed & (1 << s));
  return sides.length === 1 ? { corner: true, rot: opposite(sides[0]!) } : { corner: false, rot: r };
}

describe('the way into a pit', () => {
  it('flat on the ribbon, up the chute, then a fall faster and faster, gone before the glide ends', () => {
    const o = { z: 0, d: 0 };
    expect(pitPath(0.3, o)).toEqual({ z: 0, d: 0 });
    expect(pitPath(0.6, o).z).toBeGreaterThan(0); // on the chute, over the collar
    expect(pitPath(PIT_WAY.tip - 0.001, o).d).toBe(0);
    let z = Infinity, dz = 0;
    for (let f = PIT_WAY.tip + 0.01; f <= PIT_WAY.gone; f += 0.01) {
      const p = pitPath(f, o);
      expect(p.d).toBeGreaterThan(0);
      expect(p.z).toBeLessThan(z);
      expect(z - p.z).toBeGreaterThanOrEqual(dz - 1e-9); // accelerating
      if (z !== Infinity) dz = z - p.z;
      z = p.z;
    }
    expect(pitPath(PIT_WAY.gone, o).d).toBe(1);
    // A full basic line hands the next item on a tick before the glide's end (it is drawn a tick behind): gone by then.
    expect(PIT_WAY.gone).toBeLessThanOrEqual(0.9);
  });

  it('the flame: up fast, down, embers, then nothing', () => {
    expect(heatAt(-1)).toBe(0);
    expect(heatAt(0)).toBeGreaterThan(0.3);
    expect(heatAt(1.5)).toBeCloseTo(1, 6);
    expect(heatAt(4)).toBeLessThan(1);
    expect(heatAt(10)).toBeLessThan(0.25);
    expect(heatAt(30)).toBe(0);
    expect(flameLevel(1)).toBe(6);
    expect(flameLevel(0.05)).toBe(0); // embers
    expect(flameLevel(0)).toBe(-1);
  });
});

describe('the fire, driven by the engine', () => {
  it('flares once for every item that falls in, and the items glide in without a jump', () => {
    const sim = testSim();
    stockedSilo(sim, 500, 520, 0, 'iron_ore', 40); // out at (500,519) going north
    expect(sim.placeBelts('ribbon', line(500, 519, 0, 4))).toBe(4); // (500,519)…(500,516)
    const inc = sim.place('incinerator', 500, 515, 0);
    expect(inc.ok).toBe(true);
    sim.run(60);
    sim.ensureCompiled();
    const flow = new CellFlow();
    flow.setPieces(buildPieces(sim, beltPiece, 20));
    const fire = new PitFire();
    const before = sim.consumed[itemIdx('iron_ore')]!;
    let flares = 0, prev = 0, maxHeat = 0, fell = 0, lastPit: { x: number; y: number } | null = null, maxStep = 0;
    for (let k = 0; k < 600 * 6; k++) {
      if (k % 6 === 0) sim.step();
      const t = sim.tick + (k % 6) / 6;
      let pit: { x: number; y: number } | null = null;
      flow.each(sim, t, [400, 400, 620, 620], (it) => { if (it.d > 0) fell = Math.max(fell, it.d); if (it.y < 516) pit = { x: it.x, y: it.y }; });
      // The item on its way in moves smoothly (while one is in sight from frame to frame).
      const p = pit as { x: number; y: number } | null;
      if (p && lastPit) maxStep = Math.max(maxStep, Math.hypot(p.x - lastPit.x, p.y - lastPit.y));
      lastPit = p;
      fire.update(sim, t);
      const h = fire.heat(inc.id!);
      maxHeat = Math.max(maxHeat, h);
      if (h > prev + 0.15) flares++; // a fresh flare: the heat jumps up (it only creeps up through a flare's rise)
      prev = h;
    }
    const burnt = (sim.consumed[itemIdx('iron_ore')]! - before) / 1000;
    expect(burnt).toBeGreaterThan(20);
    expect(Math.abs(flares - burnt)).toBeLessThanOrEqual(2); // one flare an item (the last may still be falling)
    expect(maxHeat).toBeLessThanOrEqual(1);
    expect(fell).toBeGreaterThan(0.5); // they were seen falling in
    expect(maxStep).toBeLessThan(0.3);
    // The silo is empty: the fire dies down.
    expect(fire.heat(inc.id!)).toBe(0);
  });
});
