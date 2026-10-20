// blueprint-perf.test.ts — what a big paste costs the engine (D154): on the late debug base, a box of
// about two hundred pieces copied, taken down, and pasted back where it stood (every piece fits, the
// demolition's refund pays for it). Timed: the plan the ghost recomputes when the cursor moves, the
// paste itself (each piece a `place`, each wire a `link`), and the tick after it, which recompiles
// the flow graph. On the CPU clock (core/cpu-time.ts); the wall's in the log. The shell's side — the
// views rebuilt after the structure event — is measured in the browser (scripts/blueprint-shots.mjs).
import { describe, it, expect } from 'vitest';
import { CPU_CLOCK, timed } from '@/core/cpu-time';
import { WORLD_EPOCH0 } from '../constants';
import { foundScenario } from '../scenarios';
import { entsInBox } from '../systems/blueprint';

describe('performance: a paste of about 200 pieces on the late base (D154)', () => {
  it('plans in a few ms, pastes and recompiles well inside a frame budget of a few frames', () => {
    const { sim } = foundScenario('late', { playerSeed: 1, near: WORLD_EPOCH0 + 50_000, name: 'Essai' });
    sim.run(60);
    // The smallest square round the Core that holds 200 pieces or more.
    let box: [number, number, number, number] | null = null;
    const c = 512;
    for (let r = 6; r < 60 && !box; r++) {
      const n = entsInBox(sim, c - r, c - r, c + r, c + r).length;
      if (n >= 200) box = [c - r, c - r, c + r, c + r];
    }
    expect(box).not.toBeNull();
    const [x0, y0, x1, y1] = box!;
    const bp = sim.capture(x0, y0, x1, y1)!;
    const n = bp.pieces.length;
    // The blueprint's corner is the top-left of the footprints taken (they may stand past the box).
    const ids = entsInBox(sim, x0, y0, x1, y1);
    const ox = Math.min(...ids.map((id) => sim.ents.get(id)!.x)), oy = Math.min(...ids.map((id) => sim.ents.get(id)!.y));
    // Take them down (refunded), then paste them back where they stood: the cursor on the blueprint's middle.
    for (const id of ids) { const e = sim.ents.get(id); if (e) sim.remove(e.x, e.y); }
    sim.run(1);
    const cx = ox + Math.floor((bp.w - 1) / 2), cy = oy + Math.floor((bp.h - 1) / 2);
    sim.planPaste(bp, cx, cy, 0, false); // warm the JIT
    const plan = timed(() => sim.planPaste(bp, cx, cy, 0, false));
    const paste = timed(() => sim.paste(bp, cx, cy, 0, false));
    const tick = timed(() => sim.run(1));
    console.log(`${n} pieces · ${CPU_CLOCK ? 'CPU' : 'wall'} times: plan ${plan.ms.toFixed(1)} ms (${plan.wall.toFixed(1)} wall) · paste ${paste.ms.toFixed(1)} ms (${paste.wall.toFixed(1)} wall; ${paste.value.placed} laid, ${paste.value.skipped} skipped, ${paste.value.wired} wires) · next tick (recompile) ${tick.ms.toFixed(1)} ms`);
    expect(paste.value.placed).toBeGreaterThanOrEqual(n - 5);
    expect(plan.ms).toBeLessThan(20);
    expect(paste.ms).toBeLessThan(60);
    expect(tick.ms).toBeLessThan(60);
  }, 120000);
});
