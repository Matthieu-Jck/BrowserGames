// item-speed.test.ts — an item keeps its line's pace everywhere (D121, owner, 2026-10-17: « la
// vitesse sur le bridge, la junction, est plus rapide que sur les tapis d'entrée et de sortie,
// c'est bizarre »): over a skybridge's span and through a junction it moves as fast as on the
// ribbons before and after, on both axes, at every span, for a plain and a swift line. Measured as
// the app draws: the real engine at 60 frames a second, each item matched to where it was the
// frame before, its speed (tiles a tick) binned by the tile it is over.
import { describe, it, expect } from 'vitest';
import { line, stockedSilo, testSim } from '@/sim/testkit';
import { DX, DY, opposite, type Ent, type Rot } from '@/sim/types';
import { tileIndex } from '@/sim/world/grid';
import type { Sim } from '@/sim/state';
import { BeltLift, ITEM_DZ } from './belt-lift';
import { CellFlow } from './cell-flow';
import { OVER, buildPieces } from './item-flow';
import { deckSquareZ, depthKey } from './stand';

/** The views' rule for a ribbon tile (buildings-view's beltPiece, which pulls in Pixi). */
function beltPiece(sim: Sim, e: Ent): { corner: boolean; rot: Rot } {
  const r = e.rot;
  const fed = sim.graph?.feedDirs.get(tileIndex(e.x, e.y)) ?? 0;
  if (!fed || fed & (1 << opposite(r))) return { corner: false, rot: r };
  const sides = ([((r + 1) & 3), ((r + 3) & 3)] as Rot[]).filter((s) => fed & (1 << s));
  return sides.length === 1 ? { corner: true, rot: opposite(sides[0]!) } : { corner: false, rot: r };
}

type Kind = 'ribbon' | 'span' | 'junction';

/**
 * A straight line along `rot` from (x, y): `pre` ribbons, a skybridge pair `gap` tiles apart (0: none),
 * `mid` ribbons, a junction (or none), `post` ribbons, an incinerator: fed by a stocked silo behind
 * it. Returns the kind of each tile along the line (by its index along `rot`).
 */
function layout(sim: Sim, x: number, y: number, rot: Rot, tier: string, gap: number, junction: boolean): Map<number, Kind> {
  const dx = DX[rot]!, dy = DY[rot]!;
  const kinds = new Map<number, Kind>();
  const at = (k: number): [number, number] => [x + dx * k, y + dy * k];
  // A silo whose out port hands onto (x, y): it lies behind the line (its 2 × 2 footprint, turned).
  const [ox, oy] = rot === 0 ? [0, 1] : rot === 1 ? [-2, 0] : rot === 2 ? [-1, -2] : [1, -1];
  stockedSilo(sim, x + ox, y + oy, rot, 'iron_ore', 2000);
  let k = 0;
  const ribbons = (n: number): void => {
    const [sx, sy] = at(k);
    expect(sim.placeBelts(tier as 'ribbon', line(sx, sy, rot, n))).toBe(n);
    for (let i = 0; i < n; i++) kinds.set(k + i, 'ribbon');
    k += n;
  };
  ribbons(5);
  if (gap > 0) {
    expect(sim.place('skybridge', ...at(k), rot).ok).toBe(true);
    for (let i = 1; i <= gap; i++) kinds.set(k + i, 'span');
    expect(sim.place('skybridge', ...at(k + gap + 1), rot).ok).toBe(true);
    k += gap + 2;
  }
  ribbons(5);
  if (junction) {
    expect(sim.place('crossing', ...at(k), 0).ok).toBe(true);
    kinds.set(k, 'junction');
    k += 1;
  }
  ribbons(5);
  expect(sim.place('incinerator', ...at(k), 0).ok).toBe(true);
  return kinds;
}

/** Mean speed (tiles a tick) of the items over each kind of tile, drawn at 60 frames a second for `ticks`. */
function speeds(sim: Sim, x: number, y: number, rot: Rot, kinds: Map<number, Kind>, ticks: number): Record<Kind, number> {
  sim.ensureCompiled();
  const flow = new CellFlow();
  flow.setPieces(buildPieces(sim, beltPiece, 20));
  const dx = DX[rot]!, dy = DY[rot]!;
  const along = (px: number, py: number): number => (px - x - 0.5) * dx + (py - y - 0.5) * dy; // tiles from the first ribbon's centre
  const sum: Record<Kind, number> = { ribbon: 0, span: 0, junction: 0 }, n: Record<Kind, number> = { ribbon: 0, span: 0, junction: 0 };
  let prev: number[] | null = null;
  for (let f = 0; f < ticks * 6; f++) {
    if (f % 6 === 0) sim.step();
    const cur: number[] = [];
    flow.each(sim, sim.tick + (f % 6) / 6, [400, 400, 620, 620], (it) => cur.push(along(it.x, it.y)));
    if (prev) {
      for (const s of cur) {
        // The item it was: the nearest one behind it (or level), within half a tile.
        let best = Infinity;
        for (const p of prev) if (p <= s + 1e-9 && s - p < best) best = s - p;
        if (!(best < 0.5)) continue;
        const kind = kinds.get(Math.floor(s - best / 2 + 0.5)); // the tile it is over (by the middle of the move)
        if (!kind) continue;
        sum[kind] += best * 6; n[kind]++;
      }
    }
    prev = cur;
  }
  return { ribbon: sum.ribbon / n.ribbon, span: n.span ? sum.span / n.span : NaN, junction: n.junction ? sum.junction / n.junction : NaN };
}

describe('an item keeps its line’s pace (D121)', () => {
  for (const [name, rot] of [['northward', 0], ['eastward', 1]] as const) {
    for (const gap of [1, 2, 3]) {
      it(`${name}, a skybridge ${gap + 1} tiles long and a junction: as fast over them as on the ribbons`, () => {
        const sim = testSim();
        const x = 500, y = rot === 0 ? 540 : 500;
        const kinds = layout(sim, x, y, rot, 'ribbon', gap, true);
        sim.run(400); // the line full and flowing
        const v = speeds(sim, x, y, rot, kinds, 300);
        expect(v.ribbon).toBeGreaterThan(0.08);
        expect(Math.abs(v.span / v.ribbon - 1)).toBeLessThan(0.1);
        expect(Math.abs(v.junction / v.ribbon - 1)).toBeLessThan(0.1);
      });
    }
  }

  it('a swift line keeps its own, faster pace over a skybridge and a junction', () => {
    const sim = testSim();
    sim.done.add('xp_swift');
    sim.rebuildDerived();
    sim.grant('gear', 50);
    const kinds = layout(sim, 500, 540, 0, 'swift_ribbon', 3, true);
    sim.run(400);
    const v = speeds(sim, 500, 540, 0, kinds, 300);
    expect(v.ribbon).toBeGreaterThan(0.15);
    expect(Math.abs(v.span / v.ribbon - 1)).toBeLessThan(0.1);
    expect(Math.abs(v.junction / v.ribbon - 1)).toBeLessThan(0.1);
  });

  it('a backed-up line waits on the deck too: a token over each tile of the gap, at the deck’s height, sorted with the deck (owner: « les objets devraient pouvoir patienter sur le pont »)', () => {
    const sim = testSim();
    stockedSilo(sim, 500, 520, 0, 'iron_ore', 500); // out at (500, 519)
    expect(sim.placeBelts('ribbon', line(500, 519, 0, 3))).toBe(3);
    expect(sim.place('skybridge', 500, 516, 0).ok).toBe(true);
    expect(sim.placeBelts('ribbon', line(497, 514, 1, 7))).toBe(7); // a line under the deck, east
    expect(sim.place('skybridge', 500, 512, 0).ok).toBe(true); // the gap: 515…513
    expect(sim.placeBelts('ribbon', line(500, 511, 0, 3))).toBe(3); // 511…509: a dead end
    const silo = sim.place('silo', 501, 512, 0); // tall, beside the deck's far end and in front of it
    expect(silo.ok).toBe(true);
    sim.run(1200); // the line fills and stops
    sim.ensureCompiled();
    const c = sim.chainAt(500, 519)!;
    expect(c.cells.every((v) => v > 0)).toBe(true); // every cell full, the three over the gap too
    const flow = new CellFlow();
    flow.setPieces(buildPieces(sim, beltPiece, 20));
    const lift = new BeltLift();
    lift.rebuild(sim);
    const deck: Array<{ y: number; z: number; o: number; key: number }> = [];
    flow.each(sim, sim.tick + 0.5, [400, 400, 620, 620], (it) => { if (it.x > 500 && it.x < 501 && it.y > 513 && it.y < 516) deck.push({ y: it.y, z: it.z, o: it.o, key: lift.spanZ(it.x, it.y) }); });
    deck.sort((a, b) => a.y - b.y);
    expect(deck.map((d) => d.y)).toEqual([513.5, 514.5, 515.5]); // each on its tile's centre, still
    for (const d of deck) {
      expect(d.z).toBe(20); // at the deck's height
      expect(d.o).toBe(OVER.sky);
      expect(d.key).toBe(deckSquareZ(500, Math.floor(d.y), 0) + ITEM_DZ.span); // just over its deck square, among the volumes
    }
    // The silo stands in front of the deck's far square: it hides the token there as it hides the deck.
    expect(depthKey(sim.ents.get(silo.id!)!)).toBeGreaterThan(deck[0]!.key);
  });
});

