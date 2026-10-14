// mapgen.test.ts — Ysmère's land on the real generator: deterministic; the same cirque for every
// player, closed all round by the Crown's terraces (D45) and crossed one level per step; the
// tutorial's distances; mountains up to 5 around it, terraced and climbable; the deposits on the
// floor; the unique sites, the copper field and the archetypes where they belong.
import { describe, it, expect } from 'vitest';
import { BUILDINGS } from '@/content/buildings';
import { CIRQUE, COS64, MOUNTAINS, SIN64, WORLD_SEED, UNIQUE_BIOMES } from '@/content/world';
import { buildingIdx, itemIdx } from '@/content/registry';
import { isqrt } from '@/core/fixed';
import { CENTER, CHUNK, WORLD } from '../constants';
import { gap2 } from '../power/links';
import { T, isRock } from '../types';
import { BIOME, MapGen } from './mapgen';
import { Grid, MAX_LEVEL } from './grid';

const SEEDS = Array.from({ length: 16 }, (_, i) => 1000 + i * 7919);
const world = (seed: number): { gen: MapGen; g: Grid } => {
  const gen = new MapGen(WORLD_SEED, seed);
  return { gen, g: new Grid(gen) };
};
const d2c = (x: number, y: number): number => (x - CENTER) * (x - CENTER) + (y - CENTER) * (y - CENTER);
const biomeAt = (g: Grid, x: number, y: number): number => g.chunkAt(x >> 5, y >> 5).biome[(y & 31) * CHUNK + (x & 31)]!;
const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

/**
 * Breadth-first from `start` over 4-neighbours inside `within`, stepping from a to b only where
 * `step` allows; stops at the first tile `goal` accepts. Returns the tiles reached (x + y·WORLD).
 */
function flood(
  start: readonly [number, number],
  step: (ax: number, ay: number, bx: number, by: number) => boolean,
  within: (x: number, y: number) => boolean,
  goal: (x: number, y: number) => boolean = () => false,
): { seen: Set<number>; found: boolean } {
  const seen = new Set<number>([start[1] * WORLD + start[0]]);
  const todo: Array<readonly [number, number]> = [start];
  for (let i = 0; i < todo.length; i++) {
    const [x, y] = todo[i]!;
    if (goal(x, y)) return { seen, found: true };
    for (const [dx, dy] of N4) {
      const u = x + dx, v = y + dy, k = v * WORLD + u;
      if (seen.has(k) || !within(u, v) || !step(x, y, u, v)) continue;
      seen.add(k);
      todo.push([u, v]);
    }
  }
  return { seen, found: false };
}

/** A climb: one level at most per step. */
const climb = (g: Grid) => (ax: number, ay: number, bx: number, by: number): boolean => Math.abs(g.level(ax, ay) - g.level(bx, by)) <= 1;

describe('map generation', () => {
  it('is deterministic: the same seeds give the same tiles and levels', () => {
    const a = world(42).g, b = world(42).g;
    for (const [cx, cy] of [[16, 16], [10, 3], [25, 20], [14, 15]] as const) {
      const ca = a.chunkAt(cx, cy), cb = b.chunkAt(cx, cy);
      for (const k of ['terrain', 'ore', 'rich', 'level', 'height', 'biome'] as const) expect(Array.from(ca[k]), k).toEqual(Array.from(cb[k]));
    }
  });

  it('every colony lands in the same cirque: Hearth spot, deposits, lake, and the Crown all round', () => {
    for (const seed of SEEDS) {
      const { g } = world(seed);
      for (let y = CENTER - 4; y <= CENTER + 4; y++) {
        for (let x = CENTER - 4; x <= CENTER + 4; x++) {
          expect(g.terrain(x, y), `seed ${seed}`).toBe(T.Sand);
          expect(g.ore(x, y)).toBe(-1);
        }
      }
      for (const d of CIRQUE.deposits) {
        let found = 0;
        for (let y = -2; y <= 2; y++) for (let x = -2; x <= 2; x++) if (g.ore(CENTER + d.dx + x, CENTER + d.dy + y) === itemIdx(d.item)) found++;
        expect(found, `seed ${seed} ${d.item}`).toBeGreaterThan(5);
      }
      expect(g.terrain(CENTER + CIRQUE.lake.dx, CENTER + CIRQUE.lake.dy)).toBe(T.Deep);
      // The Crown: rock all around at r 26 (past the floor's rim, short of the thinnest Crown's
      // foot) — no pass any more (D45).
      let rock = 0;
      for (let k = 0; k < 360; k++) {
        const x = CENTER + Math.round(26 * Math.cos((k * Math.PI) / 180)), y = CENTER + Math.round(26 * Math.sin((k * Math.PI) / 180));
        if (isRock(g.terrain(x, y)) && g.level(x, y) > 0) rock++;
      }
      expect(rock, `seed ${seed}`).toBe(360);
    }
  });

  it('the cirque floor is nearly identical across players (same land for everyone)', () => {
    const count = (g: Grid): number => {
      let n = 0;
      for (let y = CENTER - 20; y <= CENTER + 20; y++) for (let x = CENTER - 20; x <= CENTER + 20; x++) {
        const dx = x - CENTER, dy = y - CENTER;
        if (dx * dx + dy * dy <= 20 * 20 && g.terrain(x, y) === T.Sand) n++;
      }
      return n;
    };
    const counts = SEEDS.map((s) => count(world(s).g));
    const min = Math.min(...counts), max = Math.max(...counts);
    expect((max - min) / max).toBeLessThan(0.03);
  });

  it('the floor and the Crown\'s climb to its crest are the same land for every player, tile for tile', () => {
    // Out to r 26 everything is the shared template: the floor, the lake, the terraces up to the
    // crest (only the crest's outer edge and the way down follow the archetype).
    const ref = world(SEEDS[0]!).g;
    for (const seed of SEEDS.slice(1)) {
      const { g } = world(seed);
      let diff = 0;
      for (let y = CENTER - 26; y <= CENTER + 26; y++) for (let x = CENTER - 26; x <= CENTER + 26; x++) {
        if (d2c(x, y) <= 26 * 26 && (g.level(x, y) !== ref.level(x, y) || g.terrain(x, y) !== ref.terrain(x, y))) diff++;
      }
      expect(diff, `seed ${seed}`).toBe(0);
    }
  });

  it('the Crown closes the cirque: no level-0 path leads out of the floor, and every way out climbs to the crest', () => {
    for (const seed of SEEDS) {
      const { gen, g } = world(seed);
      const near = (x: number, y: number): boolean => d2c(x, y) <= 80 * 80;
      // On the floor's level, from the Heart: the whole floor and its deposits, never past its rim.
      const floor = flood([CENTER, CENTER], (_ax, _ay, bx, by) => g.level(bx, by) === 0, near);
      let far = 0;
      for (const k of floor.seen) far = Math.max(far, d2c(k % WORLD, Math.floor(k / WORLD)));
      // The rim wobbles by −amp … amp − 1: the floor never reaches past floorRadius + amp − 1.
      const rimMax = CIRQUE.floorRadius + CIRQUE.rimJitter.floor - 1;
      expect(isqrt(far), `seed ${seed}: the floor's level reaches r ${isqrt(far)}`).toBeLessThan(rimMax);
      for (const d of CIRQUE.deposits) expect(floor.seen.has((CENTER + d.dy) * WORLD + CENTER + d.dx), `seed ${seed} ${d.item} on the floor`).toBe(true);
      // Below the crest: still shut in. The crest stands at its level all round.
      const below = flood([CENTER, CENTER], (_ax, _ay, bx, by) => g.level(bx, by) < CIRQUE.crest, near);
      let out = 0;
      for (const k of below.seen) out = Math.max(out, d2c(k % WORLD, Math.floor(k / WORLD)));
      expect(isqrt(out), `seed ${seed} ${gen.archetype}: under the crest out to r ${isqrt(out)}`).toBeLessThan(rimMax + (CIRQUE.crest - 1) * CIRQUE.terrace);
    }
  });

  it('on the Crown and around it, neighbours are never more than one level apart; rock, and only rock, stands above level 0', () => {
    for (const seed of SEEDS) {
      const { gen, g } = world(seed);
      const R = MOUNTAINS.cliffFrom - 1;
      let steep = 0, wrong = 0, crown = 0;
      for (let y = CENTER - R; y <= CENTER + R; y++) {
        for (let x = CENTER - R; x <= CENTER + R; x++) {
          if (d2c(x, y) > R * R) continue;
          const l = g.level(x, y), t = g.terrain(x, y);
          if (Math.abs(l - g.level(x + 1, y)) > 1 || Math.abs(l - g.level(x, y + 1)) > 1) steep++;
          if (l < 0 || l > MAX_LEVEL || isRock(t) !== l > 0) wrong++;
          if (biomeAt(g, x, y) === BIOME.crown) {
            crown++;
            // Hardness follows height: H1 on the lower terraces, H2 on the crest.
            if (l < 1 || l > CIRQUE.crest || t !== T.Rock1 + CIRQUE.hardness[l - 1]! - 1) wrong++;
          }
        }
      }
      expect(steep, `seed ${seed} ${gen.archetype}: steps of two levels or more`).toBe(0);
      expect(wrong, `seed ${seed}: rock off its level`).toBe(0);
      expect(crown, `seed ${seed}: the Crown`).toBeGreaterThan(1000);
    }
  });

  it('a line climbs from the floor over the crest and down to the land outside in every direction, one level per step', () => {
    for (const seed of SEEDS) {
      const { gen, g } = world(seed);
      const R = gen.crownFoot + 30;
      for (let d = 0; d < 64; d += 8) {
        // A corridor 7 tiles wide from the Heart outwards (×1024: the trig table's scale).
        const ux = COS64[d]!, uy = SIN64[d]!;
        const inWedge = (x: number, y: number): boolean => {
          const dx = x - CENTER, dy = y - CENTER;
          return dx * ux + dy * uy >= -1024 && Math.abs(dx * uy - dy * ux) <= 3 * 1024 && d2c(x, y) <= R * R;
        };
        const outside = (x: number, y: number): boolean => g.level(x, y) === 0 && d2c(x, y) >= (gen.crownFoot + 1) ** 2;
        const way = flood([CENTER, CENTER], climb(g), inWedge, outside);
        expect(way.found, `seed ${seed} ${gen.archetype}: over the Crown towards ${d}/64`).toBe(true);
      }
    }
  });

  it('mountains rise around the cirque, up to 5, terraced: a two-level cliff only far out and facing east, and every mountain climbable', () => {
    let top = 0;
    for (const seed of SEEDS.slice(0, 5)) {
      const { gen, g } = world(seed);
      // The levels of the disc r ≤ R (and one tile past it), read once.
      const R = 150, S = 2 * R + 3, o = CENTER - R - 1;
      const lv = new Uint8Array(S * S), crown = new Uint8Array(S * S);
      for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
        lv[j * S + i] = g.level(o + i, o + j);
        crown[j * S + i] = biomeAt(g, o + i, o + j) === BIOME.crown ? 1 : 0;
      }
      const at = (x: number, y: number): number => lv[(y - o) * S + (x - o)]!;
      const inDisc = (x: number, y: number): boolean => d2c(x, y) <= R * R;
      const cliff2 = MOUNTAINS.cliffFrom ** 2, from2 = (MOUNTAINS.from - 1) ** 2;
      let land = 0, raised = 0, badCliff = 0, over = 0;
      const peaks: Array<[number, number]> = [];
      const seen = new Uint8Array(S * S);
      for (let y = CENTER - R; y <= CENTER + R; y++) {
        for (let x = CENTER - R; x <= CENTER + R; x++) {
          if (!inDisc(x, y)) continue;
          const l = at(x, y), e = at(x + 1, y), s = at(x, y + 1);
          if (l > MAX_LEVEL) over++;
          top = Math.max(top, l);
          // Every step of two levels or more: east-facing (the west tile higher), exactly two, out past cliffFrom.
          if (Math.abs(l - s) > 1) badCliff++;
          if (Math.abs(l - e) > 1 && (l - e !== 2 || d2c(x, y) < cliff2 || d2c(x + 1, y) < cliff2)) badCliff++;
          const k = (y - o) * S + (x - o);
          if (d2c(x, y) < from2 || crown[k]) continue;
          land++;
          if (l === 0) continue;
          raised++;
          if (seen[k]) continue;
          // One mountain (outside the Crown): mark it, keep its highest tile.
          let px = x, py = y;
          const todo = [k];
          seen[k] = 1;
          for (let q = 0; q < todo.length; q++) {
            const c = todo[q]!, u = o + (c % S), v = o + Math.floor(c / S);
            if (lv[c]! > at(px, py)) { px = u; py = v; }
            for (const [dx, dy] of N4) {
              const n = c + dy * S + dx;
              if (!inDisc(u + dx, v + dy) || seen[n] || !lv[n] || crown[n]) continue;
              seen[n] = 1;
              todo.push(n);
            }
          }
          peaks.push([px, py]);
        }
      }
      expect(over, `seed ${seed}: above MAX_LEVEL`).toBe(0);
      expect(badCliff, `seed ${seed}: cliffs`).toBe(0);
      expect(raised / land, `seed ${seed} ${gen.archetype}: share of mountains around`).toBeGreaterThan(0.03);
      expect(raised / land, `seed ${seed} ${gen.archetype}: share of mountains around`).toBeLessThan(0.3);
      expect(peaks.length, `seed ${seed}: mountains`).toBeGreaterThan(5);
      // Each mountain's top is reached from the floor of the land, one level per step.
      for (const [px, py] of peaks) {
        const up = flood([px, py], climb(g), (u, v) => d2c(u, v) <= (R + 40) * (R + 40), (u, v) => g.level(u, v) === 0);
        expect(up.found, `seed ${seed}: the mountain topped at (${px}, ${py}) level ${at(px, py)}`).toBe(true);
      }
    }
    expect(top).toBe(MAX_LEVEL);
  });

  it('deposits lie on the floor of the land (level 0); ore under rock is a hidden vein', () => {
    for (const seed of SEEDS.slice(0, 4)) {
      const { g } = world(seed);
      const R = 160;
      let surface = 0, veins = 0, off = 0;
      for (let y = CENTER - R; y <= CENTER + R; y++) {
        for (let x = CENTER - R; x <= CENTER + R; x++) {
          if (g.ore(x, y) < 0) continue;
          const rock = isRock(g.terrain(x, y)), l = g.level(x, y);
          if (rock) { veins++; if (l === 0) off++; } else { surface++; if (l !== 0) off++; }
        }
      }
      expect(off, `seed ${seed}: ore off its level`).toBe(0);
      expect(surface, `seed ${seed}`).toBeGreaterThan(200);
      expect(veins + surface).toBeGreaterThan(surface - 1);
    }
  });

  it('levelAt and terrainAt give what the chunks hold', () => {
    for (const seed of SEEDS.slice(0, 2)) {
      const { gen, g } = world(seed);
      // Tiles spread over the playable land (a few chunks), and the Crown's ring all round.
      const tiles: Array<[number, number]> = [];
      for (let i = 0; i < 16; i++) {
        const cx = 40 + ((i * 7919 + seed) % 944), cy = 40 + ((i * 104729 + seed * 3) % 944);
        for (let k = 0; k < 24; k++) tiles.push([cx + ((k * 13) % 32), cy + ((k * 7) % 32)]);
      }
      for (let k = 0; k < 64; k++) for (const r of [22, 25, 28, 31, 34, 40, 44]) tiles.push([CENTER + ((COS64[k]! * r) >> 10), CENTER + ((SIN64[k]! * r) >> 10)]);
      let diff = 0;
      for (const [x, y] of tiles) if (gen.levelAt(x, y) !== g.level(x, y) || gen.terrainAt(x, y) !== g.terrain(x, y)) diff++;
      expect(diff, `seed ${seed}`).toBe(0);
    }
  });

  it('keeps the tutorial\'s distances on every land: iron within the Heart\'s wires, coal and copper a pole away, all on the claim\'s land', () => {
    // Quest 1 wires a drill on the iron straight to the Heart; quest 3 needs a pole to reach the
    // coal (« 8 tuiles au plus »), quest 8 poles to the copper. Every drill touching the coal or
    // the copper is out of the Heart's reach (edge to edge), and each deposit has a drill spot
    // wholly on its ore within the early reach the tutorial expects (r 18: the Heart's old
    // level-1 zone), well inside the starting square (D60).
    const heart = { def: buildingIdx('hearth'), x: CENTER - 2, y: CENTER - 2, rot: 0 as const };
    const reach = BUILDINGS.hearth.pole.range, R = 18;
    for (const seed of SEEDS) {
      const { g } = world(seed);
      for (const d of CIRQUE.deposits.slice(0, 3)) {
        const it = itemIdx(d.item);
        let near = Infinity, inZone = 0;
        for (let y = CENTER + d.dy - 5; y <= CENTER + d.dy + 5; y++) for (let x = CENTER + d.dx - 5; x <= CENTER + d.dx + 5; x++) {
          const cells = [[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]] as const;
          const on = cells.filter(([a, b]) => g.ore(a, b) === it).length;
          if (on > 0) near = Math.min(near, gap2(heart, { def: buildingIdx('drill'), x, y, rot: 0 }));
          if (on === 4 && cells.every(([a, b]) => (a - CENTER) ** 2 + (b - CENTER) ** 2 <= R * R)) inZone++;
        }
        expect(inZone, `seed ${seed} ${d.item}: a whole drill spot in the zone`).toBeGreaterThan(0);
        if (d.item === 'iron_ore') expect(near, `seed ${seed} iron`).toBeLessThanOrEqual(reach * reach);
        else expect(near, `seed ${seed} ${d.item}: out of the Heart's reach`).toBeGreaterThan(reach * reach);
      }
    }
  });

  it('places a T3 unique biome at r 180–280 and a T4 at r 340–460, with their resource on open ground', () => {
    for (const seed of SEEDS) {
      const { gen, g } = world(seed);
      const t3 = gen.sites[0]!, t4 = gen.sites[1]!;
      const r = (s: { cx: number; cy: number }): number => isqrt((s.cx - CENTER) ** 2 + (s.cy - CENTER) ** 2);
      expect(UNIQUE_BIOMES[t3.id].tier).toBe(3);
      expect(UNIQUE_BIOMES[t4.id].tier).toBe(4);
      expect(r(t3)).toBeGreaterThanOrEqual(178);
      expect(r(t3)).toBeLessThanOrEqual(282);
      expect(r(t4)).toBeGreaterThanOrEqual(338);
      expect(r(t4)).toBeLessThanOrEqual(462);
      for (const s of [t3, t4]) {
        let tiles = 0;
        for (let y = s.cy - 5; y <= s.cy + 5; y++) for (let x = s.cx - 5; x <= s.cx + 5; x++) if (g.ore(x, y) === s.item && g.level(x, y) === 0) tiles++;
        expect(tiles, `seed ${seed} ${s.id}`).toBeGreaterThanOrEqual(15);
      }
    }
  });

  it('guarantees a full-rate copper field in the near belt, on open ground', () => {
    for (const seed of SEEDS) {
      const { gen, g } = world(seed);
      const f = gen.copperField;
      let tiles = 0;
      for (let y = f.cy - 5; y <= f.cy + 5; y++) for (let x = f.cx - 5; x <= f.cx + 5; x++) if (g.ore(x, y) === itemIdx('copper_ore') && g.capMuPerEpoch(x, y) >= 3000 && g.level(x, y) === 0) tiles++;
      expect(tiles, `seed ${seed}`).toBeGreaterThanOrEqual(20);
    }
  });

  it('archetypes shape the near belt: lagoons are wetter than mesas', () => {
    const water = (gen: MapGen): number => {
      let n = 0;
      for (let y = CENTER - 150; y <= CENTER + 150; y += 3) for (let x = CENTER - 150; x <= CENTER + 150; x += 3) {
        const t = gen.terrainAt(x, y);
        if (t === T.Shallow || t === T.Deep || t === T.Salt) n++;
      }
      return n;
    };
    const lag: number[] = [], mes: number[] = [];
    for (let s = 1; s < 400 && (lag.length < 3 || mes.length < 3); s++) {
      const gen = new MapGen(WORLD_SEED, s);
      if (gen.archetype === 'lagoons' && lag.length < 3) lag.push(water(gen));
      if (gen.archetype === 'mesas' && mes.length < 3) mes.push(water(gen));
    }
    const avg = (a: number[]): number => a.reduce((x, y) => x + y, 0) / a.length;
    expect(avg(lag)).toBeGreaterThan(avg(mes) * 1.5);
  });
});
