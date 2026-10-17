// engine.ts — the sound engine on any BaseAudioContext: the live AudioContext (sound.ts owns it)
// or an OfflineAudioContext (the level check renders the very same graph). It builds the mixer
// once, then the shell drives it: `update(world)` every frame (the score's look-ahead scheduling
// and the ambience's glides), `play(cue)` for the effects, `setVolumes` from the settings.
//
//   score voices ─→ music ──────────────→ ┐
//        ├─ echo (ping-pong) ─→ music      │
//        └─ reverb send ─→ musicWet ─→ ┐   ├─→ master (sliders × visible) → high-pass 22 Hz
//   cue recipes ─→ sfx ───────────────→ ┤   │      → limiter → make-up trim → soft clip → out
//        └─ reverb send ─→ sfxWet ──→ reverb ┘
//   wind, machines, ribbons ─→ ambience (ducked under a veil) ─→ master
//
// Each bus runs at its slider's gain (levels.ts: squared taper, trims in MIX); the reverb's sends
// sit behind their bus volume, so the music slider also turns the music's reverb down. The
// limiter only acts on rare overs; the soft clip only past −2 dBFS: the mix has headroom by
// construction (docs/audio.md, "Levels").
import type { SfxCue } from '@/core/bus';
import { lerp } from '@/core/math';
import { makeRng, type Rng } from '@/core/rng';
import { Ambience, type AmbienceInput } from './ambience';
import { clickTrain, impulseResponse, pinkNoise, softClipCurve, whiteNoise, type Samples } from './buffers';
import { CUES } from './cues';
import { moodAt, Score, stepSeconds, styleWeights, type Chord, type Mood, type NoteEvent } from './director';
import { busGains, dbToGain, DEFAULT_VOLUMES, MIX, VOICE, type Volumes } from './levels';
import { Sequencer, type Tick } from './sequencer';
import { RECIPES, type SfxKit } from './sfx';
import { SIG_RECIPES } from './signature-sfx';
import { SIGNATURES, VARIANTS, type Signature, type SigVariant } from './signatures';
import { bass, filterNode, gainNode, knock, mallet, pad, panNode, pluck, shaker, type MusicBus } from './synth';

/** What the engine reads of the world each frame (the shell fills it). */
export interface SoundWorld extends AmbienceInput {
  /** Hour of the 24-hour world clock, as the day/night look shows it. */
  hour: number;
  /** The base's activity 0 … 1 (share of its machines running, soft curve). */
  activity: number;
  /** A full screen or the main menu covers the base: the ambience steps back. */
  veiled: boolean;
}

export interface EngineOptions {
  /** Seeds the score and the generated buffers. */
  seed: number;
  volumes?: Volumes;
  /** Leave out the score / the ambience (the level check renders each part alone). */
  music?: boolean;
  ambience?: boolean;
}

/**
 * The limiter's automatic make-up gain (dB), cancelled right after it so that everything under
 * the threshold passes at unity. Browsers derive it from threshold, knee and ratio; this is the
 * value measured in Chrome for the settings below (docs/audio.md).
 */
export const LIMITER_MAKEUP_DB = 1.8;

const WARMTH_STEPS = [[2.4, 6], [1.9, 10], [1.5, 16], [1.2, 24]] as const;

/** Soft-saw waveforms: a saw's harmonic series rolled off by 1/kᵖ, from near-sine to mellow. */
function warmWaves(ctx: BaseAudioContext): PeriodicWave[] {
  return WARMTH_STEPS.map(([p, n]) => {
    const real = new Float32Array(n + 1), imag = new Float32Array(n + 1);
    for (let k = 1; k <= n; k++) imag[k] = (k % 2 ? 1 : -1) / k ** p;
    return ctx.createPeriodicWave(real, imag);
  });
}

function bufferOf(ctx: BaseAudioContext, chans: readonly Samples[]): AudioBuffer {
  const b = ctx.createBuffer(chans.length, chans[0]!.length, ctx.sampleRate);
  chans.forEach((c, i) => b.getChannelData(i).set(c));
  return b;
}

export class SoundEngine {
  private readonly master: GainNode;
  private readonly musicVol: GainNode;
  private readonly musicWetVol: GainNode;
  private readonly sfxVol: GainNode;
  private readonly sfxWetVol: GainNode;
  private readonly ambVol: GainNode;
  private readonly echoL: DelayNode;
  private readonly echoR: DelayNode;
  private readonly bus: MusicBus;
  private readonly kit: SfxKit;
  private readonly score: Score;
  private readonly seq = new Sequencer();
  private readonly ambience: Ambience | null;
  private readonly mood: Mood = moodAt(12);
  private readonly music: boolean;
  private volumes: Volumes;
  private visible = 1;
  private veil = 0;
  private started = false;
  private echoSet = false;
  private readonly ticks: Tick[] = [];
  private walk = 0;

  constructor(readonly ctx: BaseAudioContext, o: EngineOptions) {
    const rng: Rng = makeRng(o.seed >>> 0);
    const sr = ctx.sampleRate;
    this.volumes = { ...(o.volumes ?? DEFAULT_VOLUMES) };
    this.music = o.music ?? true;
    const waves = warmWaves(ctx);
    const noise = bufferOf(ctx, [whiteNoise(Math.floor(sr * 3), rng)]);
    const offset = (dur: number): number => {
      this.walk = (this.walk + 0.6180339887) % 1;
      return this.walk * Math.max(0, noise.duration - dur - 0.01);
    };

    // Master chain: sliders × visibility → DC / sub guard → limiter → make-up trim → soft clip.
    this.master = gainNode(ctx, 0);
    const hp = filterNode(ctx, 'highpass', 22, 0.7);
    const lim = ctx.createDynamicsCompressor();
    lim.threshold.value = MIX.limiter;
    lim.knee.value = 3;
    lim.ratio.value = 20;
    lim.attack.value = 0.002;
    lim.release.value = 0.15;
    const trim = gainNode(ctx, dbToGain(-LIMITER_MAKEUP_DB));
    const clip = ctx.createWaveShaper();
    clip.curve = softClipCurve();
    clip.oversample = '2x';
    this.master.connect(hp);
    hp.connect(lim);
    lim.connect(trim);
    trim.connect(clip);
    clip.connect(ctx.destination);

    // Reverb: one convolver for the music and the effects (each send behind its bus volume).
    const verbIn = gainNode(ctx, 1);
    const verbHp = filterNode(ctx, 'highpass', 180, 0.7);
    const conv = ctx.createConvolver();
    conv.buffer = bufferOf(ctx, impulseResponse(sr, 3.2, rng));
    const verbOut = gainNode(ctx, VOICE.reverb);
    verbIn.connect(verbHp);
    verbHp.connect(conv);
    conv.connect(verbOut);
    verbOut.connect(this.master);

    // Music bus, its reverb send and the echo.
    const musicIn = gainNode(ctx, 1), musicWetIn = gainNode(ctx, 1);
    this.musicVol = gainNode(ctx, 0);
    this.musicWetVol = gainNode(ctx, 0);
    musicIn.connect(this.musicVol);
    this.musicVol.connect(this.master);
    musicWetIn.connect(this.musicWetVol);
    this.musicWetVol.connect(verbIn);
    const echoIn = gainNode(ctx, 1);
    const eHp = filterNode(ctx, 'highpass', 300, 0.7), eLp = filterNode(ctx, 'lowpass', 3200, 0.7);
    this.echoL = ctx.createDelay(3);
    this.echoR = ctx.createDelay(3);
    const fbLR = gainNode(ctx, 0.36), fbRL = gainNode(ctx, 0.36), damp = filterNode(ctx, 'lowpass', 2200, 0.6);
    const echoOut = gainNode(ctx, VOICE.echo), echoWet = gainNode(ctx, 0.5);
    echoIn.connect(eHp);
    eHp.connect(eLp);
    eLp.connect(this.echoL);
    this.echoL.connect(fbLR);
    fbLR.connect(this.echoR);
    this.echoR.connect(damp);
    damp.connect(fbRL);
    fbRL.connect(this.echoL);
    for (const [d, side] of [[this.echoL, -0.55], [this.echoR, 0.55]] as const) {
      const p = panNode(ctx, side);
      d.connect(p);
      p.connect(echoOut);
    }
    echoOut.connect(musicIn);
    echoOut.connect(echoWet);
    echoWet.connect(musicWetIn);

    // Effects bus and its reverb send.
    const sfxIn = gainNode(ctx, 1), sfxWetIn = gainNode(ctx, 1);
    this.sfxVol = gainNode(ctx, 0);
    this.sfxWetVol = gainNode(ctx, 0);
    sfxIn.connect(this.sfxVol);
    this.sfxVol.connect(this.master);
    sfxWetIn.connect(this.sfxWetVol);
    this.sfxWetVol.connect(verbIn);

    // Ambience bus.
    const ambIn = gainNode(ctx, 1);
    this.ambVol = gainNode(ctx, 0);
    ambIn.connect(this.ambVol);
    this.ambVol.connect(this.master);
    this.ambience = (o.ambience ?? true)
      ? new Ambience(ctx, ambIn, {
        pink: bufferOf(ctx, [pinkNoise(Math.floor(sr * 6), rng, sr), pinkNoise(Math.floor(sr * 6), rng, sr)]),
        white: noise,
        clicks: bufferOf(ctx, [clickTrain(Math.floor(sr * 5), sr, 30, rng)]),
      }, waves, o.seed)
      : null;

    this.score = new Score(makeRng((o.seed ^ 0x2f6b) >>> 0));
    this.bus = { ctx, dry: musicIn, wet: musicWetIn, echo: echoIn, waves, noise, offset };
    this.kit = { ctx, out: sfxIn, wet: sfxWetIn, noise, offset, harmony: () => this.score.harmony() };
  }

  /** Start the loops and bring the buses up (the score's first chord swells in on its own). */
  start(at = this.ctx.currentTime): void {
    if (this.started) return;
    this.started = true;
    this.ambience?.start(at);
    this.apply(at, 0.02, 1.5); // the wind rises over a few seconds
  }

  /** The sliders (change-only writes are the caller's business: this always writes). */
  setVolumes(v: Volumes, at = this.ctx.currentTime): void {
    this.volumes = { ...v };
    this.apply(at, 0.05);
  }

  /** Fade everything out (hidden tab) or back in. */
  setVisible(on: boolean, at = this.ctx.currentTime): void {
    this.visible = on ? 1 : 0;
    this.master.gain.setTargetAtTime(busGains(this.volumes).master * this.visible, at, on ? 0.25 : 0.04);
  }

  /** Write the bus gains (time constants: the buses, and the ambience apart). */
  private apply(at: number, tau: number, ambTau = tau): void {
    const g = busGains(this.volumes, this.veil);
    this.master.gain.setTargetAtTime(g.master * this.visible, at, tau);
    this.musicVol.gain.setTargetAtTime(this.music ? g.music : 0, at, tau);
    this.musicWetVol.gain.setTargetAtTime(this.music ? g.music : 0, at, tau);
    this.sfxVol.gain.setTargetAtTime(g.sfx, at, tau);
    this.sfxWetVol.gain.setTargetAtTime(g.sfx, at, tau);
    this.ambVol.gain.setTargetAtTime(g.ambience, at, ambTau);
  }

  /** Follow the world: schedule the score ahead, move the ambience. Call every frame (or every 0.1 s offline). */
  update(w: SoundWorld, now = this.ctx.currentTime): void {
    if (!this.started) return;
    const veil = w.veiled ? 1 : 0;
    if (veil !== this.veil) { this.veil = veil; this.apply(now, 0.6); }
    // A silent score is not composed at all (the sequencer skips ahead when it comes back).
    if (this.music && this.volumes.music > 0 && this.volumes.master > 0) this.schedule(w, now);
    this.ambience?.update(now, w);
  }

  private schedule(w: SoundWorld, now: number): void {
    const mood = moodAt(w.hour, this.mood);
    const d = stepSeconds(mood.bpm);
    // The echo repeats on the dotted quarter, gliding slowly with the tempo (set at once the first
    // time: a delay sweeping up from zero would bend the first echoes' pitch).
    for (const dl of [this.echoL, this.echoR]) {
      if (this.echoSet) dl.delayTime.setTargetAtTime(3 * d, now, 2);
      else dl.delayTime.setValueAtTime(3 * d, now);
    }
    this.echoSet = true;
    this.ticks.length = 0;
    for (const tk of this.seq.due(now, d, this.ticks)) {
      for (const ev of this.score.step(tk.i, { mood, activity: w.activity, night: w.night, weights: styleWeights(w.hour) })) this.voice(ev, tk.t + ev.nudge, d, mood, w.night);
    }
  }

  private voice(ev: NoteEvent, t: number, d: number, mood: Mood, night: number): void {
    const note = ev.notes[0] ?? 62;
    switch (ev.v) {
      case 'pad':
        pad(this.bus, ev.notes, t, ev.dur * d, {
          // Soft but not slow: a pad swells in and fades out within its two bars (owner: notes « way too long »).
          cutoff: mood.cutoff, warmth: mood.warmth, level: VOICE.pad * ev.vel,
          attack: lerp(1.1, 1.8, night), release: lerp(1.6, 2.6, night), verb: 0.3 + 0.25 * night,
        });
        break;
      // The night thins the bass (colder: the warmth leaves the low end).
      case 'bass': bass(this.bus, note, t, ev.dur * d, { level: VOICE.bass * ev.vel * (1 - 0.4 * night), attack: Math.min(0.25, ev.dur * d * 0.3), release: 0.7 + 0.6 * night }); break;
      case 'mallet': mallet(this.bus, note, t, ev.vel, { level: VOICE.mallet, pan: ev.pan, night, verb: mood.verb, echo: 0.32 }); break;
      case 'pluck': pluck(this.bus, note, t, ev.vel, { level: VOICE.pluck, pan: ev.pan, verb: 0.15 }); break;
      case 'knock': knock(this.bus, note, t, ev.vel, { level: VOICE.knock }); break;
      case 'shaker': shaker(this.bus, t, ev.vel, { level: VOICE.shaker, pan: ev.pan }); break;
    }
  }

  /** Play a cue now (or at `at`): its recipe at its trim. */
  play(cue: SfxCue, n = 1, at = this.ctx.currentTime): void {
    RECIPES[cue](this.kit, Math.max(at, this.ctx.currentTime), Math.max(1, Math.floor(n)), dbToGain(CUES[cue].trimDb));
  }

  /**
   * Play a building's signature (D120) now (or at `at`): its recipe in that variant, at its trims
   * times `gain` (the spatial fade), panned to where the building is.
   */
  playSignature(s: Signature, variant: SigVariant, gain = 1, pan = 0, at = this.ctx.currentTime): void {
    const v = VARIANTS[variant];
    const g = dbToGain(SIGNATURES[s].trimDb[variant === 'build' ? 0 : 1]) * Math.max(0, Math.min(1, gain));
    SIG_RECIPES[s](this.kit, Math.max(at, this.ctx.currentTime), { g, len: v.len, full: variant === 'build', pan: Math.max(-1, Math.min(1, pan)) });
  }

  /** Pitch classes of the chord in force. */
  harmony(): readonly number[] {
    return this.score.harmony();
  }

  /** The score's state, for the debug handle and the smoke test. */
  describe(): { part: Mood['part']; mode: Mood['mode']; bpm: number; step: number; chord: Pick<Chord, 'deg' | 'upper' | 'bass'> | null } {
    const c = this.score.chord;
    return { part: this.mood.part, mode: this.mood.mode, bpm: Math.round(this.mood.bpm), step: this.seq.index, chord: c ? { deg: c.deg, upper: [...c.upper], bass: c.bass } : null };
  }
}
