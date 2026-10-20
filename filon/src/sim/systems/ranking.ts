// ranking.ts (system) — « Classement des concessions » (D153): the claim's value (D50, systems/value.ts)
// against the forty other claims of the Crier, drawn up every world hour — the long goal of a base,
// hard to top (the leaders grow too) but steady to climb.
//
// The other claims (the market's colonies, content/colonies.ts) have no books of their own, so their
// values follow a curve from the seeds alone (`BAL.ranking`): at the player's founding a ladder of
// values, from a claim just begun up to the leader, each colony placed on it by a hash of the world's
// seed; then each grows by a share of its founding value a day — the young claims fastest, the leaders
// slowest, its profile's own growth (the market's) scaling it — with a gentle wobble eased from one
// day to the next, so claims side by side sometimes swap. Counted from the player's founding, as the
// market counts its colonies' growth: every claim of the world is a partner of CrierBelt's of the
// same age as the player's.
//
// The standings are a statistic, as the value they rank: saved, not hashed. They are drawn up at the
// minute's boundary that starts a world hour — online and in the catch-up alike (`Sim.tradeEpoch`) —,
// with the claim's value then; offline that value may count the few items a line just took from a
// small store (offline.md, the small-store gap), so the rank is offline-consistent, not bit-exact.
// Integers only: the rivals' values are exact functions of (seed, colony, minutes since founding).
import { BAL } from '@/content/balance';
import { COLONY_PROFILES, COLONY_PROFILE_IDS, type ColonyProfile } from '@/content/colonies';
import { mulDiv } from '@/core/fixed';
import { hash32 } from '@/core/hash';
import type { Sim } from '../state';
import { claimValue } from './value';

export interface RankingState {
  /** Absolute world epoch of the last standings (−1: none yet). */
  epoch: number;
  /** The claim's value then (centi-◉), and its rank among all the claims (1: the first). */
  value: number;
  rank: number;
  /** Its best rank so far (0: none yet). */
  best: number;
}

export const newRankingState = (): RankingState => ({ epoch: -1, value: 0, rank: 0, best: 0 });

/** One of the other claims on the ladder: its colony (the market's index), its value at the player's founding (centi-◉), its growth a day (‰ of it). */
export interface Rival { colony: number; v0: number; g: number }

const SALT = { place: 0x0d1530, wobble: 0x0d1531 } as const;
const DAY = 1440;

const RIVALS = new Map<number, Rival[]>();

/**
 * The forty claims of a world (by colony index: the market's order, profile by profile and by rank
 * within each), each on the ladder. Pure; built once a world.
 */
export function rivals(worldSeed: number): readonly Rival[] {
  let out = RIVALS.get(worldSeed);
  if (out) return out;
  const R = BAL.ranking;
  const growth: number[] = [];
  for (const pid of COLONY_PROFILE_IDS) {
    const p = COLONY_PROFILES[pid] as ColonyProfile;
    for (let k = 0; k < p.count; k++) growth.push(Math.round(p.growth * 1000)); // ‰ a day, the market's
  }
  const n = growth.length;
  // The ladder's order: a hash of the world's seed, ties by index (a total order).
  const order = growth.map((_, i) => i).sort((a, b) => hash32(worldSeed ^ SALT.place, a) - hash32(worldSeed ^ SALT.place, b) || a - b);
  out = new Array<Rival>(n);
  let v: number = R.floor;
  order.forEach((colony, k) => {
    // The foot grows fastest, the top slowest; the profile's growth against the reference scales it.
    const g = R.growth[0] + Math.floor(((R.growth[1] - R.growth[0]) * k) / Math.max(1, n - 1));
    out![colony] = { colony, v0: v, g: Math.floor((g * growth[colony]!) / R.growthRef) };
    v = mulDiv(v, R.step, 1000);
  });
  RIVALS.set(worldSeed, out);
  return out;
}

/** A day's wobble of a claim (‰, either way). */
const wobble = (worldSeed: number, colony: number, day: number): number => {
  const w = BAL.ranking.wobble;
  return (hash32(worldSeed ^ SALT.wobble, colony, day) % (2 * w + 1)) - w;
};

/** A claim's value (centi-◉) `minutes` after the player's founding: its founding value grown, its wobble eased between days. */
export function rivalValue(worldSeed: number, r: Rival, minutes: number): number {
  const m = Math.max(0, minutes), d = Math.floor(m / DAY), f = m % DAY;
  const w = Math.floor((wobble(worldSeed, r.colony, d) * (DAY - f) + wobble(worldSeed, r.colony, d + 1) * f) / DAY);
  return mulDiv(r.v0, DAY * (1000 + w) + r.g * m, DAY * 1000);
}

/** One line of the standings: a claim (its colony index; −1: the player's), its value. */
export interface Standing { colony: number; value: number }

/**
 * The standings at an absolute epoch with the claim worth `value` (centi-◉): every claim, the
 * richest first — the player's ahead of a claim worth as much —, and the player's rank (1-based).
 */
export function standings(sim: Sim, epoch: number, value: number): { rank: number; rows: Standing[] } {
  const m = epoch - sim.foundingEpoch;
  const rows: Standing[] = rivals(sim.worldSeed).map((r) => ({ colony: r.colony, value: rivalValue(sim.worldSeed, r, m) }));
  rows.push({ colony: -1, value });
  rows.sort((a, b) => b.value - a.value || (a.colony < 0 ? -1 : b.colony < 0 ? 1 : a.colony - b.colony));
  return { rank: rows.findIndex((s) => s.colony < 0) + 1, rows };
}

/** The last standings drawn up (null: none yet). */
export function lastStandings(sim: Sim): { rank: number; rows: Standing[] } | null {
  const st = sim.ranking;
  return st.epoch < 0 ? null : standings(sim, st.epoch, st.value);
}

/**
 * At a minute's boundary (Sim.tradeEpoch, after the value's sample): the standings drawn up at the
 * first boundary of a base, then at each world hour. A climb is an event (the claims passed since the
 * last standings, nearest first).
 */
export function rankEpoch(sim: Sim): void {
  const st = sim.ranking, now = sim.absEpoch();
  if (st.epoch === now || (st.epoch >= 0 && now % BAL.ranking.everyMin !== 0)) return;
  const value = claimValue(sim).total;
  const { rank, rows } = standings(sim, now, value);
  if (st.epoch >= 0 && rank < st.rank) {
    // The claims now under the player that stood over it at the last standings, nearest first.
    const before = standings(sim, st.epoch, st.value).rows;
    const above = new Set(before.slice(0, st.rank - 1).map((s) => s.colony));
    const passed = rows.slice(rank).filter((s) => above.has(s.colony)).map((s) => s.colony);
    sim.events.push({ k: 'rank', rank, prev: st.rank, of: rows.length, passed });
  }
  st.epoch = now;
  st.value = value;
  st.rank = rank;
  st.best = st.best > 0 ? Math.min(st.best, rank) : rank;
}

export const saveRanking = (st: RankingState): RankingState => ({ ...st });

export function loadRanking(sim: Sim, d: RankingState | undefined): void {
  sim.ranking = d && Number.isInteger(d.epoch) ? { epoch: d.epoch, value: Math.floor(d.value), rank: d.rank, best: d.best } : newRankingState();
}
