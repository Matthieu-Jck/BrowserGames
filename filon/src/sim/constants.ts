// constants.ts — engine cadence and units. Everything in the sim is an integer:
// quantities in milli-items (MU per item), power in kW, energy in kW·tick, money in
// centi-ocelles, ratios in permille. Recipe cycles must divide CYCLE_LCM ticks so a
// full-speed group repeats with a short exact period (offline catch-up relies on it).

/** Simulation ticks per real second. */
export const TPS = 10;
/** Milliseconds per tick. */
export const TICK_MS = 100;
/** One epoch = one real minute: market settlement, solar/wind steps, order toggles. */
export const EPOCH = 600;
/** Base recipe cycles divide this; the catch-up period search window is twice it. */
export const CYCLE_LCM = 1200;
export const PERIOD_MAX = 2400;

/** Milli-items per item. */
export const MU = 1000;
/** Satisfaction and multipliers are permille; power satisfaction is stepped by this. */
export const PERMILLE = 1000;
export const SAT_STEP = 25;

/** World geometry. */
export const WORLD = 1024;
export const CHUNK = 32;
export const CHUNKS = WORLD / CHUNK; // 32 × 32 chunks
export const CENTER = 512;

/** Day = 36 epochs: 12 dark, 3 dawn, 18 full sun, 3 dusk (sun output ‰ per epoch). */
export const DAY_EPOCHS = 36;
export const SOLAR: readonly number[] = [
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  150, 500, 850,
  1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000,
  850, 500, 150,
];

/** Wind gust window (epochs) and the five gust levels (‰). */
export const GUST_EPOCHS = 10;
export const GUST_LEVELS: readonly number[] = [700, 850, 1000, 1150, 1300];

/** World epoch zero: 2026-01-01T00:00:00Z, in minutes since the Unix epoch (1767225600 s / 60). */
export const WORLD_EPOCH0 = 29453760;
