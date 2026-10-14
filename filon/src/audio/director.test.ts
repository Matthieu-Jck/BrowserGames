import { describe, it, expect } from 'vitest';
import { makeRng } from '@/core/rng';
import { activityOf, moodAt, partAt, PART_MODE, pulseLevels, Score, stepSeconds, STEPS_PER_BAR, STYLES, styleWeights, type NoteEvent } from './director';
import { modePcs, pc } from './theory';

/** Run a score for `steps` eighth notes at an hour, collecting what starts on each step. */
function play(hour: number, activity: number, night: number, steps: number, seed = 1): Array<{ i: number; ev: NoteEvent; mode: string }> {
  const s = new Score(makeRng(seed));
  const out: Array<{ i: number; ev: NoteEvent; mode: string }> = [];
  const mood = moodAt(hour);
  for (let i = 0; i < steps; i++) for (const ev of s.step(i, { mood, activity, night })) out.push({ i, ev, mode: s.chord!.mode });
  return out;
}

describe('audio director', () => {
  it('the day has four parts on the world clock, each with its mode', () => {
    expect(partAt(0)).toBe('night');
    expect(partAt(3.9)).toBe('night');
    expect(partAt(4)).toBe('dawn');
    expect(partAt(7.5)).toBe('day');
    expect(partAt(17.49)).toBe('day');
    expect(partAt(17.5)).toBe('dusk');
    expect(partAt(20.5)).toBe('night');
    expect(partAt(-1)).toBe('night');
    expect(partAt(36.5)).toBe('day');
    expect(new Set(Object.values(PART_MODE)).size).toBe(4);
  });

  it('night is slower, darker, sparser and lower in the pads than the day', () => {
    const n = moodAt(1), d = moodAt(12);
    expect(n.bpm).toBeLessThan(d.bpm);
    expect(n.cutoff).toBeLessThan(d.cutoff);
    expect(n.warmth).toBeLessThan(d.warmth);
    expect(n.density).toBeLessThan(d.density / 2);
    expect(n.padReg).toBeLessThan(d.padReg);
    expect(n.mode).toBe('dorian');
    expect(d.mode).toBe('ionian');
    expect(moodAt(5.5).mode).toBe('lydian');
    expect(moodAt(19).mode).toBe('mixolydian');
  });

  it('the mood changes smoothly: no jump between two moments a minute of game time apart', () => {
    for (let h = 0; h < 24; h += 1 / 60) {
      const a = moodAt(h), b = moodAt(h + 1 / 60);
      expect(Math.abs(a.bpm - b.bpm)).toBeLessThan(0.5);
      expect(Math.abs(a.cutoff - b.cutoff)).toBeLessThan(25);
      expect(Math.abs(a.density - b.density)).toBeLessThan(0.01);
    }
  });

  it('an eighth note lasts half a beat', () => {
    expect(stepSeconds(60)).toBeCloseTo(0.5, 9);
    expect(stepSeconds(66)).toBeCloseTo(30 / 66, 9);
  });

  it('pulses grow with the base\'s activity and the night halves them', () => {
    expect(pulseLevels(0, 0)).toEqual({ knock: 0, shaker: 0, pluck: 0 });
    let prev = pulseLevels(0, 0);
    for (let a = 0.05; a <= 1; a += 0.05) {
      const p = pulseLevels(a, 0);
      expect(p.knock).toBeGreaterThanOrEqual(prev.knock);
      expect(p.shaker).toBeGreaterThanOrEqual(prev.shaker);
      expect(p.pluck).toBeGreaterThanOrEqual(prev.pluck);
      prev = p;
    }
    expect(pulseLevels(1, 0).pluck).toBeGreaterThan(0.9);
    expect(pulseLevels(1, 1).pluck).toBeCloseTo(pulseLevels(1, 0).pluck / 2, 9);
    expect(activityOf(0)).toBe(0);
    expect(activityOf(10)).toBeCloseTo(1 - Math.exp(-1), 9);
    expect(activityOf(1e6)).toBeLessThanOrEqual(1);
  });

  it('chords change on bar lines; a pad sounds two bars at most and is struck again; a bass note opens every bar', () => {
    for (const hour of [0, 5.5, 12, 19]) {
      const ev = play(hour, 0.5, 0, 4000);
      const pads = ev.filter((e) => e.ev.v === 'pad');
      expect(pads.length).toBeGreaterThan(10);
      for (const p of pads) {
        expect(p.i % STEPS_PER_BAR).toBe(0);
        expect(p.ev.dur % STEPS_PER_BAR).toBe(0);
        expect(p.ev.dur).toBeGreaterThanOrEqual(STEPS_PER_BAR);
        expect(p.ev.dur).toBeLessThanOrEqual(2 * STEPS_PER_BAR); // no note drags on (owner, 2026-10-13)
      }
      for (let bar = 0; bar < 4000 / STEPS_PER_BAR; bar++) expect(ev.some((e) => e.i === bar * STEPS_PER_BAR && e.ev.v === 'bass')).toBe(true);
      for (const b of ev.filter((e) => e.ev.v === 'bass')) expect(b.ev.dur).toBeLessThanOrEqual(STEPS_PER_BAR);
    }
  });

  it('four pieces: each part of the day has its own lines, and two parts crossfade around their handover', () => {
    expect(styleWeights(12)).toEqual([['day', 1]]);
    expect(styleWeights(2)).toEqual([['night', 1]]);
    const mid = styleWeights(17.5);
    expect(mid.map(([p]) => p)).toEqual(['day', 'dusk']);
    expect(mid[0]![1]).toBeCloseTo(0.5, 5);
    let prev = 1;
    for (let h = 17.1; h <= 17.9; h += 0.05) { const w = styleWeights(h); const day = w.find(([p]) => p === 'day')?.[1] ?? 0; expect(day).toBeLessThanOrEqual(prev + 1e-9); prev = day; }
    const lines = (p: keyof typeof STYLES): string => JSON.stringify([STYLES[p].arp, STYLES[p].bass]);
    expect(new Set((['night', 'dawn', 'day', 'dusk'] as const).map(lines)).size).toBe(4);
  });

  it('every note of the score belongs to the mode in force', () => {
    for (const hour of [0, 5.5, 12, 19]) {
      for (const { ev, mode } of play(hour, 1, 0, 3000, 3)) {
        if (ev.v === 'shaker') continue;
        const pcs = modePcs(mode as never);
        for (const n of ev.notes) expect(pcs, `${mode} ${ev.v} ${n}`).toContain(pc(n));
      }
    }
  });

  it('the melody comes in phrases with rests between them, and the night has fewer notes than the day', () => {
    const count = (h: number): number => play(h, 0.3, h < 4 ? 1 : 0, 6000, 5).filter((e) => e.ev.v === 'mallet').length;
    const night = count(1), day = count(12);
    expect(day).toBeGreaterThan(300);
    expect(night).toBeLessThan(day * 0.6);
    // Rests: long gaps exist between notes (phrases), and notes never pile on one step.
    const steps = play(12, 0.3, 0, 6000, 5).filter((e) => e.ev.v === 'mallet').map((e) => e.i);
    expect(new Set(steps).size).toBe(steps.length);
    const gaps = steps.slice(1).map((s, k) => s - steps[k]!);
    expect(gaps.filter((g) => g >= 6).length).toBeGreaterThan(steps.length / 8);
  });

  it('the melody stays in its range and moves mostly by small steps', () => {
    const notes = play(12, 0.3, 0, 6000, 9).filter((e) => e.ev.v === 'mallet').map((e) => e.ev.notes[0]!);
    for (const n of notes) { expect(n).toBeGreaterThanOrEqual(62); expect(n).toBeLessThanOrEqual(86); }
    const leaps = notes.slice(1).filter((n, k) => Math.abs(n - notes[k]!) > 7).length;
    expect(leaps / notes.length).toBeLessThan(0.15);
  });

  it('the score never loops: no 12-note stretch of the melody (pitch and rhythm) comes back', () => {
    const mel = play(12, 0.3, 0, 20000, 11).filter((e) => e.ev.v === 'mallet');
    const seen = new Set<string>();
    for (let k = 0; k + 12 <= mel.length; k++) {
      const w = mel.slice(k, k + 12);
      const key = w.map((e, j) => `${e.ev.notes[0]}:${j ? e.i - w[j - 1]!.i : 0}`).join(' ');
      expect(seen.has(key), `repeat at note ${k}`).toBe(false);
      seen.add(key);
    }
  });

  it('pulses follow the activity, on top of the part’s own beat: an idle night has none, a busy day the most', () => {
    const pulses = (hour: number, a: number): number => play(hour, a, 0, 4000, 2).filter((e) => e.ev.v === 'knock' || e.ev.v === 'shaker').length;
    expect(pulses(1, 0)).toBe(0);
    const idle = pulses(12, 0), mid = pulses(12, 0.4), busy = pulses(12, 1);
    expect(idle).toBeGreaterThan(200); // the day's own beat
    expect(mid).toBeGreaterThan(idle);
    expect(busy).toBeGreaterThan(mid);
  });

  it('a change of part opens the new mode on its tonic chord', () => {
    const s = new Score(makeRng(4));
    let changes = 0;
    let last = '';
    for (let i = 0; i < 6000; i++) {
      const hour = i < 3000 ? 3.5 : 6; // night, then dawn
      s.step(i, { mood: moodAt(hour), activity: 0, night: hour < 4 ? 1 : 0.3 });
      const c = s.chord!;
      if (last && c.mode !== last) { changes++; expect(c.deg).toBe(0); }
      last = c.mode;
    }
    expect(changes).toBe(1);
  });

  it('the same seed replays the same score; another seed plays another', () => {
    const a = play(12, 0.5, 0, 2000, 21).map((e) => `${e.i}${e.ev.v}${e.ev.notes.join('.')}`).join();
    const b = play(12, 0.5, 0, 2000, 21).map((e) => `${e.i}${e.ev.v}${e.ev.notes.join('.')}`).join();
    const c = play(12, 0.5, 0, 2000, 22).map((e) => `${e.i}${e.ev.v}${e.ev.notes.join('.')}`).join();
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('harmony() gives the effects the chord in force (the tonic triad before the first chord)', () => {
    const s = new Score(makeRng(1));
    expect(s.harmony()).toEqual([2, 6, 9]);
    s.step(0, { mood: moodAt(12), activity: 0, night: 0 });
    expect(s.harmony()).toEqual(s.chord!.pcs);
    expect(s.harmony()).toContain(2); // the first chord is home
  });
});
