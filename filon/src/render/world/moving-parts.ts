// moving-parts.ts — how fast the buildings' moving parts turn, as pure functions of what the sim
// knows (BuildingsView.animate steps their baked phases; recipes/moving.ts lists the parts).
// A wind turbine on a grid turns with the wind its generator sees — the local wind ‰ (sheltered
// cirque, plain, windy mesa) times the gust ‰ of the moment — so a gusty hour shows as faster
// crowns and a mesa's turbines outspin the cirque's. One on no grid stands still, braked and
// switched off (D83: a building that does not work shows no motion); wiring it sets it going. A
// machine's part (the sand collector's wheel) turns while it works, slower on a short grid, and
// stops when it starves, backs up or loses power. Speeds are turns per second of game time: a
// paused game stands still.
import { St } from '@/sim/types';

/** A machine's part at full power (turns per second). */
export const WORK_TURNS = 0.14;

/**
 * A wind turbine's crown on a grid (turns per second) for its local wind and the gust (both ‰):
 * on the mountains (D44: the Crown's ridge, standing on the rock top) it sees the Sough's full
 * strength and spins far faster than on the sheltered cirque floor.
 */
export function windTurns(local: number, gust: number): number {
  const wind = (local * gust) / 1e6; // 0.18 (sheltered cirque floor, a lull) … 2.6 (a ridge or a mesa top, a strong gust)
  return Math.min(0.75, Math.max(0.1, 0.06 + 0.26 * wind));
}

/** A machine's part (turns per second) from its node's status and its grid's satisfaction ‰. */
export function workTurns(status: number, sat: number): number {
  if (status !== St.Ok && status !== St.LowPower) return 0;
  return WORK_TURNS * Math.min(1, Math.max(0, sat) / 1000);
}

/**
 * A building's own start phase (0–1) and speed factor (0.92–1.08), hashed from its id, so a row
 * of turbines never turns in step.
 */
export function spinSeed(id: number): { phase: number; vary: number } {
  let h = (id * 0x9e3779b1) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return { phase: (h & 0xffff) / 0x10000, vary: 0.92 + 0.16 * ((h >>> 16) / 0x10000) };
}
