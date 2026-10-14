// levels.ts — the mix, pure: decibels, the volume sliders' taper, and every bus level in one
// table. The levels were set by measurement, not by ear (an OfflineAudioContext render in headless
// Chrome, peak / RMS / K-weighted loudness; the method and the numbers are in docs/audio.md,
// "Levels"): at the default sliders the score sits around −18 LUFS, the ambience well under it,
// and no effect peaks above −6 dBFS even at full sliders. A limiter on the master catches the
// rest. To make something louder or softer, change its row here (or its cue's trim in cues.ts),
// then measure again.
import { clamp } from '@/core/math';

export const dbToGain = (db: number): number => (db <= -120 ? 0 : 10 ** (db / 20));
export const gainToDb = (g: number): number => (g <= 0 ? -Infinity : 20 * Math.log10(g));

const unit = (v: number): number => (Number.isFinite(v) ? clamp(v, 0, 1) : 0);

/**
 * A volume slider (0–1) to a gain: a squared taper, the usual approximation of how loud a fader
 * sounds (half way ≈ −12 dB, 80 % ≈ −4 dB); 0 is silence.
 */
export const sliderGain = (s: number): number => unit(s) * unit(s);

/** The three sliders of the settings page. */
export interface Volumes { master: number; music: number; sfx: number }

/** Where the sliders start: the mix below is designed for these positions. */
export const DEFAULT_VOLUMES: Readonly<Volumes> = { master: 1, music: 0.8, sfx: 0.8 };

/**
 * Bus trims (dB) at full sliders. `music`: the score's bus (pads, bass, melody, pulses, echo,
 * their reverb); `ambience`: wind, machine bed, ribbon rattle (under the effects slider, with the
 * effects); `sfx`: the cues; `duck`: the ambience under a full screen or the main menu (the base
 * is behind a veil); `limiter`: the master limiter's threshold.
 */
export const MIX = {
  music: 1.5,
  ambience: 0,
  sfx: 0,
  duck: -5,
  limiter: -4,
} as const;

/**
 * The score's voices (peak gain of one note or chord at velocity 1, before the music bus). The pad
 * carries the music; the melody sits on it; the pulses stay underneath.
 */
export const VOICE = {
  pad: 0.3,
  bass: 0.07,
  mallet: 0.3,
  pluck: 0.18,
  knock: 0.2,
  shaker: 0.14,
  /** The echo's return and the reverb's return. */
  echo: 0.45,
  reverb: 0.7,
} as const;

/** The ambience's layers (gain at full strength, before the ambience bus). */
export const AMB = {
  /** The wind's body (low-passed pink noise), its whistle (a narrow band) and its low rumble. */
  windBody: 0.45,
  windWhistle: 0.07,
  windRumble: 0.3,
  /** The machine bed at full (many machines running in view). */
  bed: 0.13,
  /** The ribbons' rattle at full (zoomed in close over busy ribbons). */
  rattle: 0.6,
} as const;

/** The gains each bus runs at, from the sliders (and the ambience duck, 0 … 1). */
export function busGains(v: Volumes, duck = 0): { master: number; music: number; ambience: number; sfx: number } {
  const sfx = sliderGain(v.sfx);
  return {
    master: sliderGain(v.master),
    music: sliderGain(v.music) * dbToGain(MIX.music),
    ambience: sfx * dbToGain(MIX.ambience + MIX.duck * unit(duck)),
    sfx: sfx * dbToGain(MIX.sfx),
  };
}

/** Did a volume change enough to be worth writing to the audio graph? */
export const sameVolumes = (a: Volumes, b: Volumes): boolean =>
  Math.abs(a.master - b.master) < 1e-4 && Math.abs(a.music - b.music) < 1e-4 && Math.abs(a.sfx - b.sfx) < 1e-4;
