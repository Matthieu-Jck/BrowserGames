// synth.ts — all sound synthesized with Web Audio. No audio files.
// Master chain: compressor + soft limiter. Music gets its own bus with a
// feedback-delay "space echo". SFX are layered (body + transient) for punch.

export class GameAudio {
  ctx: AudioContext | null = null;
  master: GainNode | null = null;
  sfxBus: GainNode | null = null;
  musicBus: GainNode | null = null;

  init(): void {
    if (this.ctx) return;
    this.ctx = new AudioContext();

    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 22;
    comp.ratio.value = 5;
    comp.attack.value = 0.004;
    comp.release.value = 0.18;
    comp.connect(this.ctx.destination);

    this.master = this.ctx.createGain();
    this.master.gain.value = 0.6;
    this.master.connect(comp);

    this.sfxBus = this.ctx.createGain();
    this.sfxBus.gain.value = 0.9;
    this.sfxBus.connect(this.master);

    // music bus with a gentle space echo (feedback delay)
    this.musicBus = this.ctx.createGain();
    this.musicBus.gain.value = 0.8;
    this.musicBus.connect(this.master);
    const delay = this.ctx.createDelay(1.0);
    delay.delayTime.value = 0.34;
    const fb = this.ctx.createGain();
    fb.gain.value = 0.28;
    const wet = this.ctx.createGain();
    wet.gain.value = 0.22;
    const damp = this.ctx.createBiquadFilter();
    damp.type = 'lowpass';
    damp.frequency.value = 2400;
    this.musicBus.connect(delay);
    delay.connect(damp);
    damp.connect(fb);
    fb.connect(delay);
    damp.connect(wet);
    wet.connect(this.master);
  }

  resume(): void {
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
  }

  get t(): number { return this.ctx?.currentTime ?? 0; }

  // ---------------------------------------------------------------- primitives

  env(g: GainNode, t0: number, a: number, peak: number, d: number, sustain = 0): void {
    const gg = g.gain;
    gg.cancelScheduledValues(t0);
    gg.setValueAtTime(0.0001, t0);
    gg.exponentialRampToValueAtTime(Math.max(0.0001, peak), t0 + a);
    gg.exponentialRampToValueAtTime(Math.max(0.0001, sustain || 0.0001), t0 + a + d);
  }

  osc(type: OscillatorType, freq: number, dur: number, peak = 0.2, slideTo: number | null = null, filterFreq: number | null = null, when = 0): void {
    if (!this.ctx || !this.sfxBus) return;
    const t0 = this.t + when;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t0 + dur);
    let node: AudioNode = o;
    if (filterFreq) {
      const f = this.ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = filterFreq;
      o.connect(f);
      node = f;
    }
    node.connect(g);
    g.connect(this.sfxBus);
    this.env(g, t0, 0.005, peak, dur);
    o.start(t0);
    o.stop(t0 + dur + 0.1);
  }

  noise(dur: number, peak = 0.2, filterFreq = 1200, type: BiquadFilterType = 'lowpass', when = 0, q = 1): void {
    if (!this.ctx || !this.sfxBus) return;
    const t0 = this.t + when;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * (dur + 0.05)));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = filterFreq;
    f.Q.value = q;
    const g = this.ctx.createGain();
    src.connect(f); f.connect(g); g.connect(this.sfxBus);
    this.env(g, t0, 0.008, peak, dur);
    src.start(t0);
  }

  /** A musical note on the music bus: soft attack, filtered, schedulable. */
  note(freq: number, dur: number, opts: { type?: OscillatorType; peak?: number; attack?: number; filter?: number; when?: number; detune?: number } = {}): void {
    if (!this.ctx || !this.musicBus) return;
    const t0 = this.t + (opts.when ?? 0);
    const o = this.ctx.createOscillator();
    o.type = opts.type ?? 'triangle';
    o.frequency.setValueAtTime(freq, t0);
    if (opts.detune) o.detune.value = opts.detune;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = opts.filter ?? 2200;
    const g = this.ctx.createGain();
    o.connect(f); f.connect(g); g.connect(this.musicBus);
    const a = opts.attack ?? 0.01;
    this.env(g, t0, a, opts.peak ?? 0.05, Math.max(0.05, dur - a));
    o.start(t0);
    o.stop(t0 + dur + 0.25);
  }

  /** Percussion on the music bus: kick / snare / hat, schedulable. */
  perc(kind: 'kick' | 'snare' | 'hat', when = 0, gain = 1): void {
    if (!this.ctx || !this.musicBus) return;
    const t0 = this.t + when;
    if (kind === 'kick') {
      const o = this.ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(120, t0);
      o.frequency.exponentialRampToValueAtTime(38, t0 + 0.12);
      const g = this.ctx.createGain();
      o.connect(g); g.connect(this.musicBus);
      this.env(g, t0, 0.003, 0.22 * gain, 0.16);
      o.start(t0); o.stop(t0 + 0.3);
      return;
    }
    const len = Math.floor(this.ctx.sampleRate * 0.12);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    const g = this.ctx.createGain();
    if (kind === 'snare') {
      f.type = 'bandpass'; f.frequency.value = 1900; f.Q.value = 0.8;
      this.env(g, t0, 0.003, 0.11 * gain, 0.1);
    } else {
      f.type = 'highpass'; f.frequency.value = 7200;
      this.env(g, t0, 0.002, 0.05 * gain, 0.045);
    }
    src.connect(f); f.connect(g); g.connect(this.musicBus);
    src.start(t0);
  }

  // ---------------------------------------------------------------- ui one-shots
  tick(): void { this.osc('sine', 940, 0.05, 0.06); this.osc('sine', 1320, 0.04, 0.03, null, null, 0.02); }
  hover(): void { this.osc('sine', 1180, 0.035, 0.028); }
  confirm(): void {
    this.osc('triangle', 587, 0.1, 0.1);
    this.osc('triangle', 880, 0.16, 0.09, null, null, 0.06);
    this.osc('sine', 1175, 0.2, 0.05, null, null, 0.12);
  }
  deny(): void { this.osc('triangle', 200, 0.12, 0.12, 150); this.osc('triangle', 150, 0.16, 0.1, 110, null, 0.09); }
  chime(): void {
    [880, 1108, 1318].forEach((f, i) => this.osc('sine', f, 0.45, 0.08, null, null, i * 0.08));
  }
  alarm(): void { this.osc('square', 660, 0.14, 0.06, null, 1800); this.osc('square', 660, 0.14, 0.06, null, 1800, 0.22); }

  // ---------------------------------------------------------------- combat one-shots
  cardDraw(): void { this.noise(0.07, 0.05, 3600, 'highpass'); this.osc('sine', 760, 0.04, 0.025, 1050); }
  cardPlayLaser(): void {
    this.osc('sawtooth', 1750, 0.2, 0.1, 320, 3200);
    this.osc('sine', 2400, 0.12, 0.05, 700);
    this.noise(0.1, 0.04, 5200, 'highpass', 0.02);
  }
  cardPlayKinetic(): void {
    this.noise(0.09, 0.22, 3000, 'highpass');
    this.osc('square', 190, 0.13, 0.16, 70);
    this.osc('sine', 95, 0.17, 0.2, 42, null, 0.01);
  }
  cardPlayNuclear(): void {
    this.osc('sine', 110, 0.55, 0.24, 32);
    this.noise(0.5, 0.14, 460, 'lowpass', 0.03);
    this.osc('sawtooth', 700, 0.3, 0.04, 180, 900, 0.05);
  }
  cardPlaySpeed(): void {
    this.osc('sine', 620, 0.1, 0.08, 1700);
    this.osc('sine', 930, 0.1, 0.06, 2300, null, 0.05);
    this.noise(0.09, 0.04, 4000, 'highpass', 0.02);
  }
  cardPlayRepair(): void {
    this.osc('sine', 523, 0.22, 0.08, null, null, 0);
    this.osc('sine', 784, 0.26, 0.07, null, null, 0.07);
    this.osc('sine', 1047, 0.3, 0.05, null, null, 0.14);
  }
  cardPlaySkill(): void { this.osc('triangle', 460, 0.13, 0.08, 690); this.osc('sine', 920, 0.1, 0.04, null, null, 0.05); }
  energySpend(): void { this.osc('sine', 1000, 0.06, 0.04, 760); }
  shieldFx(): void { this.osc('sine', 480, 0.3, 0.09, 950); this.osc('sine', 720, 0.22, 0.05, 1400, null, 0.04); }
  hit(power = 1): void {
    const p = Math.min(1.6, 0.7 + power * 0.3);
    this.noise(0.14 * p, 0.2 * p, 1100);
    this.osc('triangle', 210, 0.14, 0.16 * p, 80);
    if (power > 1.2) this.osc('sine', 70, 0.3, 0.22, 36, null, 0.01);
  }
  evade(): void { this.noise(0.16, 0.06, 2600, 'bandpass', 0, 2); this.osc('sine', 1500, 0.1, 0.04, 2600); }
  statusApply(): void { this.osc('sawtooth', 380, 0.13, 0.05, 280, 1300); }
  explosion(): void {
    this.noise(0.7, 0.3, 800);
    this.osc('sine', 130, 0.6, 0.24, 30);
    this.noise(0.25, 0.16, 2800, 'highpass');
  }
  enemyMove(): void { this.osc('sawtooth', 200, 0.12, 0.05, 150, 800); }
  victory(): void {
    // little fanfare: I – IV – V – I arpeggio with sparkle
    const seq = [523, 659, 784, 1047, 784, 1047, 1319];
    seq.forEach((f, i) => this.osc('triangle', f, 0.32, 0.09, null, null, i * 0.09));
    [1568, 2093].forEach((f, i) => this.osc('sine', f, 0.5, 0.04, null, null, 0.65 + i * 0.1));
    this.noise(0.4, 0.03, 6000, 'highpass', 0.65);
  }
  defeat(): void {
    [392, 370, 311, 262].forEach((f, i) => this.osc('triangle', f, 0.5, 0.1, null, null, i * 0.28));
    this.noise(1.4, 0.08, 320, 'lowpass', 0.2);
  }
  warp(): void { this.osc('sawtooth', 120, 1.3, 0.1, 980, 1500); this.noise(1.1, 0.06, 900, 'bandpass', 0.1, 1.4); }
  boom(): void { this.noise(2.2, 0.34, 340); this.osc('sine', 60, 2.4, 0.3, 24); }
  ignite(): void { this.noise(1.6, 0.24, 520); this.osc('sawtooth', 70, 1.6, 0.14, 38, 320); }
  forge(): void {
    this.osc('triangle', 330, 0.4, 0.1, 660);
    this.osc('sine', 165, 0.6, 0.09);
    this.osc('sine', 990, 0.3, 0.04, null, null, 0.18);
  }
  loot(): void {
    [784, 988, 1175, 1568].forEach((f, i) => this.osc('sine', f, 0.2, 0.07, null, null, i * 0.06));
  }
}

export const audio = new GameAudio();
