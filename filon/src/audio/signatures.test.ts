import { describe, it, expect } from 'vitest';
import { BUILDINGS } from '@/content/buildings';
import type { BuildingDef } from '@/content/types';
import type { SfxCue } from '@/core/bus';
import { CUES } from './cues';
import { dbToGain, MIX } from './levels';
import { RECIPES, type SfxKit } from './sfx';
import { SIG_RECIPES } from './signature-sfx';
import {
  ID_SIGNATURE, KIND_SIGNATURE, MAX_SIGS_PER_FRAME, mergeSignatures, PICK_GAP_MS, QUIET_BUILD_GAP_MS, SIG_OF_DEF, SigLimiter, SIGNATURES,
  signatureOf, spatialGain, spatialPan, VARIANTS, type QueuedSig, type Signature, type SigVariant,
} from './signatures';

const IDS = Object.keys(BUILDINGS);
const ALL = Object.keys(SIGNATURES) as Signature[];

describe('building signatures: the table (D120)', () => {
  it('every building has a signature, by kind or by id, and every signature is someone’s', () => {
    expect(SIG_OF_DEF).toHaveLength(IDS.length);
    for (const id of IDS) expect(SIGNATURES[signatureOf(id)], id).toBeDefined();
    for (const id of Object.keys(ID_SIGNATURE)) expect(IDS, `override for a building that is not there: ${id}`).toContain(id);
    const used = new Set(IDS.map(signatureOf));
    for (const s of ALL) expect(used.has(s), `no building sounds like ${s}`).toBe(true);
    for (const s of Object.values(KIND_SIGNATURE)) expect(SIGNATURES[s]).toBeDefined();
  });

  it('the machines sound as the brief says', () => {
    const want: Record<string, Signature> = {
      hearth: 'heart', drill: 'drill', fast_drill: 'drill', deep_bore: 'bore', kiln: 'smelter', electric_smelter: 'electric',
      wire_mill: 'press', press: 'press', wind_flower: 'wind', sun_bulb: 'solar', steam_boiler: 'steam', pump: 'pump',
      observatory: 'lab', server: 'server', trade_post: 'trade', face_cutter: 'cutter', ribbon: 'line', router: 'line', mast: 'pole',
    };
    for (const [id, s] of Object.entries(want)) if (IDS.includes(id)) expect(signatureOf(id), id).toBe(s);
  });

  it('a building the table does not name takes its kind’s signature', () => {
    for (const id of IDS) {
      if ((ID_SIGNATURE as Record<string, unknown>)[id]) continue;
      expect(signatureOf(id), id).toBe(KIND_SIGNATURE[(BUILDINGS as Record<string, BuildingDef>)[id]!.kind]);
    }
    expect(signatureOf('no_such_building')).toBe('press');
  });

  it('every signature was measured under −6 dBFS at full sliders; a pick is softer than the build; the quiet family is quiet', () => {
    const loudestQuiet = Math.max(...ALL.filter((s) => SIGNATURES[s].quiet).map((s) => SIGNATURES[s].peakDb[0]));
    const softestMachine = Math.min(...ALL.filter((s) => !SIGNATURES[s].quiet).map((s) => SIGNATURES[s].peakDb[0]));
    for (const s of ALL) {
      const [build, pick] = SIGNATURES[s].peakDb;
      expect(build, s).toBeLessThanOrEqual(-6);
      expect(build, s).toBeLessThan(MIX.limiter);
      expect(pick, s).toBeLessThan(build - 3);
      expect(pick, s).toBeGreaterThan(-40);
      // Never louder than a placement's thunk, which it may take the place of.
      expect(build, s).toBeLessThanOrEqual(CUES.place.peakDb);
    }
    expect(loudestQuiet).toBeLessThan(softestMachine - 6);
    expect(VARIANTS.pick.len).toBeLessThan(VARIANTS.build.len);
  });
});

describe('building signatures: restraint', () => {
  const q = (sig: Signature, variant: SigVariant = 'build', gain = 1, n = 1, pan = 0): QueuedSig => ({ sig, variant, gain, pan, n });

  it('a drag of 40 pieces in one frame is one click; counts add up and the loudest one’s place wins', () => {
    const batch = Array.from({ length: 40 }, (_, i) => q('line', 'build', 0.4 + i / 100, 1, i / 40));
    const m = mergeSignatures(batch);
    expect(m).toHaveLength(1);
    expect(m[0]!.n).toBe(40);
    expect(m[0]!.gain).toBeCloseTo(0.79, 9);
    expect(m[0]!.pan).toBeCloseTo(39 / 40, 9);
  });

  it('at most two signatures a frame: builds first, then the loudest; the inaudible dropped', () => {
    const m = mergeSignatures([q('lab', 'pick', 1), q('drill', 'build', 0.3), q('smelter', 'build', 0.9), q('press', 'build', 0.6), q('pump', 'build', 0.01), q('silo', 'build', Number.NaN)]);
    expect(m.map((x) => x.sig)).toEqual(['smelter', 'press']);
    expect(m.length).toBeLessThanOrEqual(MAX_SIGS_PER_FRAME);
    expect(mergeSignatures([])).toEqual([]);
    expect(mergeSignatures([q('pump', 'build', 0.01)])).toEqual([]);
  });

  it('the limiter spaces each signature, and picks across all of them', () => {
    const r = new SigLimiter();
    expect(r.allow('drill', 'build', 1)).toBe(true);
    expect(r.allow('drill', 'build', 1.1)).toBe(false);
    expect(r.allow('smelter', 'build', 1.1)).toBe(true); // another building
    expect(r.allow('drill', 'build', 1 + VARIANTS.build.gapMs / 1000)).toBe(true);
    expect(r.allow('drill', 'pick', 2)).toBe(true);
    expect(r.allow('lab', 'pick', 2 + PICK_GAP_MS / 2000)).toBe(false); // clicking from building to building fast
    expect(r.allow('lab', 'pick', 2 + PICK_GAP_MS / 1000)).toBe(true);
    expect(r.allow('drill', 'pick', 2 + PICK_GAP_MS / 1000 + 0.01)).toBe(false); // its own gap is longer
  });

  it('pieces laid one a frame over a whole drag click once or twice, not per piece', () => {
    const r = new SigLimiter();
    let n = 0;
    for (let i = 0; i < 40; i++) if (r.allow('line', 'build', i / 60)) n++;
    expect(n).toBeGreaterThanOrEqual(1);
    expect(n).toBeLessThanOrEqual(2);
    expect(QUIET_BUILD_GAP_MS).toBeGreaterThan(VARIANTS.build.gapMs);
  });

  it('repeated selections of the same building do not stack', () => {
    const r = new SigLimiter();
    let n = 0;
    for (let i = 0; i < 20; i++) if (r.allow('trade', 'pick', i * 0.05)) n++; // twenty clicks in a second
    expect(n).toBeLessThanOrEqual(Math.ceil(1000 / VARIANTS.pick.gapMs));
  });

  it('the spatial fade: full in the middle, a third at the edges, nothing past half a screen beyond', () => {
    expect(spatialGain(0, 0, 1)).toBe(1);
    expect(spatialGain(0.5, -0.5, 1)).toBe(1);
    expect(spatialGain(1, 0, 1)).toBeCloseTo(1 / 3, 9);
    expect(spatialGain(0, -1.5, 1)).toBe(0);
    expect(spatialGain(4, 0, 1)).toBe(0);
    expect(spatialGain(4, 0, 1, 0.35)).toBe(0.35); // the player's own act is always heard a little
    expect(spatialGain(Number.NaN, 0, 1, 0.2)).toBe(0.2);
    let prev = 2;
    for (let d = 0; d <= 2; d += 0.05) { const g = spatialGain(d, d / 2, 1); expect(g).toBeLessThanOrEqual(prev + 1e-12); prev = g; }
    expect(spatialGain(0, 0, 0.5)).toBeCloseTo(0.775, 9); // zoomed out, everything is farther…
    expect(spatialGain(0, 0, 0)).toBeCloseTo(0.55, 9); // …down to 55 %
    expect(spatialGain(0, 0, 3)).toBe(1);
    expect(spatialPan(0)).toBe(0);
    expect(spatialPan(1)).toBe(0.5);
    expect(spatialPan(-9)).toBe(-0.6);
    expect(spatialPan(Number.NaN)).toBe(0);
  });
});

// ── the recipes, rendered into a recording context ─────────────────────────────────────────────
// Node has no Web Audio: this fake context records what the recipes ask for (nodes, every value
// written to an audio parameter, sources' start and stop, the strike envelopes), so a recipe that
// writes a NaN, never stops a source, or rings too long fails here. The real levels are measured
// in Chrome (scripts/sound-levels.mjs).

interface Strike { t0: number; peak: number; tau: number }

class Rec {
  readonly bad: string[] = [];
  readonly strikes: Strike[] = [];
  readonly sources: Array<{ start: number; stop: number }> = [];
}

class FakeParam {
  private v: number;
  private ramp: { v: number; t: number } | null = null;
  constructor(private readonly rec: Rec, v = 0) { this.v = v; }
  private check(...xs: number[]): void { for (const x of xs) if (!Number.isFinite(x)) this.rec.bad.push(`non-finite ${x}`); }
  get value(): number { return this.v; }
  set value(x: number) { this.check(x); this.v = x; }
  setValueAtTime(x: number, t: number): this { this.check(x, t); return this; }
  linearRampToValueAtTime(x: number, t: number): this { this.check(x, t); this.ramp = { v: x, t }; return this; }
  exponentialRampToValueAtTime(x: number, t: number): this { this.check(x, t); if (x <= 0) this.rec.bad.push('exponential ramp to 0'); return this; }
  setTargetAtTime(x: number, t: number, tau: number): this {
    this.check(x, t, tau);
    if (!(tau > 0)) this.rec.bad.push(`time constant ${tau}`);
    if (x === 0 && this.ramp && Math.abs(this.ramp.t - t) < 1e-9) this.rec.strikes.push({ t0: t, peak: this.ramp.v, tau });
    return this;
  }
  cancelScheduledValues(): this { return this; }
}

class FakeNode {
  constructor(protected readonly rec: Rec) {}
  connect<T>(d: T): T { if (d === undefined || d === null) this.rec.bad.push('connect to nothing'); return d; }
  disconnect(): void {}
}

class FakeSource extends FakeNode {
  private at = Number.NaN;
  start(t = 0, _offset = 0, dur?: number): void {
    this.at = t;
    if (dur !== undefined) this.rec.sources.push({ start: t, stop: t + dur });
  }
  stop(t: number): void { this.rec.sources.push({ start: this.at, stop: t }); }
  addEventListener(): void {}
}

class FakeOsc extends FakeSource {
  type: OscillatorType = 'sine';
  readonly frequency: FakeParam;
  readonly detune: FakeParam;
  constructor(rec: Rec) { super(rec); this.frequency = new FakeParam(rec, 440); this.detune = new FakeParam(rec); }
  setPeriodicWave(): void {}
}

class FakeBufferSource extends FakeSource {
  buffer: unknown = null;
  readonly playbackRate: FakeParam;
  constructor(rec: Rec) { super(rec); this.playbackRate = new FakeParam(rec, 1); }
}

function fakeKit(rec: Rec, harmony: readonly number[]): SfxKit {
  const out = new FakeNode(rec), wet = new FakeNode(rec);
  const param = (v = 0): FakeParam => new FakeParam(rec, v);
  const ctx = {
    currentTime: 0, sampleRate: 48000,
    createOscillator: () => new FakeOsc(rec),
    createBufferSource: () => new FakeBufferSource(rec),
    createGain: () => Object.assign(new FakeNode(rec), { gain: param(1) }),
    createBiquadFilter: () => Object.assign(new FakeNode(rec), { type: 'lowpass', frequency: param(350), Q: param(1), gain: param() }),
    createStereoPanner: () => Object.assign(new FakeNode(rec), { pan: param() }),
  };
  return {
    ctx: ctx as unknown as BaseAudioContext, out: out as unknown as AudioNode, wet: wet as unknown as AudioNode,
    noise: { duration: 3 } as AudioBuffer, offset: () => 0.5, harmony: () => harmony,
  };
}

/** The envelopes' sum, sampled every millisecond: an upper bound of the voices' summed amplitude. */
function summedPeak(strikes: readonly Strike[], t: number): number {
  let top = 0;
  for (let x = t; x < t + 1.2; x += 0.001) {
    let s = 0;
    for (const k of strikes) if (x >= k.t0) s += k.peak * Math.exp(-(x - k.t0) / k.tau);
    top = Math.max(top, s);
  }
  return top;
}

/** When the loudest part has fallen 26 dB (3 τ): the length the ear hears. */
const audible = (strikes: readonly Strike[], t: number): number => Math.max(0, ...strikes.map((k) => k.t0 + 3 * k.tau)) - t;

const CHORDS: ReadonlyArray<readonly number[]> = [[2, 6, 9, 4], [4, 7, 11], [7, 11, 2, 6], [0, 4, 7], []];

describe('building signatures: the recipes (rendered into a recording context)', () => {
  const T = 1;
  const render = (s: Signature, variant: SigVariant, harmony: readonly number[]): Rec => {
    const rec = new Rec(), v = VARIANTS[variant];
    SIG_RECIPES[s](fakeKit(rec, harmony), T, { g: dbToGain(SIGNATURES[s].trimDb[variant === 'build' ? 0 : 1]), len: v.len, full: variant === 'build', pan: 0.3 });
    return rec;
  };

  it('no NaN anywhere, every source starts on time and stops, in every chord', () => {
    for (const s of ALL) {
      for (const variant of ['build', 'pick'] as const) {
        for (const h of CHORDS) {
          const r = render(s, variant, h);
          expect(r.bad, `${s} ${variant}`).toEqual([]);
          expect(r.strikes.length, `${s} ${variant}`).toBeGreaterThan(0);
          for (const src of r.sources) {
            expect(src.start, `${s} ${variant}`).toBeGreaterThanOrEqual(T);
            expect(src.stop, `${s} ${variant}`).toBeGreaterThan(src.start);
            expect(src.stop - T, `${s} ${variant}: a source rings on`).toBeLessThan(2.5);
          }
        }
      }
    }
  });

  it.skipIf(!process.env.SIG_REPORT)('report', () => {
    for (const s of ALL) console.log(s, ['build', 'pick'].map((v) => { const r = render(s, v as SigVariant, CHORDS[0]!); return `${audible(r.strikes, T).toFixed(2)}s ${summedPeak(r.strikes, T).toFixed(2)}`; }).join(' | '));
  });

  it('a machine’s signature lasts 0.2–0.6 s built, shorter picked; the quiet family is a click', () => {
    for (const s of ALL) {
      const build = audible(render(s, 'build', CHORDS[0]!).strikes, T), pick = audible(render(s, 'pick', CHORDS[0]!).strikes, T);
      if (SIGNATURES[s].quiet) {
        expect(build, s).toBeLessThan(0.15);
      } else {
        expect(build, s).toBeGreaterThanOrEqual(0.2);
        expect(build, s).toBeLessThanOrEqual(0.65);
        expect(pick, s).toBeGreaterThanOrEqual(0.1);
      }
      expect(pick, s).toBeLessThan(build);
    }
  });

  it('even summed at their peaks, a signature’s voices stay well under full scale', () => {
    for (const s of ALL) {
      const b = summedPeak(render(s, 'build', CHORDS[0]!).strikes, T), p = summedPeak(render(s, 'pick', CHORDS[0]!).strikes, T);
      expect(b, s).toBeLessThan(0.8);
      expect(p, s).toBeLessThan(b);
    }
  });

  it('the cues, with their new modulation option, still render clean', () => {
    for (const cue of Object.keys(RECIPES) as SfxCue[]) {
      const rec = new Rec();
      RECIPES[cue](fakeKit(rec, CHORDS[1]!), T, 5, dbToGain(CUES[cue].trimDb));
      expect(rec.bad, cue).toEqual([]);
    }
  });
});
