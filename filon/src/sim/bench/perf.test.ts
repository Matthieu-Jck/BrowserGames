import { describe, it, expect } from 'vitest';
import { CPU_CLOCK, timed } from '@/core/cpu-time';
import { buildBench } from './base20k';
import { catchUp } from '../offline/catchup';
import { itemIdx } from '@/content/registry';
import { foundScenario } from '../scenarios';
import { WORLD_EPOCH0 } from '../constants';

describe('performance (base20k: ~27k entities)', () => {
  // Times on the CPU (core/cpu-time.ts): another test run on the machine does not count; the wall's in the log.
  it('ticks under 3 ms and catches up a week of absence in under 3 s', () => {
    const { value: sim, ms: tCompile } = timed(() => { const s = buildBench(); s.ensureCompiled(); return s; });
    sim.run(60); // settle the JIT
    const tick = timed(() => sim.run(300));
    const tickMs = tick.ms / 300;
    // One hour online: every silo is full by then (they fill in about half an hour), so the week
    // is jammed lines under the wind — each cell's grid swinging between power levels (D137).
    sim.run(36000 - 360);
    const { value: rep, ms: tCatch, wall: wCatch } = timed(() => catchUp(sim, 7 * 24 * 36000, { noDirect: true }));
    const wire = itemIdx('copper_wire');
    let siloWire = 0;
    for (const st of sim.stores.values()) siloWire += st[wire]!;
    console.log(`entities=${sim.ents.size} nodes=${sim.graph.nodes.length} grids=${sim.graph.nets.length} · ${CPU_CLOCK ? 'CPU' : 'wall'} times: compile ${tCompile.toFixed(0)} ms · tick ${tickMs.toFixed(2)} ms (${(tick.wall / 300).toFixed(2)} on the wall) · week catch-up ${tCatch.toFixed(0)} ms (${wCatch.toFixed(0)} on the wall; ${rep.warmups} warm-ups, ${rep.mode})`);
    // Every silo ends the week full (1 000 wire each).
    expect(siloWire / 1000).toBeGreaterThan(0.99 * 1000 * sim.stores.size);
    expect(tickMs).toBeLessThan(3);
    expect(tCatch).toBeLessThan(3000);
  }, 120000);

  // D138: the catch-up of a base still moving. A young base (the tutorial level: fuel generators
  // called at a share the sun moves, drills on capped deposits) took 45 s for 8 h — its generators'
  // and drills' whole items repeated over tens of minutes, so no warm-up found a cycle and every
  // minute took another; base20k while its silos fill took 10.8 s for 4 h (about 19 s here: under
  // vitest an imported binding is read through a getter). Measured on 2026-10-18 under vitest: 3.8–4.1
  // and 11.6–13.5 s of CPU. The young base's limit catches a return by far; base20k's (exact, the
  // same results either way) only one past its cost before D138.
  it('catches up eight hours of a young base, and four of base20k while it fills, in seconds', () => {
    const { sim: young } = foundScenario('tutorial', { playerSeed: 1, near: WORLD_EPOCH0 + 1000, name: 'Essai' });
    young.run(600);
    const y = timed(() => catchUp(young, 8 * 36000, { noDirect: true }));
    const fresh = buildBench();
    fresh.ensureCompiled();
    fresh.run(600);
    const f = timed(() => catchUp(fresh, 4 * 36000, { noDirect: true }));
    console.log(`young base 8 h: ${y.ms.toFixed(0)} ms (${y.value.warmups} warm-ups, ${y.value.mode}) · base20k filling 4 h: ${f.ms.toFixed(0)} ms (${f.value.warmups} warm-ups, ${f.value.mode})`);
    expect(y.ms).toBeLessThan(8000);
    expect(f.ms).toBeLessThan(20000);
  }, 240000);
});
