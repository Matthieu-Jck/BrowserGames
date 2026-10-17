// ore.test.ts — the ground ores painted (D99): each ore in its own material (iron's rust and
// magnetite, never copper's malachite; copper's orange and green), richer tiles wearing more, a
// hidden vein only a faint mark, and a deposit across a chunk seam painted the same from both
// sides (every choice hashed from world coordinates). A recorder stands in for the canvas.
import { describe, expect, it } from 'vitest';
import { itemIdx } from '@/content/registry';
import { T } from '@/sim/types';
import { BORDER, WIN, type PaintData } from './paint-kit';
import { LOOKS, ORE_LOOK, nodulesOf, paintDeposits, richness } from './ore';

interface Rec { ctx: CanvasRenderingContext2D; fills: string[]; arcs: string[] }

/** A stand-in 2D context: records each fill's style, and each arc's centre in WORLD px (chunk px + the chunk's origin). */
function recorder(ox: number, oy: number): Rec {
  const fills: string[] = [], arcs: string[] = [];
  const t: Record<string | symbol, unknown> = { fillStyle: '#000000', strokeStyle: '#000000', globalAlpha: 1, lineWidth: 1 };
  const ctx = new Proxy(t, {
    get(o, k): unknown {
      if (k === 'fill') return () => { fills.push(String(o.fillStyle)); };
      if (k === 'arc') return (x: number, y: number, r: number) => { arcs.push(`${(x + ox).toFixed(2)},${(y + oy).toFixed(2)},${r.toFixed(2)},${String(o.fillStyle)}`); };
      if (k in o) return o[k];
      return () => undefined;
    },
    set(o, k, v): boolean { o[k] = v; return true; },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, fills, arcs };
}

/** The paint window of chunk (cx, cy) over a world of sand where `deposit` holds ore. */
function windowOf(cx: number, cy: number, deposit: (x: number, y: number) => [item: number, rich: number] | null, terrain: (x: number, y: number) => number = () => T.Sand): PaintData {
  const n = WIN * WIN;
  const d: PaintData = { cx, cy, terrain: new Uint8Array(n), ore: new Uint8Array(n), rich: new Uint16Array(n), height: new Uint8Array(n), biome: new Uint8Array(n), level: new Uint8Array(n) };
  for (let j = 0; j < WIN; j++) for (let i = 0; i < WIN; i++) {
    const x = cx * 32 - BORDER + i, y = cy * 32 - BORDER + j, o = j * WIN + i;
    d.terrain[o] = terrain(x, y);
    const dep = deposit(x, y);
    if (dep) { d.ore[o] = dep[0] + 1; d.rich[o] = dep[1]; }
  }
  return d;
}

const IRON = itemIdx('iron_ore'), COPPER = itemIdx('copper_ore'), COAL = itemIdx('coal');
/** A 12 × 10 field in chunk (4, 4). */
const field = (item: number, rich: number) => (x: number, y: number): [number, number] | null => (x >= 138 && x < 150 && y >= 140 && y < 150 ? [item, rich] : null);

describe('the ground ores (D99)', () => {
  it('every ground ore has a look of its own; an item without one, its colour as a pebble', () => {
    expect(LOOKS[IRON]).toBe(ORE_LOOK.iron_ore);
    expect(LOOKS[COPPER]).toBe(ORE_LOOK.copper_ore);
    expect(LOOKS[COAL]).toBe(ORE_LOOK.coal);
    expect(LOOKS[itemIdx('salt')]).toBe(ORE_LOOK.salt);
    expect(LOOKS[itemIdx('sporeglass')]!.kind).toBe('pebble');
    // Iron and copper are told apart by their stains: rust against verdigris.
    expect(ORE_LOOK.iron_ore.stain).not.toBe(ORE_LOOK.copper_ore.stain);
  });

  it('iron in rust and magnetite, copper in orange and malachite: neither wears the other\'s', () => {
    for (const ppt of [16, 32, 64]) {
      const iron = recorder(0, 0), copper = recorder(0, 0);
      paintDeposits(iron.ctx, windowOf(4, 4, field(IRON, 500)), ppt);
      paintDeposits(copper.ctx, windowOf(4, 4, field(COPPER, 500)), ppt);
      expect(iron.fills, `iron ${ppt}`).toContain(ORE_LOOK.iron_ore.stain);
      expect(iron.fills).toContain(ORE_LOOK.iron_ore.body);
      expect(iron.fills).toContain(ORE_LOOK.iron_ore.accent);
      expect(iron.fills).not.toContain(ORE_LOOK.copper_ore.accent);
      expect(copper.fills, `copper ${ppt}`).toContain(ORE_LOOK.copper_ore.stain);
      expect(copper.fills).toContain(ORE_LOOK.copper_ore.body);
      expect(copper.fills).toContain(ORE_LOOK.copper_ore.accent);
      expect(copper.fills).not.toContain(ORE_LOOK.iron_ore.accent);
    }
  });

  it('richer tiles wear more: more nodules a tile, and more paint over a deposit', () => {
    expect(richness(IRON, 350)).toBe(700); // a near deposit's rim
    expect(richness(IRON, 800)).toBe(1600); // the far ring's heart
    expect(nodulesOf(700, 64)).toBeLessThan(nodulesOf(1000, 64));
    expect(nodulesOf(1000, 64)).toBeLessThan(nodulesOf(1600, 64));
    expect(nodulesOf(1600, 8)).toBe(1);
    const poor = recorder(0, 0), rich = recorder(0, 0);
    paintDeposits(poor.ctx, windowOf(4, 4, field(IRON, 350)), 32);
    paintDeposits(rich.ctx, windowOf(4, 4, field(IRON, 800)), 32);
    expect(rich.fills.length).toBeGreaterThan(poor.fills.length * 1.5);
  });

  it('a vein under rock is a faint mark, no stain', () => {
    const r = recorder(0, 0);
    paintDeposits(r.ctx, windowOf(4, 4, field(COPPER, 500), (x, y) => (x >= 138 && x < 150 && y >= 140 && y < 150 ? T.Rock2 : T.Sand)), 32);
    expect(r.fills).not.toContain(ORE_LOOK.copper_ore.stain);
    expect(r.fills.length).toBe(120); // one mark a tile
  });

  it('a deposit across a chunk seam: both chunks paint the tiles along it alike', () => {
    // A field across the seam between chunks (4, 4) and (5, 4), world x = 160.
    const dep = (x: number, y: number): [number, number] | null => (x >= 150 && x < 170 && y >= 140 && y < 150 ? [COAL, 300 + ((x * 7 + y * 3) % 5) * 40] : null);
    const ppt = 32;
    const a = recorder(4 * 32 * ppt, 4 * 32 * ppt), b = recorder(5 * 32 * ppt, 4 * 32 * ppt);
    paintDeposits(a.ctx, windowOf(4, 4, dep), ppt);
    paintDeposits(b.ctx, windowOf(5, 4, dep), ppt);
    // The arcs (grit, glints' halos) of the tiles either side of the seam, world x 159–160.
    const near = (s: string): boolean => { const x = Number(s.split(',')[0]) / ppt; return x >= 159.2 && x < 160.8; };
    const sa = a.arcs.filter(near), sb = b.arcs.filter(near);
    expect(sa.length).toBeGreaterThan(10);
    expect(sb.sort()).toEqual(sa.sort());
  });
});
