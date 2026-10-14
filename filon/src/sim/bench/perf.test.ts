import { describe, it, expect } from 'vitest';
import { buildBench } from './base20k';
import { catchUp } from '../offline/catchup';
import { itemIdx } from '@/content/registry';

describe('performance (base20k: ~25k entities)', () => {
  it('ticks under 3 ms and catches up a week of absence in under 3 s', () => {
    const t0 = performance.now();
    const sim = buildBench();
    sim.ensureCompiled();
    const tCompile = performance.now() - t0;
    sim.run(60); // settle the JIT
    const t1 = performance.now();
    sim.run(300);
    const tickMs = (performance.now() - t1) / 300;
    sim.run(36000 - 360); // one hour online: silos start filling
    const t2 = performance.now();
    const rep = catchUp(sim, 7 * 24 * 36000, { noDirect: true });
    const tCatch = performance.now() - t2;
    const wire = itemIdx('copper_wire');
    let siloWire = 0;
    for (const st of sim.stores.values()) siloWire += st[wire]!;
    console.log(`entities=${sim.ents.size} nodes=${sim.graph.nodes.length} grids=${sim.graph.nets.length} · compile ${tCompile.toFixed(0)} ms · tick ${tickMs.toFixed(2)} ms · week catch-up ${tCatch.toFixed(0)} ms (${rep.warmups} warm-ups, ${rep.mode})`);
    // Every silo ends the week full (1 000 wire each).
    expect(siloWire / 1000).toBeGreaterThan(0.99 * 1000 * sim.stores.size);
    expect(tickMs).toBeLessThan(3);
    expect(tCatch).toBeLessThan(3000);
  }, 120000);
});
