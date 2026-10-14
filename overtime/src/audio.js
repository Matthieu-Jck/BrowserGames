// audio.js — every sound is synthesized with WebAudio. No assets.

export class GameAudio {
  constructor() {
    this.ctx = null;
    this.heartTimer = 0;
    this.threat = 0;
    this.phoneInterval = null;
  }

  init() {
    if (this.ctx) return;
    const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)();

    this.master = ctx.createGain();
    this.master.gain.value = 0.85;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.ratio.value = 6;
    this.master.connect(comp); comp.connect(ctx.destination);

    // shared noise buffer
    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { // brown-ish noise
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    }

    // ---- room tone: low rumble + fluorescent hum ----
    const amb = this._noiseSource(true);
    const ambLp = ctx.createBiquadFilter();
    ambLp.type = 'lowpass'; ambLp.frequency.value = 160;
    this.ambGain = ctx.createGain(); this.ambGain.gain.value = 0.06;
    amb.connect(ambLp); ambLp.connect(this.ambGain); this.ambGain.connect(this.master);
    amb.start();

    const hum = ctx.createOscillator(); hum.type = 'sawtooth'; hum.frequency.value = 120;
    const humBp = ctx.createBiquadFilter(); humBp.type = 'bandpass'; humBp.frequency.value = 120; humBp.Q.value = 9;
    const hum2 = ctx.createOscillator(); hum2.type = 'sine'; hum2.frequency.value = 240;
    this.humGain = ctx.createGain(); this.humGain.gain.value = 0.016;
    const hum2g = ctx.createGain(); hum2g.gain.value = 0.25;
    hum.connect(humBp); humBp.connect(this.humGain);
    hum2.connect(hum2g); hum2g.connect(this.humGain);
    this.humGain.connect(this.master);
    hum.start(); hum2.start();

    // ---- blackout drone: two beating saws, gain raised during the finale ----
    const d1 = ctx.createOscillator(); d1.type = 'sawtooth'; d1.frequency.value = 36;
    const d2 = ctx.createOscillator(); d2.type = 'sawtooth'; d2.frequency.value = 36.6;
    const dLp = ctx.createBiquadFilter(); dLp.type = 'lowpass'; dLp.frequency.value = 220;
    this.droneGain = ctx.createGain(); this.droneGain.gain.value = 0;
    d1.connect(dLp); d2.connect(dLp); dLp.connect(this.droneGain); this.droneGain.connect(this.master);
    d1.start(); d2.start();
  }

  _noiseSource(loop = false) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf; s.loop = loop;
    return s;
  }

  _env(gainNode, t0, peak, attack, decay) {
    const g = gainNode.gain;
    g.setValueAtTime(0.0001, t0);
    g.exponentialRampToValueAtTime(Math.max(peak, 0.0001), t0 + attack);
    g.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
  }

  _pan(node, pan = 0) {
    if (!this.ctx.createStereoPanner) { node.connect(this.master); return; }
    const p = this.ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    node.connect(p); p.connect(this.master);
  }

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

  setPower(on, time = 0.8) {
    if (!this.ctx) return;
    this.humGain.gain.linearRampToValueAtTime(on ? 0.016 : 0.0005, this.ctx.currentTime + time);
  }

  setBlackout(b) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.droneGain.gain.linearRampToValueAtTime(b ? 0.10 : 0, t + 3.0);
    this.ambGain.gain.linearRampToValueAtTime(b ? 0.10 : 0.06, t + 3.0);
  }

  // everything goes quiet for a moment — "you notice the hum for the first time"
  duck(hold = 2.5) {
    if (!this.ctx) return;
    const g = this.master.gain, t = this.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.linearRampToValueAtTime(0.0, t + 0.15);
    g.setValueAtTime(0.0, t + hold);
    g.linearRampToValueAtTime(0.85, t + hold + 1.2);
  }

  footstep(running = false) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const s = this._noiseSource();
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 280 + Math.random() * 220; bp.Q.value = 0.8;
    const g = this.ctx.createGain();
    s.connect(bp); bp.connect(g); g.connect(this.master);
    this._env(g, t, running ? 0.16 : 0.09, 0.005, 0.09);
    s.start(t); s.stop(t + 0.15);
  }

  buzz(intensity = 1) { // fluorescent tube sputter
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); o.type = 'square'; o.frequency.value = 120;
    const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 2;
    const g = this.ctx.createGain();
    o.connect(bp); bp.connect(g); g.connect(this.master);
    this._env(g, t, 0.05 * intensity, 0.01, 0.10 + Math.random() * 0.08);
    o.start(t); o.stop(t + 0.25);
  }

  slam(gain = 0.5, pan = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const s = this._noiseSource();
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 140;
    const g = this.ctx.createGain();
    s.connect(lp); lp.connect(g); this._pan(g, pan);
    this._env(g, t, gain, 0.008, 0.5);
    s.start(t); s.stop(t + 0.6);
    const o = this.ctx.createOscillator(); o.frequency.setValueAtTime(70, t);
    o.frequency.exponentialRampToValueAtTime(32, t + 0.4);
    const og = this.ctx.createGain();
    o.connect(og); this._pan(og, pan);
    this._env(og, t, gain * 0.8, 0.008, 0.45);
    o.start(t); o.stop(t + 0.5);
  }

  whisper(pan = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, dur = 1.4 + Math.random() * 0.8;
    const s = this._noiseSource();
    const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 6;
    bp.frequency.setValueAtTime(800 + Math.random() * 600, t);
    bp.frequency.linearRampToValueAtTime(1800 + Math.random() * 900, t + dur);
    // syllabic amplitude modulation makes it read as speech
    const am = this.ctx.createOscillator(); am.type = 'square';
    am.frequency.value = 7 + Math.random() * 6;
    const amg = this.ctx.createGain(); amg.gain.value = 0.5;
    const base = this.ctx.createGain(); base.gain.value = 0.5;
    am.connect(amg);
    const g = this.ctx.createGain(); g.gain.value = 0;
    amg.connect(g.gain); // wobble
    s.connect(bp); bp.connect(base); base.connect(g); this._pan(g, pan);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.10, t + 0.3);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    s.start(t); s.stop(t + dur + 0.1);
    am.start(t); am.stop(t + dur + 0.1);
  }

  stinger(intensity = 1) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      const o = this.ctx.createOscillator(); o.type = 'sawtooth';
      const f = 90 + i * 6 + Math.random() * 8;
      o.frequency.setValueAtTime(f, t);
      o.frequency.exponentialRampToValueAtTime(f * 0.5, t + 1.2);
      const g = this.ctx.createGain();
      o.connect(g); g.connect(this.master);
      this._env(g, t, 0.10 * intensity, 0.02, 1.1);
      o.start(t); o.stop(t + 1.3);
    }
    const s = this._noiseSource();
    const hp = this.ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1200;
    const g = this.ctx.createGain();
    s.connect(hp); hp.connect(g); g.connect(this.master);
    this._env(g, t, 0.12 * intensity, 0.01, 0.5);
    s.start(t); s.stop(t + 0.6);
  }

  screech() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (let i = 0; i < 4; i++) {
      const o = this.ctx.createOscillator(); o.type = 'sawtooth';
      const f = 500 + Math.random() * 500;
      o.frequency.setValueAtTime(f, t);
      o.frequency.exponentialRampToValueAtTime(f * 1.8, t + 0.9);
      const g = this.ctx.createGain();
      o.connect(g); g.connect(this.master);
      this._env(g, t, 0.09, 0.03, 0.9);
      o.start(t); o.stop(t + 1.0);
    }
    const s = this._noiseSource();
    const hp = this.ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2000;
    const g = this.ctx.createGain();
    s.connect(hp); hp.connect(g); g.connect(this.master);
    this._env(g, t, 0.18, 0.02, 0.8);
    s.start(t); s.stop(t + 1.0);
  }

  ding() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    [[1318, 0], [1046, 0.22]].forEach(([f, dt]) => {
      const o = this.ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const g = this.ctx.createGain();
      o.connect(g); g.connect(this.master);
      this._env(g, t + dt, 0.12, 0.005, 0.9);
      o.start(t + dt); o.stop(t + dt + 1.0);
    });
  }

  phoneStart(panFn = null) {
    if (!this.ctx || this.phoneInterval) return;
    const ringOnce = () => {
      const t = this.ctx.currentTime;
      const pan = panFn ? panFn() : 0;
      [1568, 1976].forEach(f => {
        const o = this.ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
        const trem = this.ctx.createOscillator(); trem.frequency.value = 22;
        const tg = this.ctx.createGain(); tg.gain.value = 0.5;
        const carrier = this.ctx.createGain(); carrier.gain.value = 0;
        trem.connect(tg); tg.connect(carrier.gain);
        const g = this.ctx.createGain();
        o.connect(carrier); carrier.connect(g); this._pan(g, pan);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.05, t + 0.03);
        g.gain.setValueAtTime(0.05, t + 1.0);
        g.gain.linearRampToValueAtTime(0.0001, t + 1.1);
        o.start(t); o.stop(t + 1.2); trem.start(t); trem.stop(t + 1.2);
      });
    };
    ringOnce();
    this.phoneInterval = setInterval(ringOnce, 3000);
  }

  phoneStop() {
    if (this.phoneInterval) { clearInterval(this.phoneInterval); this.phoneInterval = null; }
  }

  pickup() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); o.type = 'triangle';
    o.frequency.setValueAtTime(520, t);
    o.frequency.exponentialRampToValueAtTime(780, t + 0.08);
    const g = this.ctx.createGain();
    o.connect(g); g.connect(this.master);
    this._env(g, t, 0.10, 0.01, 0.18);
    o.start(t); o.stop(t + 0.25);
  }

  rumble(dur = 2.0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const s = this._noiseSource();
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 80;
    const g = this.ctx.createGain();
    s.connect(lp); lp.connect(g); g.connect(this.master);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.22, t + 0.4);
    g.gain.setValueAtTime(0.22, t + dur - 0.5);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    s.start(t); s.stop(t + dur + 0.1);
  }

  _thump() {
    const t = this.ctx.currentTime;
    [[0, 1], [0.16, 0.7]].forEach(([dt, v]) => {
      const o = this.ctx.createOscillator();
      o.frequency.setValueAtTime(58, t + dt);
      o.frequency.exponentialRampToValueAtTime(38, t + dt + 0.12);
      const g = this.ctx.createGain();
      o.connect(g); g.connect(this.master);
      this._env(g, t + dt, 0.20 * v * Math.min(1, this.threat * 1.4), 0.005, 0.13);
      o.start(t + dt); o.stop(t + dt + 0.2);
    });
  }

  update(dt, threat) {
    this.threat = threat;
    if (!this.ctx || threat < 0.05) return;
    this.heartTimer -= dt;
    if (this.heartTimer <= 0) {
      this._thump();
      this.heartTimer = 1.5 - threat * 1.0; // heart speeds up as it closes in
    }
  }
}
