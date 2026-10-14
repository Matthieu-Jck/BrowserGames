// music.ts — generative score with actual arrangement: a 4-chord progression,
// pad / bass / arpeggio / lead layers and a drum kit, all scheduled ahead on a
// 16th-note grid and crossfaded per mood. Everything synthesized.
import { makeRng, type Rng } from '@/core/rng';
import { audio } from './synth';

export type Mood = 'title' | 'map' | 'combat' | 'boss' | 'grief' | 'transcend' | 'intro' | 'unease' | 'triumph' | 'off';

interface MoodProfile {
  root: number;                 // tonic (Hz, low octave)
  scale: number[];              // 7-note scale in semitones
  prog: number[];               // 4 chord degrees (0-based into scale)
  bpm: number;
  pad: number;                  // 0 = off
  bass: 'off' | 'whole' | 'pulse' | 'drive';
  arp: number;                  // density 0..1
  lead: number;                 // density 0..1
  drums: 'off' | 'soft' | 'combat' | 'boss';
  filter: number;               // lowpass brightness for melodic layers
}

const AEOLIAN = [0, 2, 3, 5, 7, 8, 10];
const DORIAN = [0, 2, 3, 5, 7, 9, 10];
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const PHRYGIAN = [0, 1, 3, 5, 7, 8, 10];
const LYDIAN = [0, 2, 4, 6, 7, 9, 11];

const PROFILES: Record<Exclude<Mood, 'off'>, MoodProfile> = {
  title: { root: 65.4, scale: AEOLIAN, prog: [0, 5, 2, 6], bpm: 72, pad: 0.8, bass: 'whole', arp: 0.35, lead: 0.3, drums: 'off', filter: 2000 },
  intro: { root: 65.4, scale: DORIAN, prog: [0, 3, 4, 5], bpm: 76, pad: 0.9, bass: 'whole', arp: 0.3, lead: 0.25, drums: 'off', filter: 1800 },
  map: { root: 73.4, scale: DORIAN, prog: [0, 5, 3, 4], bpm: 84, pad: 0.7, bass: 'pulse', arp: 0.45, lead: 0.25, drums: 'soft', filter: 2200 },
  combat: { root: 61.7, scale: AEOLIAN, prog: [0, 0, 5, 6], bpm: 112, pad: 0.5, bass: 'drive', arp: 0.6, lead: 0.15, drums: 'combat', filter: 2600 },
  boss: { root: 55, scale: PHRYGIAN, prog: [0, 1, 0, 6], bpm: 126, pad: 0.55, bass: 'drive', arp: 0.7, lead: 0.3, drums: 'boss', filter: 3000 },
  grief: { root: 58.3, scale: AEOLIAN, prog: [0, 2, 5, 4], bpm: 58, pad: 1.0, bass: 'whole', arp: 0.12, lead: 0.4, drums: 'off', filter: 1500 },
  unease: { root: 61.7, scale: PHRYGIAN, prog: [0, 1, 3, 1], bpm: 70, pad: 0.8, bass: 'pulse', arp: 0.25, lead: 0.2, drums: 'off', filter: 1700 },
  transcend: { root: 82.4, scale: LYDIAN, prog: [0, 1, 4, 3], bpm: 80, pad: 1.0, bass: 'whole', arp: 0.5, lead: 0.45, drums: 'off', filter: 2800 },
  triumph: { root: 87.3, scale: MAJOR, prog: [0, 3, 4, 0], bpm: 92, pad: 0.9, bass: 'pulse', arp: 0.5, lead: 0.5, drums: 'soft', filter: 2600 },
};

class MusicEngine {
  private mood: Mood = 'off';
  private timer: number | null = null;
  private nextStep = 0;
  private step = 0;
  private rng: Rng = makeRng('music');
  private motif: number[] = [];

  setMood(mood: Mood): void {
    if (mood === this.mood) return;
    this.mood = mood;
    if (mood === 'off') { this.stop(); return; }
    this.rng = makeRng('music:' + mood);
    // an 8-slot melodic motif of chord-relative degrees (rests as -1)
    this.motif = Array.from({ length: 8 }, () =>
      this.rng.chance(0.6) ? this.rng.pick([0, 2, 4, 5, 7, 9]) : -1);
    if (this.timer === null && audio.ctx) {
      this.step = 0;
      this.nextStep = audio.t + 0.1;
      this.timer = window.setInterval(() => this.schedule(), 25);
    }
  }

  /** Call once audio is initialized (first pointer event). */
  kick(): void {
    if (this.mood !== 'off' && this.timer === null && audio.ctx) {
      const m = this.mood;
      this.mood = 'off';
      this.setMood(m);
    }
  }

  private freqOf(p: MoodProfile, degree: number, octave: number): number {
    const oct = Math.floor(degree / 7);
    const idx = ((degree % 7) + 7) % 7;
    return p.root * Math.pow(2, (p.scale[idx]! + (oct + octave) * 12) / 12);
  }

  private schedule(): void {
    if (!audio.ctx || this.mood === 'off') return;
    const p = PROFILES[this.mood];
    const stepDur = 60 / p.bpm / 4;       // 16th notes
    while (this.nextStep < audio.t + 0.16) {
      const when = Math.max(0, this.nextStep - audio.t);
      this.playStep(p, this.step, stepDur, when);
      this.step++;
      this.nextStep += stepDur;
    }
  }

  private playStep(p: MoodProfile, step: number, stepDur: number, when: number): void {
    const s16 = step % 16;                // position in bar
    const bar = Math.floor(step / 16);
    const chordDeg = p.prog[bar % p.prog.length]!;
    const barDur = stepDur * 16;

    // ---- pad: a soft triad swelling at each bar
    if (p.pad > 0 && s16 === 0) {
      for (const off of [0, 2, 4]) {
        audio.note(this.freqOf(p, chordDeg + off, 1), barDur * 1.05, {
          type: 'sawtooth', peak: 0.018 * p.pad, attack: barDur * 0.3, filter: 900, when,
        });
        audio.note(this.freqOf(p, chordDeg + off, 1), barDur * 1.05, {
          type: 'sine', peak: 0.02 * p.pad, attack: barDur * 0.25, filter: 1200, when, detune: 7,
        });
      }
    }

    // ---- bass
    const bassFreq = this.freqOf(p, chordDeg, 0);
    if (p.bass === 'whole' && s16 === 0) {
      audio.note(bassFreq, barDur * 0.9, { type: 'sine', peak: 0.09, attack: 0.04, filter: 500, when });
    } else if (p.bass === 'pulse' && (s16 === 0 || s16 === 8)) {
      audio.note(bassFreq, stepDur * 6, { type: 'triangle', peak: 0.085, attack: 0.015, filter: 600, when });
    } else if (p.bass === 'drive' && s16 % 4 === 0) {
      const up = s16 === 12 && this.rng.chance(0.5);
      audio.note(this.freqOf(p, chordDeg + (up ? 4 : 0), 0), stepDur * 3.2, {
        type: 'triangle', peak: 0.09, attack: 0.008, filter: 750, when,
      });
      if (s16 === 8) audio.note(bassFreq * 2, stepDur * 1.6, { type: 'triangle', peak: 0.04, attack: 0.008, filter: 800, when: when + stepDur * 2 });
    }

    // ---- arpeggio: chord tones on 8ths
    if (p.arp > 0 && s16 % 2 === 0 && this.rng.chance(p.arp)) {
      const pattern = [0, 2, 4, 7, 4, 2];
      const tone = pattern[(s16 / 2) % pattern.length]!;
      audio.note(this.freqOf(p, chordDeg + tone, 2), stepDur * 2.6, {
        type: 'triangle', peak: 0.038, attack: 0.01, filter: p.filter, when,
      });
    }

    // ---- lead: the motif, on alternate bars
    if (p.lead > 0 && bar % 2 === 1 && s16 % 2 === 0) {
      const m = this.motif[(s16 / 2) % this.motif.length]!;
      if (m >= 0 && this.rng.chance(p.lead + 0.3)) {
        const f = this.freqOf(p, chordDeg + m, 3);
        audio.note(f, stepDur * 3.4, { type: 'sine', peak: 0.045, attack: 0.02, filter: p.filter + 600, when });
        if (this.mood === 'transcend' || this.mood === 'triumph') {
          audio.note(f, stepDur * 3.4, { type: 'sine', peak: 0.02, attack: 0.03, filter: p.filter, when, detune: 9 });
        }
      }
    }

    // ---- drums
    switch (p.drums) {
      case 'soft':
        if (s16 === 0 || s16 === 8) audio.perc('kick', when, 0.5);
        if (s16 === 4 || s16 === 12) audio.perc('hat', when, 0.6);
        break;
      case 'combat':
        if (s16 === 0 || s16 === 8 || s16 === 10) audio.perc('kick', when, 0.85);
        if (s16 % 4 === 2) audio.perc('hat', when, 0.8);
        if (s16 === 4 || s16 === 12) audio.perc('snare', when, 0.55);
        break;
      case 'boss':
        if (s16 === 0 || s16 === 6 || s16 === 8 || s16 === 14) audio.perc('kick', when, 1);
        if (s16 % 2 === 1) audio.perc('hat', when, 0.6);
        if (s16 === 4 || s16 === 12) audio.perc('snare', when, 0.9);
        break;
      default: break;
    }
  }

  private stop(): void {
    if (this.timer !== null) { clearInterval(this.timer); this.timer = null; }
  }
}

export const music = new MusicEngine();
