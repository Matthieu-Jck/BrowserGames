// deposit-facts.ts — what the deposit card (D99, deposit-card.ts) says about a tile of known ground:
// its ore, where the ore lies (open ground, a vein under rock, a cliff face, water), what one tile
// of it gives and the whole deposit, and the machines that work it, each unlocked or not. Read
// from the engine and the content tables, never written by hand: the extractors are the buildings
// whose `drill` (or kind) fits the place — a drill for a deposit (`drill` with neither `ground`
// nor `face`), the excavators then the drills for a vein still under rock, a face
// cutter for a face ore (`drill.face`, D87), a pump for water. Plain sand gets no card: it is the
// ground everywhere (D38), and a card on every tile would be noise. Pure (no DOM): tested in node
// (deposit-facts.test.ts).
import { BAL } from '@/content/balance';
import { BUILDING_IDS, ITEM_IDS, buildingDef, buildingIdx } from '@/content/registry';
import type { BuildingDef } from '@/content/types';
import { RICH_MULT } from '@/content/world';
import { WORLD } from '@/sim/constants';
import { isFaceOre } from '@/sim/face';
import type { Sim } from '@/sim/state';
import { isRock, isWater } from '@/sim/types';

/** Where an ore lies: on open ground, in a vein under rock (dig it out first), set in a cliff face (D87), or water. */
export type DepositWhere = 'ground' | 'vein' | 'face' | 'water';

export interface DepositMachine {
  readonly def: string;
  /** Not unlocked yet: shown dim, with a lock. */
  readonly locked: boolean;
}

export interface DepositFacts {
  /** The item's index. */
  readonly item: number;
  readonly where: DepositWhere;
  /** What this tile gives a drill a minute (its cap), and the most a tile of that ore ever gives (the far ring's heart). 0 for water. */
  readonly tilePerMin: number;
  readonly tileMax: number;
  /** The machines that work it, in the content's order (the tiers'); for a vein, `dig` first. */
  readonly machines: readonly DepositMachine[];
  readonly dig: readonly DepositMachine[];
}

const defs = (pick: (d: BuildingDef) => boolean): string[] => BUILDING_IDS.filter((id) => pick(buildingDef(buildingIdx(id))));

/** The extractors by place, from the content tables. */
export const DRILLS = defs((d) => d.kind === 'drill' && !!d.drill && !d.drill.ground && !d.drill.face);
export const CUTTERS = defs((d) => d.kind === 'drill' && d.drill?.face === true);
export const DIGGERS = defs((d) => d.kind === 'excavator');
export const PUMPS = defs((d) => d.kind === 'pump');

const WATER = ITEM_IDS.indexOf('water');

/** A tile's cap as a drill reads it, items a minute (`Grid.capMuPerEpoch`: rich × 10 mu per epoch = rich / 100 a minute). */
export const tileRate = (rich: number): number => rich / 100;

/** The most a tile of an ore gives (its base richness, at the far ring's heart), items a minute. */
export function tileMaxOf(item: number): number {
  const base = BAL.depositRich[ITEM_IDS[item]!] ?? BAL.uniqueRich;
  return tileRate((base * RICH_MULT.far) / 1000);
}

/** The deposit card's facts for tile (x, y), or null: plain ground, or off the world. */
export function depositAt(sim: Sim, x: number, y: number): DepositFacts | null {
  if (x < 0 || y < 0 || x >= WORLD || y >= WORLD) return null;
  const g = sim.grid, t = g.terrain(x, y), ore = g.ore(x, y);
  const of = (ids: readonly string[]): DepositMachine[] => ids.map((def) => ({ def, locked: !sim.unlocked(buildingDef(buildingIdx(def)).unlock) }));
  if (ore < 0) {
    if (!isWater(t) || WATER < 0) return null;
    return { item: WATER, where: 'water', tilePerMin: 0, tileMax: 0, machines: of(PUMPS), dig: [] };
  }
  const where: DepositWhere = isFaceOre(ore) ? 'face' : isRock(t) ? 'vein' : 'ground';
  return {
    item: ore, where,
    tilePerMin: g.capMuPerEpoch(x, y) / 1000,
    tileMax: tileMaxOf(ore),
    machines: of(where === 'face' ? CUTTERS : DRILLS),
    dig: where === 'vein' ? of(DIGGERS) : [],
  };
}

/** The deposit a tile belongs to: its known tiles of the same ore joined by their sides (at most `cap`), their count and what they give together a minute. */
export function depositExtent(sim: Sim, x: number, y: number, cap = 1500): { tiles: number; perMin: number; keys: Set<number> } {
  const g = sim.grid, ore = g.ore(x, y);
  const keys = new Set<number>();
  if (ore < 0) return { tiles: 0, perMin: 0, keys };
  let mu = 0, n = 0;
  const stack = [y * WORLD + x];
  keys.add(stack[0]!);
  while (stack.length && n < cap) {
    const k = stack.pop()!, kx = k % WORLD, ky = (k - kx) / WORLD;
    mu += g.capMuPerEpoch(kx, ky);
    n++;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = kx + dx, ny = ky + dy, nk = ny * WORLD + nx;
      if (nx < 0 || ny < 0 || nx >= WORLD || ny >= WORLD || keys.has(nk)) continue;
      if (g.ore(nx, ny) !== ore) continue;
      keys.add(nk);
      stack.push(nk);
    }
  }
  return { tiles: n, perMin: mu / 1000, keys };
}
