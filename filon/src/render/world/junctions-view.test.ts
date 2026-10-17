// junctions-view.test.ts — the ribbon laid under a junction (`underPass`): from a ribbon either side,
// either way, and from a building's port facing the junction on that axis (a trade post's exit, a
// machine's input), in every orientation; the deck axis (north–south) lays nothing for a port.
import { describe, it, expect } from 'vitest';
import { testSim, line } from '@/sim/testkit';
import { worldPorts } from '@/sim/entities';
import type { Rot } from '@/sim/types';
import type { Sim } from '@/sim/state';
import { underPass } from './junctions-view';

const N = 0 as Rot, S = 2 as Rot, E = 1 as Rot, W = 3 as Rot;
const ROTS: Rot[] = [N, E, S, W];

function fresh(): Sim {
  const sim = testSim();
  sim.grant('iron_plate', 500); sim.grant('copper_wire', 200); sim.grant('glass', 100); sim.grant('gear', 50);
  return sim;
}
const settle = (sim: Sim): void => { for (const e of sim.ents.map.values()) e.builtAt = 0; sim.markDirty(); sim.ensureCompiled(); };

describe('underPass', () => {
  it('a ribbon on either side, either way', () => {
    const cases: Array<[Rot, number, Rot]> = [[E, -1, E], [W, -1, W], [E, 1, E], [W, 1, W]]; // belt rot, side, expected
    for (const [rot, dx, want] of cases) {
      const sim = fresh();
      sim.place('crossing', 512, 503, S);
      sim.placeBelts('ribbon', line(512 + dx, 503, rot, 1));
      settle(sim);
      expect(underPass(sim, 512, 503)).toEqual({ tier: 'ribbon', rot: want });
    }
  });

  it('a ribbon across the deck axis only lays nothing', () => {
    const sim = fresh();
    sim.place('crossing', 512, 503, S);
    sim.placeBelts('ribbon', line(512, 504, S, 1));
    settle(sim);
    expect(underPass(sim, 512, 503)).toBeNull();
  });

  for (const id of ['trade_post', 'kiln'] as const) {
    it(`a ${id}'s ports facing the junction, in every orientation`, () => {
      let tested = 0;
      for (const rot of ROTS) {
        const probe = fresh();
        const r = probe.place(id, 500, 500, rot);
        if (!r.ok) continue;
        for (const p of worldPorts(probe.entityAt(500, 500)!)) {
          const sim = fresh();
          expect(sim.place(id, 500, 500, rot).ok).toBe(true);
          const ok = sim.place('crossing', p.fx, p.fy, S);
          if (!ok.ok) continue;
          settle(sim);
          const got = underPass(sim, p.fx, p.fy);
          if (p.dir === E || p.dir === W) {
            // an exit feeds the junction (runs away from the building), an entrance is fed through it
            const away = p.dir;
            expect(got, `${id} rot ${rot} port ${p.io} dir ${p.dir}`).toEqual({ tier: 'ribbon', rot: p.io === 'out' ? away : ((away + 2) & 3) as Rot });
            tested++;
          } else expect(got).toBeNull();
        }
      }
      expect(tested).toBeGreaterThan(0);
    });
  }

  it('a post exit through two junctions to a ribbon is seen across two junctions', () => {
    const sim = fresh();
    const r = sim.place('trade_post', 500, 500, E);
    if (!r.ok) return;
    const out = worldPorts(sim.entityAt(500, 500)!).find((p) => p.io === 'out' && p.dir === E)!;
    sim.place('crossing', out.fx, out.fy, S);
    sim.place('crossing', out.fx + 1, out.fy, S);
    expect(sim.placeBelts('ribbon', line(out.fx + 2, out.fy, E, 1))).toBe(1);
    settle(sim);
    expect(underPass(sim, out.fx, out.fy)).toEqual({ tier: 'ribbon', rot: E });
  });
});
