// land-facts.ts — what the land panel, the toasts and the absence report say about a parcel
// (docs/land.md, D60), derived from the engine and never written by hand: its name on the map (a
// compass offset from the Heart's parcel, « 2 E · 1 N »: the parcels have no names, and an offset
// is what the player can find on the overlay), what it holds tile by tile (floor, rock, water, salt
// flats, vents, the dune sea, each deposit's ore — of the tiles explored: the fog keeps the rest,
// counted apart; the price, the engine's, knows it all), who holds it (the claim — its starting square,
// bought, granted or leased —, a sister claim, or nobody: CrierBelt sells it), and the buildings
// standing on it. Pure text and numbers, no DOM, so it is tested in node (land-facts.test.ts).
import { WORLD, CENTER } from '@/sim/constants';
import type { Sim } from '@/sim/state';
import { isRock, T } from '@/sim/types';
import { PARCEL_COLS, parcelAt, parcelRect } from '@/sim/world/land';
import { footprint } from '@/sim/entities';
import { locale, t } from '@/i18n/i18n';

/** The Heart's parcel: the compass names every other one from it. */
const HOME = parcelAt(CENTER, CENTER);

/** A parcel's column and row on the world's parcel grid. */
export const parcelCell = (p: number): [number, number] => [p % PARCEL_COLS, Math.floor(p / PARCEL_COLS)];

/** The parcel under a tile, the tile clamped to the world (the pointer may hang off its edge). */
export const parcelUnder = (x: number, y: number): number =>
  parcelAt(Math.max(0, Math.min(WORLD - 1, Math.floor(x))), Math.max(0, Math.min(WORLD - 1, Math.floor(y))));

/** A parcel's name: its offset from the Heart's in parcels, north / south then east / west (« 2 N · 1 E »); the Heart's own is « Cœur ». */
export function parcelLabel(p: number): string {
  const [c, r] = parcelCell(p), [hc, hr] = parcelCell(HOME);
  const dx = c - hc, dy = r - hr;
  const parts: string[] = [];
  if (dy) parts.push(t(dy < 0 ? 'land.dir.n' : 'land.dir.s', { n: Math.abs(dy) }));
  if (dx) parts.push(t(dx > 0 ? 'land.dir.e' : 'land.dir.w', { n: Math.abs(dx) }));
  return parts.length ? parts.join(' · ') : t('land.here');
}

/** Who holds a parcel and how: the claim (its grant, bought, granted at a save's migration, leased), a sister claim, or CrierBelt (for sale). */
export type ParcelState = 'start' | 'bought' | 'granted' | 'leased' | 'sister' | 'free';

export function parcelState(sim: Sim, p: number): ParcelState {
  const L = sim.land;
  if (L.inStart(p)) return 'start';
  if (L.bought.has(p)) return 'bought';
  if (L.granted.has(p)) return 'granted';
  if (L.leases.has(p)) return 'leased';
  return L.sister(p) >= 0 ? 'sister' : 'free';
}

/** Held for good (the overlay's solid border): the starting square, bought or granted — not a lease. */
export const ownsForGood = (s: ParcelState): boolean => s === 'start' || s === 'bought' || s === 'granted';

/** The sister claim's name (the Crier's colony of that index), in the current language; '' if the market does not know it. */
export function sisterName(sim: Sim, idx: number): string {
  const cs = sim.market.snapshot().colonies;
  const c = cs.find((k) => k.idx === idx) ?? cs[idx];
  return c ? c.name[locale()] : '';
}

/** What a parcel holds, tile by tile: grounds, and deposit tiles by ore (item index). */
export interface ParcelContents {
  readonly tiles: number;
  /** Tiles still under the fog: not counted below. */
  readonly hidden: number;
  readonly floor: number;
  readonly rock: number;
  readonly water: number;
  readonly salt: number;
  readonly vent: number;
  readonly dunes: number;
  /** Deposit tiles by ore item, most first (ties by item). */
  readonly ores: ReadonlyArray<readonly [item: number, tiles: number]>;
}

export function parcelContents(sim: Sim, p: number): ParcelContents {
  const { x0, y0, x1, y1 } = parcelRect(p);
  let floor = 0, rock = 0, water = 0, salt = 0, vent = 0, dunes = 0, hidden = 0;
  const ores = new Map<number, number>();
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (!sim.revealed(x, y)) { hidden++; continue; }
      const tt = sim.grid.terrain(x, y);
      if (isRock(tt)) rock++;
      else if (tt === T.Shallow || tt === T.Deep) water++;
      else if (tt === T.Salt) salt++;
      else if (tt === T.Vent) vent++;
      else if (tt === T.DuneSea) dunes++;
      else floor++;
      const ore = sim.grid.ore(x, y);
      if (ore >= 0) ores.set(ore, (ores.get(ore) ?? 0) + 1);
    }
  }
  return {
    tiles: (x1 - x0) * (y1 - y0), hidden, floor, rock, water, salt, vent, dunes,
    ores: [...ores].sort((a, b) => b[1] - a[1] || a[0] - b[0]),
  };
}

/** A short signature of what a parcel holds (the panel rebuilds its contents row when it changes: a tile dug, water filled). */
export const contentsSig = (c: ParcelContents): string =>
  `${c.hidden},${c.floor},${c.rock},${c.water},${c.salt},${c.vent},${c.dunes};${c.ores.map(([i, n]) => `${i}:${n}`).join(',')}`;

/** The buildings with a footprint tile on the parcel (what a lapsed or given-up lease would stop), by id. */
export function buildingsOn(sim: Sim, p: number): number[] {
  const { x0, y0, x1, y1 } = parcelRect(p);
  const out: number[] = [];
  for (const e of sim.ents.sorted()) {
    if (e.id === sim.hearthId) continue;
    const [w, h] = footprint(e.def, e.rot);
    if (e.x < x1 && e.x + w > x0 && e.y < y1 && e.y + h > y0) out.push(e.id);
  }
  return out;
}
