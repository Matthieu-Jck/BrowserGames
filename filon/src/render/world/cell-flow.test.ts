// cell-flow.test.ts — items drawn from the engine's cells (D57), driven by the real engine at 60
// frames a second as the app does: an item never jumps, never pops up but out of a source, never
// vanishes but into a building, and rides a junction's hump on the north–south line.
import { describe, it, expect } from 'vitest';
import { itemIdx } from '@/content/registry';
import { line, stockedSilo, testSim } from '@/sim/testkit';
import { opposite, type Ent, type Rot } from '@/sim/types';
import { tileIndex } from '@/sim/world/grid';
import type { Sim } from '@/sim/state';
import { CellFlow, type FlowItem } from './cell-flow';
import { HUMP_Z, buildPieces } from './item-flow';

/** The views' rule for a ribbon tile (buildings-view's beltPiece, which pulls in Pixi). */
function beltPiece(sim: Sim, e: Ent): { corner: boolean; rot: Rot } {
  const r = e.rot;
  const fed = sim.graph?.feedDirs.get(tileIndex(e.x, e.y)) ?? 0;
  if (!fed || fed & (1 << opposite(r))) return { corner: false, rot: r };
  const sides = ([((r + 1) & 3), ((r + 3) & 3)] as Rot[]).filter((s) => fed & (1 << s));
  return sides.length === 1 ? { corner: true, rot: opposite(sides[0]!) } : { corner: false, rot: r };
}

interface Seen { item: number; x: number; y: number; z: number; o: number }
interface Stats { frames: number; drawn: number; maxStep: number; popped: Array<[number, number]>; lost: Array<[number, number]>; maxZ: number }

/**
 * Run `ticks` engine ticks at 60 frames a second (six frames a tick), drawing every item each
 * frame; match each item to the nearest one of its kind in the frame before. An item with no match
 * is popped (allowed near `sources`), one that leaves none is lost (allowed near `sinks`).
 */
function watch(sim: Sim, ticks: number, sources: Array<[number, number]>, sinks: Array<[number, number]>, each?: (it: Seen) => void): Stats {
  sim.ensureCompiled();
  const flow = new CellFlow();
  flow.setPieces(buildPieces(sim, beltPiece, 20));
  const st: Stats = { frames: 0, drawn: 0, maxStep: 0, popped: [], lost: [], maxZ: 0 };
  const near = (pts: Array<[number, number]>, x: number, y: number): boolean => pts.some(([px, py]) => Math.hypot(px - x, py - y) <= 1.6);
  let prev: Seen[] | null = null;
  const view = [400, 400, 620, 620] as const;
  for (let k = 0; k < ticks * 6; k++) {
    if (k % 6 === 0) sim.step();
    const t = sim.tick + (k % 6) / 6;
    const cur: Seen[] = [];
    flow.each(sim, t, view, (it: FlowItem) => { cur.push({ ...it }); each?.(it); });
    st.frames++;
    st.drawn += cur.length;
    for (const c of cur) st.maxZ = Math.max(st.maxZ, c.z);
    if (prev) {
      // Greedy nearest matching, same kind.
      const used = new Set<number>();
      for (const c of cur) {
        let best = -1, bd = Infinity;
        prev.forEach((p, j) => { if (used.has(j) || p.item !== c.item) return; const d = Math.hypot(p.x - c.x, p.y - c.y); if (d < bd) { bd = d; best = j; } });
        if (best >= 0 && bd < 0.3) { used.add(best); st.maxStep = Math.max(st.maxStep, bd); } else if (!near(sources, c.x, c.y)) st.popped.push([c.x, c.y]);
      }
      prev.forEach((p, j) => { if (!used.has(j) && !near(sinks, p.x, p.y)) st.lost.push([p.x, p.y]); });
    }
    prev = cur;
  }
  return st;
}

describe('items drawn from the cells (D57)', () => {
  it('a line through a junction, a skybridge and onto a swift ribbon: smooth, over the junction’s hump', () => {
    const sim = testSim();
    sim.done.add('xp_swift'); // swift ribbons
    sim.rebuildDerived();
    sim.grant('gear', 50);
    stockedSilo(sim, 500, 520, 0, 'iron_ore', 400); // out at (500,519) going north
    expect(sim.placeBelts('ribbon', line(500, 519, 0, 4))).toBe(4); // (500,519)…(500,516)
    expect(sim.place('crossing', 500, 515, 0).ok).toBe(true); // the north–south line rides over it
    expect(sim.placeBelts('ribbon', line(500, 514, 0, 2))).toBe(2);
    expect(sim.place('skybridge', 500, 512, 0).ok).toBe(true);
    expect(sim.place('skybridge', 500, 509, 0).ok).toBe(true);
    expect(sim.placeBelts('swift_ribbon', line(500, 508, 0, 2))).toBe(2);
    expect(sim.place('incinerator', 500, 506, 0).ok).toBe(true);
    let humped = 0;
    sim.run(100);
    const st = watch(sim, 600, [[500.5, 519.5]], [[500.5, 506.5]], (it) => {
      if (Math.abs(it.y - 515.5) < 0.05 && it.z > 0) { humped++; expect(it.z).toBeCloseTo(HUMP_Z, 0); expect(it.o).toBe(1); }
    });
    expect(st.drawn / st.frames).toBeGreaterThan(5); // the line is busy
    expect(st.maxStep).toBeLessThan(0.2);
    expect(st.popped).toEqual([]);
    expect(st.lost).toEqual([]);
    expect(humped).toBeGreaterThan(10);
    expect(sim.consumed[itemIdx('iron_ore')]).toBeGreaterThan(40_000);
  });

  it('a router dealing a line out three ways: items glide into its centre and out of it, none jump or vanish', () => {
    const sim = testSim();
    stockedSilo(sim, 512, 508, 0, 'iron_ore', 400);
    sim.placeBelts('ribbon', [[512, 507, 0]]);
    expect(sim.place('router', 512, 506, 0).ok).toBe(true);
    sim.placeBelts('ribbon', line(512, 505, 0, 6)); // north, to (512,500)
    sim.placeBelts('ribbon', line(513, 506, 1, 6)); // east, to (518,506)
    sim.placeBelts('ribbon', line(511, 506, 3, 6)); // west, to (506,506)
    for (const [x, y] of [[512, 499], [519, 506], [505, 506]] as const) expect(sim.place('incinerator', x, y, 0).ok).toBe(true);
    sim.run(100);
    const st = watch(sim, 600, [[512.5, 507.5]], [[512.5, 499.5], [519.5, 506.5], [505.5, 506.5]]);
    expect(st.drawn / st.frames).toBeGreaterThan(5);
    expect(st.maxStep).toBeLessThan(0.2);
    expect(st.popped).toEqual([]);
    expect(st.lost).toEqual([]);
  });

  it('a jammed line: every item sits still on its own tile', () => {
    const sim = testSim();
    stockedSilo(sim, 500, 520, 0, 'sand', 100);
    sim.placeBelts('ribbon', line(500, 519, 0, 8)); // a dead end
    sim.run(1200);
    const flow = new CellFlow();
    flow.setPieces(buildPieces(sim, beltPiece, 20));
    const at = (t: number): string[] => { const o: string[] = []; flow.each(sim, t, [400, 400, 620, 620], (it) => o.push(`${it.x.toFixed(3)},${it.y.toFixed(3)}`)); return o.sort(); };
    const a = at(sim.tick + 0.2), b = at(sim.tick + 0.9);
    expect(a).toHaveLength(8);
    expect(b).toEqual(a);
    for (const p of a) expect(Number(p.split(',')[0])).toBeCloseTo(500.5, 6); // tile centres
  });
});
