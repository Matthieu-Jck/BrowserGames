// synth.ts — the score's instruments, in Web Audio. Each function builds a few short-lived nodes
// on any BaseAudioContext (the live AudioContext, or an OfflineAudioContext for the level check),
// schedules their envelopes at an exact audio time, and lets them go: sources stop on their own
// and their last node disconnects when they end. Simple by construction: sine and soft-saw
// oscillators, one low-pass per pad, linear attacks and exponential decays (no clicks: every
// envelope starts and ends at zero, every source stops well below −60 dB).
//
// - pad: a chord of soft saws (two detuned oscillators per note), one low-pass that opens with the
//   attack and slowly closes, spread across the stereo field. The warmth picks the waveform.
// - bass: a sine and a quiet triangle an octave up, under 380 Hz.
// - mallet: the melody: a sine with a bright overtone that dies fast (a double octave by day, an
//   inharmonic 2.76 bell partial at night) — a kalimba by day, glass at night.
// - pluck, knock, shaker: the pulses: a filtered triangle, a pitched wooden tock, a puff of noise.
import { clamp } from '@/core/math';
import { midiHz } from './theory';

/** Where the music's voices go, and what they share. */
export interface MusicBus {
  readonly ctx: BaseAudioContext;
  /** The music bus (dry), the reverb send and the echo send (all music-volume controlled). */
  readonly dry: AudioNode;
  readonly wet: AudioNode;
  readonly echo: AudioNode;
  /** Soft-saw waveforms, from near-sine (cold) to a mellow saw (warm). */
  readonly waves: readonly PeriodicWave[];
  /** White noise (one-shots read a slice of it). */
  readonly noise: AudioBuffer;
  /** A start offset (s) into the noise for a slice of `dur` seconds: a low-discrepancy walk, so slices differ. */
  offset(dur: number): number;
}

const now0 = (t: number): number => Math.max(0, t);

/** A gain node at a fixed value. */
export function gainNode(ctx: BaseAudioContext, value: number): GainNode {
  const g = ctx.createGain();
  g.gain.value = value;
  return g;
}

/** A stereo panner at a fixed position (−1 … 1). */
export function panNode(ctx: BaseAudioContext, pan: number): StereoPannerNode {
  const p = ctx.createStereoPanner();
  p.pan.value = clamp(pan, -1, 1);
  return p;
}

/** A biquad filter. */
export function filterNode(ctx: BaseAudioContext, type: BiquadFilterType, freq: number, q = 0.7): BiquadFilterNode {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  return f;
}

/** When `src` ends, disconnect `last` (the voice's exit), so nothing lingers in the graph. */
export function releaseOnEnd(src: AudioScheduledSourceNode, ...last: AudioNode[]): void {
  src.addEventListener('ended', () => { for (const n of last) { try { n.disconnect(); } catch { /* already gone */ } } });
}

/**
 * A percussive envelope on a fresh gain: 0 → peak over `attack` (linear), then an exponential
 * decay with time constant `tau`. Returns when it is below −60 dB (≈ 7 τ). The gain's own value
 * is set to 0 first: a GainNode starts at 1, and if `t` has just slipped into the past the browser
 * plays that 1 until it catches up with the automation — a click.
 */
export function strike(g: AudioParam, t: number, peak: number, attack: number, tau: number): number {
  g.value = 0;
  g.setValueAtTime(0, t);
  g.linearRampToValueAtTime(peak, t + attack);
  g.setTargetAtTime(0, t + attack, Math.max(0.001, tau));
  return t + attack + 7 * tau;
}

export interface PadOpts {
  /** Low-pass cutoff (Hz) at the end of the attack. */
  cutoff: number;
  /** 0 (cold) … 1 (warm). */
  warmth: number;
  /** Peak gain of the whole chord. */
  level: number;
  /** Attack and release (s). */
  attack: number;
  release: number;
  /** Reverb send. */
  verb: number;
}

/** A pad chord from `t` for `dur` seconds (then its release). */
export function pad(b: MusicBus, notes: readonly number[], t: number, dur: number, o: PadOpts): void {
  const { ctx } = b;
  t = now0(t);
  const end = t + dur;
  const attack = Math.min(o.attack, dur * 0.6);
  const stopAt = end + o.release * 2.4 + 0.1;
  const lp = filterNode(ctx, 'lowpass', o.cutoff * 0.55, 0.5);
  lp.frequency.setValueAtTime(o.cutoff * 0.55, t);
  lp.frequency.linearRampToValueAtTime(o.cutoff, t + attack * 1.2);
  lp.frequency.linearRampToValueAtTime(o.cutoff * 0.72, end + o.release);
  const vca = gainNode(ctx, 0); // silent until its envelope starts (see `strike`)
  vca.gain.setValueAtTime(0, t);
  vca.gain.linearRampToValueAtTime(o.level, t + attack);
  vca.gain.setValueAtTime(o.level, end);
  vca.gain.setTargetAtTime(0, end, o.release / 3);
  const send = gainNode(ctx, o.verb);
  lp.connect(vca);
  vca.connect(b.dry);
  vca.connect(send);
  send.connect(b.wet);
  const wave = b.waves[Math.round(clamp(o.warmth, 0, 1) * (b.waves.length - 1))]!;
  // Two detuned oscillators per note, one on each side of the note's place: their slow beating
  // moves between the speakers, and the chord spreads across the field (wide, not a mono block).
  const pre = gainNode(ctx, 0.5 / Math.sqrt(Math.max(1, notes.length))); // constant power per chord
  pre.connect(lp);
  const oscs: OscillatorNode[] = [];
  for (let k = 0; k < notes.length; k++) {
    const place = notes.length > 1 ? (k / (notes.length - 1) - 0.5) * 0.5 : 0;
    for (const side of [-1, 1]) {
      const osc = ctx.createOscillator();
      osc.setPeriodicWave(wave);
      osc.frequency.value = midiHz(notes[k]!);
      osc.detune.value = side * 7 * (1 + 0.2 * k); // a slow, uneven chorus
      const p = panNode(ctx, place + side * 0.55);
      osc.connect(p);
      p.connect(pre);
      osc.start(t);
      osc.stop(stopAt);
      oscs.push(osc);
    }
  }
  const last = oscs[oscs.length - 1];
  if (last) releaseOnEnd(last, vca, send);
}

/** The bass under a chord: a sine and a quiet triangle an octave up, low-passed. */
export function bass(b: MusicBus, note: number, t: number, dur: number, o: { level: number; attack: number; release: number }): void {
  const { ctx } = b;
  t = now0(t);
  const end = t + dur;
  const attack = Math.min(o.attack, dur * 0.6);
  const stopAt = end + o.release * 2.4 + 0.1;
  const vca = gainNode(ctx, 0);
  vca.gain.setValueAtTime(0, t);
  vca.gain.linearRampToValueAtTime(o.level, t + attack);
  vca.gain.setValueAtTime(o.level, end);
  vca.gain.setTargetAtTime(0, end, o.release / 3);
  const lp = filterNode(ctx, 'lowpass', 380, 0.5);
  lp.connect(vca);
  vca.connect(b.dry);
  const f = midiHz(note);
  const sine = ctx.createOscillator();
  sine.frequency.value = f;
  sine.connect(lp);
  const tri = ctx.createOscillator();
  tri.type = 'triangle';
  tri.frequency.value = f * 2;
  const tg = gainNode(ctx, 0.16);
  tri.connect(tg);
  tg.connect(lp);
  for (const o2 of [sine, tri]) { o2.start(t); o2.stop(stopAt); }
  releaseOnEnd(sine, vca);
}

/** One partial of a struck sound: a sine with its own strike envelope, into `dest`. */
function partial(ctx: BaseAudioContext, dest: AudioNode, f: number, t: number, amp: number, attack: number, tau: number): OscillatorNode {
  const osc = ctx.createOscillator();
  osc.frequency.value = f;
  const g = ctx.createGain();
  const end = strike(g.gain, t, amp, attack, tau);
  osc.connect(g);
  g.connect(dest);
  osc.start(t);
  osc.stop(end);
  releaseOnEnd(osc, g);
  return osc;
}

export interface MalletOpts { level: number; pan: number; night: number; verb: number; echo: number }

/** A melody note: struck, ringing, sent to the echo and the reverb. */
export function mallet(b: MusicBus, note: number, t: number, vel: number, o: MalletOpts): void {
  const { ctx } = b;
  t = now0(t);
  const f = midiHz(note);
  const night = clamp(o.night, 0, 1);
  const tau = clamp(1.1 * (440 / f) ** 0.35, 0.45, 1.8) * (1 + 0.5 * night);
  const out = gainNode(ctx, vel * o.level);
  const p = panNode(ctx, o.pan);
  const sv = gainNode(ctx, o.verb), se = gainNode(ctx, o.echo);
  out.connect(p);
  p.connect(b.dry);
  p.connect(sv);
  sv.connect(b.wet);
  p.connect(se);
  se.connect(b.echo);
  const attack = 0.006 - 0.002 * night;
  const ratio = 4 - (4 - 2.76) * night;
  const fund = partial(ctx, out, f, t, 1, attack, tau);
  partial(ctx, out, f * ratio, t, 0.2, attack, tau * 0.18);
  partial(ctx, out, f * 2, t, 0.09, attack, tau * 0.45);
  releaseOnEnd(fund, out, p, sv, se);
}

/** A plucked arpeggio note (the busy base's pulse): a triangle through a closing low-pass. */
export function pluck(b: MusicBus, note: number, t: number, vel: number, o: { level: number; pan: number; verb: number }): void {
  const { ctx } = b;
  t = now0(t);
  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.value = midiHz(note);
  const lp = filterNode(ctx, 'lowpass', 3000, 0.8);
  lp.frequency.setValueAtTime(3000, t);
  lp.frequency.setTargetAtTime(700, t, 0.06);
  const vca = ctx.createGain();
  const end = strike(vca.gain, t, vel * o.level, 0.003, 0.16);
  const p = panNode(ctx, o.pan);
  const sv = gainNode(ctx, o.verb);
  osc.connect(lp);
  lp.connect(vca);
  vca.connect(p);
  p.connect(b.dry);
  p.connect(sv);
  sv.connect(b.wet);
  osc.start(t);
  osc.stop(end);
  releaseOnEnd(osc, p, sv);
}

/** A soft wooden knock on the bar (the machines' heartbeat): a falling sine and a tiny click. */
export function knock(b: MusicBus, note: number, t: number, vel: number, o: { level: number }): void {
  const { ctx } = b;
  t = now0(t);
  const f = midiHz(note);
  const osc = ctx.createOscillator();
  osc.frequency.setValueAtTime(f * 1.7, t);
  osc.frequency.setTargetAtTime(f, t, 0.012);
  const vca = ctx.createGain();
  const end = strike(vca.gain, t, vel * o.level, 0.002, 0.06);
  osc.connect(vca);
  vca.connect(b.dry);
  osc.start(t);
  osc.stop(end);
  releaseOnEnd(osc, vca);
  const src = ctx.createBufferSource();
  src.buffer = b.noise;
  const bp = filterNode(ctx, 'bandpass', 1500, 1.5);
  const cg = ctx.createGain();
  strike(cg.gain, t, vel * o.level * 0.35, 0.001, 0.006);
  src.connect(bp);
  bp.connect(cg);
  cg.connect(b.dry);
  src.start(t, b.offset(0.08), 0.08);
  releaseOnEnd(src, cg);
}

/** A puff of high noise on an off-beat. */
export function shaker(b: MusicBus, t: number, vel: number, o: { level: number; pan: number }): void {
  const { ctx } = b;
  t = now0(t);
  const src = ctx.createBufferSource();
  src.buffer = b.noise;
  const hp = filterNode(ctx, 'highpass', 5200, 0.7);
  const vca = ctx.createGain();
  strike(vca.gain, t, vel * o.level, 0.004, 0.025);
  const p = panNode(ctx, o.pan);
  src.connect(hp);
  hp.connect(vca);
  vca.connect(p);
  p.connect(b.dry);
  src.start(t, b.offset(0.25), 0.25);
  releaseOnEnd(src, p);
}
