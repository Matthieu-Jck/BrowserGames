// climate.ts — the cirque desert's air temperature, a pure integer function of the absolute
// world clock and WORLD_SEED (like the sun and the gusts in power/network.ts): the same for
// every colony, the same online and offline, never saved. Units: deci-°C (215 = 21.5 °C).
//
// The day: a table of 36 values (BAL.climate.curve, one at the start of each day epoch; day
// epoch 0 is 20:00, the start of the night), interpolated linearly tick by tick. The desert
// cools fast after sunset and slowly through the night, is coldest at the end of the night
// (04:00, ≈ 4 °C), warms quickly once the sun is up and peaks a little after noon (14:00,
// ≈ 37 °C). On top, each world day runs a little hotter or colder: an offset drawn from
// hash32(worldSeed, day) in [−1000, 1000] ‰, blended linearly from one day start to the next
// (so the temperature never jumps), worth ±3 °C at the hottest hour and ±2 °C at the coldest.
//
// The effects are prepared here as pure functions of a temperature (wired into power later):
// solar panels lose output above 25 °C, and on cold nights the base's electronics run survival
// heaters (the base is automated, nobody lives there: like a planetary rover, the Heart and
// the accumulators' cells must stay above a cold limit). Like the sun, power reads one value per
// epoch (`epochTemp`), so a whole epoch is one regime for the offline catch-up.
import { BAL } from '@/content/balance';
import { hash32 } from '@/core/hash';
import { DAY_EPOCHS, EPOCH } from '../constants';

/** Salt of the per-day draw (keeps it independent of the gusts' and the market's draws). */
const DAY_SALT = 0xc11a7e;
/** Ticks per world day. */
const DAY_TICKS = DAY_EPOCHS * EPOCH;

const CURVE = BAL.climate.curve;
/** Coldest and hottest values of the daily curve (deci-°C): they scale the day's offset. */
const T_MIN = Math.min(...CURVE);
const T_MAX = Math.max(...CURVE);

/** The day's offset in ‰ of the full swing, in [−1000, 1000], from the world seed (day = absEpoch / 36). */
export function dayOffsetPermille(day: number, worldSeed: number): number {
  return (hash32(worldSeed, day, DAY_SALT) % 2001) - 1000;
}

/** The daily curve alone at a tick of the day (0 ≤ dayTick < 36·600), deci-°C. */
export function baseTemp(dayTick: number): number {
  const e = Math.floor(dayTick / EPOCH), k = dayTick - e * EPOCH;
  const a = CURVE[e]!, b = CURVE[(e + 1) % DAY_EPOCHS]!;
  return Math.floor((a * (EPOCH - k) + b * k) / EPOCH);
}

/**
 * Air temperature (deci-°C) at an absolute world tick (`absEpoch · EPOCH + tick in epoch`, i.e.
 * `sim.foundingEpoch · EPOCH + sim.tick`). Integer, continuous to ±1 per tick.
 *
 * T = curve(t) + offset(t) · worth(curve(t)) / 1000, where the curve is interpolated within the
 * epoch, the offset blended between the two day starts around t, and its worth runs from
 * dayVarLow at the curve's coldest to dayVarPeak at its hottest. It is computed as ONE exact
 * fraction floored once (every term below 2^53), so rounding never adds a step between ticks.
 */
export function temperatureAt(absTick: number, worldSeed: number): number {
  const day = Math.floor(absTick / DAY_TICKS);
  const p = absTick - day * DAY_TICKS;
  const e = Math.floor(p / EPOCH), k = p - e * EPOCH;
  // The curve × EPOCH, and the day's offset (‰) × DAY_TICKS.
  const tb = CURVE[e]! * (EPOCH - k) + CURVE[(e + 1) % DAY_EPOCHS]! * k;
  const off = dayOffsetPermille(day, worldSeed) * (DAY_TICKS - p) + dayOffsetPermille(day + 1, worldSeed) * p;
  // The offset's worth (deci-°C at 1000 ‰) × (T_MAX − T_MIN) × EPOCH.
  const span = T_MAX - T_MIN;
  const worth = BAL.climate.dayVarLow * (T_MAX * EPOCH - tb) + BAL.climate.dayVarPeak * (tb - T_MIN * EPOCH);
  return Math.floor((tb * DAY_TICKS * span * 1000 + off * worth) / (EPOCH * DAY_TICKS * span * 1000));
}

/** The temperature power uses for a whole epoch: the value at its middle tick (deci-°C). */
export function epochTemp(absEpoch: number, worldSeed: number): number {
  return temperatureAt(absEpoch * EPOCH + (EPOCH >> 1), worldSeed);
}

/**
 * Sun bulbs in the heat (‰ of their output): 1000 up to BAL.climate.solarRef, then
 * BAL.climate.solarLoss ‰ less per °C above it (−0.4 %/°C: 940 ‰ at 40 °C). Not wired yet.
 */
export function solarHeatPermille(tempDeci: number): number {
  const over = tempDeci - BAL.climate.solarRef;
  if (over <= 0) return 1000;
  return Math.max(0, 1000 - Math.floor((over * BAL.climate.solarLoss) / 10));
}

/**
 * Survival heaters (kW) at a temperature: the electronics of the Heart (and the accumulators' cells)
 * draw BAL.climate.heaterKwPerDeg kW per °C below BAL.climate.heaterBelow, nothing above it.
 * Not wired yet.
 */
export function heaterKw(tempDeci: number, kwPerDeg: number = BAL.climate.heaterKwPerDeg): number {
  const under = BAL.climate.heaterBelow - tempDeci;
  return under <= 0 ? 0 : Math.floor((under * kwPerDeg) / 10);
}
