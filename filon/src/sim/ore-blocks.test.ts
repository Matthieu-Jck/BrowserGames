// ore-blocks.test.ts — map 4's deposits in whole blocks (D104; owner, 2026-10-17: « les ressources
// disponibles ne sont pas des multiples de la taille des machines qui les extraient »): every ore
// tile lies in a 2 × 2 block of its ore on the world's even grid, so drills on that grid cover a
// deposit whole, yet each is an irregular patch, not a square (owner: « it still has to look
// natural »); the cirque's deposits keep their richness, size and place (shifted a block along
// the Crown per player, never towards the Heart); a drill held over ore snaps onto the grid, and
// the debug bases' drill search takes it first. Maps 1–3 stay tile by tile.
import { describe, it, expect } from 'vitest';
import { CIRQUE, MAPS, MAP_VERSION, WORLD_SEED } from '@/content/world';
import { buildingIdx, itemIdx } from '@/content/registry';
import { hash32 } from '@/core/hash';
import { CENTER, WORLD, WORLD_EPOCH0 } from './constants';
import { isFaceOre } from './face';
import { oreSnap } from './ore-blocks';
import { spotsNear } from './dev';
import { Sim } from './state';
import { across, blocksOf, MapGen } from './world/mapgen';
import { Grid } from './world/grid';

const SEEDS = [1000, 8919, 16838, 24757, 32676, 8];
const world = (seed: number, v = 4): { gen: MapGen; g: Grid } => {
  const gen = new MapGen(WORLD_SEED, seed, v);
  return { gen, g: new Grid(gen) };
};
const V4 = MAPS[4]!.cirque.deposits;

/** Do these tiles fill their bounding box? */
function isRectangle(tiles: ReadonlySet<number>): boolean {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const k of tiles) { const x = k % WORLD, y = Math.floor(k / WORLD); x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  return (x1 - x0 + 1) * (y1 - y0 + 1) === tiles.size;
}

/**
 * The deposit of `item` nearest (cx, cy) within `r`: its tiles joined edge to edge (the north iron,
 * shifted a block along the Crown, may come within two tiles of the north-west one, never touching
 * it) and the sum of their caps.
 */
function oreAround(g: Grid, item: number, cx: number, cy: number, r: number): { tiles: Set<number>; sum: number } {
  let start = -1, best = Infinity;
  for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
    const d = (x - cx) ** 2 + (y - cy) ** 2;
    if (g.ore(x, y) === item && d < best) { best = d; start = y * WORLD + x; }
  }
  const tiles = new Set<number>(start < 0 ? [] : [start]), todo = [...tiles];
  let sum = 0;
  while (todo.length) {
    const k = todo.pop()!, x = k % WORLD, y = Math.floor(k / WORLD);
    sum += g.capMuPerEpoch(x, y);
    for (const [a, b] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as const) {
      const q = b * WORLD + a;
      if (!tiles.has(q) && g.ore(a, b) === item) { tiles.add(q); todo.push(q); }
    }
  }
  return { tiles, sum };
}

describe('deposits in whole blocks (map 4, D104)', () => {
  it('map 4 and today\'s map (6: map 4 with D136\'s quartz faces and D147\'s spires) come in blocks, maps 1–3 tile by tile', () => {
    expect(MAP_VERSION).toBe(6);
    for (const v of [4, 5, 6]) expect(MAPS[v]!.oreBlock).toBe(2);
    for (const v of [1, 2, 3]) expect(MAPS[v]!.oreBlock ?? 1).toBe(1);
    expect(new MapGen(WORLD_SEED, 8, 3).oreBlock).toBe(1);
  });

  it('a disc in blocks keeps its richness to the unit and its size to the block, its heart richer', () => {
    for (const [r2, rich] of [[11.56, 500], [8.41, 300], [2.89, 75], [16, 400], [3.2, 260]] as const) {
      for (const [cx, cy] of [[512, 502], [513, 503], [496, 513], [700, 211]] as const) {
        let n = 0, total = 0;
        for (let dy = -5; dy <= 5; dy++) for (let dx = -5; dx <= 5; dx++) {
          const d2 = dx * dx + dy * dy;
          if (d2 <= r2) { n++; total += d2 * 3 <= r2 ? rich : Math.floor((rich * 700) / 1000); }
        }
        const t = blocksOf({ cx, cy, r2, rich }, 2);
        const tiles = t.length / 3;
        expect(tiles % 4).toBe(0);
        expect(Math.abs(tiles - n), `r² ${r2} at (${cx}, ${cy})`).toBeLessThanOrEqual(2);
        let sum = 0;
        for (let i = 0; i < t.length; i += 3) sum += t[i + 2]!;
        expect(sum).toBe(total);
        // Block by block on the even grid, each block's tiles alike (to the unit the sum's rest adds).
        for (let i = 0; i < t.length; i += 12) {
          expect(t[i]! % 2 === 0 && t[i + 1]! % 2 === 0, 'a block on the grid').toBe(true);
          const rs = [t[i + 2]!, t[i + 5]!, t[i + 8]!, t[i + 11]!];
          expect(Math.max(...rs) - Math.min(...rs)).toBeLessThanOrEqual(1);
        }
        // Never richer at the rim than at the heart.
        if (tiles >= 12) expect(t[2]!).toBeGreaterThanOrEqual(t[t.length - 1]! - 1);
      }
    }
  });

  it('every ore tile on map 4 lies in a whole 2 × 2 block of its ore, on the even grid', () => {
    for (const seed of SEEDS.slice(0, 4)) {
      const { gen, g } = world(seed);
      const R = 170;
      let tiles = 0, bad = 0;
      for (let y = CENTER - R; y < CENTER + R; y++) for (let x = CENTER - R; x < CENTER + R; x++) {
        const o = g.ore(x, y);
        if (o < 0 || isFaceOre(o)) continue;
        tiles++;
        const bx = x & ~1, by = y & ~1;
        for (const [a, b] of [[bx, by], [bx + 1, by], [bx, by + 1], [bx + 1, by + 1]] as const) if (g.ore(a, b) !== o) bad++;
      }
      expect(tiles, `seed ${seed}`).toBeGreaterThan(400);
      expect(bad, `seed ${seed}: ore tiles in a broken block`).toBe(0);
      // The deposits of three blocks or more: irregular patches, a rectangle now and then at most.
      const seen = new Set<number>();
      let patches = 0, rects = 0;
      for (let y = CENTER - R; y < CENTER + R; y++) for (let x = CENTER - R; x < CENTER + R; x++) {
        const o = g.ore(x, y);
        if (o < 0 || isFaceOre(o) || seen.has(y * WORLD + x)) continue;
        const p = oreAround(g, o, x, y, 0);
        for (const k of p.tiles) seen.add(k);
        if (p.tiles.size < 12) continue;
        patches++;
        if (isRectangle(p.tiles)) rects++;
      }
      expect(patches, `seed ${seed}`).toBeGreaterThan(20);
      expect(rects * 5, `seed ${seed}: ${rects} rectangles of ${patches}`).toBeLessThan(patches);
      // The copper field too, whole.
      const cf = oreAround(g, itemIdx('copper_ore'), gen.copperField.cx, gen.copperField.cy, 7);
      expect(cf.tiles.size % 4).toBe(0);
      expect(cf.tiles.size).toBeGreaterThanOrEqual(44);
    }
  });

  it('the cirque\'s deposits: the template\'s richness to the unit, its size to the block, a block along the Crown per player', () => {
    const gaps = new Map<number, Set<number>>();
    for (const seed of SEEDS) {
      const a = world(seed, 3).g, b = world(seed, 4).g;
      V4.forEach((d, i) => {
        const old = CIRQUE.deposits[i]!;
        expect(d.item).toBe(old.item);
        expect(Math.abs(d.dx - old.dx) + Math.abs(d.dy - old.dy), 'at most a tile off the template').toBeLessThanOrEqual(2);
        const it = itemIdx(d.item);
        // The template's disc as map 3 lays it (its ±20 % per player), whole: map 3's own may lose
        // a rim tile to the Crown where the north-west iron runs up to it.
        const rich = Math.floor((d.rich * (800 + (hash32(seed >>> 0, 50 + i) % 401))) / 1000), r2 = d.radius * d.radius;
        let n = 0, total = 0;
        for (let dy = -5; dy <= 5; dy++) for (let dx = -5; dx <= 5; dx++) {
          const q = dx * dx + dy * dy;
          if (q <= r2) { n++; total += q * 3 <= r2 ? rich : Math.floor((rich * 700) / 1000); }
        }
        const was = oreAround(a, it, CENTER + old.dx, CENTER + old.dy, 6), now = oreAround(b, it, CENTER + d.dx, CENTER + d.dy, 7);
        expect(was.sum, `seed ${seed} ${d.item}: map 3`).toBeLessThanOrEqual(10 * total);
        expect(now.sum, `seed ${seed} ${d.item}`).toBe(10 * total);
        expect(now.tiles.size % 4).toBe(0);
        expect(Math.abs(now.tiles.size - n), `seed ${seed} ${d.item}`).toBeLessThanOrEqual(2);
        // A natural patch, not a rectangle (owner: « it still has to look natural »), but for the
        // tired vein's two blocks.
        if (now.tiles.size > 8) expect(isRectangle(now.tiles), `seed ${seed} ${d.item}: a rectangle`).toBe(false);
        // How near it comes to the Heart along its bearing (the shift's way turned a quarter): the
        // same on every land.
        const [ux, uy] = across(d.dx, d.dy);
        let near = Infinity;
        for (const k of now.tiles) { const x = k % WORLD, y = Math.floor(k / WORLD); near = Math.min(near, Math.abs((x - CENTER) * uy - (y - CENTER) * ux)); }
        if (!gaps.has(i)) gaps.set(i, new Set());
        gaps.get(i)!.add(near);
      });
    }
    for (const [i, g] of gaps) expect(g.size, V4[i]!.item).toBe(1);
  });

  it('a drill held over ore snaps onto the blocks\' grid; off the ore, on maps 1–3, a 3 × 3 bore: where the cursor puts it', () => {
    const { g } = world(SEEDS[0]!);
    const d = V4[0]!, drill = buildingIdx('drill');
    // An odd corner over the north iron: down to the grid, still under the cursor.
    const [x, y] = [CENTER + d.dx + 1, CENTER + d.dy - 1];
    expect(g.ore(x, y)).toBe(itemIdx('iron_ore'));
    const [sx, sy] = oreSnap(g, drill, x, y, 0);
    expect([sx % 2, sy % 2]).toEqual([0, 0]);
    expect(x - sx).toBeLessThanOrEqual(1);
    expect(y - sy).toBeLessThanOrEqual(1);
    for (const [a, b] of [[sx, sy], [sx + 1, sy], [sx, sy + 1], [sx + 1, sy + 1]] as const) expect(g.ore(a, b)).toBe(itemIdx('iron_ore'));
    // The 4 × 4 giant snaps too; the 3 × 3 deep bore and a sand collector do not.
    expect(oreSnap(g, buildingIdx('giant_drill'), x, y, 0).map((v) => v % 2)).toEqual([0, 0]);
    expect(oreSnap(g, buildingIdx('deep_bore'), x, y, 0)).toEqual([x, y]);
    expect(oreSnap(g, buildingIdx('sand_collector'), x, y, 0)).toEqual([x, y]);
    // Off the ore (the Heart's floor), and on map 3: unmoved.
    expect(oreSnap(g, drill, CENTER + 5, CENTER + 3, 0)).toEqual([CENTER + 5, CENTER + 3]);
    const old = world(SEEDS[0]!, 3).g;
    expect(oreSnap(old, drill, x, y, 0)).toEqual([x, y]);
  });

  it('the debug bases\' drill search takes the grid first', () => {
    const sim = new Sim({ worldSeed: WORLD_SEED, playerSeed: SEEDS[0]!, foundingEpoch: WORLD_EPOCH0, source: new MapGen(WORLD_SEED, SEEDS[0]!, 4) });
    const d = V4[1]!;
    const spots = spotsNear(sim, 'drill', [CENTER + d.dx, CENTER + d.dy], { item: d.item, r: 8 });
    expect(spots.length).toBeGreaterThan(0);
    // The first spots are on the grid, as many as the deposit has blocks free to its lines.
    const first = spots.findIndex(([x, y]) => x % 2 !== 0 || y % 2 !== 0);
    expect(first === -1 || first >= 4, `an off-grid spot at ${first}`).toBe(true);
  });
});
