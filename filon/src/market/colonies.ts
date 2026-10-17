// colonies.ts — the forty colonies of a world, generated from content/colonies.ts and
// the world seed, so every player of that world trades with the same ones: a name drawn from
// syllables (« Port-Écume », the design's pinned names kept), a distance band (→ delivery
// delay; a profile spanning two bands alternates them by rank) and a place on the planet for
// the orbital view, a size, its unique resource. Then the per-item view the market runs on:
// who supplies and who buys each good, with what share of the NPC supply / demand at day 0,
// the share-weighted growth of each side, and the import sources sorted nearest first.
import { BAL } from '@/content/balance';
import {
  BAND_ARC, COLONY_PROFILES, COLONY_PROFILE_IDS, COLONY_SIZE, HOME_POSITION, NAME_HEADS, NAME_TAILS,
  PINNED_COLONIES, UNIQUE_WEIGHT, type ColonyProfile, type DistanceBand,
} from '@/content/colonies';
import { N_ITEMS, itemIdx } from '@/content/registry';
import type { Loc } from '@/content/types';
import { hash32, hashUnit } from '@/core/hash';
import type { ColonyView, ImportSource } from './types';

/** A generated colony: the UI view plus its weighted trade lines. */
export interface Colony extends ColonyView {
  readonly supplyLines: ReadonlyArray<readonly [number, number]>; // [item index, weight × size]
  readonly needLines: ReadonlyArray<readonly [number, number]>;
}

/** Per item: the colonies on each side of its trade. */
export interface ItemTrade {
  /** Suppliers, nearest first, then the larger share, then index: where imports come from. */
  readonly sources: readonly ImportSource[];
  /** Buyers with their share of the base demand (index order). */
  readonly buyers: ReadonlyArray<{ readonly colony: number; readonly share: number }>;
  /** Share-weighted growth per day of the base supply and demand. */
  readonly growthS: number;
  readonly growthD: number;
}

const SALT = { name: 0xc0b2, bearing: 0xc0b3, arc: 0xc0b4, size: 0xc0b5 } as const;
const GOLDEN = 137.50776405; // degrees: successive colonies spread evenly around the cirque
const DEG = Math.PI / 180;
const round1 = (v: number): number => Math.round(v * 10) / 10;

/** A name not taken yet: head + tail drawn from the hash, the tail stepped on a clash. */
function drawName(seed: number, idx: number, taken: Set<string>): Loc {
  for (let h = 0; h < NAME_HEADS.length; h++) {
    const head = NAME_HEADS[(hash32(seed, SALT.name, idx, 0) + h) % NAME_HEADS.length]!;
    const t0 = hash32(seed, SALT.name, idx, 1);
    for (let k = 0; k < NAME_TAILS.length; k++) {
      const tail = NAME_TAILS[(t0 + k) % NAME_TAILS.length]!;
      const fr = `${head.fr}-${head.plural ? tail.frPl : tail.fr}`;
      if (taken.has(fr)) continue;
      taken.add(fr);
      return { fr, en: head.en.replace('{}', head.plural ? tail.enPl : tail.en) };
    }
  }
  throw new Error('colonies: out of names');
}

/** The point at great-circle distance `arc` (degrees) from the cirque, at a bearing (degrees). */
function placeAt(bearing: number, arc: number): { lat: number; lon: number } {
  const la1 = HOME_POSITION.lat * DEG, lo1 = HOME_POSITION.lon * DEG, th = bearing * DEG, d = arc * DEG;
  const la2 = Math.asin(Math.sin(la1) * Math.cos(d) + Math.cos(la1) * Math.sin(d) * Math.cos(th));
  const lo2 = lo1 + Math.atan2(Math.sin(th) * Math.sin(d) * Math.cos(la1), Math.cos(d) - Math.sin(la1) * Math.sin(la2));
  const lon = ((((lo2 / DEG) + 180) % 360) + 360) % 360 - 180;
  return { lat: round1(la2 / DEG), lon: round1(lon) };
}

/** The forty colonies of a world, in profile order (COLONY_PROFILE_IDS), then by rank. */
export function makeColonies(seed: number): Colony[] {
  const out: Colony[] = [];
  const taken = new Set(PINNED_COLONIES.map((p) => p.name.fr));
  for (const pid of COLONY_PROFILE_IDS) {
    const p = COLONY_PROFILES[pid] as ColonyProfile;
    for (let rank = 0; rank < p.count; rank++) {
      const idx = out.length;
      const pin = PINNED_COLONIES.find((q) => q.profile === pid && q.rank === rank);
      // Bands alternate by rank: a « near–medium » profile always has some of each.
      const band: DistanceBand = pin?.band ?? p.bands[rank % p.bands.length]!;
      const [a0, a1] = BAND_ARC[band];
      const arc = round1(a0 + hashUnit(seed, SALT.arc, idx) * (a1 - a0));
      const bearing = (idx * GOLDEN + (hashUnit(seed, SALT.bearing, idx) - 0.5) * 40 + 360) % 360;
      const size = Math.round((COLONY_SIZE[0] + hashUnit(seed, SALT.size, idx) * (COLONY_SIZE[1] - COLONY_SIZE[0])) * 100) / 100;
      const unique = p.uniques.length > 0 ? p.uniques[rank % p.uniques.length]! : null;
      const supplies: Array<readonly [string, number]> = [...p.supplies];
      if (unique) supplies.push([unique, UNIQUE_WEIGHT]);
      out.push({
        idx,
        key: pin?.key ?? `${pid}_${rank}`,
        profile: pid,
        name: pin?.name ?? drawName(seed, idx, taken),
        band,
        delayMin: BAL.market.delayMin[band],
        ...placeAt(bearing, arc),
        arc,
        size,
        growth: p.growth,
        unique,
        supplies: supplies.map(([it]) => it),
        needs: p.needs.map(([it]) => it),
        supplyLines: supplies.map(([it, w]) => [itemIdx(it), w * size] as const),
        needLines: p.needs.map(([it, w]) => [itemIdx(it), w * size] as const),
      });
    }
  }
  return out;
}

/** Per item index: suppliers (import sources, nearest first), buyers, and each side's growth. */
export function tradeByItem(cols: readonly Colony[]): ItemTrade[] {
  const sup: Array<Array<{ colony: number; w: number }>> = Array.from({ length: N_ITEMS }, () => []);
  const buy: Array<Array<{ colony: number; w: number }>> = Array.from({ length: N_ITEMS }, () => []);
  for (const c of cols) {
    for (const [i, w] of c.supplyLines) sup[i]!.push({ colony: c.idx, w });
    for (const [i, w] of c.needLines) buy[i]!.push({ colony: c.idx, w });
  }
  return sup.map((s, i) => {
    const b = buy[i]!;
    const ws = s.reduce((a, e) => a + e.w, 0), wb = b.reduce((a, e) => a + e.w, 0);
    const sources = s.map((e) => ({ colony: e.colony, delayMin: cols[e.colony]!.delayMin, share: e.w / ws }));
    sources.sort((x, y) => x.delayMin - y.delayMin || y.share - x.share || x.colony - y.colony);
    return {
      sources,
      buyers: b.map((e) => ({ colony: e.colony, share: e.w / wb })),
      growthS: ws > 0 ? s.reduce((a, e) => a + (e.w / ws) * cols[e.colony]!.growth, 0) : 0,
      growthD: wb > 0 ? b.reduce((a, e) => a + (e.w / wb) * cols[e.colony]!.growth, 0) : 0,
    };
  });
}

/** Index of the colony with this key (pinned or `<profile>_<rank>`), −1 if none. */
export const colonyByKey = (cols: readonly Colony[], key: string): number => cols.findIndex((c) => c.key === key);
