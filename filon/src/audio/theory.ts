// theory.ts — the score's pitch material, pure: four modes on one tonic (D), MIDI ⇄ Hz, chords
// stacked in thirds inside a mode, the melody's ladders, and voice leading (each new chord is
// voiced as close as possible to the last one, without semitone rubs). The whole day turns
// around D: the time of day changes the mode (Lydian at dawn, Ionian by day, Mixolydian at dusk,
// Dorian at night), so the colour moves while the centre stays — one or three notes change at
// each turn of the day. No Web Audio here: unit-tested in Node.

export type ModeId = 'lydian' | 'ionian' | 'mixolydian' | 'dorian';

/** Semitones of each mode's seven degrees above its tonic, brightest first. */
export const MODES: Record<ModeId, readonly number[]> = {
  lydian: [0, 2, 4, 6, 7, 9, 11],
  ionian: [0, 2, 4, 5, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
};

/** The tonic of the whole score: D4 (MIDI 62). D2 (38) is also the machines' hum, so they play in key. */
export const TONIC = 62;

const mod = (a: number, n: number): number => ((a % n) + n) % n;

/** Pitch class (0 = C) of a MIDI note. */
export const pc = (m: number): number => mod(m, 12);

/** Frequency (Hz) of a MIDI note (A4 = 69 = 440 Hz; fractional notes allowed). */
export const midiHz = (m: number): number => 440 * 2 ** ((m - 69) / 12);

/** MIDI pitch of a scale degree in a mode on a tonic; any integer (7 = the tonic an octave up, −1 = the 7th below). */
export function degreeMidi(mode: ModeId, deg: number, tonic = TONIC): number {
  return tonic + 12 * Math.floor(deg / 7) + MODES[mode][mod(deg, 7)]!;
}

/** Pitch classes of a whole mode. */
export const modePcs = (mode: ModeId, tonic = TONIC): number[] => MODES[mode].map((s) => pc(tonic + s));

/** The chord in thirds on a degree, as MIDI notes from its root: root, 3rd, 5th, 7th, 9th. */
export function chordTones(mode: ModeId, deg: number, tonic = TONIC): number[] {
  return [0, 2, 4, 6, 8].map((k) => degreeMidi(mode, deg + k, tonic));
}

/** One chord the progressions may move to: a scale degree (0 = the tonic chord) and its weight. */
export interface ChordChoice { readonly deg: number; readonly w: number }

/**
 * Each mode's chords, by how often they come. The tonic chord is the home; the modal chord
 * (Lydian's major II, Mixolydian's ♭VII, Dorian's major IV) is the colour, weighted next.
 * Never the diminished chord.
 */
export const PROGRESSIONS: Record<ModeId, readonly ChordChoice[]> = {
  lydian: [{ deg: 0, w: 5 }, { deg: 1, w: 4 }, { deg: 4, w: 2 }, { deg: 5, w: 2 }, { deg: 2, w: 1 }],
  ionian: [{ deg: 0, w: 5 }, { deg: 3, w: 4 }, { deg: 5, w: 3 }, { deg: 1, w: 2 }, { deg: 4, w: 1 }, { deg: 2, w: 1 }],
  mixolydian: [{ deg: 0, w: 5 }, { deg: 6, w: 4 }, { deg: 3, w: 3 }, { deg: 4, w: 2 }, { deg: 1, w: 1 }],
  dorian: [{ deg: 0, w: 5 }, { deg: 3, w: 4 }, { deg: 6, w: 3 }, { deg: 2, w: 2 }, { deg: 4, w: 1 }],
};

/**
 * The upper structures a pad may voice over a chord's root (indices into `chordTones`: 1 = 3rd,
 * 2 = 5th, 3 = 7th, 4 = 9th). Open, add9-flavoured sets; the 9th is skipped where it would sit a
 * semitone above the root (a ♭9 rubs in a pad).
 */
const UPPERS: ReadonlyArray<readonly number[]> = [[1, 2, 4], [1, 3, 4], [1, 2, 3], [2, 3, 4], [1, 2, 4]];

/** Pitch classes of the pad's three upper voices for a chord, picked by `r` (0 ≤ r < 1). */
export function upperPcs(mode: ModeId, deg: number, r: number, tonic = TONIC): number[] {
  const tones = chordTones(mode, deg, tonic);
  const flat9 = pc(tones[4]! - tones[0]!) === 1;
  const sets = flat9 ? UPPERS.filter((s) => !s.includes(4)) : UPPERS;
  const set = sets[Math.min(sets.length - 1, Math.floor(r * sets.length))]!;
  return set.map((k) => pc(tones[k]!));
}

/** The MIDI note of pitch class `p` nearest to `ref`, then moved by octaves into [lo, hi]. */
export function nearestIn(p: number, ref: number, lo: number, hi: number): number {
  let m = ref + (((p - pc(ref) + 6) % 12 + 12) % 12) - 6;
  while (m < lo) m += 12;
  while (m > hi) m -= 12;
  return m;
}

function permutations(n: number): number[][] {
  if (n <= 1) return [[0]];
  const out: number[][] = [];
  for (const p of permutations(n - 1)) for (let i = 0; i < n; i++) out.push([...p.slice(0, i), n - 1, ...p.slice(i)]);
  return out;
}

/** What a voicing costs beyond its motion: unisons are forbidden, semitones rub, whole tones blur a little. */
function clashCost(notes: readonly number[]): number {
  const s = [...notes].sort((a, b) => a - b);
  let c = 0;
  for (let i = 1; i < s.length; i++) {
    const d = s[i]! - s[i - 1]!;
    if (d === 0) c += 100;
    else if (d === 1) c += 8;
    else if (d === 2) c += 1;
  }
  return c;
}

/**
 * Voice the pitch classes `pcs` in [lo, hi] as close as possible to the previous voicing `prev`
 * (the same number of voices; the first chord is spread evenly over the range): every
 * assignment of pitch classes to voices is tried (3! or 4!), each voice takes the nearest octave,
 * and the total motion plus the clash cost decides. Returns the notes, ascending.
 */
export function voiceLead(prev: readonly number[], pcs: readonly number[], lo: number, hi: number): number[] {
  const n = pcs.length;
  const ref = prev.length === n ? prev : Array.from({ length: n }, (_, i) => lo + ((i + 0.5) * (hi - lo)) / n);
  let best: number[] = [];
  let bestCost = Infinity;
  for (const perm of permutations(n)) {
    const notes = perm.map((j, i) => nearestIn(pcs[j]!, Math.round(ref[i]!), lo, hi));
    let cost = clashCost(notes);
    for (let i = 0; i < n; i++) cost += Math.abs(notes[i]! - ref[i]!);
    if (cost < bestCost) { bestCost = cost; best = notes; }
  }
  return best.sort((a, b) => a - b);
}

/**
 * The melody's ladder in each mode: the degrees it walks on, within an octave. Pentatonic at
 * heart (no semitone steps), plus the mode's colour note where it sings: Lydian's ♯4 and major
 * 7th, Dorian's major 6th.
 */
export const LADDERS: Record<ModeId, readonly number[]> = {
  lydian: [0, 1, 2, 3, 4, 6],
  ionian: [0, 1, 2, 4, 5],
  mixolydian: [0, 1, 2, 4, 6],
  dorian: [0, 2, 3, 4, 5, 6],
};

/** MIDI pitch of rung `i` of a mode's melody ladder (rung 0 = the tonic D4; negative rungs go down). */
export function ladderMidi(mode: ModeId, i: number, tonic = TONIC): number {
  const l = LADDERS[mode];
  return degreeMidi(mode, l[mod(i, l.length)]! + 7 * Math.floor(i / l.length), tonic);
}

/** The rung of a mode's ladder nearest to a MIDI note (ties go down). */
export function ladderRung(mode: ModeId, midi: number, tonic = TONIC): number {
  const l = LADDERS[mode].length;
  let i = Math.floor(((midi - tonic) / 12) * l);
  while (ladderMidi(mode, i + 1, tonic) <= midi) i++;
  while (ladderMidi(mode, i, tonic) > midi) i--;
  const lo = ladderMidi(mode, i, tonic), hi = ladderMidi(mode, i + 1, tonic);
  return midi - lo <= hi - midi ? i : i + 1;
}
