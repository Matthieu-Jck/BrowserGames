// moving-parts.ts — how fast the buildings' moving parts turn, as pure functions of what the sim
// knows (BuildingsView.animate steps their baked phases; recipes/moving.ts lists the parts).
// A wind turbine on a grid turns with the local wind its generator sees (D95: the weather's wind ×
// its place's exposure), so a gusty hour shows as faster crowns, a crest's turbines outspin the
// cirque's, one below its cut-in barely drifts and one stopped by a storm stands braked. One on no
// grid stands still, braked and switched off (D83: a building that does not work shows no motion);
// wiring it sets it going. A
// machine's part (the sand collector's wheel) turns while it works, slower on a short grid, and
// stops when it starves, backs up or loses power. Speeds are turns per second of game time: a
// paused game stands still.
import { St } from '@/sim/types';

/** A machine's part at full power (turns per second). */
export const WORK_TURNS = 0.14;

/**
 * A wind turbine's crown on a grid (turns per second) for the local wind it sees (‰ of the
 * reference wind, D95) and its curve's bounds: a slow drift below its cut-in (the place tells on
 * itself), braked at its cut-out (a storm), else faster the stronger the wind, within bounds.
 */
export function windTurns(wind: number, cutIn = 0, cutOut = Infinity): number {
  if (wind >= cutOut) return 0;
  if (wind < cutIn) return 0.03;
  return Math.min(0.75, Math.max(0.1, 0.06 + (0.26 * wind) / 1000));
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
