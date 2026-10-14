// director.ts — the musical director, pure: what the score should feel like at a moment of the
// world, and the generative score itself. `moodAt(hour)` reads the world clock (the same clock the
// day/night look uses): dawn, day, dusk and night each have a mode, and keyframes over the 24 hours
// move the tempo, the pads' brightness and register, the melody's density and register, the
// reverb. `pulseLevels(activity, night)` turns the base's activity into a little rhythm: a soft
// knock on the bar first, then shakers, then a plucked arpeggio as more machines run.
//
// `Score.step(i, ctx)` is called once per eighth-note step (the sequencer gives the index and the
// time) and returns the notes that start on it: a pad chord and its bass every 2–8 bars (voice-led,
// the next chord drawn from the mode's progression weights), the melody in phrases of a few notes
// separated by long rests (a random walk on the mode's ladder, strong beats pulled onto chord
// tones, phrases sometimes answering a remembered rhythm or contour so it sounds composed rather
// than random), and the pulses. Seeded randomness (core/rng): the score never loops, and a test can
// replay it. Audio is not engine state: nothing here touches the sim.
import type { Rng } from '@/core/rng';
import { clamp, lerp } from '@/core/math';
import {
  degreeMidi, ladderMidi, ladderRung, pc, PROGRESSIONS, TONIC, upperPcs, voiceLead, type ModeId,
} from './theory';

export type DayPart = 'night' | 'dawn' | 'day' | 'dusk';

/** The mode of each part of the day, all on D: a luminous dawn, a plain day, a warm dusk, a cool night. */
export const PART_MODE: Record<DayPart, ModeId> = { dawn: 'lydian', day: 'ionian', dusk: 'mixolydian', night: 'dorian' };

/** Eighth-note steps per 4/4 bar. */
export const STEPS_PER_BAR = 8;

const mod = (a: number, n: number): number => ((a % n) + n) % n;
const smooth = (t: number): number => t * t * (3 - 2 * t);
const smoothstep = (a: number, b: number, x: number): number => smooth(clamp((x - a) / (b - a), 0, 1));

/** The part of the day at an hour of the 24-hour clock (the sun rises 04:00–06:00, sets 18:00–20:00). */
export function partAt(hour: number): DayPart {
  const h = mod(hour, 24);
  return h >= 20.5 || h < 4 ? 'night' : h < 7.5 ? 'dawn' : h < 17.5 ? 'day' : 'dusk';
}

/** What the music should feel like now. */
export interface Mood {
  part: DayPart;
  mode: ModeId;
  /** Tempo (quarter notes per minute). */
  bpm: number;
  /** The pads' low-pass cutoff (Hz): dark at night, open by day. */
  cutoff: number;
  /** The pads' waveform, 0 (near-sine, cold) … 1 (soft saw, warm). */
  warmth: number;
  /** Chance per step, once a rest is over, that a melodic phrase starts. */
  density: number;
  /** Register offsets (semitones) of the pads and of the melody. */
  padReg: number;
  melReg: number;
  /** Reverb send of the melody (0–1). */
  verb: number;
  /** The pads' level (0–1). */
  pad: number;
}

interface MoodKey { h: number; bpm: number; cutoff: number; warmth: number; density: number; padReg: number; melReg: number; verb: number; pad: number }

/**
 * The day in keyframes (hours of the 24-hour clock), smoothly joined. Night: slow, dark, low pads
 * and a sparse, high, glassy melody (cold stars). Dawn opens it up; the day is the fullest; dusk
 * warms and lowers the melody.
 */
const KEYS: readonly MoodKey[] = [
  { h: 0, bpm: 58, cutoff: 760, warmth: 0.1, density: 0.1, padReg: -3, melReg: 5, verb: 0.62, pad: 0.8 },
  { h: 3.5, bpm: 58, cutoff: 800, warmth: 0.15, density: 0.1, padReg: -3, melReg: 5, verb: 0.62, pad: 0.8 },
  { h: 5.2, bpm: 66, cutoff: 1150, warmth: 0.45, density: 0.2, padReg: -1, melReg: 3, verb: 0.55, pad: 0.85 },
  { h: 7.5, bpm: 72, cutoff: 1750, warmth: 0.75, density: 0.28, padReg: 0, melReg: 1, verb: 0.46, pad: 0.9 },
  { h: 12, bpm: 76, cutoff: 2100, warmth: 0.9, density: 0.32, padReg: 2, melReg: 0, verb: 0.42, pad: 0.9 },
  { h: 16.5, bpm: 74, cutoff: 1900, warmth: 0.9, density: 0.3, padReg: 1, melReg: -1, verb: 0.44, pad: 0.9 },
  { h: 18.6, bpm: 68, cutoff: 1350, warmth: 0.7, density: 0.24, padReg: -1, melReg: -2, verb: 0.5, pad: 0.88 },
  { h: 20.5, bpm: 62, cutoff: 900, warmth: 0.3, density: 0.13, padReg: -3, melReg: 3, verb: 0.58, pad: 0.84 },
  { h: 24, bpm: 58, cutoff: 760, warmth: 0.1, density: 0.1, padReg: -3, melReg: 5, verb: 0.62, pad: 0.8 },
];

/** The mood at an hour of the 24-hour clock (continuous values; the mode follows the part of the day). */
export function moodAt(hour: number, out?: Mood): Mood {
  const h = mod(hour, 24);
  let k = 0;
  while (k < KEYS.length - 2 && KEYS[k + 1]!.h <= h) k++;
  const A = KEYS[k]!, B = KEYS[k + 1]!;
  const t = smooth(clamp((h - A.h) / (B.h - A.h), 0, 1));
  const m = out ?? ({} as Mood);
  m.part = partAt(h);
  m.mode = PART_MODE[m.part];
  m.bpm = lerp(A.bpm, B.bpm, t);
  m.cutoff = lerp(A.cutoff, B.cutoff, t);
  m.warmth = lerp(A.warmth, B.warmth, t);
  m.density = lerp(A.density, B.density, t);
  m.padReg = lerp(A.padReg, B.padReg, t);
  m.melReg = lerp(A.melReg, B.melReg, t);
  m.verb = lerp(A.verb, B.verb, t);
  m.pad = lerp(A.pad, B.pad, t);
  return m;
}

/**
 * What gives each part of the day its own piece over the shared score (owner, 2026-10-13: « 4 :
 * one for the morning, one for the day, one for the evening, one for the night. smooth
 * transitions »): an arpeggio over the bar, a bass that moves, a light beat. The night keeps the
 * old calm (a slow broken chord, a held root); the morning climbs; the day walks; the evening sways.
 */
export interface Style {
  /** Arpeggio over the bar's eight steps: an index into the chord's tones, low to high (−1: a rest). */
  readonly arp: readonly number[];
  readonly arpVel: number;
  /** The bass in the bar: [step, scale steps above the chord's root (0 root, 3 fourth, 4 fifth, 7 octave), length in steps]. */
  readonly bass: ReadonlyArray<readonly [number, number, number]>;
  /** A soft knock and a shaker on these steps of the bar, at `beat`. */
  readonly knock: readonly number[];
  readonly shaker: readonly number[];
  readonly beat: number;
}

export const STYLES: Readonly<Record<DayPart, Style>> = {
  night: { arp: [0, -1, 2, -1, 1, -1, 3, -1], arpVel: 0.2, bass: [[0, 0, 7]], knock: [], shaker: [], beat: 0 },
  dawn: { arp: [0, 1, 2, 3, 4, 3, 2, 1], arpVel: 0.24, bass: [[0, 0, 4], [4, 4, 4]], knock: [], shaker: [3, 7], beat: 0.22 },
  day: { arp: [0, 2, 1, 3, 2, 4, 3, 1], arpVel: 0.26, bass: [[0, 0, 3], [3, 0, 1], [4, 4, 2], [6, 7, 2]], knock: [0, 4], shaker: [1, 3, 5, 7], beat: 0.4 },
  dusk: { arp: [0, -1, 1, 2, -1, 3, 2, -1], arpVel: 0.23, bass: [[0, 0, 4], [4, 4, 2], [6, 3, 2]], knock: [0], shaker: [2, 6], beat: 0.28 },
};

/** Where one part hands over to the next (hours), and how long the crossfade lasts around it (hours). */
const HANDOVERS: ReadonlyArray<readonly [number, DayPart, DayPart]> = [[4, 'night', 'dawn'], [7.5, 'dawn', 'day'], [17.5, 'day', 'dusk'], [20.5, 'dusk', 'night']];
const FADE_H = 0.4;

/** Each part's weight at an hour (summing to 1): one part alone, or two crossfading around their handover. */
export function styleWeights(hour: number): Array<[DayPart, number]> {
  const h = mod(hour, 24);
  for (const [at, from, to] of HANDOVERS) {
    if (Math.abs(h - at) < FADE_H) {
      const w = smoothstep(at - FADE_H, at + FADE_H, h);
      return [[from, 1 - w], [to, w]];
    }
  }
  return [[partAt(h), 1]];
}

/** Seconds per eighth-note step at a tempo. */
export const stepSeconds = (bpm: number): number => 30 / clamp(bpm, 20, 240);

/**
 * How much rhythm the base's activity (0–1: share of its machines running, on a soft curve) earns:
 * a knock on each bar from a few machines, shakers on the off-beats from a working base, a plucked
 * arpeggio from a busy one. The night halves the pulses (colder, sparser).
 */
export function pulseLevels(activity: number, night: number): { knock: number; shaker: number; pluck: number } {
  const a = clamp(activity, 0, 1), cool = 1 - 0.5 * clamp(night, 0, 1);
  return {
    knock: smoothstep(0.04, 0.35, a) * cool,
    shaker: smoothstep(0.3, 0.7, a) * cool,
    pluck: smoothstep(0.55, 0.95, a) * cool,
  };
}

/** The base's activity (0–1) from the number of machines running: 1 − e^(−n/10), so the first ones count most. */
export const activityOf = (running: number): number => 1 - Math.exp(-Math.max(0, running) / 10);

export type Voice = 'pad' | 'bass' | 'mallet' | 'pluck' | 'knock' | 'shaker';

/** A note (or a chord) starting on a step. */
export interface NoteEvent {
  v: Voice;
  /** MIDI notes (empty for the shaker). */
  notes: number[];
  /** 0–1. */
  vel: number;
  /** Length in steps (pads, bass, melody); the percussive voices ignore it. */
  dur: number;
  /** Stereo position −1 … 1. */
  pan: number;
  /** Timing nudge (seconds): the melody breathes a little off the grid. */
  nudge: number;
}

/** What the score reads at each step. */
export interface ScoreCtx {
  mood: Mood;
  /** The base's activity, 0–1. */
  activity: number;
  /** Night factor of the world's look, 0 by day … 1 at night. */
  night: number;
  /** The parts of the day sounding now and their weights (`styleWeights`; default: the mood's part alone). */
  weights?: ReadonlyArray<readonly [DayPart, number]>;
}

/** The chord in force. */
export interface Chord {
  mode: ModeId;
  deg: number;
  /** The pad's upper voices (MIDI, ascending) and the bass note. */
  upper: number[];
  bass: number;
  /** Pitch classes of the chord (bass + upper). */
  pcs: number[];
  /** Step where it began, and the step where the next one is due. */
  from: number;
  until: number;
}

/** A remembered phrase: its rhythm (gaps in steps) and its contour (ladder moves). */
interface Motif { gaps: number[]; moves: number[] }

/** A melodic phrase being played: its notes' absolute steps and ladder moves, the next one (k), its place in the field. */
interface Phrase { steps: number[]; moves: number[]; k: number; pan: number }

/**
 * Bars per chord by part of the day (weighted): longer at night, shorter by day — never more than
 * four (owner: « sometimes the note is way too long »); a pad is struck again every two bars.
 */
const BARS: Record<DayPart, ReadonlyArray<readonly [number, number]>> = {
  night: [[2, 2], [4, 1]],
  dawn: [[2, 2], [1, 1]],
  day: [[1, 2], [2, 3]],
  dusk: [[2, 3], [1, 1]],
};
/** A pad's longest note (steps): a longer chord is struck again. */
const PAD_STEPS = 2 * STEPS_PER_BAR;
/** Every few bars the piece breathes: the arpeggio and the beat thin out for one bar in four of a section. */
const SECTION_BARS = 8;

/** Steps between melody notes (weighted): mostly quarters and dotted quarters, a few eighths. */
const GAPS: ReadonlyArray<readonly [number, number]> = [[2, 5], [3, 2], [4, 3], [1, 1], [6, 1]];
/** Moves on the ladder between melody notes (weighted): mostly steps, a few skips and leaps. */
const MOVES: ReadonlyArray<readonly [number, number]> = [[-2, 1], [-1, 4], [0, 0.6], [1, 4], [2, 1.5], [3, 0.4], [-3, 0.3]];

export class Score {
  chord: Chord | null = null;
  /** Melody: the rung on the current ladder, the phrase in progress, the step its next rest ends. */
  private rung = 2;
  private lastNote = TONIC + 12;
  private phrase: Phrase | null = null;
  private restUntil = 4;
  private readonly motifs: Motif[] = [];
  private readonly degrees: number[] = [];

  constructor(private readonly rng: Rng) {}

  /** The notes starting on step `i` (call with increasing `i`; skipped steps are fine). */
  step(i: number, c: ScoreCtx): NoteEvent[] {
    const out: NoteEvent[] = [];
    if (!this.chord || i >= this.chord.until) this.nextChord(i, c, out);
    else this.restrike(i, c, out);
    this.melody(i, c, out);
    this.style(i, c, out);
    this.pulses(i, c, out);
    return out;
  }

  /** A pad held over two bars is struck again (a new voicing of the same chord), so no note drags on. */
  private restrike(i: number, c: ScoreCtx, out: NoteEvent[]): void {
    const ch = this.chord!;
    if ((i - ch.from) % PAD_STEPS !== 0) return;
    const dur = Math.min(PAD_STEPS, ch.until - i);
    const upper = ch.upper.map((n, k) => (k === 0 ? n + 12 : n)).sort((a, b) => a - b);
    out.push({ v: 'pad', notes: upper, vel: c.mood.pad * 0.85, dur, pan: 0, nudge: 0 });
  }

  /** Each part's arpeggio, bass line and beat, crossfading with the next part around their handover. */
  private style(i: number, c: ScoreCtx, out: NoteEvent[]): void {
    const ch = this.chord;
    if (!ch) return;
    const { rng } = this;
    const inBar = mod(i, STEPS_PER_BAR), bar = Math.floor(i / STEPS_PER_BAR);
    const breathe = mod(bar, SECTION_BARS) === SECTION_BARS - 1 ? 0.35 : 1; // the last bar of a section thins out
    const weights = c.weights ?? [[c.mood.part, 1] as const];
    // The bass follows the part that leads now (two bass lines at once would blur).
    let lead: DayPart = c.mood.part, best = -1;
    for (const [p, w] of weights) if (w > best) { best = w; lead = p; }
    for (const [at, steps, len] of STYLES[lead].bass) {
      if (at !== inBar) continue;
      // Scale steps in the chord's own mode, so every note stays in it (a fifth over a diminished root is one too).
      const note = ch.bass + degreeMidi(ch.mode, ch.deg + steps) - degreeMidi(ch.mode, ch.deg);
      out.push({ v: 'bass', notes: [note], vel: (0.62 + 0.25 * c.mood.pad) * (at === 0 ? 1 : 0.8), dur: len, pan: 0, nudge: 0 });
    }
    const tones = [ch.bass + 12, ...ch.upper, ...ch.upper.map((n) => n + 12)].sort((a, b) => a - b);
    for (const [p, w] of weights) {
      if (w < 0.04) continue;
      const st = STYLES[p];
      const k = st.arp[inBar]!;
      if (k >= 0 && rng.chance(0.92)) {
        out.push({ v: 'pluck', notes: [tones[k % tones.length]!], vel: st.arpVel * w * breathe * rng.range(0.8, 1), dur: 1, pan: (inBar & 1) === 0 ? -0.22 : 0.22, nudge: 0 });
      }
      const knockNote = 48 + mod(ch.bass - 48, 12);
      if (st.knock.includes(inBar)) out.push({ v: 'knock', notes: [knockNote], vel: st.beat * w * breathe * (inBar === 0 ? 1 : 0.7), dur: 1, pan: 0, nudge: 0 });
      if (st.shaker.includes(inBar) && rng.chance(0.85)) out.push({ v: 'shaker', notes: [], vel: st.beat * 0.8 * w * breathe * rng.range(0.6, 1), dur: 1, pan: rng.range(-0.3, 0.3), nudge: 0 });
    }
  }

  /** Pitch classes of the chord in force (the effects pick their notes from it), or the tonic's triad. */
  harmony(): number[] {
    return this.chord ? this.chord.pcs : [pc(TONIC), pc(TONIC + 4), pc(TONIC + 7)];
  }

  private nextChord(i: number, c: ScoreCtx, out: NoteEvent[]): void {
    const { rng } = this;
    const mode = c.mood.mode;
    const prev = this.chord;
    // A new mode opens on its tonic chord, so its colour is heard at once; otherwise never the
    // same chord twice, and home grows more likely the longer the music has been away.
    let deg = 0;
    if (prev && prev.mode === mode) {
      const away = this.degrees.slice(-3).every((d) => d !== 0);
      const choices = PROGRESSIONS[mode].filter((ch) => ch.deg !== prev.deg).map((ch) => [ch.deg, ch.deg === 0 && away ? ch.w * 2.5 : ch.w] as const);
      deg = rng.weighted(choices);
    }
    this.degrees.push(deg);
    if (this.degrees.length > 8) this.degrees.shift();
    const bars = rng.weighted(BARS[c.mood.part]);
    // Chords start on a bar line: after skipped steps, the first one runs to the next bar line.
    const until = (Math.floor(i / STEPS_PER_BAR) + bars) * STEPS_PER_BAR;
    const reg = Math.round(c.mood.padReg);
    const lo = 50 + reg, hi = 71 + reg;
    const upper = voiceLead(prev?.upper ?? [], upperPcs(mode, deg, rng.next()), lo, hi);
    const root = pc(degreeMidi(mode, deg));
    let bass = 36 + root; // the root in C2–B2…
    if (bass > lo - 3) bass -= 12; // …always under the pads
    // The melody keeps its pitch across a change of mode (its ladder changes under it).
    if (prev && prev.mode !== mode) this.rung = ladderRung(mode, this.lastNote);
    this.chord = { mode, deg, upper, bass, pcs: [...new Set([root, ...upper.map(pc)])], from: i, until };
    // The pad sounds two bars at most (`restrike` goes on); the bass comes from the part's line (`style`).
    out.push({ v: 'pad', notes: upper, vel: c.mood.pad, dur: Math.min(PAD_STEPS, until - i), pan: 0, nudge: 0 });
  }

  private melody(i: number, c: ScoreCtx, out: NoteEvent[]): void {
    const { rng } = this;
    const mood = c.mood;
    const ph = this.phrase;
    if (ph) {
      if (i < ph.steps[ph.k]!) return;
      const last = ph.k === ph.steps.length - 1;
      this.rung += ph.moves[ph.k]!;
      let note = this.place(mood);
      // Strong beats lean on the chord; the phrase ends on a chord tone.
      if (last || ((i & 1) === 0 && rng.chance(0.5))) note = this.toChordTone(note, mood);
      const arc = Math.sin((Math.PI * (ph.k + 0.5)) / ph.steps.length);
      const vel = clamp((0.5 + 0.32 * arc + rng.range(-0.07, 0.07)) * (1 - 0.15 * c.night), 0.2, 1);
      const dur = last ? rng.int(3, 6) : Math.max(2, (ph.steps[ph.k + 1] ?? i + 4) - i + 1);
      out.push({ v: 'mallet', notes: [note], vel, dur, pan: ph.pan, nudge: rng.range(-0.012, 0.012) });
      this.lastNote = note;
      ph.k++;
      if (last) {
        this.phrase = null;
        const minRest = mood.part === 'night' ? 14 : mood.part === 'day' ? 6 : 9;
        this.restUntil = i + minRest + rng.int(0, 4);
      }
      return;
    }
    if (i < this.restUntil || (i & 1) === 1 || !rng.chance(mood.density)) return;
    this.phrase = this.compose(i, mood);
    this.melody(i, c, out);
  }

  /** Plan a phrase from step i: new, or answering a remembered rhythm, or echoing a contour. */
  private compose(i: number, mood: Mood): Phrase {
    const { rng } = this;
    const night = mood.part === 'night';
    const len = night ? rng.int(2, 4) : rng.int(3, 6);
    const mem = this.motifs.length ? rng.pick(this.motifs) : null;
    const roll = rng.next();
    let gaps: number[], moves: number[];
    if (mem && roll < 0.3) {
      // An answer: the same rhythm, a new line.
      gaps = mem.gaps.slice(0, len);
      while (gaps.length < len) gaps.push(rng.weighted(GAPS));
      moves = Array.from({ length: gaps.length }, () => rng.weighted(MOVES));
    } else if (mem && roll < 0.45) {
      // An echo: the same contour, from elsewhere (the walk carries on from where it is).
      gaps = mem.gaps.slice();
      moves = mem.moves.map((m, k) => (k === 0 ? rng.int(-2, 2) : m));
    } else {
      gaps = Array.from({ length: len }, () => rng.weighted(GAPS));
      moves = Array.from({ length: len }, () => rng.weighted(MOVES));
    }
    moves[0] = (moves[0] ?? 0) + rng.int(-1, 1); // phrases do not start where the last one ended
    this.motifs.push({ gaps, moves });
    if (this.motifs.length > 4) this.motifs.shift();
    const steps: number[] = [];
    let s = i;
    for (const g of gaps) { steps.push(s); s += g; }
    return { steps, moves, k: 0, pan: rng.range(-0.5, 0.5) };
  }

  /** The current rung as a note, kept inside the melody's range (the walk bounces off its edges). */
  private place(mood: Mood): number {
    const mode = this.chord?.mode ?? mood.mode;
    const centre = 74 + Math.round(mood.melReg);
    const lo = centre - 8, hi = centre + 9;
    let note = ladderMidi(mode, this.rung);
    if (note < lo || note > hi) {
      this.rung = ladderRung(mode, note < lo ? lo + 3 : hi - 3);
      note = ladderMidi(mode, this.rung);
    }
    return note;
  }

  /** The nearest chord tone (pad or bass pitch class) to a note, moving the walk with it. */
  private toChordTone(note: number, mood: Mood): number {
    const pcs = this.chord?.pcs;
    if (!pcs || pcs.includes(pc(note))) return note;
    for (let d = 1; d <= 6; d++) {
      for (const s of [-d, d]) {
        if (pcs.includes(pc(note + s))) {
          const m = note + s;
          this.rung = ladderRung(this.chord?.mode ?? mood.mode, m);
          return m;
        }
      }
    }
    return note;
  }

  private pulses(i: number, c: ScoreCtx, out: NoteEvent[]): void {
    const { rng } = this;
    const lv = pulseLevels(c.activity, c.night);
    const ch = this.chord;
    if (!ch) return;
    const inBar = mod(i, STEPS_PER_BAR);
    const knockNote = 48 + mod(ch.bass - 48, 12); // the chord's root, C3–B3
    if (lv.knock > 0.02 && inBar === 0 && rng.chance(0.9)) out.push({ v: 'knock', notes: [knockNote], vel: lv.knock, dur: 1, pan: 0, nudge: 0 });
    if (lv.knock > 0.3 && inBar === 4 && rng.chance(0.75)) out.push({ v: 'knock', notes: [knockNote], vel: lv.knock * 0.55, dur: 1, pan: 0, nudge: 0 });
    if (lv.shaker > 0.02 && (i & 1) === 1 && rng.chance(0.3 + 0.5 * lv.shaker)) {
      out.push({ v: 'shaker', notes: [], vel: lv.shaker * rng.range(0.5, 1), dur: 1, pan: rng.range(-0.35, 0.35), nudge: 0 });
    }
    if (lv.pluck > 0.02 && rng.chance(0.2 + 0.5 * lv.pluck)) {
      const tones = [...ch.upper, ...ch.upper.map((n) => n + 12)];
      const note = tones[mod(i, tones.length)]!;
      out.push({ v: 'pluck', notes: [note], vel: lv.pluck * rng.range(0.55, 1), dur: 1, pan: (i & 2) === 0 ? -0.3 : 0.3, nudge: 0 });
    }
  }
}
