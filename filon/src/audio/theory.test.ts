import { describe, it, expect } from 'vitest';
import {
  chordTones, degreeMidi, ladderMidi, ladderRung, LADDERS, midiHz, MODES, modePcs, nearestIn, pc,
  PROGRESSIONS, TONIC, upperPcs, voiceLead, type ModeId,
} from './theory';

const ALL: ModeId[] = ['lydian', 'ionian', 'mixolydian', 'dorian'];

describe('audio theory', () => {
  it('MIDI to Hz: A4 is 440, an octave doubles', () => {
    expect(midiHz(69)).toBeCloseTo(440, 9);
    expect(midiHz(81)).toBeCloseTo(880, 9);
    expect(midiHz(62)).toBeCloseTo(293.665, 2); // D4, the tonic
  });

  it('each mode is seven ascending degrees on D, one colour apart from its neighbour', () => {
    for (const m of ALL) {
      const s = MODES[m];
      expect(s).toHaveLength(7);
      for (let i = 1; i < 7; i++) expect(s[i]!).toBeGreaterThan(s[i - 1]!);
    }
    const diff = (a: ModeId, b: ModeId): number => MODES[a].filter((x, i) => x !== MODES[b][i]).length;
    expect(diff('lydian', 'ionian')).toBe(1); // ♯4 → 4
    expect(diff('ionian', 'mixolydian')).toBe(1); // 7 → ♭7
    expect(diff('mixolydian', 'dorian')).toBe(1); // 3 → ♭3
    expect(modePcs('dorian')).toEqual([2, 4, 5, 7, 9, 11, 0]); // D E F G A B C
  });

  it('degrees wrap by octaves in both directions', () => {
    expect(degreeMidi('ionian', 0)).toBe(TONIC);
    expect(degreeMidi('ionian', 7)).toBe(TONIC + 12);
    expect(degreeMidi('ionian', -1)).toBe(TONIC - 1); // C♯ below D
    expect(degreeMidi('dorian', -1)).toBe(TONIC - 2); // C below D
  });

  it('chords are stacked thirds inside the mode (the Lydian II is major, the Dorian IV is major)', () => {
    const lydII = chordTones('lydian', 1).slice(0, 3).map((m) => m - chordTones('lydian', 1)[0]!);
    expect(lydII).toEqual([0, 4, 7]);
    const dorIV = chordTones('dorian', 3).slice(0, 3).map((m) => m - chordTones('dorian', 3)[0]!);
    expect(dorIV).toEqual([0, 4, 7]);
  });

  it('progressions never use the diminished chord and always include home', () => {
    for (const m of ALL) {
      expect(PROGRESSIONS[m].some((c) => c.deg === 0)).toBe(true);
      for (const c of PROGRESSIONS[m]) {
        const t = chordTones(m, c.deg);
        expect(t[2]! - t[0]!, `${m} degree ${c.deg}`).toBe(7); // a perfect fifth: no diminished triad
      }
    }
  });

  it('upper structures are chord tones, three of them, and never a ♭9 over the root', () => {
    for (const m of ALL) {
      for (const c of PROGRESSIONS[m]) {
        const tones = chordTones(m, c.deg).map(pc);
        for (const r of [0, 0.3, 0.55, 0.8, 0.99]) {
          const u = upperPcs(m, c.deg, r);
          expect(u).toHaveLength(3);
          for (const p of u) expect(tones).toContain(p);
          for (const p of u) expect(pc(p - tones[0]!)).not.toBe(1);
        }
      }
    }
  });

  it('nearestIn finds the nearest octave of a pitch class, inside the range', () => {
    expect(nearestIn(2, 60, 48, 84)).toBe(62);
    expect(nearestIn(11, 60, 48, 84)).toBe(59);
    expect(nearestIn(0, 90, 48, 84)).toBe(84);
    expect(nearestIn(0, 30, 48, 84)).toBe(48);
  });

  it('voice leading moves each voice a little and never stacks a unison or a semitone', () => {
    let prev: number[] = [];
    let total = 0, changes = 0;
    for (const m of ALL) {
      for (const c of PROGRESSIONS[m]) {
        const v = voiceLead(prev, upperPcs(m, c.deg, 0.4), 52, 73);
        expect(v).toHaveLength(3);
        for (const n of v) { expect(n).toBeGreaterThanOrEqual(52); expect(n).toBeLessThanOrEqual(73); }
        for (let i = 1; i < v.length; i++) expect(v[i]! - v[i - 1]!, `${m} ${c.deg}: ${v}`).toBeGreaterThan(1);
        if (prev.length) { total += v.reduce((s, n, i) => s + Math.abs(n - prev[i]!), 0); changes++; }
        prev = v;
      }
    }
    expect(total / changes).toBeLessThan(7); // under ~2.3 semitones per voice on average
  });

  it('the melody ladders are pentatonic at heart: no semitone between neighbouring rungs, except a mode colour', () => {
    for (const m of ALL) {
      let semis = 0;
      for (let i = -8; i < 8; i++) {
        const d = ladderMidi(m, i + 1) - ladderMidi(m, i);
        expect(d).toBeGreaterThan(0);
        expect(d).toBeLessThanOrEqual(4);
        if (d === 1) semis++;
      }
      expect(semis, m).toBeLessThanOrEqual(6); // a colour note may sit a semitone from its neighbour
      expect(LADDERS[m][0]).toBe(0);
    }
    expect(ladderMidi('ionian', 0)).toBe(TONIC);
    expect(ladderMidi('ionian', 5)).toBe(TONIC + 12);
  });

  it('ladderRung inverts ladderMidi and snaps between rungs to the nearest', () => {
    for (const m of ALL) for (let i = -10; i <= 10; i++) expect(ladderRung(m, ladderMidi(m, i))).toBe(i);
    expect(ladderMidi('ionian', ladderRung('ionian', TONIC + 1))).toBe(TONIC); // E♭ → D (ties go down)
  });
});
