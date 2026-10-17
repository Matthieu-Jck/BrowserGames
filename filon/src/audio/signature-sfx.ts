// signature-sfx.ts — the buildings' signatures (D120), in Web Audio: one short recipe per
// signature of signatures.ts, built from sfx.ts's primitives (`tone`, `hiss`, their amplitude
// modulation) and in key with the score (`chordNote`: the tonal parts take the chord in force, in
// a register fixed per signature, so the drill always sounds low and the solar panel always
// high). Each recipe draws the same sound for both variants: `v.len` scales its decays, `v.full`
// (the build) adds its extra layers — a second stroke, a tail, more room — and the shared
// `setDown`, a soft landing thump under the machine (it takes the placement thunk's place).
//
// Lengths: 0.2–0.6 s for a machine (the time its loudest part takes to fall 26 dB), a few tens
// of milliseconds for the quiet family (line pieces, poles). Peaks are measured offline
// (scripts/sound-levels.mjs) and recorded in `SIGNATURES[…].peakDb`.
import { chordNote, hiss, tone, type SfxKit } from './sfx';
import type { Signature } from './signatures';
import { midiHz } from './theory';

/** How one signature plays this time. */
export interface SigVoice {
  /** Overall gain: signature trim × variant trim × the spatial fade. */
  readonly g: number;
  /** Decay scale: 1 for a build, shorter for a pick. */
  readonly len: number;
  /** The build: the extra layers and the set-down. */
  readonly full: boolean;
  /** Where the building is on screen (−1 … 1). */
  readonly pan: number;
}

type SigRecipe = (k: SfxKit, t: number, v: SigVoice) => void;

const hz = (k: SfxKit, i: number, floor: number): number => midiHz(chordNote(k, i, floor));
const room = (v: SigVoice, verb: number): number => (v.full ? verb * 1.4 : verb);

/** The build's set-down: a soft landing thump and a little dust under the machine. */
function setDown(k: SfxKit, t: number, v: SigVoice): void {
  tone(k, t, { f: 130, f2: 72, glide: 0.03, peak: 0.16 * v.g, tau: 0.07, pan: v.pan });
  hiss(k, t, { type: 'bandpass', f: 700, q: 1.2, peak: 0.08 * v.g, tau: 0.02, pan: v.pan });
}

export const SIG_RECIPES: Record<Signature, SigRecipe> = {
  /** Le Cœur: a heartbeat (lub-dub) under two warm chord tones. */
  heart: (k, t, v) => {
    const { g, len: L, pan } = v;
    tone(k, t, { f: 80, f2: 55, glide: 0.03, peak: 0.2 * g, tau: 0.06 * L, pan });
    tone(k, t + 0.17 * L, { f: 76, f2: 52, glide: 0.03, peak: 0.14 * g, tau: 0.06 * L, pan });
    for (const [i, p] of [[0, -0.15], [2, 0.15]] as const) tone(k, t + 0.02, { f: hz(k, i, 50), type: 'triangle', lp: 1000, peak: 0.06 * g, attack: 0.06, tau: 0.17 * L, verb: room(v, 0.3), pan: pan + p });
    if (v.full) tone(k, t + 0.1, { f: hz(k, 1, 74), peak: 0.04 * g, attack: 0.08, tau: 0.13, verb: 0.45, pan });
  },
  /** A drill: a low thud, then the bit's grind (chopped noise) over a low chord tone. */
  drill: (k, t, v) => {
    const { g, len: L, pan } = v;
    if (v.full) setDown(k, t, v);
    tone(k, t, { f: 92, f2: 48, glide: 0.04, peak: 0.24 * g, tau: 0.08 * L, pan });
    hiss(k, t + 0.02, { type: 'bandpass', f: 520, q: 1.4, peak: 0.17 * g, attack: 0.02, tau: 0.09 * L, am: { rate: 26, depth: 0.8, wave: 'square' }, pan });
    tone(k, t + 0.02, { f: hz(k, 0, 38), type: 'triangle', lp: 600, peak: 0.08 * g, attack: 0.01, tau: 0.12 * L, pan });
    if (v.full) hiss(k, t + 0.17, { type: 'bandpass', f: 600, q: 1.4, peak: 0.1 * g, attack: 0.015, tau: 0.07, am: { rate: 26, depth: 0.8, wave: 'square' }, pan });
  },
  /** The deep bore: a deeper, longer thrum (a throbbing low saw), then a clank of steel. */
  bore: (k, t, v) => {
    const { g, len: L, pan } = v;
    if (v.full) setDown(k, t, v);
    tone(k, t, { f: 70, f2: 40, glide: 0.05, peak: 0.22 * g, tau: 0.1 * L, pan });
    tone(k, t + 0.01, { f: hz(k, 0, 38), type: 'sawtooth', lp: 260, peak: 0.22 * g, attack: 0.05, tau: 0.18 * L, am: { rate: 11, depth: 0.7 }, pan });
    const c = t + (v.full ? 0.24 : 0.14);
    tone(k, c, { f: 820, peak: 0.07 * g, tau: 0.035 * L, verb: room(v, 0.2), pan });
    tone(k, c, { f: 820 * 2.71, peak: 0.03 * g, tau: 0.02 * L, pan });
    hiss(k, c, { type: 'bandpass', f: 2400, q: 3, peak: 0.07 * g, tau: 0.008, pan });
  },
  /** An excavator, a backfiller: a hydraulic whine rising, a scoop of gravel, the earth set down. */
  earth: (k, t, v) => {
    const { g, len: L, pan } = v;
    const f = hz(k, 0, 43);
    tone(k, t, { f, f2: f * 1.5, glide: 0.08, type: 'sawtooth', lp: 700, peak: 0.08 * g, attack: 0.04, tau: 0.12 * L, pan });
    hiss(k, t + 0.06, { type: 'lowpass', f: 900, f2: 400, sweep: 0.08, q: 0.8, peak: 0.2 * g, attack: 0.01, tau: 0.1 * L, am: { rate: 19, depth: 0.85, wave: 'square' }, pan });
    if (v.full) tone(k, t + 0.18, { f: 100, f2: 60, glide: 0.03, peak: 0.18 * g, tau: 0.06, pan });
  },
  /** The Face Cutter: a stony scrape (gritty noise sweeping down), then a stone's tock. */
  cutter: (k, t, v) => {
    const { g, len: L, pan } = v;
    if (v.full) setDown(k, t, v);
    hiss(k, t, { type: 'bandpass', f: 2400, f2: 900, sweep: 0.07, q: 2.2, peak: 0.2 * g, attack: 0.015, tau: 0.08 * L, am: { rate: 38, depth: 0.7, wave: 'sawtooth' }, pan });
    const c = t + 0.12 * L;
    tone(k, c, { f: 190, f2: 130, glide: 0.015, peak: 0.14 * g, tau: 0.03 * L, pan });
    hiss(k, c, { type: 'bandpass', f: 800, q: 1.2, peak: 0.1 * g, tau: 0.01, pan });
    if (v.full) {
      hiss(k, t + 0.2, { type: 'bandpass', f: 1200, q: 1.5, peak: 0.07 * g, attack: 0.02, tau: 0.06, am: { rate: 50, depth: 0.8, wave: 'sawtooth' }, pan });
      tone(k, t + 0.12, { f: hz(k, 0, 50), type: 'triangle', lp: 500, peak: 0.06 * g, tau: 0.1, pan });
    }
  },
  /** A pump: a gurgle (bubbles: sines bending up fast, on the chord) over a slosh. */
  pump: (k, t, v) => {
    const { g, len: L, pan } = v;
    if (v.full) setDown(k, t, v);
    const bloops: ReadonlyArray<readonly [number, number, number]> = [[0, 0, -0.1], [2, 0.055, 0.1], [1, 0.1, 0], [3, 0.17, 0.15]];
    for (const [i, dt, p] of v.full ? bloops : bloops.slice(0, 3)) {
      const f = hz(k, i, 60);
      tone(k, t + dt * L, { f, f2: f * 1.6, glide: 0.02, peak: 0.1 * g, tau: 0.028 * L, pan: pan + p });
    }
    hiss(k, t, { type: 'lowpass', f: 500, f2: 250, sweep: 0.1, q: 0.8, peak: 0.1 * g, attack: 0.03, tau: 0.09 * L, pan });
    if (v.full) tone(k, t + 0.02, { f: 85, f2: 60, glide: 0.04, peak: 0.1 * g, tau: 0.06, pan });
  },
  /** A sand collector, a sifter: a dry pour of grains (chopped high noise) and a soft chord tone. */
  sand: (k, t, v) => {
    const { g, len: L, pan } = v;
    if (v.full) setDown(k, t, v);
    hiss(k, t, { type: 'bandpass', f: 3800, f2: 2200, sweep: 0.15, q: 1.1, peak: 0.13 * g, attack: 0.04, tau: 0.11 * L, am: { rate: 31, depth: 0.75, wave: 'square' }, pan });
    hiss(k, t + 0.02, { type: 'highpass', f: 6000, q: 0.7, peak: 0.05 * g, attack: 0.05, tau: 0.08 * L, am: { rate: 47, depth: 0.9, wave: 'square' }, pan });
    tone(k, t + 0.04, { f: hz(k, 1, 74), peak: 0.035 * g, attack: 0.02, tau: 0.12 * L, verb: room(v, 0.25), pan });
  },
  /** A smelter: a whoosh of fire (noise opening up, flickering), then a metallic tick. */
  smelter: (k, t, v) => {
    const { g, len: L, pan } = v;
    if (v.full) setDown(k, t, v);
    hiss(k, t, { type: 'lowpass', f: 300, f2: 1800, sweep: 0.08, q: 0.9, peak: 0.2 * g, attack: 0.05, tau: 0.12 * L, pan });
    hiss(k, t + 0.02, { type: 'bandpass', f: 900, q: 0.8, peak: 0.08 * g, attack: 0.04, tau: 0.1 * L, am: { rate: 15, depth: 0.5 }, pan });
    const c = t + 0.17 * L;
    tone(k, c, { f: 2900, peak: 0.05 * g, tau: 0.012, verb: room(v, 0.2), pan });
    tone(k, c, { f: 4100, peak: 0.03 * g, tau: 0.008, pan });
    if (v.full) tone(k, t + 0.03, { f: hz(k, 0, 38), type: 'triangle', lp: 300, peak: 0.1 * g, attack: 0.05, tau: 0.15, pan });
  },
  /** The electric smelter (and what hums): an electric hum on the chord, then crackles. */
  electric: (k, t, v) => {
    const { g, len: L, pan } = v;
    if (v.full) setDown(k, t, v);
    const f = hz(k, 0, 45);
    tone(k, t, { f, type: 'sawtooth', lp: 900, peak: 0.12 * g, attack: 0.02, tau: 0.14 * L, pan });
    tone(k, t, { f: f * 2, peak: 0.05 * g, attack: 0.02, tau: 0.12 * L, pan });
    const cracks: ReadonlyArray<readonly [number, number, number]> = [[0.03, 0.12, -0.2], [0.065, 0.08, 0.15], [0.11, 0.1, 0.05], [0.19, 0.06, -0.1]];
    for (const [dt, p, q] of v.full ? cracks : cracks.slice(0, 2)) hiss(k, t + dt, { type: 'highpass', f: 4200, q: 0.7, peak: p * g, tau: 0.003, pan: pan + q });
  },
  /** A wire mill, a press, a workshop: a mechanical clack-clack (the build adds the release). */
  press: (k, t, v) => {
    const { g, len: L, pan } = v;
    if (v.full) setDown(k, t, v);
    hiss(k, t, { type: 'bandpass', f: 2000, q: 1.6, peak: 0.18 * g, tau: 0.005, pan });
    tone(k, t, { f: 420, f2: 300, glide: 0.01, type: 'triangle', peak: 0.12 * g, tau: 0.025 * L, pan });
    const c = t + 0.085;
    hiss(k, c, { type: 'bandpass', f: 1500, q: 1.6, peak: 0.14 * g, tau: 0.006, pan });
    tone(k, c, { f: 300, f2: 220, glide: 0.01, type: 'triangle', peak: 0.1 * g, tau: 0.03 * L, pan });
    if (v.full) {
      hiss(k, t + 0.2, { type: 'bandpass', f: 2400, q: 1.6, peak: 0.08 * g, tau: 0.004, pan });
      tone(k, t + 0.2, { f: hz(k, 0, 67), type: 'square', lp: 1400, peak: 0.04 * g, tau: 0.06, verb: 0.2, pan });
    }
  },
  /** A wind turbine: an airy swoosh crossing the field (the build: the blade comes round again). */
  wind: (k, t, v) => {
    const { g, len: L, pan } = v;
    hiss(k, t, { type: 'bandpass', f: 420, f2: 1600, sweep: 0.12, q: 0.9, peak: 0.16 * g, attack: 0.12 * L, tau: 0.13 * L, verb: room(v, 0.25), pan: pan - 0.25 });
    if (v.full) hiss(k, t + 0.16, { type: 'bandpass', f: 1600, f2: 700, sweep: 0.12, q: 0.9, peak: 0.1 * g, attack: 0.06, tau: 0.1, verb: 0.3, pan: pan + 0.25 });
    tone(k, t + 0.04, { f: hz(k, 1, 79), peak: 0.03 * g, attack: 0.1 * L, tau: 0.15 * L, verb: room(v, 0.3), pan });
  },
  /** A solar panel: a glassy shimmer, high chord tones each beating with a twin. */
  solar: (k, t, v) => {
    const { g, len: L, pan } = v;
    const notes: ReadonlyArray<readonly [number, number, number]> = [[0, 0, -0.2], [1, 0.03, 0], [2, 0.06, 0.2], [3, 0.09, 0.1]];
    for (const [i, dt, p] of v.full ? notes : notes.slice(0, 3)) {
      const f = hz(k, i, 86);
      tone(k, t + dt, { f, peak: 0.05 * g, tau: 0.17 * L, verb: room(v, 0.35), pan: pan + p });
      tone(k, t + dt, { f: f * 1.006, peak: 0.025 * g, tau: 0.17 * L, pan: pan - p });
    }
    hiss(k, t, { type: 'bandpass', f: 7000, q: 2, peak: 0.04 * g, attack: 0.08 * L, tau: 0.12 * L, verb: room(v, 0.4), pan });
  },
  /** The steam boiler (and the fumarole): a hiss of steam, then a puff. */
  steam: (k, t, v) => {
    const { g, len: L, pan } = v;
    if (v.full) setDown(k, t, v);
    hiss(k, t, { type: 'highpass', f: 2600, f2: 3800, sweep: 0.1, q: 0.7, peak: 0.14 * g, attack: 0.015, tau: 0.1 * L, pan });
    const c = t + 0.14 * L;
    hiss(k, c, { type: 'lowpass', f: 700, q: 0.8, peak: 0.22 * g, attack: 0.004, tau: 0.04 * L, pan });
    tone(k, c, { f: 110, f2: 70, glide: 0.03, peak: 0.12 * g, tau: 0.05 * L, pan });
    if (v.full) hiss(k, t + 0.3, { type: 'lowpass', f: 600, q: 0.8, peak: 0.12 * g, attack: 0.004, tau: 0.035, pan });
  },
  /** A lab: a soft data chirp, quick sines bending up on the chord, over a round low tone. */
  lab: (k, t, v) => {
    const { g, len: L, pan } = v;
    if (v.full) setDown(k, t, v);
    const chirps: ReadonlyArray<readonly [number, number, number]> = [[0, 0, -0.15], [1, 0.045, 0], [2, 0.09, 0.15], [3, 0.14, 0.05]];
    for (const [i, dt, p] of v.full ? chirps : chirps.slice(0, 2)) {
      const f = hz(k, i, 81);
      tone(k, t + dt, { f, f2: f * 1.26, glide: 0.015, peak: 0.05 * g, tau: 0.035 * L, verb: room(v, 0.2), pan: pan + p });
    }
    tone(k, t, { f: hz(k, 0, 69), peak: 0.05 * g, attack: 0.01, tau: 0.14 * L, verb: room(v, 0.3), pan });
  },
  /** A server: a digital blip-blip (filtered squares, an octave apart) and a tick. */
  server: (k, t, v) => {
    const { g, len: L, pan } = v;
    if (v.full) setDown(k, t, v);
    const f = hz(k, 0, 76);
    tone(k, t, { f, type: 'square', lp: 2400, peak: 0.06 * g, tau: 0.025 * L, pan });
    hiss(k, t, { type: 'highpass', f: 6000, q: 0.7, peak: 0.05 * g, tau: 0.003, pan });
    tone(k, t + 0.06, { f: f * 2, type: 'square', lp: 3000, peak: 0.05 * g, tau: 0.03 * L, pan });
    if (v.full) tone(k, t + 0.12, { f: hz(k, 2, 76), type: 'square', lp: 2400, peak: 0.045 * g, tau: 0.035, verb: 0.2, pan });
  },
  /** The trade post: a bell (inharmonic partials), answered by a second one (and a third built). */
  trade: (k, t, v) => {
    const { g, len: L, pan } = v;
    if (v.full) setDown(k, t, v);
    const bell = (at: number, f: number, amp: number, p: number): void => {
      tone(k, at, { f, peak: 0.09 * amp * g, tau: 0.13 * L, verb: room(v, 0.35), pan: pan + p });
      tone(k, at, { f: f * 2.76, peak: 0.025 * amp * g, tau: 0.08 * L, pan: pan + p });
      tone(k, at, { f: f * 5.4, peak: 0.01 * amp * g, tau: 0.04 * L, pan: pan + p });
    };
    bell(t, hz(k, 0, 79), 1, -0.1);
    bell(t + 0.11, hz(k, 2, 79), 0.85, 0.1);
    if (v.full) bell(t + 0.2, hz(k, 0, 91), 0.6, 0);
  },
  /** A silo: a hollow tin drum (a low body and a resonant ring) on the chord. */
  silo: (k, t, v) => {
    const { g, len: L, pan } = v;
    if (v.full) setDown(k, t, v);
    const knock = (at: number, amp: number): void => {
      tone(k, at, { f: 104, f2: 92, glide: 0.05, peak: 0.2 * amp * g, tau: 0.12 * L, pan });
      hiss(k, at, { type: 'bandpass', f: 420, q: 6, peak: 0.2 * amp * g, tau: 0.06 * L, pan });
      tone(k, at, { f: hz(k, 0, 57), type: 'triangle', lp: 900, peak: 0.06 * amp * g, tau: 0.16 * L, verb: room(v, 0.2), pan });
    };
    knock(t, 1);
    if (v.full) knock(t + 0.13, 0.55);
  },
  /** A line piece (ribbon, routing block, conduit, fence): a light click and a tiny tone. */
  line: (k, t, v) => {
    const { g, len: L, pan } = v;
    hiss(k, t, { type: 'bandpass', f: 2800, q: 1.5, peak: 0.12 * g, tau: 0.004, pan });
    tone(k, t, { f: hz(k, 0, 84), peak: 0.03 * g, tau: 0.02 * L, pan });
    if (v.full) hiss(k, t + 0.04, { type: 'bandpass', f: 2200, q: 1.5, peak: 0.08 * g, tau: 0.004, pan });
  },
  /** A pole, a pylon: a tick and a faint electric buzz (the build: a little zap up the wire). */
  pole: (k, t, v) => {
    const { g, len: L, pan } = v;
    hiss(k, t, { type: 'bandpass', f: 3400, q: 1.4, peak: 0.1 * g, tau: 0.004, pan });
    tone(k, t, { f: hz(k, 0, 57), type: 'square', lp: 1200, peak: 0.04 * g, attack: 0.005, tau: 0.04 * L, pan });
    if (v.full) tone(k, t + 0.03, { f: 900, f2: 2400, glide: 0.02, peak: 0.03 * g, tau: 0.02, pan });
  },
};
