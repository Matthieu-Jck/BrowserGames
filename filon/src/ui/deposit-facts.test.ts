// deposit-facts.test.ts — what the deposit card says (D99): the extractors read from the content
// tables by place, a deposit tile's ore, place, rate and machines (locked until unlocked), a vein
// under rock with its excavators first, water with its pumps, nothing on plain sand or in the fog,
// and a deposit's known extent.
import { describe, expect, it } from 'vitest';
import { itemIdx } from '@/content/registry';
import { testSim, COPPER, IRON } from '@/sim/testkit';
import { T } from '@/sim/types';
import { CUTTERS, DIGGERS, DRILLS, PUMPS, depositAt, depositExtent, tileMaxOf } from './deposit-facts';

describe('the deposit card\'s facts (D99)', () => {
  it('reads the extractors from the content tables, by place', () => {
    expect(DRILLS).toContain('drill');
    expect(DRILLS).toContain('deep_bore');
    for (const not of ['face_cutter', 'sand_collector', 'data_collector', 'pump', 'excavator']) expect(DRILLS).not.toContain(not);
    expect(CUTTERS).toEqual(['face_cutter']);
    expect(PUMPS).toContain('pump');
    expect(DIGGERS).toContain('excavator');
  });

  it('a deposit tile: its ore, what a tile gives, its drills — the deep bore locked for a new claim', () => {
    const sim = testSim(undefined, { plans: false });
    const f = depositAt(sim, 510, 500)!;
    expect(f.item).toBe(IRON());
    expect(f.where).toBe('ground');
    expect(f.tilePerMin).toBe(5); // rich 500: 5 a minute
    expect(f.tileMax).toBeGreaterThan(f.tilePerMin);
    expect(f.tileMax).toBe(tileMaxOf(IRON()));
    expect(f.machines.find((m) => m.def === 'drill')?.locked).toBe(false);
    expect(f.machines.find((m) => m.def === 'deep_bore')?.locked).toBe(true);
    expect(f.dig).toEqual([]);
    expect(depositAt(sim, 510, 523)!.item).toBe(COPPER());
  });

  it('a vein under rock: the excavators first, then the drills', () => {
    const rocky = testSim([{ x: 530, y: 500, w: 3, h: 3, item: IRON(), rich: 400 }]);
    for (let y = 500; y < 503; y++) for (let x = 530; x < 533; x++) rocky.grid.setTerrain(x, y, T.Rock2);
    const f = depositAt(rocky, 531, 501)!;
    expect(f.where).toBe('vein');
    expect(f.dig.map((m) => m.def)).toContain('excavator');
    expect(f.machines.map((m) => m.def)).toContain('drill');
  });

  it('water: its pumps; plain sand and the fog: no card', () => {
    const sim = testSim();
    sim.grid.setTerrain(515, 515, T.Shallow);
    const w = depositAt(sim, 515, 515)!;
    expect(w.item).toBe(itemIdx('water'));
    expect(w.where).toBe('water');
    expect(w.machines.map((m) => m.def)).toContain('pump');
    expect(depositAt(sim, 520, 512)).toBeNull(); // plain sand
    expect(sim.revealed(900, 900)).toBe(false);
    expect(depositAt(sim, 900, 900)).toBeNull(); // in the fog
    expect(depositAt(sim, -1, 3)).toBeNull();
  });

  it('a deposit\'s known extent: its tiles joined by their sides and what they give together', () => {
    const sim = testSim();
    const e = depositExtent(sim, 510, 500);
    expect(e.tiles).toBe(60); // the iron field, 10 × 6
    expect(e.perMin).toBe(300);
    expect(e.keys.has(500 * 1024 + 510)).toBe(true);
    expect(depositExtent(sim, 520, 512).tiles).toBe(0);
  });
});
