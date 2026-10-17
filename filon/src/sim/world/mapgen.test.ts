// mapgen.test.ts — Ysmère's land on the real generator: deterministic; the same cirque for every
// player, closed all round by the Crown's terraces (D45) and crossed one level per step, each
// terrace deep enough for a traction ribbon's elevator and its flat tile; the tarn up on the
// crest (D63); the tutorial's distances; mountains up to 5 around it, terraced and climbable, the
// lilac rock on their tops; the deposits on the floor; the unique sites, the copper field and the
// archetypes where they belong; maps 1–3, the land of the bases founded on them, kept tile for tile;
// and map 4's obstacles (D94): massifs and their cliffs, chasms, rivers, a floor corridor to each
// site, the rings past the starting square cut up.
import { describe, it, expect } from 'vitest';
import { BUILDINGS } from '@/content/buildings';
import { CIRQUE, CIRQUE_V1, COS64, MAP_VERSION, MAPS, MOUNTAINS, OBSTACLES, RINGS, SIN64, WORLD_SEED, UNIQUE_BIOMES } from '@/content/world';
import { buildingDef, buildingIdx, itemIdx } from '@/content/registry';
import { isqrt } from '@/core/fixed';
import { CENTER, CHUNK, WORLD, WORLD_EPOCH0 } from '../constants';
import { Sim } from '../state';
import { gap2 } from '../power/links';
import { T, isFloor, isRock, isWater } from '../types';
import { BIOME, MapGen } from './mapgen';
import { Grid, MAX_LEVEL } from './grid';
import { parcelFloor } from './floor';
import { parcelAt, parcelRect, ringOf } from './land';
import { isFaceOre } from '../face';

/** Sixteen lands, and seed 8's Closed Cirque (none of the sixteen draws one). */
const SEEDS = [...Array.from({ length: 16 }, (_, i) => 1000 + i * 7919), 8];
const world = (seed: number, v = MAP_VERSION): { gen: MapGen; g: Grid } => {
  const gen = new MapGen(WORLD_SEED, seed, v);
  return { gen, g: new Grid(gen) };
};
/** The level the Crown keeps all round, and how far its climb to it runs past the rim. */
const RIDGE = CIRQUE.ridge ?? CIRQUE.crest, LIFT = (RIDGE - 1) * CIRQUE.terrace;
/** Today's land's cirque deposits (map 4: in whole blocks, D104; the floor, the Crown and the tarn are `CIRQUE`'s). */
const DEPOSITS = MAPS[MAP_VERSION]!.cirque.deposits;
/** Is (x, y) one of the tarn's tiles (the cirque's water on today's map)? */
const inTarn = (x: number, y: number): boolean => (x - CENTER - CIRQUE.lake.dx) ** 2 + (y - CENTER - CIRQUE.lake.dy) ** 2 <= CIRQUE.lake.radius ** 2;
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

/**
 * Can a line of ribbons go from `start` to a tile `goal` accepts, inside `within`, one level per
 * step and never two steps on consecutive tiles (a traction ribbon's elevator takes the step's
 * tile and a flat one in front: every terrace on its way two tiles deep at least)? Breadth-first
 * over (tile, did the last step climb).
 */
function lineWay(g: Grid, start: readonly [number, number], within: (x: number, y: number) => boolean, goal: (x: number, y: number) => boolean): boolean {
  const seen = new Set<number>([(start[1] * WORLD + start[0]) * 2]);
  const todo: Array<readonly [number, number, number]> = [[start[0], start[1], 0]];
  for (let i = 0; i < todo.length; i++) {
    const [x, y, stepped] = todo[i]!;
    if (goal(x, y)) return true;
    const l = g.level(x, y);
    for (const [dx, dy] of N4) {
      const u = x + dx, v = y + dy;
      if (!within(u, v)) continue;
      const d = Math.abs(g.level(u, v) - l);
      if (d > 1 || (d === 1 && stepped)) continue;
      const k = (v * WORLD + u) * 2 + d;
      if (seen.has(k)) continue;
      seen.add(k);
      todo.push([u, v, d]);
    }
  }
  return false;
}

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
      for (const d of DEPOSITS) {
        let found = 0;
        // Within a block's shift of its place (map 4: a whole block along the Crown, D104).
        for (let y = -3; y <= 3; y++) for (let x = -3; x <= 3; x++) if (g.ore(CENTER + d.dx + x, CENTER + d.dy + y) === itemIdx(d.item)) found++;
        expect(found, `seed ${seed} ${d.item}`).toBeGreaterThan(5);
      }
      // The tarn's heart (maps 2–3); on map 4 its spring, the head of its stream (D115).
      expect(g.terrain(CENTER + CIRQUE.lake.dx, CENTER + CIRQUE.lake.dy)).toBe(MAPS[MAP_VERSION]!.cirque.spring ? T.River : T.Deep);
      // The Crown: rock all around at r 26 (past the floor's rim, short of the thinnest Crown's
      // foot) — no pass any more (D45).
      let rock = 0;
      for (let k = 0; k < 360; k++) {
        const x = CENTER + Math.round(26 * Math.cos((k * Math.PI) / 180)), y = CENTER + Math.round(26 * Math.sin((k * Math.PI) / 180));
        // Rock, or the spring's stream down the terraces at their level (map 4, D115).
        const t = g.terrain(x, y);
        if ((isRock(t) || t === T.River) && g.level(x, y) > 0) rock++;
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

  it('the floor and the Crown\'s climb to its ridge are the same land for every player, tile for tile', () => {
    // Out to the ridge's first tile from the lowest rim (r 24; map 1: the crest's, r 26)
    // everything is the shared template: the floor, the terraces up to the top (only the top's
    // outer edge, whether it rises to the crest, and the way down follow the archetype).
    const R = CIRQUE.floorRadius - CIRQUE.rimJitter.floor + LIFT + 1;
    expect(R).toBe(24);
    const ref = world(SEEDS[0]!).g;
    for (const seed of SEEDS.slice(1)) {
      const { g } = world(seed);
      let diff = 0;
      for (let y = CENTER - R; y <= CENTER + R; y++) for (let x = CENTER - R; x <= CENTER + R; x++) {
        if (d2c(x, y) <= R * R && (g.level(x, y) !== ref.level(x, y) || g.terrain(x, y) !== ref.terrain(x, y))) diff++;
      }
      expect(diff, `seed ${seed}`).toBe(0);
    }
  });

  it('the Crown closes the cirque: no level-0 path leads out of the floor, and every way out climbs to its ridge', () => {
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
      for (const d of DEPOSITS) expect(floor.seen.has((CENTER + d.dy) * WORLD + CENTER + d.dx), `seed ${seed} ${d.item} on the floor`).toBe(true);
      // Below the ridge: still shut in. The ridge stands at its level all round (the peaks higher).
      const below = flood([CENTER, CENTER], (_ax, _ay, bx, by) => g.level(bx, by) < RIDGE, near);
      let out = 0;
      for (const k of below.seen) out = Math.max(out, d2c(k % WORLD, Math.floor(k / WORLD)));
      expect(isqrt(out), `seed ${seed} ${gen.archetype}: under the ridge out to r ${isqrt(out)}`).toBeLessThan(rimMax + LIFT);
    }
  });

  it('on the Crown and around it, neighbours are never more than one level apart; rock, and only rock but the tarn, stands above level 0 (map 3: map 4\'s massifs stand in cliffs)', () => {
    for (const seed of SEEDS) {
      const { gen, g } = world(seed, 3);
      const R = MOUNTAINS.cliffFrom - 1;
      let steep = 0, wrong = 0, crown = 0;
      for (let y = CENTER - R; y <= CENTER + R; y++) {
        for (let x = CENTER - R; x <= CENTER + R; x++) {
          if (d2c(x, y) > R * R) continue;
          const l = g.level(x, y), t = g.terrain(x, y);
          if (Math.abs(l - g.level(x + 1, y)) > 1 || Math.abs(l - g.level(x, y + 1)) > 1) steep++;
          const tarn = isWater(t) && l === CIRQUE.crest && inTarn(x, y);
          if (l < 0 || l > MAX_LEVEL || (isRock(t) || tarn) !== l > 0) wrong++;
          if (biomeAt(g, x, y) === BIOME.crown && !tarn) {
            crown++;
            // Hardness follows height: H1 on the lower terraces and the ridge, H2 on the peaks' crest.
            if (l < 1 || l > CIRQUE.crest || t !== T.Rock1 + CIRQUE.hardness[l - 1]! - 1) wrong++;
          }
        }
      }
      expect(steep, `seed ${seed} ${gen.archetype}: steps of two levels or more`).toBe(0);
      expect(wrong, `seed ${seed}: rock off its level`).toBe(0);
      expect(crown, `seed ${seed}: the Crown`).toBeGreaterThan(1000);
    }
  });

  it('a line climbs from the floor over the Crown and down to the land outside in every direction, one level per step, an elevator and a flat tile a terrace (map 3; map 4: below)', () => {
    for (const seed of SEEDS) {
      const { gen, g } = world(seed, 3);
      const R = gen.crownFoot + 30;
      for (let d = 0; d < 64; d += 4) {
        // A corridor 7 tiles wide from the Heart outwards (×1024: the trig table's scale).
        const ux = COS64[d]!, uy = SIN64[d]!;
        const inWedge = (x: number, y: number): boolean => {
          const dx = x - CENTER, dy = y - CENTER;
          return dx * ux + dy * uy >= -1024 && Math.abs(dx * uy - dy * ux) <= 3 * 1024 && d2c(x, y) <= R * R;
        };
        const outside = (x: number, y: number): boolean => g.level(x, y) === 0 && d2c(x, y) >= (gen.crownFoot + 1) ** 2;
        expect(lineWay(g, [CENTER, CENTER], inWedge, outside), `seed ${seed} ${gen.archetype}: over the Crown towards ${d}/64`).toBe(true);
      }
    }
  });

  it('mountains rise around the cirque, up to 5, terraced: a two-level cliff only far out and facing east, and every mountain climbable (map 3: map 4\'s massifs stand in cliffs)', () => {
    let top = 0;
    for (const seed of SEEDS.slice(0, 5)) {
      const { gen, g } = world(seed, 3);
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
      for (let y = -4; y <= 4; y++) for (let x = -4; x <= 4; x++) tiles.push([CENTER + CIRQUE.lake.dx + x, CENTER + CIRQUE.lake.dy + y]); // the tarn and its rim
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
      for (const d of DEPOSITS.slice(0, 3)) {
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

/** A fingerprint of a land's terrain, levels and where its ore lies, over the cirque's chunks and one far out (content indices left out). */
function fingerprint(gen: MapGen): number {
  let h = 0x811c9dc5;
  const mix = (v: number): void => { h = Math.imul(h ^ v, 16777619) >>> 0; };
  const N = CHUNK * CHUNK;
  for (const [cx, cy] of [[15, 15], [16, 15], [15, 16], [16, 16], [14, 15], [17, 16], [16, 14], [15, 17], [20, 9]] as const) {
    const t = new Uint8Array(N), o = new Uint8Array(N), r = new Uint16Array(N), hh = new Uint8Array(N), b = new Uint8Array(N), l = new Uint8Array(N);
    gen.fill(cx, cy, t, o, r, hh, b, l);
    for (let i = 0; i < N; i++) { mix(t[i]!); mix(l[i]!); mix(o[i]! > 0 ? 1 : 0); }
  }
  return h;
}

describe('map versions (D63)', () => {
  it('map 1 is the land the bases founded before D63 stand on, tile for tile (saves are sacred)', () => {
    // Pinned from the generator as it was before map versions (seeds: lagoons, steppe, mesas, closed).
    const pinned: Record<number, number> = { 1: 0xd443c4a6, 42: 0x8fe9aa81, 8919: 0x41478c03, 8: 0x39dc2ff4 };
    for (const [seed, h] of Object.entries(pinned)) expect(fingerprint(new MapGen(WORLD_SEED, Number(seed), 1)).toString(16), `seed ${seed}`).toBe(h.toString(16));
    // Maps 2 and 3 likewise, pinned when map 4 came (D94): a new version never moves an old land.
    const pinnedV: Record<number, Record<number, number>> = {
      2: { 1: 0xfc2900c2, 42: 0x7837f35f, 8919: 0x69742876, 8: 0xf7c51baa, 1000: 0x4cd39501, 3: 0x6b65d226 },
      3: { 1: 0x5e1d903a, 42: 0x808f9557, 8919: 0x81d65964, 8: 0xc5470347, 1000: 0xbe8417f6, 3: 0x8fa64496 },
    };
    for (const [v, pins] of Object.entries(pinnedV)) {
      for (const [seed, h] of Object.entries(pins)) expect(fingerprint(new MapGen(WORLD_SEED, Number(seed), Number(v))).toString(16), `map ${v} seed ${seed}`).toBe(h.toString(16));
    }
    const { gen, g } = world(1, 1);
    expect(gen.mapV).toBe(1);
    expect(gen.tarn).toBeNull();
    expect(gen.crownReach).toBe(36);
    expect(g.terrain(CENTER + CIRQUE_V1.lake.dx, CENTER + CIRQUE_V1.lake.dy)).toBe(T.Deep); // the lake on the floor
    expect(g.level(CENTER + CIRQUE_V1.lake.dx, CENTER + CIRQUE_V1.lake.dy)).toBe(0);
    // Its crest all round at level 3, its mountains lilac from their first terrace.
    let low = 0;
    for (let k = 0; k < 64; k++) {
      const x = CENTER + ((COS64[k]! * 28) >> 10), y = CENTER + ((SIN64[k]! * 28) >> 10);
      if (g.level(x, y) < 2) low++;
    }
    expect(low).toBe(0);
    expect(new MapGen(WORLD_SEED, 1).mapV).toBe(MAP_VERSION); // a new base: today's map
  });

  it('a map version this build does not know does not open (a newer build\'s land)', () => {
    expect(() => new MapGen(WORLD_SEED, 1, MAP_VERSION + 1)).toThrow(/map version/);
  });

  it('the tarn (maps 2–3; map 4 has a spring in its place, D115): up on the crest, its water at the crest\'s level, ringed by rock of that level, the same for every player', () => {
    for (const seed of SEEDS) {
      const { gen, g } = world(seed, 3);
      expect(gen.tarn, `seed ${seed}`).toEqual({ x: CENTER + CIRQUE.lake.dx, y: CENTER + CIRQUE.lake.dy, level: CIRQUE.crest });
      let water = 0, deep = 0, ringBad = 0;
      for (let y = -4; y <= 4; y++) for (let x = -4; x <= 4; x++) {
        const tx = gen.tarn!.x + x, ty = gen.tarn!.y + y, t = g.terrain(tx, ty);
        if (!isWater(t)) continue;
        water++;
        if (t === T.Deep) deep++;
        expect(g.level(tx, ty), `seed ${seed}: water at (${tx}, ${ty})`).toBe(CIRQUE.crest);
        // Every tile round it: the tarn's own water, or rock at its level (a pump stands there).
        for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
          const u = tx + i, v = ty + j, n = g.terrain(u, v);
          if (!(isWater(n) && inTarn(u, v)) && !(isRock(n) && g.level(u, v) === CIRQUE.crest)) ringBad++;
        }
      }
      expect(water, `seed ${seed}`).toBe(21);
      expect(deep, `seed ${seed}`).toBe(9);
      expect(ringBad, `seed ${seed}`).toBe(0);
      // No water left on the floor: the cirque's water is the tarn's.
      let floorWater = 0;
      for (let y = CENTER - 22; y <= CENTER + 22; y++) for (let x = CENTER - 22; x <= CENTER + 22; x++) if (d2c(x, y) <= 21 * 21 && isWater(g.terrain(x, y))) floorWater++;
      expect(floorWater, `seed ${seed}`).toBe(0);
    }
  });

  it('a thinner Crown (owner, 2026-10-14: "the circus moutain is too large"): its ridge 7–8 tiles across on most bearings, a few wider peaks, the lilac rock only on them', () => {
    const widths: number[] = [];
    for (const seed of SEEDS) {
      const { gen, g } = world(seed);
      if (gen.archetype === 'closed') continue; // « une Couronne épaisse »: three levels all round
      let peaks = 0;
      for (let k = 0; k < 64; k++) {
        // The Crown's width along the bearing: its tiles between r 18 and 50.
        let w = 0, top = 0;
        for (let r = 18; r < 50; r++) {
          const x = CENTER + ((COS64[k]! * r) >> 10), y = CENTER + ((SIN64[k]! * r) >> 10);
          if (biomeAt(g, x, y) !== BIOME.crown) continue;
          w++;
          top = Math.max(top, g.level(x, y));
          const t = g.terrain(x, y);
          // Lilac (H2 and harder) only on the crest's level: the peaks.
          if (isRock(t) && t !== T.Rock1) expect(g.level(x, y), `seed ${seed} lilac at (${x}, ${y})`).toBe(CIRQUE.crest);
        }
        widths.push(w);
        if (top === CIRQUE.crest) peaks++;
      }
      // A few peaks round the ring, not all of it (the tarn's among them).
      expect(peaks, `seed ${seed} ${gen.archetype}: bearings over a peak`).toBeGreaterThan(4);
      expect(peaks, `seed ${seed} ${gen.archetype}: bearings over a peak`).toBeLessThan(40);
    }
    widths.sort((a, b) => a - b);
    // Map 1: 9–12 tiles on every bearing.
    expect(widths[Math.floor(widths.length / 2)], 'median width').toBeLessThanOrEqual(8);
    expect(widths[Math.floor(widths.length * 0.6)], 'most bearings').toBeLessThanOrEqual(8);
    expect(widths[0], 'the thinnest').toBeGreaterThanOrEqual(2 * LIFT + CIRQUE.minCrest - 1);
  });

  it('the mountains\' lilac rock is their high tops: sandstone on their first two terraces near the cirque (map 1: lilac from the first)', () => {
    for (const v of [1, MAP_VERSION]) {
      const { g } = world(SEEDS[0]!, v);
      let low = 0, lowLilac = 0, high = 0, highLilac = 0;
      for (let y = CENTER - RINGS.near; y <= CENTER + RINGS.near; y += 2) for (let x = CENTER - RINGS.near; x <= CENTER + RINGS.near; x += 2) {
        if (d2c(x, y) < 60 * 60 || d2c(x, y) >= RINGS.near * RINGS.near || biomeAt(g, x, y) === BIOME.crown) continue;
        const t = g.terrain(x, y), l = g.level(x, y);
        if (!isRock(t) || l === 0) continue;
        if (l <= 2) { low++; if (t !== T.Rock1) lowLilac++; } else { high++; if (t !== T.Rock1) highLilac++; }
      }
      expect(low + high, `map ${v}: mountains near the cirque`).toBeGreaterThan(100);
      if (v === 1) expect(lowLilac).toBe(low);
      else {
        expect(lowLilac, 'map 2: lilac on the low terraces').toBe(0);
        expect(highLilac, 'map 2: lilac on the high tops').toBe(high);
      }
    }
  });

  it('water at a level in play: a pump stands by the tarn on its own level, a backfiller marks it, the floor\'s lake stays a floor pump\'s (map 1)', () => {
    const at = (v: number): Sim => {
      const sim = new Sim({ worldSeed: WORLD_SEED, playerSeed: SEEDS[0]!, source: new MapGen(WORLD_SEED, SEEDS[0]!, v), foundingEpoch: WORLD_EPOCH0 + 24 });
      sim.done.add('tr3'); // conduits, the ceramic oven
      sim.done.add(buildingDef(buildingIdx('pump')).unlock); // the pump, wherever its unlock now stands (D114: Tier 1)
      sim.rebuildDerived();
      sim.grant('iron_plate', 50); sim.grant('glass', 20);
      return sim;
    };
    const sim = at(3), t = sim.grid.source.tarn!;
    // On the tarn's shallows (its west tip): the pump's tile is the tarn's level.
    expect(sim.grid.terrain(t.x - 2, t.y)).toBe(T.Shallow);
    expect(sim.canPlace('pump', t.x - 2, t.y, 0).reason).toBe('ok');
    // On the rock round it, at the tarn's level: the water is there; whether a pump stands on rock is its content's (`onRock`).
    expect(sim.grid.level(t.x - 3, t.y)).toBe(t.level);
    expect(sim.canPlace('pump', t.x - 3, t.y, 0).reason).toBe(buildingDef(buildingIdx('pump')).onRock ? 'ok' : 'terrain');
    // A tile of the tarn marked for filling (a backfiller's job): it will be ground at the tarn's level.
    expect(sim.designate([t.y * WORLD + t.x - 2])).toBe(1);
    expect(sim.designated.get(t.y * WORLD + t.x - 2)).toBe('fill');
    // Map 1: the lake on the floor, a pump on its shore (level 0, the water's level).
    const old = at(1), L = CIRQUE_V1.lake, lx = CENTER + L.dx - 4, ly = CENTER + L.dy;
    expect(old.grid.terrain(lx, ly)).toBe(T.Sand);
    expect(isWater(old.grid.terrain(lx + 1, ly))).toBe(true);
    expect(old.canPlace('pump', lx, ly, 0).reason).toBe('ok');
  });
});

describe('map 4: obstacles (D94)', () => {
  const M4 = SEEDS.slice(0, 6);
  /** The disc r ≤ R, read once: levels and terrains. */
  const disc = (g: Grid, R: number): Array<[number, number, number, number]> => {
    const out: Array<[number, number, number, number]> = [];
    for (let y = CENTER - R; y <= CENTER + R; y++) for (let x = CENTER - R; x <= CENTER + R; x++) if (d2c(x, y) <= R * R) out.push([x, y, g.level(x, y), g.terrain(x, y)]);
    return out;
  };

  it('keeps map 3\'s cirque, Crown, tarn and quartz vein tile for tile', () => {
    for (const seed of M4) {
      const a = world(seed, 3), b = world(seed, 4);
      expect(b.gen.crownReach).toBe(a.gen.crownReach);
      expect(b.gen.quartzVein).toEqual(a.gen.quartzVein);
      let diff = 0;
      const R = b.gen.crownReach;
      // The cirque's floor and the Crown (map 3's biome codes): past its foot, map 4's massifs may
      // stand. Its deposits are in whole blocks on map 4 (D104, tested below).
      for (const [x, y, l, t] of disc(b.g, R)) {
        const bio = biomeAt(a.g, x, y);
        if (bio !== BIOME.cirque && bio !== BIOME.crown) continue;
        // Its water apart: map 3's tarn is map 4's dry peak, map 4's spring and pool (D115).
        if (isWater(a.g.terrain(x, y)) || isWater(t)) continue;
        if (l !== a.g.level(x, y) || t !== a.g.terrain(x, y) || biomeAt(b.g, x, y) !== bio) diff++;
      }
      // The vein's face and the floor two tiles in front of it.
      const V = b.gen.quartzVein!, fx = [0, 1, 0, -1][V.look]!, fy = [-1, 0, 1, 0][V.look]!;
      for (let i = 0; i < V.n; i++) for (let k = 0; k <= 2; k++) {
        const x = V.x + i * V.dx + k * fx, y = V.y + i * V.dy + k * fy;
        if (b.g.level(x, y) !== a.g.level(x, y) || b.g.terrain(x, y) !== a.g.terrain(x, y)) diff++;
      }
      expect(diff, `seed ${seed}`).toBe(0);
    }
  });

  it('massifs past the Crown rise in sheer cliffs, up to 5; ramps of single steps climb most of their tops', () => {
    for (const seed of M4) {
      const { gen, g } = world(seed);
      const R = 120, tiles = disc(g, R);
      const lv = new Map<number, number>();
      let cliffs = 0, tall = 0, top = 0, high = 0;
      for (const [x, y, l] of tiles) {
        lv.set(y * WORLD + x, l);
        top = Math.max(top, l);
        if (l >= 3) high++;
        for (const d of [Math.abs(l - g.level(x + 1, y)), Math.abs(l - g.level(x, y + 1))]) { if (d >= 2) cliffs++; if (d >= 3) tall++; }
      }
      expect(top, `seed ${seed}`).toBe(MAX_LEVEL);
      expect(cliffs, `seed ${seed} ${gen.archetype}: steps of two levels or more`).toBeGreaterThan(500);
      expect(tall, `seed ${seed}: sheer cliffs of three levels or more`).toBeGreaterThan(200);
      // From the floor, one level per step: most of the high ground is reached (ramps), not all (cliffs).
      const seen = new Set<number>(), todo: number[] = [];
      for (const [k, l] of lv) if (l === 0) { seen.add(k); todo.push(k); }
      for (let i = 0; i < todo.length; i++) {
        const k = todo[i]!, l = lv.get(k)!;
        for (const [dx, dy] of N4) {
          const n = k + dy * WORLD + dx, m = lv.get(n);
          if (m === undefined || seen.has(n) || Math.abs(m - l) > 1) continue;
          seen.add(n); todo.push(n);
        }
      }
      let reached = 0;
      for (const [k, l] of lv) if (l >= 3 && seen.has(k)) reached++;
      expect(reached / high, `seed ${seed}: high ground reached by single steps`).toBeGreaterThan(0.8);
    }
  });

  it('chasms cut the plains at level 0, rivers too but up on a massif; none on the Crown but its spring\'s stream; a river flows (its way in the biome code)', () => {
    for (const seed of M4) {
      const { gen, g } = world(seed);
      let chasm = 0, river = 0, wrong = 0, inner = 0, flow = 0;
      for (const [x, y, l, t] of disc(g, 160)) {
        if (t !== T.Chasm && t !== T.River) continue;
        if (t === T.Chasm) chasm++; else river++;
        if (t === T.Chasm && l !== 0) wrong++;
        // On the Crown only its spring's stream (D115, tested below).
        if (d2c(x, y) <= (gen.crownReach + 4) ** 2 && !(t === T.River && gen.spring)) inner++;
        const b = biomeAt(g, x, y);
        if (t === T.River && b >= BIOME.river && b < BIOME.river + 8) flow++;
      }
      expect(chasm, `seed ${seed}: chasm tiles (narrow crevasses)`).toBeGreaterThan(100);
      expect(river, `seed ${seed}: river tiles`).toBeGreaterThan(50);
      expect(wrong, `seed ${seed}: off level 0`).toBe(0);
      expect(inner, `seed ${seed}: on the Crown`).toBe(0);
      expect(flow, `seed ${seed}: rivers with their way`).toBe(river);
    }
  });

  it('a corridor leads from the Crown\'s foot to each site the land guarantees (the copper field, the unique sites, the vents): no chasm or cliff on it, a level a step at most, a ford where a river crosses', () => {
    for (const seed of SEEDS) {
      const { gen, g } = world(seed);
      const goals: Array<[number, number, number]> = [[gen.copperField.cx, gen.copperField.cy, 3], ...gen.sites.map((s) => [s.cx, s.cy, s.r + 2] as [number, number, number]), ...gen.ventSites.map((v) => [v.x + 1, v.y + 1, 2] as [number, number, number])];
      for (const [gx, gy, gr] of goals) {
        const dx = gx - CENTER, dy = gy - CENTER, len = isqrt(dx * dx + dy * dy), r0 = gen.crownReach + 2;
        const start = [CENTER + Math.floor((dx * r0) / len), CENTER + Math.floor((dy * r0) / len)] as const;
        const lim = (len + 30) ** 2;
        const step = (ax: number, ay: number, bx: number, by: number): boolean => {
          const t = g.terrain(bx, by);
          // A ford where a river crosses (still shallows: a backfiller fills them, a skybridge leaps them).
          return (isFloor(t) || isRock(t) || t === T.Shallow) && Math.abs(g.level(bx, by) - g.level(ax, ay)) <= 1;
        };
        const way = flood(start, step, (x, y) => d2c(x, y) <= lim, (x, y) => (x - gx) ** 2 + (y - gy) ** 2 <= gr * gr);
        expect(way.found, `seed ${seed} ${gen.archetype}: the floor to (${dx}, ${dy})`).toBe(true);
      }
    }
  });

  it('the rings of parcels past the starting square are cut up (usable floor, D94): far less room than on map 3', () => {
    const shares = (v: number, seed: number): number[] => {
      const g = world(seed, v).g, seen = new Set<number>(), out: number[] = [];
      for (let y = CENTER - 80; y <= CENTER + 80; y += 4) for (let x = CENTER - 80; x <= CENTER + 80; x += 4) {
        const p = parcelAt(x, y);
        if (seen.has(p)) continue;
        seen.add(p);
        if (ringOf(p) >= 2 && ringOf(p) <= 3) out.push(parcelFloor(g, p).permille);
      }
      return out.sort((a, b) => a - b);
    };
    const med = (a: number[]): number => a[a.length >> 1]!, q1 = (a: number[]): number => a[a.length >> 2]!;
    for (const seed of M4) {
      const a = shares(3, seed), b = shares(4, seed);
      expect(b.length).toBe(40);
      expect(med(b), `seed ${seed}: the median parcel's usable floor (map 3: ${med(a)} ‰)`).toBeLessThan(900);
      expect(q1(b), `seed ${seed}: a quarter of them under (map 3: ${q1(a)} ‰)`).toBeLessThan(720);
      expect(med(b), `seed ${seed}: less than on map 3`).toBeLessThan(med(a));
    }
  });

  it('a line still climbs over the Crown and down to the land outside in most directions (map 4: a massif or a mountain may stand right past its foot)', () => {
    for (const seed of SEEDS.slice(0, 8)) {
      const { gen, g } = world(seed);
      const R = gen.crownFoot + 30;
      let ways = 0;
      for (let d = 0; d < 64; d += 4) {
        const ux = COS64[d]!, uy = SIN64[d]!;
        const inWedge = (x: number, y: number): boolean => {
          const dx = x - CENTER, dy = y - CENTER;
          return dx * ux + dy * uy >= -1024 && Math.abs(dx * uy - dy * ux) <= 3 * 1024 && d2c(x, y) <= R * R;
        };
        const outside = (x: number, y: number): boolean => g.level(x, y) === 0 && d2c(x, y) >= (gen.crownFoot + 1) ** 2;
        if (lineWay(g, [CENTER, CENTER], inWedge, outside)) ways++;
      }
      expect(ways, `seed ${seed} ${gen.archetype}: directions out of 16`).toBeGreaterThanOrEqual(11);
    }
  });

  it('space or ore (owner, 2026-10-16): past the starting square the ore lies in broken ground, the open desert holds little — on lands 1–3 a parcel\'s ore and its usable floor go clearly against each other, with exceptions; map 3 shows no such rule', () => {
    /** Per parcel of the four rings past the starting square: its ore tiles (no face ore) and its usable floor (‰). */
    const parcels = (v: number, seed: number): Array<[number, number]> => {
      const g = world(seed, v).g, seen = new Set<number>(), out: Array<[number, number]> = [];
      for (let y = CENTER - 130; y <= CENTER + 130; y += 5) for (let x = CENTER - 130; x <= CENTER + 130; x += 5) {
        const p = parcelAt(x, y);
        if (seen.has(p)) continue;
        seen.add(p);
        if (ringOf(p) < 2 || ringOf(p) > 5) continue;
        const q = parcelRect(p);
        let ore = 0;
        for (let ty = q.y0; ty < q.y1; ty++) for (let tx = q.x0; tx < q.x1; tx++) { const o = g.ore(tx, ty); if (o >= 0 && !isFaceOre(o)) ore++; }
        out.push([ore, parcelFloor(g, p).permille]);
      }
      return out;
    };
    /** The correlation's sign and its square (no root: cov² / (var · var)). */
    const corr = (rows: Array<[number, number]>): { neg: boolean; r2: number } => {
      const n = rows.length, mx = rows.reduce((a, r) => a + r[0], 0) / n, my = rows.reduce((a, r) => a + r[1], 0) / n;
      let cov = 0, vx = 0, vy = 0;
      for (const [a, b] of rows) { cov += (a - mx) * (b - my); vx += (a - mx) ** 2; vy += (b - my) ** 2; }
      return { neg: cov < 0, r2: (cov * cov) / (vx * vy) };
    };
    let exceptions = 0;
    for (const seed of [1, 2, 3]) {
      const rows = parcels(4, seed), c = corr(rows);
      expect(rows.length).toBe(112);
      expect(c.neg && c.r2 > 0.16, `land ${seed}: r² ${c.r2.toFixed(2)}, negative ${c.neg} (wanted r < −0.4)`).toBe(true);
      // Open desert: room and little or no ore; rich ground: ore and little room.
      expect(rows.filter(([o, f]) => f >= 750 && o <= 6).length, `land ${seed}: open desert parcels`).toBeGreaterThanOrEqual(20);
      expect(rows.filter(([o, f]) => o >= 25 && f <= 550).length, `land ${seed}: rich, cramped parcels`).toBeGreaterThanOrEqual(15);
      exceptions += rows.filter(([o, f]) => o >= 25 && f >= 750).length;
      const old = corr(parcels(3, seed));
      expect(old.r2, `map 3, land ${seed}: no rule`).toBeLessThan(0.09);
    }
    expect(exceptions, 'parcels both rich and roomy (not a rigid rule)').toBeGreaterThan(0);
  });

  it('the chasms\' widths: mostly within a plain skybridge\'s leap', () => {
    // Content: a band takes the tiles within its half width (quarter tiles) of its line.
    const C = OBSTACLES.chasm.width;
    expect(C[0] + C[1] - 1).toBeLessThanOrEqual(6);
  });

  it('the rivers drain (owner, 2026-10-16: « de petits ruisseaux qui partent de grandes montagnes… se rejoindre pour devenir un grand courant en bas »): streams up on the massifs fall to the floor and never climb along their way; rivers widen down to the sea, the same sea for every claim', () => {
    const DX8 = [1, 1, 0, -1, -1, -1, 0, 1], DY8 = [0, 1, 1, 1, 0, -1, -1, -1];
    let seaPoint = '';
    for (const seed of M4.slice(0, 4)) {
      const { gen, g } = world(seed);
      let tiles = 0, raised = 0, climbs = 0, falls = 0, mouths = 0, narrow = 0, broad = 0;
      for (const [x, y, l, t] of disc(g, 400)) {
        if (t !== T.River) continue;
        tiles++;
        if (l > 0) raised++;
        const f = biomeAt(g, x, y) - BIOME.river, nx = x + DX8[f]!, ny = y + DY8[f]!;
        expect(f >= 0 && f < 8, 'a river tile holds its way').toBe(true);
        // Along its own way (the next tile flowing the same way): never up.
        if (g.terrain(nx, ny) === T.River && biomeAt(g, nx, ny) - BIOME.river === f) {
          const m = g.level(nx, ny);
          if (m > l) climbs++;
          if (m < l) falls++;
        }
        if (biomeAt(g, nx, ny) === BIOME.sea) mouths++;
        // Across a river flowing east–west, its run north–south (and the other way round).
        if (f % 2 === 0) {
          const [ax, ay] = f === 0 || f === 4 ? [0, 1] : [1, 0];
          if (g.terrain(x - ax, y - ay) !== T.River) {
            let n = 1;
            while (g.terrain(x + n * ax, y + n * ay) === T.River && n < 12) n++;
            if (n <= 2) narrow++;
            if (n >= 5) broad++;
          }
        }
      }
      expect(tiles, `seed ${seed}: river tiles`).toBeGreaterThan(5000);
      expect(raised, `seed ${seed}: streams up on the massifs`).toBeGreaterThan(100);
      expect(falls, `seed ${seed}: falls`).toBeGreaterThan(5);
      expect(climbs, `seed ${seed}: water climbing along its way`).toBe(0);
      expect(mouths, `seed ${seed}: river tiles flowing into the sea`).toBeGreaterThan(5);
      expect(narrow, `seed ${seed}: narrow streams`).toBeGreaterThan(50);
      expect(broad, `seed ${seed}: broad rivers`).toBeGreaterThan(20);
      const sp = String(gen.seaPoint());
      if (seaPoint) expect(sp, 'the sea is the shared world\'s').toBe(seaPoint);
      seaPoint = sp;
      const [sx, sy] = gen.seaPoint()!;
      expect(isqrt(d2c(sx, sy)), 'the coast past the T3 sites\' ring').toBeGreaterThan(300);
    }
  });

});

describe('the spring on the Crown (map 4, D115)', () => {
  /** The spring's stream: the river tiles within the Crown's reach. */
  const stream = (gen: MapGen, g: Grid): Array<[number, number]> => {
    const out: Array<[number, number]> = [], R = gen.crownReach;
    for (let y = CENTER - R; y <= CENTER + R; y++) for (let x = CENTER - R; x <= CENTER + R; x++) if (d2c(x, y) <= R * R && g.terrain(x, y) === T.River) out.push([x, y]);
    return out;
  };
  const DX8 = [1, 1, 0, -1, -1, -1, 0, 1], DY8 = [0, 1, 1, 1, 0, -1, -1, -1];

  it('the tarn replaced (owner: « Il reste un lac vestige… Il faut l\'enlever ou le remplacer »): a spring up on its dry peak, its stream down the terraces in small falls, never climbing, into a pool on the floor', () => {
    const W = MAPS[4]!.cirque, P = W.spring!.pool;
    for (const seed of SEEDS) {
      const { gen, g } = world(seed, 4);
      expect(gen.tarn).toBeNull();
      expect(gen.spring).toEqual({ x: CENTER + W.lake.dx, y: CENTER + W.lake.dy, level: W.crest });
      expect(g.terrain(gen.spring!.x, gen.spring!.y)).toBe(T.River);
      expect(g.level(gen.spring!.x, gen.spring!.y)).toBe(W.crest);
      // No still water up on the Crown any more.
      let still = 0;
      for (let y = -6; y <= 6; y++) for (let x = -6; x <= 6; x++) if (isWater(g.terrain(gen.spring!.x + x, gen.spring!.y + y)) && g.terrain(gen.spring!.x + x, gen.spring!.y + y) !== T.River) still++;
      expect(still, `seed ${seed}: still water on the peak`).toBe(0);
      const tiles = stream(gen, g);
      expect(tiles.length, `seed ${seed}`).toBeGreaterThanOrEqual(14);
      let climbs = 0, falls = 0, mouth = 0;
      for (const [x, y] of tiles) {
        const b = biomeAt(g, x, y) - BIOME.river;
        expect(b >= 0 && b < 8, `seed ${seed}: its way at (${x}, ${y})`).toBe(true);
        const nx = x + DX8[b]!, ny = y + DY8[b]!, nt = g.terrain(nx, ny), l = g.level(x, y);
        if (nt === T.River) { if (g.level(nx, ny) > l) climbs++; if (g.level(nx, ny) < l) falls++; }
        // Into the pool on the floor.
        for (const [dx, dy] of N4) { const u = x + dx, v = y + dy; if ((g.terrain(u, v) === T.Shallow || g.terrain(u, v) === T.Deep) && g.level(u, v) === 0) mouth++; }
      }
      expect(climbs, `seed ${seed}: climbs along its way`).toBe(0);
      expect(falls, `seed ${seed}: falls`).toBeGreaterThanOrEqual(2);
      expect(mouth, `seed ${seed}: into its pool`).toBeGreaterThan(0);
      // The pool on the floor's edge, and a pump's tile beside it on the floor, near the Core.
      expect(g.terrain(CENTER + P.dx, CENTER + P.dy)).toBe(T.Deep);
      let pumpable = 0;
      for (let y = -24; y <= 24; y++) for (let x = -24; x <= 24; x++) {
        const tx = CENTER + x, ty = CENTER + y;
        if (x * x + y * y > 22 * 22 || g.terrain(tx, ty) !== T.Sand || g.level(tx, ty) !== 0) continue;
        if (N4.some(([dx, dy]) => isWater(g.terrain(tx + dx, ty + dy)) && g.level(tx + dx, ty + dy) === 0)) pumpable++;
      }
      expect(pumpable, `seed ${seed}: floor tiles a pump draws from`).toBeGreaterThan(6);
      // Clear of the deposits: no ore within three tiles of its water.
      let ore = 0;
      for (const [x, y] of tiles) for (let j = -3; j <= 3; j++) for (let i = -3; i <= 3; i++) if (g.ore(x + i, y + j) >= 0) ore++;
      expect(ore, `seed ${seed}: ore by the stream`).toBe(0);
    }
  });

  it('the same stream for every player, tile for tile', () => {
    const ref = world(SEEDS[0]!, 4), key = (gen: MapGen, g: Grid): string => stream(gen, g).map(([x, y]) => `${x},${y},${g.level(x, y)}`).join(' ');
    const want = key(ref.gen, ref.g);
    for (const seed of SEEDS.slice(1)) { const { gen, g } = world(seed, 4); expect(key(gen, g), `seed ${seed}`).toBe(want); }
  });
});
