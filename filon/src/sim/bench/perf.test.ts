import { describe, it, expect } from 'vitest';
import { CPU_CLOCK, timed } from '@/core/cpu-time';
import { buildBench } from './base20k';
import { catchUp } from '../offline/catchup';
import { itemIdx } from '@/content/registry';

describe('performance (base20k: ~25k entities)', () => {
  // Times on the CPU (core/cpu-time.ts): another test run on the machine does not count; the wall's in the log.
  it('ticks under 3 ms and catches up a week of absence in under 3 s', () => {
    const { value: sim, ms: tCompile } = timed(() => { const s = buildBench(); s.ensureCompiled(); return s; });
    sim.run(60); // settle the JIT
    const tick = timed(() => sim.run(300));
    const tickMs = tick.ms / 300;
    sim.run(36000 - 360); // one hour online: silos start filling
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
});
