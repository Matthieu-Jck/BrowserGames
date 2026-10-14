// daynight.ts — the look of the time of day (design §9: « teinte globale par images-clés,
// jamais noire (nuit lilas/indigo) »). Pure keyframes over the 24-hour clock give, for any
// moment, a multiply tint for the lit world (dawn peach and rose, a neutral warm day, coral
// and amber at dusk, a lilac-indigo night that never goes black), a night factor (how much
// the colony's lights glow), the sun as the eye sees it (the engine's SOLAR table, smoothed)
// and how much the cloud shadows show.
//
// The clock is the sim's own: the absolute world tick (foundingEpoch · EPOCH + the sim's
// interpolated tick), so the look turns with the power the solar panels make. `DayNight` applies
// the grade: one tint on the containers that hold the world (`lit` is a render group, so its
// tint is one uniform, whatever the number of sprites), written only when the 24-bit colour
// changes; the plan view gets a lighter grade so building stays clear. A debug offset
// (`FL.dayPhase`) shifts the clock the look and the HUD read — never the sim's.
import type { Container, Renderer } from 'pixi.js';
import { DAY_EPOCHS, EPOCH, SOLAR } from '@/sim/constants';
import type { Sim } from '@/sim/state';

/** Ticks per world day (36 epochs). */
export const DAY_TICKS = DAY_EPOCHS * EPOCH;
/** Day epoch of midnight on the 24-hour clock (the HUD's clock: the world day starts at 20:00). */
const MIDNIGHT = 6;
/** Share of the grade the plan view keeps (building stays clear). */
const PLAN_GRADE = 0.4;
/** The sand behind the world (stage background), graded with it. */
const GROUND: readonly [number, number, number] = [0xee, 0xd7, 0xb8];

/** Hour of the 24-hour clock (0 ≤ h < 24) at a day phase in day epochs (0 ≤ phase < 36). */
export const hourOf = (phase: number): number => ((((phase - MIDNIGHT) % DAY_EPOCHS) + DAY_EPOCHS) % DAY_EPOCHS) * (24 / DAY_EPOCHS);
/** Day phase (day epochs) of an hour of the 24-hour clock. */
export const phaseOf = (hour: number): number => (((hour * DAY_EPOCHS) / 24 + MIDNIGHT) % DAY_EPOCHS + DAY_EPOCHS) % DAY_EPOCHS;
/** Day phase (fractional day epochs) of an absolute world tick. */
export const phaseAt = (worldTick: number): number => (((worldTick / EPOCH) % DAY_EPOCHS) + DAY_EPOCHS) % DAY_EPOCHS;

/** A keyframe: the hour, the multiply tint (0–1 per channel) and the night factor. */
interface Key { h: number; c: readonly [number, number, number]; night: number }

const NIGHT = [0.56, 0.54, 0.8] as const;
/**
 * The day, hour by hour. The sun rises from 04:00 to 06:00 and sets from 18:00 to 20:00 (the
 * SOLAR table); the lights come on through dusk and go out through dawn. The darkest channel
 * never drops below ~0.5: the night is lilac and indigo, the board stays readable.
 */
const KEYS: readonly Key[] = [
  { h: 0, c: NIGHT, night: 1 },
  { h: 3.4, c: [0.53, 0.53, 0.81], night: 1 },     // the deep blue before dawn
  { h: 4.2, c: [0.67, 0.58, 0.8], night: 0.95 },   // first light: lilac turning rose
  { h: 5.0, c: [0.94, 0.75, 0.77], night: 0.55 },  // dawn: rose and peach
  { h: 6.0, c: [1, 0.86, 0.77], night: 0.1 },      // sunrise: peach gold
  { h: 7.4, c: [1, 0.95, 0.89], night: 0 },        // a warm morning
  { h: 12, c: [1, 1, 0.98], night: 0 },            // noon: neutral
  { h: 16.4, c: [1, 0.95, 0.88], night: 0 },       // a warm afternoon
  { h: 18.0, c: [1, 0.85, 0.7], night: 0.08 },     // golden hour: amber
  { h: 19.0, c: [0.95, 0.72, 0.64], night: 0.5 },  // dusk: coral
  { h: 20.0, c: [0.72, 0.59, 0.76], night: 0.9 },  // twilight: violet
  { h: 21.0, c: [0.58, 0.55, 0.8], night: 1 },
  { h: 24, c: NIGHT, night: 1 },
];

/** What the renderer needs to know about the moment. Mutable: `DayNight` refills one object every frame. */
export interface Grade {
  /** Day phase, fractional day epochs [0, 36). */
  phase: number;
  /** Hour of the 24-hour clock [0, 24). */
  hour: number;
  /** Multiply tint per channel (0–1), before the view's strength. */
  r: number;
  g: number;
  b: number;
  /** 0 by day … 1 at night: how much the lights glow. */
  night: number;
  /** The sun as seen (0–1): SOLAR ‰ smoothed between epoch centres. */
  sun: number;
  /** Cloud shadows' strength (0 at night). */
  clouds: number;
}

export const newGrade = (): Grade => ({ phase: 0, hour: 0, r: 1, g: 1, b: 1, night: 0, sun: 1, clouds: 1 });

const smooth = (t: number): number => t * t * (3 - 2 * t);
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** The sun the eye sees at a day phase: SOLAR (‰ per epoch) joined linearly between epoch centres, 0–1. */
export function sunAt(phase: number): number {
  const x = phase - 0.5;
  const i = Math.floor(x), t = x - i;
  const a = SOLAR[((i % DAY_EPOCHS) + DAY_EPOCHS) % DAY_EPOCHS]!, b = SOLAR[(((i + 1) % DAY_EPOCHS) + DAY_EPOCHS) % DAY_EPOCHS]!;
  return (a + (b - a) * t) / 1000;
}

/** Fill `out` with the grade at a day phase (no allocation). */
export function gradeAt(phase: number, out: Grade = newGrade()): Grade {
  const h = hourOf(phase);
  let k = 0;
  while (k < KEYS.length - 2 && KEYS[k + 1]!.h <= h) k++;
  const A = KEYS[k]!, B = KEYS[k + 1]!;
  const t = smooth(clamp01((h - A.h) / (B.h - A.h)));
  out.phase = phase;
  out.hour = h;
  out.r = A.c[0] + (B.c[0] - A.c[0]) * t;
  out.g = A.c[1] + (B.c[1] - A.c[1]) * t;
  out.b = A.c[2] + (B.c[2] - A.c[2]) * t;
  out.night = A.night + (B.night - A.night) * t;
  out.sun = sunAt(phase);
  out.clouds = smooth(clamp01((out.sun - 0.2) / 0.7)) * (1 - out.night);
  return out;
}

/** The 24-bit tint of a grade at a strength (1 = the full grade, 0 = white). */
export function tintOf(g: Grade, strength: number): number {
  const ch = (v: number): number => Math.round(255 * (1 - strength * (1 - v)));
  return (ch(g.r) << 16) | (ch(g.g) << 8) | ch(g.b);
}

/** Named moments for screenshots and the debug handle. */
export const MOMENTS = { dawn: 5, noon: 12, dusk: 19, night: 0 } as const;

/**
 * Applies the grade every frame: the tint on the world's containers and the stage background,
 * written only when the 24-bit colour changes (a few times a minute during dawn and dusk,
 * never in full day or night).
 */
export class DayNight {
  /** Debug offset (ticks) added to the world clock for the look and the HUD clock (FL.dayPhase). */
  offsetTicks = 0;
  readonly grade: Grade = newGrade();
  private tint = -1;

  constructor(private readonly tinted: readonly Container[], private readonly renderer: Renderer) {}

  /** The absolute world tick the look shows: the sim's clock (interpolated ticks allowed), plus the debug offset. */
  worldTick(sim: Sim, simTicks: number = sim.tick): number {
    return sim.foundingEpoch * EPOCH + simTicks + this.offsetTicks;
  }

  /** Show another hour of the day (debug): shifts the clock by less than a day; null returns to the world clock. */
  setHour(hour: number | null, sim: Sim): void {
    if (hour === null) { this.offsetTicks = 0; return; }
    const now = phaseAt(sim.foundingEpoch * EPOCH + sim.tick);
    const d = (((phaseOf(hour) - now) % DAY_EPOCHS) + DAY_EPOCHS) % DAY_EPOCHS;
    this.offsetTicks = Math.round(d * EPOCH);
  }

  /** Grade the moment at a world tick, for a view `te` (0 iso … 1 plan); returns the (shared) grade. */
  update(worldTick: number, te: number): Grade {
    const g = gradeAt(phaseAt(worldTick), this.grade);
    const tint = tintOf(g, 1 - (1 - PLAN_GRADE) * te);
    if (tint !== this.tint) {
      this.tint = tint;
      for (const c of this.tinted) c.tint = tint;
      const r = (tint >> 16) & 255, gg = (tint >> 8) & 255, b = tint & 255;
      const bg = (Math.round((GROUND[0] * r) / 255) << 16) | (Math.round((GROUND[1] * gg) / 255) << 8) | Math.round((GROUND[2] * b) / 255);
      this.renderer.background.color = bg;
    }
    return g;
  }
}
