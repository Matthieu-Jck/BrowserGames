// ambience.ts — the base's sound bed, in Web Audio: the wind (le Souffle), the machines and the
// ribbons. Three looping layers run for the whole session; `update` only moves their levels and
// filters (a few parameter glides, at most ~15 times a second), so the bed costs almost nothing.
//
// - Wind: pink noise in three bands — a low-passed body, a low rumble (the same noise played at
//   half speed, so it is not correlated with the body) and a narrow whistle that wanders. Its
//   strength follows the weather's gust level (‰, the same one the wind turbines see: 700 calm …
//   1300 gusty), smoothed over several seconds; within it a slow noise curve makes the gusts
//   swell and ebb. A little darker at night.
// - Machines: a hum in D (a D2 sine and an A2 soft saw — in key with the score), a band of whirr
//   and a slow mechanical throb, at a level that follows how many machines run in view, panned
//   towards them.
// - Ribbons: a loop of tiny clicks, band-passed, heard only zoomed in close over moving items.
import { clamp } from '@/core/math';
import { makeNoise2, type Noise2 } from '@/core/noise';
import { AMB } from './levels';
import { filterNode, gainNode, panNode } from './synth';
import { midiHz } from './theory';

/** What the bed listens to. */
export interface AmbienceInput {
  /** Gust level ‰ of the weather (700 … 1300). */
  gust: number;
  /** Night factor 0 … 1. */
  night: number;
  /** Running machines in view (closer to the centre counts more). */
  machines: number;
  /** Where they are, left −1 … right 1. */
  machinePan: number;
  /** Items drawn on ribbons in view. */
  items: number;
  /** Camera zoom (0.125 far … 2 close). */
  zoom: number;
}

export interface AmbienceBuffers { pink: AudioBuffer; white: AudioBuffer; clicks: AudioBuffer }

const smooth = (t: number): number => t * t * (3 - 2 * t);
const smoothstep = (a: number, b: number, x: number): number => smooth(clamp((x - a) / (b - a), 0, 1));

/** The wind's strength (0.45 … 1) from the gust level ‰. */
export const windStrength = (gust: number): number => 0.45 + 0.55 * clamp((gust - 700) / 600, 0, 1);
/** The machine bed's level (0 … 1) from the running machines in view: the first few count most. */
export const bedLevel = (machines: number): number => 1 - Math.exp(-Math.max(0, machines) / 5);
/** The rattle's level (0 … 1): only zoomed in close, and only over moving items. */
export const rattleLevel = (zoom: number, items: number): number => smoothstep(1.1, 1.9, zoom) * (1 - Math.exp(-Math.max(0, items) / 30));

export class Ambience {
  private readonly body: GainNode;
  private readonly bodyLp: BiquadFilterNode;
  private readonly whistle: GainNode;
  private readonly whistleBp: BiquadFilterNode;
  private readonly rumble: GainNode;
  private readonly bed: GainNode;
  private readonly bedPan: StereoPannerNode;
  private readonly rattle: GainNode;
  private readonly noise: Noise2;
  private readonly sources: AudioScheduledSourceNode[] = [];
  /** Smoothed wind strength (the gust level steps every ten minutes; the ear should not hear the step). */
  private strength = -1;
  private last = -1;

  constructor(ctx: BaseAudioContext, out: AudioNode, bufs: AmbienceBuffers, waves: readonly PeriodicWave[], seed: number) {
    this.noise = makeNoise2(seed ^ 0x5a17);
    const loop = (buf: AudioBuffer, rate = 1): AudioBufferSourceNode => {
      const s = ctx.createBufferSource();
      s.buffer = buf;
      s.loop = true;
      s.playbackRate.value = rate;
      this.sources.push(s);
      return s;
    };
    // Wind.
    const pink = loop(bufs.pink);
    this.bodyLp = filterNode(ctx, 'lowpass', 500, 0.5);
    this.body = gainNode(ctx, 0);
    pink.connect(this.bodyLp);
    this.bodyLp.connect(this.body);
    this.body.connect(out);
    this.whistleBp = filterNode(ctx, 'bandpass', 700, 6);
    this.whistle = gainNode(ctx, 0);
    pink.connect(this.whistleBp);
    this.whistleBp.connect(this.whistle);
    this.whistle.connect(out);
    const slow = loop(bufs.pink, 0.5);
    const rumbleLp = filterNode(ctx, 'lowpass', 170, 0.6);
    this.rumble = gainNode(ctx, 0);
    slow.connect(rumbleLp);
    rumbleLp.connect(this.rumble);
    this.rumble.connect(out);
    // Machines: hum, whirr, throb.
    const throb = gainNode(ctx, 0.85);
    const hum1 = ctx.createOscillator();
    hum1.frequency.value = midiHz(38); // D2
    const h1 = gainNode(ctx, 0.5);
    hum1.connect(h1);
    h1.connect(throb);
    const hum2 = ctx.createOscillator();
    hum2.setPeriodicWave(waves[Math.min(2, waves.length - 1)]!);
    hum2.frequency.value = midiHz(45); // A2
    const h2lp = filterNode(ctx, 'lowpass', 320, 0.6);
    const h2 = gainNode(ctx, 0.4);
    hum2.connect(h2lp);
    h2lp.connect(h2);
    h2.connect(throb);
    const whirr = loop(bufs.white);
    const wbp = filterNode(ctx, 'bandpass', 190, 1.2);
    const wg = gainNode(ctx, 0.5);
    whirr.connect(wbp);
    wbp.connect(wg);
    wg.connect(throb);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 1.7;
    const depth = gainNode(ctx, 0.15);
    lfo.connect(depth);
    depth.connect(throb.gain);
    this.sources.push(hum1, hum2, lfo);
    this.bedPan = panNode(ctx, 0);
    this.bed = gainNode(ctx, 0);
    throb.connect(this.bedPan);
    this.bedPan.connect(this.bed);
    this.bed.connect(out);
    // Ribbons: the same click loop at two speeds, one per side.
    this.rattle = gainNode(ctx, 0);
    const rbp = filterNode(ctx, 'bandpass', 2600, 0.9);
    const rhp = filterNode(ctx, 'highpass', 700, 0.7);
    rbp.connect(rhp);
    rhp.connect(this.rattle);
    this.rattle.connect(out);
    for (const [rate, side] of [[1, -0.5], [1.07, 0.5]] as const) {
      const c = loop(bufs.clicks, rate);
      const p = panNode(ctx, side);
      c.connect(p);
      p.connect(rbp);
    }
  }

  /** Start the loops at time t (silent until the first update brings the levels up). */
  start(t: number): void {
    this.sources.forEach((s, i) => {
      if (s instanceof AudioBufferSourceNode && s.buffer) s.start(t, (i * 1.37) % Math.max(0.1, s.buffer.duration));
      else s.start(t);
    });
  }

  /** Follow the world: call often; it writes at most ~15 times a second. */
  update(now: number, w: AmbienceInput): void {
    if (this.last >= 0 && now - this.last < 1 / 15) return;
    const dt = this.last < 0 ? 0 : now - this.last;
    this.last = now;
    const target = windStrength(w.gust);
    this.strength = this.strength < 0 ? target : this.strength + (target - this.strength) * (1 - Math.exp(-dt / 6));
    const s = this.strength;
    // The gusts inside the weather's level: a slow swell and a faster flutter, 0 … 1 (value noise
    // hovers around the middle: stretched so that lulls and blasts both happen).
    const raw = 0.7 * this.noise.noise(now / 6.5, 0.5) + 0.3 * this.noise.noise(now / 2.1, 7.5);
    const g = smoothstep(0.22, 0.78, raw);
    const wander = this.noise.noise(now / 9.7, 13.5);
    const night = clamp(w.night, 0, 1);
    const set = (p: AudioParam, v: number, tau: number): void => { p.setTargetAtTime(Number.isFinite(v) ? v : 0, now, tau); };
    set(this.body.gain, AMB.windBody * s * (0.3 + 0.7 * g), 0.35);
    set(this.bodyLp.frequency, (280 + 560 * g) * (1 - 0.15 * night), 0.35);
    set(this.rumble.gain, AMB.windRumble * s * (0.6 + 0.4 * g), 0.5);
    set(this.whistle.gain, AMB.windWhistle * s * g * g * (0.3 + 0.7 * clamp((w.gust - 850) / 450, 0, 1)), 0.5);
    set(this.whistleBp.frequency, 480 + 620 * wander, 0.6);
    set(this.bed.gain, AMB.bed * bedLevel(w.machines), 1.2);
    set(this.bedPan.pan, clamp(w.machinePan, -0.6, 0.6), 1);
    set(this.rattle.gain, AMB.rattle * rattleLevel(w.zoom, w.items), 0.4);
  }
}
