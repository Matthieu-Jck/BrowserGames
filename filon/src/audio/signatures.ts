// signatures.ts — every building's sound signature (D120), pure: which signature a building has,
// how loud each one is, how its two variants differ, how the distance to the camera fades it, and
// how a frame's signatures are merged and spaced. A signature is a short sound evocative of the
// machine (a drill's thud and grind, a smelter's whoosh of fire, a trade post's bell…) that plays
// twice in its life: fuller when the building stands (placed on the claim, or when its kite lands
// off it), softer and shorter when the player selects it — the same sound, so the ear learns it.
// The recipes themselves are in signature-sfx.ts; the shell (app/sound.ts) says when and where.
//
// The table goes by building kind, overridden by id: a new building gets its kind's signature
// without a line here (`signatureOf`, tested over every building of the content).
import type { BuildingId } from '@/content/buildings';
import { BUILDINGS } from '@/content/buildings';
import type { BuildingDef, BuildingKind } from '@/content/types';
import { clamp } from '@/core/math';

export type Signature =
  | 'heart' | 'drill' | 'bore' | 'earth' | 'cutter' | 'pump' | 'sand'
  | 'smelter' | 'electric' | 'press' | 'wind' | 'solar' | 'steam'
  | 'lab' | 'server' | 'trade' | 'silo' | 'line' | 'pole';

/** Built (the fuller one) or picked (selected: softer and shorter). */
export type SigVariant = 'build' | 'pick';

export interface SigSpec {
  /** Trims (dB) of the recipe, build then pick: the per-signature level knobs. */
  readonly trimDb: readonly [build: number, pick: number];
  /**
   * The quiet family (line pieces, poles): its build click joins the placement's thunk instead of
   * taking its place, and a ribbon drag's own ticks stand for it.
   */
  readonly quiet: boolean;
  /**
   * Peaks measured alone at full sliders through the master chain, build then pick (dBFS; the
   * offline render of scripts/sound-levels.mjs). Every one stays under −6 dBFS; update them when a
   * recipe or a trim changes.
   */
  readonly peakDb: readonly [build: number, pick: number];
}

const sig = (build: number, pick: number, peakBuild: number, peakPick: number, quiet = false): SigSpec =>
  ({ trimDb: [build, pick], quiet, peakDb: [peakBuild, peakPick] });

// Built, a machine peaks around −13.5 dBFS at full sliders (the airy and high ones a little lower:
// they read louder), just under the placement thunk it replaces; picked, around −22 (the glint it
// replaces was −23). The quiet family sits 12 dB under the machines.
export const SIGNATURES: Record<Signature, SigSpec> = {
  heart: sig(3, -5, -13.5, -22),
  drill: sig(-1, -7, -13, -22),
  bore: sig(0, -6.5, -13, -22),
  earth: sig(3, 1, -13.5, -22),
  cutter: sig(3, -2, -13.5, -22),
  pump: sig(1, -0.5, -13.5, -22),
  sand: sig(4, -1, -14, -23),
  smelter: sig(4, 1.5, -13.5, -22),
  electric: sig(-1, -9, -13.5, -22),
  press: sig(2, -2, -13.5, -22),
  wind: sig(7, 0, -15, -23.5),
  solar: sig(4, -3, -15, -23.5),
  steam: sig(-0.5, -4, -13.5, -22),
  lab: sig(0.5, 0.5, -15, -23.5),
  server: sig(0.5, -1, -15, -23.5),
  trade: sig(0.5, -1, -13.5, -22),
  silo: sig(-3, -7.5, -13.5, -22),
  line: sig(1.5, -4.5, -26, -32, true),
  pole: sig(1, -5, -26, -32, true),
};

/** Each kind's signature: what a building of that kind sounds like unless its id says otherwise. */
export const KIND_SIGNATURE: Record<BuildingKind, Signature> = {
  hearth: 'heart',
  drill: 'drill',
  excavator: 'earth',
  backfiller: 'earth',
  pump: 'pump',
  machine: 'press',
  lab: 'lab',
  server: 'server',
  generator: 'steam',
  geothermal: 'steam',
  wind: 'wind',
  solar: 'solar',
  accumulator: 'electric',
  storage: 'silo',
  trade: 'trade',
  sink: 'smelter',
  belt: 'line',
  fork: 'line',
  crossing: 'line',
  bridge: 'line',
  conduit: 'line',
  fence: 'line',
  pole: 'pole',
};

/** Buildings that do not sound like their kind. */
export const ID_SIGNATURE: Partial<Record<BuildingId, Signature>> = {
  // Drills of another sort: the deep ones, the sand, the quartz face (the data antennas went with the data, D122).
  deep_bore: 'bore',
  giant_drill: 'bore',
  sand_collector: 'sand',
  face_cutter: 'cutter',
  // Machines that burn, hum, grind glass or sift.
  kiln: 'smelter',
  kiln_compact: 'smelter',
  ceramic_oven: 'smelter',
  steel_mill: 'smelter', // D123: the converter roars like a furnace; the brickworks presses (its kind's)
  electric_smelter: 'electric',
  arc_furnace: 'electric',
  cell_charger: 'electric',
  etcher: 'electric',
  chip_fab: 'electric',
  optics_workshop: 'solar',
  sifter: 'sand',
  // Generators: batteries hum, the Sunheart shines; the steam boiler is the kind's (the coal
  // generator, a furnace's roar, left the game with D143).
  cell_generator: 'electric',
  sunheart: 'solar',
};

/** The signature of a building, by its id. */
export function signatureOf(id: string): Signature {
  const over = (ID_SIGNATURE as Record<string, Signature | undefined>)[id];
  if (over) return over;
  const def = (BUILDINGS as Record<string, BuildingDef | undefined>)[id];
  return def ? KIND_SIGNATURE[def.kind] : 'press';
}

/** By building index (the order of the content's table, as `Ent.def`). */
export const SIG_OF_DEF: readonly Signature[] = Object.keys(BUILDINGS).map(signatureOf);

/**
 * The two variants: `len` scales the decays, `gapMs` is the least time between two plays of the
 * same signature in that variant. A pick is the signature at 60 % of its length, without the
 * build's extra layers (a set-down, a second stroke, more room), and ~8 dB softer (its trims).
 */
export const VARIANTS: Record<SigVariant, { readonly len: number; readonly gapMs: number }> = {
  build: { len: 1, gapMs: 250 },
  pick: { len: 0.6, gapMs: 180 },
};

/** Least time between two picks of any signature (clicking from building to building does not stack them). */
export const PICK_GAP_MS = 120;
/** The quiet family's build waits longer: pieces laid one by one over a drag click once or twice, not per piece. */
export const QUIET_BUILD_GAP_MS = 450;
/** At most this many signatures in one frame (a blueprint landing, a drag of mixed pieces). */
export const MAX_SIGS_PER_FRAME = 2;
/** Under this gain (after the spatial fade) a signature is not worth playing. */
export const MIN_SIG_GAIN = 0.05;

/**
 * How loud a building is from where the camera looks: `u`, `v` its offset from the screen's centre
 * in half-screens (±1 at the edges), `zoom` the camera's. Full in the middle 60 %, falling to a
 * third at the edges and to nothing a half-screen beyond them; zoomed out (zoom < 1) everything is
 * farther, down to 55 %. `floor`: the least gain anywhere (the player's own act — a placement, a
 * selection from a list — is always heard a little); a kite landing has none (near the camera only).
 */
export function spatialGain(u: number, v: number, zoom: number, floor = 0): number {
  if (!Number.isFinite(u) || !Number.isFinite(v)) return floor;
  const d = Math.max(Math.abs(u), Math.abs(v));
  const near = d <= 0.6 ? 1 : d <= 1 ? 1 - (d - 0.6) / 0.4 * (2 / 3) : Math.max(0, (1 / 3) * (1 - (d - 1) / 0.5));
  const far = clamp(0.55 + 0.45 * (Number.isFinite(zoom) ? zoom : 1), 0.55, 1);
  return Math.max(floor, near * far);
}

/** Stereo position for an offset `u` (half-screens): half way to the side at the edge. */
export const spatialPan = (u: number): number => (Number.isFinite(u) ? clamp(u * 0.5, -0.6, 0.6) : 0);

export interface QueuedSig {
  sig: Signature;
  variant: SigVariant;
  /** The spatial fade (0 … 1). */
  gain: number;
  pan: number;
  /** How many buildings it stands for (a drag of routers…). */
  n: number;
}

/**
 * The signatures of one frame, as they should play: one per signature and variant (the loudest
 * one's place, counts summed), the inaudible dropped, builds before picks, then the loudest
 * first, at most `MAX_SIGS_PER_FRAME`.
 */
export function mergeSignatures(batch: readonly QueuedSig[]): QueuedSig[] {
  const merged = new Map<string, QueuedSig>();
  for (const q of batch) {
    if (!(q.gain >= MIN_SIG_GAIN)) continue;
    const key = `${q.sig}.${q.variant}`;
    const m = merged.get(key);
    if (!m) merged.set(key, { ...q });
    else {
      m.n += q.n;
      if (q.gain > m.gain) { m.gain = q.gain; m.pan = q.pan; }
    }
  }
  const all = [...merged.values()];
  const order = (q: QueuedSig): number => (q.variant === 'build' ? 0 : 1);
  // A stable sort (first come first among equals): builds, then by gain.
  return all
    .map((q, i) => ({ q, i }))
    .sort((a, b) => order(a.q) - order(b.q) || b.q.gain - a.q.gain || a.i - b.i)
    .slice(0, MAX_SIGS_PER_FRAME)
    .map((x) => x.q);
}

/** Spaces the signatures: each by its variant's gap (the quiet family's builds by `QUIET_BUILD_GAP_MS`), and picks by `PICK_GAP_MS` across all of them. */
export class SigLimiter {
  private readonly last = new Map<string, number>();
  private lastPick = -Infinity;

  /** May this signature play at `now` (seconds)? Records it when it may. */
  allow(s: Signature, variant: SigVariant, now: number): boolean {
    const key = `${s}.${variant}`;
    const prev = this.last.get(key);
    const gap = variant === 'build' && SIGNATURES[s].quiet ? QUIET_BUILD_GAP_MS : VARIANTS[variant].gapMs;
    if (prev !== undefined && now - prev < gap / 1000 - 1e-9) return false;
    if (variant === 'pick' && now - this.lastPick < PICK_GAP_MS / 1000 - 1e-9) return false;
    this.last.set(key, now);
    if (variant === 'pick') this.lastPick = now;
    return true;
  }
}
