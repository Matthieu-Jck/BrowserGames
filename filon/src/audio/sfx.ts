// sfx.ts — the sound cues' recipes, in Web Audio. Short, soft and never shrill: sines and
// triangles with fast decays, puffs of band-passed noise, a little reverb. Two primitives do all
// the work: `tone` (an oscillator with a strike envelope, an optional glide and low-pass) and
// `hiss` (a slice of white noise through a filter that may sweep). The tonal cues take their
// notes from the chord the score is playing (`harmony()`), so placing, linking or finishing a
// research plays along with the music instead of against it.
//
// A recipe gets the start time, a count (ribbon tiles, buildings removed) and its trim (cues.ts);
// it returns nothing and leaves nothing behind. Peaks are measured offline (docs/audio.md) and
// recorded in cues.ts: every cue stays under −6 dBFS at full sliders. The buildings' signatures
// (D120, signature-sfx.ts) are built from the same primitives, exported here.
import type { SfxCue } from '@/core/bus';
import { clamp } from '@/core/math';
import { ribbonTicks } from './cues';
import { filterNode, gainNode, panNode, releaseOnEnd, strike } from './synth';
import { midiHz, pc } from './theory';

/** What the recipes play into. */
export interface SfxKit {
  readonly ctx: BaseAudioContext;
  /** The effects bus (dry) and its reverb send. */
  readonly out: AudioNode;
  readonly wet: AudioNode;
  readonly noise: AudioBuffer;
  offset(dur: number): number;
  /** Pitch classes of the chord in force. */
  harmony(): readonly number[];
}

/**
 * Amplitude modulation: an LFO at `rate` Hz swings the level between 1 − `depth` and 1 (a grind,
 * a thrum, grit in a scrape). `wave` is the LFO's shape (a square chops, a sine throbs).
 */
export interface AmOpts { rate: number; depth: number; wave?: OscillatorType }

export interface ToneOpts {
  f: number;
  /** Glide towards this frequency (time constant `glide`). */
  f2?: number;
  glide?: number;
  type?: OscillatorType;
  peak: number;
  attack?: number;
  tau: number;
  pan?: number;
  /** Low-pass cutoff (Hz). */
  lp?: number;
  verb?: number;
  am?: AmOpts;
}

/** Insert the amplitude modulation `o` after `head` (until `end`); returns the new head. */
function modulate(ctx: BaseAudioContext, head: AudioNode, t: number, end: number, o: AmOpts | undefined): AudioNode {
  if (!o) return head;
  const depth = clamp(o.depth, 0, 1);
  const vca = gainNode(ctx, 1 - depth / 2);
  const lfo = ctx.createOscillator();
  lfo.type = o.wave ?? 'sine';
  lfo.frequency.value = o.rate;
  const swing = gainNode(ctx, depth / 2);
  lfo.connect(swing);
  swing.connect(vca.gain);
  head.connect(vca);
  lfo.start(t);
  lfo.stop(end);
  releaseOnEnd(lfo, swing);
  return vca;
}

/** A struck oscillator. */
export function tone(k: SfxKit, t: number, o: ToneOpts): void {
  const { ctx } = k;
  const osc = ctx.createOscillator();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(o.f, t);
  if (o.f2) osc.frequency.setTargetAtTime(o.f2, t, o.glide ?? 0.03);
  const vca = ctx.createGain();
  const end = strike(vca.gain, t, o.peak, o.attack ?? 0.003, o.tau);
  let head: AudioNode = osc;
  if (o.lp) { const lp = filterNode(ctx, 'lowpass', o.lp, 0.7); osc.connect(lp); head = lp; }
  head.connect(vca);
  const p = panNode(ctx, o.pan ?? 0);
  modulate(ctx, vca, t, end, o.am).connect(p);
  p.connect(k.out);
  const sv = gainNode(ctx, o.verb ?? 0);
  if (o.verb) { p.connect(sv); sv.connect(k.wet); }
  osc.start(t);
  osc.stop(end);
  releaseOnEnd(osc, p, sv);
}

export interface HissOpts {
  type: BiquadFilterType;
  f: number;
  /** Sweep the filter towards this frequency (time constant `sweep`). */
  f2?: number;
  sweep?: number;
  q?: number;
  peak: number;
  attack?: number;
  tau: number;
  pan?: number;
  verb?: number;
  am?: AmOpts;
}

/** A puff of filtered noise. */
export function hiss(k: SfxKit, t: number, o: HissOpts): void {
  const { ctx } = k;
  const src = ctx.createBufferSource();
  src.buffer = k.noise;
  const f = filterNode(ctx, o.type, o.f, o.q ?? 1);
  if (o.f2) f.frequency.setTargetAtTime(o.f2, t, o.sweep ?? 0.08);
  const vca = ctx.createGain();
  const end = strike(vca.gain, t, o.peak, o.attack ?? 0.002, o.tau);
  const p = panNode(ctx, o.pan ?? 0);
  src.connect(f);
  f.connect(vca);
  modulate(ctx, vca, t, end, o.am).connect(p);
  p.connect(k.out);
  const sv = gainNode(ctx, o.verb ?? 0);
  if (o.verb) { p.connect(sv); sv.connect(k.wet); }
  const dur = Math.min(1.9, end - t + 0.02);
  src.start(t, k.offset(dur), dur);
  releaseOnEnd(src, p, sv);
}

/** The `i`-th note of the chord in force (its pitch classes in order, cycling upwards) at or above `floor` (MIDI). */
export function chordNote(k: SfxKit, i: number, floor: number): number {
  const pcs = [...k.harmony()].sort((a, b) => a - b);
  if (!pcs.length) return floor;
  const n = pcs.length;
  const octave = Math.floor(i / n), p = pcs[((i % n) + n) % n]!;
  return floor + ((p - pc(floor) + 12) % 12) + 12 * octave;
}

type Recipe = (k: SfxKit, t: number, n: number, g: number) => void;

/** One tick of a ribbon run: a dry tap and a tiny chord tone climbing the run (six tones, then round again). */
function ribbonTick(k: SfxKit, t: number, i: number, of: number, g: number): void {
  const v = 1 - 0.45 * (i / Math.max(1, of));
  hiss(k, t, { type: 'bandpass', f: 1700, q: 1.6, peak: 0.18 * v * g, tau: 0.006, pan: clamp((i / Math.max(1, of)) * 0.6 - 0.3, -0.4, 0.4) });
  tone(k, t, { f: midiHz(chordNote(k, i % 6, 72)), peak: 0.05 * v * g, tau: 0.045, verb: 0.15 }); // climbs the chord, wrapping (never shrill)
}

export const RECIPES: Record<SfxCue, Recipe> = {
  click: (k, t, _n, g) => {
    hiss(k, t, { type: 'bandpass', f: 3200, q: 1.2, peak: 0.14 * g, tau: 0.006 });
    tone(k, t, { f: 1250, peak: 0.06 * g, tau: 0.012 });
  },
  select: (k, t, _n, g) => {
    tone(k, t, { f: 1620, f2: 1500, glide: 0.02, peak: 0.04 * g, tau: 0.02 });
    hiss(k, t, { type: 'bandpass', f: 4200, q: 1.5, peak: 0.07 * g, tau: 0.004 });
  },
  tab: (k, t, _n, g) => {
    tone(k, t, { f: 990, peak: 0.055 * g, tau: 0.016, pan: -0.15 });
    tone(k, t + 0.035, { f: 1320, peak: 0.05 * g, tau: 0.018, pan: 0.15 });
    hiss(k, t, { type: 'bandpass', f: 3000, q: 1.2, peak: 0.07 * g, tau: 0.005 });
  },
  open: (k, t, _n, g) => {
    hiss(k, t, { type: 'bandpass', f: 700, f2: 2600, sweep: 0.08, q: 1.1, peak: 0.07 * g, attack: 0.04, tau: 0.07, verb: 0.2 });
    tone(k, t + 0.02, { f: midiHz(chordNote(k, 0, 74)), peak: 0.1 * g, tau: 0.22, verb: 0.25, pan: -0.1 });
    tone(k, t + 0.08, { f: midiHz(chordNote(k, 2, 74)), peak: 0.085 * g, tau: 0.28, verb: 0.25, pan: 0.1 });
  },
  close: (k, t, _n, g) => {
    hiss(k, t, { type: 'bandpass', f: 2400, f2: 700, sweep: 0.08, q: 1.1, peak: 0.065 * g, attack: 0.03, tau: 0.07, verb: 0.2 });
    tone(k, t + 0.02, { f: midiHz(chordNote(k, 2, 74)), peak: 0.085 * g, tau: 0.2, verb: 0.25, pan: 0.1 });
    tone(k, t + 0.08, { f: midiHz(chordNote(k, 0, 74)), peak: 0.08 * g, tau: 0.25, verb: 0.25, pan: -0.1 });
  },
  view: (k, t, _n, g) => {
    hiss(k, t, { type: 'bandpass', f: 380, f2: 1500, sweep: 0.15, q: 0.8, peak: 0.06 * g, attack: 0.16, tau: 0.14, verb: 0.15 });
  },
  'toast.info': (k, t, _n, g) => {
    tone(k, t, { f: midiHz(chordNote(k, 1, 79)), peak: 0.07 * g, tau: 0.12, verb: 0.2 });
  },
  'toast.good': (k, t, _n, g) => {
    tone(k, t, { f: midiHz(chordNote(k, 0, 79)), peak: 0.07 * g, tau: 0.14, verb: 0.2 });
    tone(k, t + 0.07, { f: midiHz(chordNote(k, 2, 79)), peak: 0.07 * g, tau: 0.2, verb: 0.2 });
  },
  'toast.warn': (k, t, _n, g) => {
    const f = midiHz(chordNote(k, 0, 69));
    tone(k, t, { f, type: 'triangle', lp: 1800, peak: 0.1 * g, tau: 0.08 });
    tone(k, t + 0.11, { f, type: 'triangle', lp: 1800, peak: 0.09 * g, tau: 0.1 });
  },
  'toast.bad': (k, t, _n, g) => {
    const f = midiHz(chordNote(k, 0, 57));
    tone(k, t, { f, f2: f * 0.944, glide: 0.06, type: 'triangle', lp: 1200, peak: 0.13 * g, tau: 0.1 });
    tone(k, t + 0.09, { f: f * 0.89, type: 'triangle', lp: 1100, peak: 0.11 * g, tau: 0.12 });
  },
  place: (k, t, _n, g) => {
    tone(k, t, { f: 150, f2: 85, glide: 0.03, peak: 0.3 * g, attack: 0.002, tau: 0.09 });
    hiss(k, t, { type: 'bandpass', f: 900, q: 1.4, peak: 0.25 * g, tau: 0.025 });
    tone(k, t + 0.03, { f: midiHz(chordNote(k, 0, 74)), peak: 0.1 * g, tau: 0.3, verb: 0.25 });
  },
  ribbon: (k, t, n, g) => {
    const ticks = ribbonTicks(n);
    ticks.forEach((dt, i) => ribbonTick(k, t + dt, i, ticks.length, g));
  },
  demolish: (k, t, n, g) => {
    const big = n > 1 ? 1.4 : 1;
    hiss(k, t, { type: 'lowpass', f: 900, f2: 280, sweep: 0.06, q: 0.7, peak: 0.3 * g, attack: 0.004, tau: 0.09 * big });
    for (const [dt, p] of [[0.03, 0.12], [0.07, 0.1], [0.12, 0.08]] as const) hiss(k, t + dt * big, { type: 'bandpass', f: 600, q: 1, peak: p * g, tau: 0.02 });
    // The refund going back to the Heart: two notes falling.
    tone(k, t + 0.16, { f: midiHz(chordNote(k, 2, 84)), peak: 0.06 * g, tau: 0.2, verb: 0.3 });
    tone(k, t + 0.24, { f: midiHz(chordNote(k, 0, 84)), peak: 0.06 * g, tau: 0.28, verb: 0.3 });
  },
  refused: (k, t, _n, g) => {
    const f = midiHz(chordNote(k, 0, 55));
    tone(k, t, { f: 110, f2: 70, glide: 0.03, peak: 0.16 * g, tau: 0.05 });
    tone(k, t, { f, type: 'triangle', lp: 900, peak: 0.15 * g, tau: 0.07 });
    tone(k, t + 0.09, { f: f * 0.944, type: 'triangle', lp: 850, peak: 0.14 * g, tau: 0.09 });
  },
  mark: (k, t, _n, g) => {
    hiss(k, t, { type: 'bandpass', f: 1100, f2: 1700, sweep: 0.03, q: 1.3, peak: 0.12 * g, attack: 0.01, tau: 0.04 });
    hiss(k, t + 0.05, { type: 'bandpass', f: 1400, q: 1.3, peak: 0.07 * g, attack: 0.008, tau: 0.03 });
  },
  link: (k, t, _n, g) => {
    tone(k, t, { f: 520, f2: 1040, glide: 0.03, peak: 0.09 * g, tau: 0.08 });
    hiss(k, t, { type: 'bandpass', f: 4200, q: 3, peak: 0.1 * g, tau: 0.012 });
    tone(k, t + 0.06, { f: midiHz(chordNote(k, 0, 79)), peak: 0.07 * g, tau: 0.35, verb: 0.3, pan: -0.15 });
    tone(k, t + 0.06, { f: midiHz(chordNote(k, 2, 79)), peak: 0.06 * g, tau: 0.35, verb: 0.3, pan: 0.15 });
  },
  unlink: (k, t, _n, g) => {
    tone(k, t, { f: 1040, f2: 480, glide: 0.03, peak: 0.09 * g, tau: 0.08 });
    hiss(k, t, { type: 'highpass', f: 3200, q: 0.7, peak: 0.1 * g, tau: 0.008 });
  },
  research: (k, t, _n, g) => {
    for (let i = 0; i < 4; i++) tone(k, t + i * 0.09, { f: midiHz(chordNote(k, i, 74)), peak: 0.11 * g, tau: 0.6, verb: 0.4, pan: -0.3 + 0.2 * i });
    for (let i = 0; i < 3; i++) tone(k, t, { f: midiHz(chordNote(k, i, 62)), peak: 0.04 * g, attack: 0.3, tau: 0.5, verb: 0.4 });
  },
  quest: (k, t, _n, g) => {
    const root = chordNote(k, 0, 76);
    tone(k, t, { f: midiHz(root), peak: 0.12 * g, tau: 0.5, verb: 0.45 });
    tone(k, t, { f: midiHz(root) * 2.76, peak: 0.02 * g, tau: 0.15, verb: 0.45 });
    tone(k, t + 0.14, { f: midiHz(root + 7), peak: 0.11 * g, tau: 0.5, verb: 0.45 });
    tone(k, t + 0.28, { f: midiHz(root + 12), peak: 0.12 * g, tau: 0.9, verb: 0.5 });
    hiss(k, t + 0.1, { type: 'bandpass', f: 6000, q: 2, peak: 0.03 * g, attack: 0.2, tau: 0.3, verb: 0.5 });
  },
  sale: (k, t, _n, g) => {
    for (const [dt, f] of [[0, 1975], [0.07, 2637]] as const) {
      tone(k, t + dt, { f, peak: 0.06 * g, tau: 0.06, pan: 0.2 });
      tone(k, t + dt, { f: f * 1.5, peak: 0.02 * g, tau: 0.04, pan: 0.2 });
    }
    hiss(k, t + 0.05, { type: 'bandpass', f: 500, f2: 2000, sweep: 0.1, q: 1, peak: 0.06 * g, attack: 0.1, tau: 0.12, verb: 0.2 });
  },
  purchase: (k, t, _n, g) => {
    hiss(k, t, { type: 'bandpass', f: 2000, f2: 500, sweep: 0.1, q: 1, peak: 0.06 * g, attack: 0.1, tau: 0.12, verb: 0.2 });
    for (const [dt, f] of [[0.14, 1480], [0.21, 1975]] as const) {
      tone(k, t + dt, { f, peak: 0.06 * g, tau: 0.07, pan: -0.2 });
      tone(k, t + dt, { f: f * 1.5, peak: 0.03 * g, tau: 0.05, pan: -0.2 });
    }
  },
  lift: (k, t, _n, g) => {
    hiss(k, t, { type: 'lowpass', f: 180, f2: 900, sweep: 0.5, q: 0.8, peak: 0.08 * g, attack: 0.5, tau: 0.5, verb: 0.3 });
    tone(k, t, { f: 55, peak: 0.06 * g, attack: 0.4, tau: 0.4 });
  },
  delivered: (k, t, _n, g) => {
    tone(k, t, { f: 120, f2: 80, glide: 0.03, peak: 0.18 * g, tau: 0.07 });
    tone(k, t + 0.04, { f: midiHz(chordNote(k, 0, 76)), peak: 0.08 * g, tau: 0.3, verb: 0.3 });
  },
  notice: (k, t, _n, g) => {
    const f = midiHz(chordNote(k, 0, 86));
    tone(k, t, { f, type: 'triangle', lp: 3000, peak: 0.06 * g, tau: 0.04 });
    tone(k, t + 0.12, { f, type: 'triangle', lp: 3000, peak: 0.06 * g, tau: 0.05 });
  },
  vein: (k, t, _n, g) => {
    for (let i = 0; i < 3; i++) tone(k, t + i * 0.06, { f: midiHz(chordNote(k, i, 84)), peak: 0.06 * g, tau: 0.2, verb: 0.35, pan: -0.2 + 0.2 * i });
  },
};
