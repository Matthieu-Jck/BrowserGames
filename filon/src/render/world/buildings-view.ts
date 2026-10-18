// buildings-view.ts — sprites for placed entities, in both views. Each building has an iso
// volume (iso world px, in the shared depth-sorted layer with the cliffs) and a plan sprite
// (tile units, on the plan plane); the layers fade one into the other as the view morphs.
// Ribbons are straight or corner pieces chosen from what actually feeds them in the compiled
// graph (a single feeder on a side makes a bend — a ribbon, a router, a machine's outlet, a
// bridge), drawn top-down in tile units, flat on the ground in either view; a straight piece
// fed from a side opens its rail there (an inlet). A piece on rock lies on its column's top in
// iso, among the volumes (`layBelt`; world/stand.ts `beltZ`), and flat in plan; a traction ribbon
// that hands on a terrace up or down gets its lift against the wall between (traction-lifts.ts), a
// conduit pouring a terrace down its downpipe (D114, the same file). A skybridge's deck spans the
// gap to its far end, lifted above the ground in iso. Sorters show their chosen item.
//
// Updated on structural changes, entity by entity (D92): each entity keeps its sprites with what
// they were drawn from (`sigOf`: its kind, place, turn, stand, piece, lift, look…), and a change
// re-draws only the entities whose drawing changed — the one placed, the neighbours whose bends
// and inlets it changed — so placing a ribbon on a base of 25 000 entities costs a few sprites,
// not 40 000. Ties among equal depth keys go by rank (the entity's id, then the order its sprites
// are laid: `tie`), the order a rebuild from scratch lays them in, so what an update draws is
// what a full rebuild draws (`rebuildAll`). Off screen, an entity's sprites are `culled` by
// 16-tile buckets (`cull`, when the view's range of buckets changes) and its moving part stops
// swapping textures.
//
// Moving parts (art/recipes/moving.ts: the wind turbine's crown, the sand collector's wheel):
// such a building shows its body alone and, as a second sprite, its part, whose texture steps
// through phases baked at boot (`animate`, per frame: a few texture swaps on the same atlas
// page — no repaint, no upload, no re-batch). In iso the part is stacked just over or under the
// body as its rotation brings it nearer or farther; in plan it lies over it.
//
// Cast shadows (iso): each building lays a shadow on the ground (`shadows` layer, under every
// volume): its own recipe drawn along the light into a silhouette, baked the first time that
// building and rotation show up (a DynAtlas), then only stretched, swung and faded with the time
// of day (world/cast-shadows.ts) — one matrix per sprite when the sun has moved enough, one alpha
// (their container is a render group: its alpha is a uniform, set when its 8-bit value changes).
//
// Standing on the mountains (D44; world/stand.ts, worked out once per rebuild): a building on rock
// is lifted to the top of the column under it — its sprite, its moving part, its shadow, its chosen
// item — and sorts with the cliffs by its stand's key, so the column under it never covers it and
// higher rock in front still hides it. Its shadow then lies on the rock top among the volumes (just
// under it, over the rock it falls on) instead of on the ground layer far below. In plan it lies
// flat like everything else, with a short ink shadow on the map for a hint of its height.
//
// The incinerator (D51) is a pit (world/pits.ts): in iso its back and its near rim as two sprites
// with its flame between them (an item tipping in sinks between them too: the items view), the
// flame stepped per frame from the pit's fire (`animate`); in plan its sprite and, over it, the
// flame seen from above, faded in with the fire.
//
// The plan layer is sorted like the volumes (world/stand.ts `PLAN_Z`): the plan copies of the
// ribbons on rock and the elevators' marks under the items riding them, the buildings over all.
//
// Switched off (D83; world/work-look.ts): a production building that does not work — no power,
// starved, backed up, no recipe, no grid — shows its unlit art (art/unlit.ts: its lamps and
// furnace mouths dark glass, the body greyed and darker) in both views, its moving part still and
// greyed. The unlit pictures are baked the first time one is needed (a DynAtlas of their own, a
// few ms a frame at most; until then a grey tint stands in), then a look that flips is a texture
// swap on its sprites — `WorkLook` reports the flips, sampled once per game tick.
//
// The neighbouring bases (D110, sim/world/neighbours.ts; laid by world/neighbours-view.ts as they
// come near the view): their buildings with the same art as the claim's, tinted a little towards
// their emblem's colour, their ribbons as laid (bends from the line's own turns), their flag waving
// by their lift pad. Kept apart from the claim's records (`foreign`): a rebuild leaves them be,
// another colony drops them (`foreignEpoch`). Their moving parts turn steadily, the turbines with
// the open desert's wind: they always work.
import { Container, Matrix, Sprite, type Texture } from 'pixi.js';
import { BUILDING_IDS, BUILDING_KIND, ITEM_IDS, buildingDef } from '@/content/registry';
import type { BuildingId } from '@/content/buildings';
import { filterOf } from '@/sim/cfg';
import type { Sim } from '@/sim/state';
import { DX, DY, opposite, type Ent, type Rot } from '@/sim/types';
import { footprint } from '@/sim/entities';
import { tileIndex } from '@/sim/world/grid';
import { TPS, WORLD } from '@/sim/constants';
import { turbineWind, weatherAt, type Producer } from '@/sim/power/network';
import { CAMO_VENT_KEY, bKey, bodyKey, btKey, beltKey, iKey, inletKey, partKey, type Atlas } from '../art/atlas';
import { DynAtlas, type DynFrame } from '../art/dyn-atlas';
import { BELT_PX, BELT_TIERS, type BeltTier } from '../art/recipes/belts';
import { SKY, artLevelOf, drawBuildingShadow, isoHead, shadowFrameOf, type SkyPiece } from '../art/recipes/buildings';
import { MOVING } from '../art/recipes/moving';
import { drawOff } from '../art/recipes/off';
import { silhouette } from '../art/silhouette';
import { C, mix, num } from '../art/tokens';
import type { Grade } from '../daynight';
import { LH, TH, TW, tileToIso } from '../iso';
import { tileTop } from '../relief';
import { SHADOW_DX, SHADOW_DY, seamClip, shadowLook, shadowMap } from './cast-shadows';
import { spinSeed, windTurns, workTurns } from './moving-parts';
import { OFF_TINT, WorkLook, looksAtWork } from './work-look';
import { ISO_K, PLAN_K, skyFrames } from './sky-decks';
import { PLAN_Z, SPAN_DZ, beltZ, buildingZ, computeStands, deckSquareZ, liftOf, liftZ, rampZ, riseOffset, standOf, type Stand } from './stand';
import { PIT_ISO_K, PIT_PLAN_K, PIT_Z, flameFrames, flameLevel, flicker, pitFire, pitFrames, planFlameFrame } from './pits';
import { LIFT_ISO_K, LIFT_PLAN_K, fallFrames, fallOfConduit, liftFrames, liftOfBelt, type Fall, type Lift } from './traction-lifts';
import { FLAG, FLAG_K, flagFrames, type FlagFrames } from './heart-flag';
import { defaultEmblem, emblemKey, type Emblem } from '@/content/emblem';
import { ribbonRuns } from './neighbour-goods';

/** The shadows' colour: ink with a little lilac (Moebius shadows are cool on the warm sand); also the plan's hint of height. */
export const SHADOW_TINT = num(mix(C.ink, C.lilacD, 0.3));

/** A skybridge deck's height above its ends' ground (iso world px): the art's running surface (`SKY.deck`), which items ride. */
export const DECK_Z = SKY.deck * LH;

/** One buried tile in five wears a vent (D109): a fixed hash of the tile, not of the frame. */
const camoVent = (x: number, y: number): boolean => ((Math.imul(x, 0x45d9f3b) ^ Math.imul(y, 0x2c1b3c6d)) >>> 0) % 5 === 0;

const tierOf = (def: number): BeltTier | null => {
  const id = BUILDING_IDS[def]!;
  return id in BELT_TIERS ? (id as BeltTier) : null;
};

/** Sorting key shared with the relief (a building on the floor; one above it sorts by its stand: world/stand.ts). */
export { buildingZ } from './stand';

/** Plan: how dark the hint of height is under a building standing above the floor (its offset: `riseOffset`). */
const RISE_ALPHA = 0.3;

/** A neighbouring base's turbines see the open desert's wind (D110: no wind map of theirs), its machines turn this fast (turns a second). */
const OPEN_DESERT: readonly [number, number, number] = [1000, 1000, 1000];
const FOREIGN_TURNS = 0.5;

/** Dormant (its unlock given up, its land lost): a grey wash, like an unpainted model. */
const DORMANT_TINT = 0x9b97a8;
/** Baking time (ms) a frame may spend on unlit pictures; the rest wait for the next frame. */
const OFF_BAKE_MS = 6;

/**
 * Ties among equal depth keys (D92). A rebuild from scratch laid every sprite in entity order, and a
 * sorted layer keeps equal keys in the order laid; an update lays a re-drawn entity's sprites last.
 * So every sprite here sorts at its key less a hair that grows down with its rank — the entity's id
 * × 16 plus the order its sprites are laid, then the skybridges' spans and the flag, laid after every
 * entity — and lands where a full rebuild lays it. Just UNDER the key: the other views' sprites at
 * the very key (the lights' solar overlays, the junctions' passages, laid after the buildings) stay
 * after them. `TIE × TIE_TOP` = 2⁻⁸ tile-keys at most, under the smallest gap between two keys
 * (0.01: an elevator's car and front frame); exact in a double for every key of a 1024-tile world.
 */
const TIE = 2 ** -36;
const TIE_TOP = 2 ** 28;
/** The ranks laid after every entity's (ids below 2²³ keep under them): the skybridges' spans, then the flag. */
const DECK_RANK = TIE_TOP - 2 ** 21;
const FLAG_RANK = TIE_TOP - 2 ** 4;
const tie = (key: number, rank: number): number => key - TIE * (TIE_TOP - rank);

/** Culling (D92): entities are bucketed by the 16-tile square their origin is in; a bucket shows when it is this close (tiles) to the view's rect — room for tall art standing on the mountains and the longest shadows. */
const BUCKET = 16;
const BUCKETS = WORLD / BUCKET;
const CULL_MARGIN = 12;

/** Over this many sprites leaving one layer at once, the layer is emptied and refilled (one pass) instead of removing each (a search through the layer each). */
const BULK = 48;

/** A building whose look says whether it works (D83): its sprites, what they show lit, the look applied. */
interface Look {
  ent: number;
  id: BuildingId;
  dormant: boolean;
  /** Its body sprites (iso, plan): their atlas key lit, the art's rotation, whether the key is a moving building's body. */
  views: Array<{ s: Sprite; key: string; iso: boolean; rot: Rot; body: boolean }>;
  parts: Sprite[];
  /** Switched off (as applied); waiting for an unlit picture to be baked; its sprites gone (re-drawn or removed). */
  off: boolean;
  waits: boolean;
  dead: boolean;
}

/**
 * Which belt piece a ribbon tile shows: straight, or a bend when its only feeder sits on one
 * side (none behind) — read from the compiled graph, so what is drawn is what is connected.
 */
export function beltPiece(sim: Sim, e: Ent): { corner: boolean; rot: Rot; mirror: boolean } {
  const r = e.rot;
  const fed = sim.graph?.feedDirs.get(tileIndex(e.x, e.y)) ?? 0;
  const straight = { corner: false, rot: r, mirror: false };
  if (!fed || fed & (1 << opposite(r))) return straight;
  const sides = ([((r + 1) & 3), ((r + 3) & 3)] as Rot[]).filter((s) => fed & (1 << s));
  if (sides.length !== 1) return straight;
  const enter = opposite(sides[0]!);
  return { corner: true, rot: enter, mirror: r === ((enter + 3) & 3) };
}

/** Texture px → tile units for a belt piece at (x, y): centred, turned, mirrored. */
export function beltMatrix(x: number, y: number, rot: Rot, mirror: boolean): Matrix {
  return new Matrix()
    .translate(-BELT_PX / 2, -BELT_PX / 2)
    .scale((mirror ? -1 : 1) / BELT_PX, 1 / BELT_PX)
    .rotate((rot * Math.PI) / 2)
    .translate(x + 0.5, y + 0.5);
}

/** Layers a ribbon piece goes on: the ground (on the floor), the volumes (iso px) and the plan (tile units) on rock. */
export interface BeltLayers { ground: Container; volumes: Container; plan: Container }

/**
 * Lay a ribbon piece (a belt texture) on tile (x, y), whose top is `lv` relief levels up: on the
 * floor, one sprite on the ground plane (both views); on rock, one on the column's top in iso,
 * sorted among the volumes (`beltZ`, minus `dz`: a junction's passage goes under its bridge), and
 * one flat in plan (owner, 2026-10-13: ribbons on the mountains were drawn at the floor, under the rock).
 * `z` turns each sprite's depth key into its zIndex (the buildings view's ties, in laying order).
 */
export function layBelt(tex: Texture, x: number, y: number, rot: Rot, mirror: boolean, lv: number, to: BeltLayers, dz = 0, z: (key: number) => number = (k) => k): Sprite[] {
  const m = beltMatrix(x, y, rot, mirror);
  const s = new Sprite(tex);
  s.setFromMatrix(m);
  if (lv <= 0) { s.zIndex = z(0); to.ground.addChild(s); return [s]; }
  s.zIndex = z(PLAN_Z.belt); // under the items riding it, and the plan buildings
  to.plan.addChild(s);
  const iso = new Sprite(tex);
  iso.setFromMatrix(new Matrix(TW / 2, TH / 2, -TW / 2, TH / 2, 0, -lv * LH).append(m));
  iso.zIndex = z(beltZ(x, y) - dz);
  to.volumes.addChild(iso);
  return [s, iso];
}

/** A moving part in the world: its sprites (iso, plan) with their phases, and how it turns. */
interface Spinner {
  ent: number;
  /** A wind turbine (turns with the wind on its grid) or a machine (turns while it works). */
  wind: boolean;
  /** Under construction or dormant: it does not turn. */
  still: boolean;
  /** Phases per period, periods per turn (the part's symmetry), this building's speed factor. */
  n: number;
  sym: number;
  vary: number;
  /** Where it is in its period [0, 1), how fast it goes now (periods per second), the phase it is at, the phase its sprites show. */
  phase: number;
  rate: number;
  k: number;
  shown: number;
  /** Off screen (culled): it turns on, its sprites wait. */
  culled: boolean;
  sprites: Array<{ s: Sprite; tex: Texture[] }>;
  /** A neighbouring base's (D110): it always works. */
  foreign?: boolean;
}

/** A cast shadow: its sprite, where it was laid (iso world px) and its building's foot, the stretch's centre. */
interface Shade { s: Sprite; x: number; y: number; cx: number; cy: number }
/** A shadow on a rock top, among the volumes: its own alpha (its base, × the day's look). */
interface LiftShade { s: Sprite; a: number; ent: number }
/** An incinerator's pit: its flame (iso, among the volumes) and its plan glow, the heat shown. */
interface Pit { ent: number; flame: Sprite; glow: Sprite | null; heat: number }
/** A traction elevator's car (iso): its sprite, its y at the foot of its shaft, its low tile. */
interface Car { s: Sprite; y0: number; x: number; y: number }

/**
 * What one entity is drawn with — or one group: the skybridges' spans, the claim's flag — kept until
 * what it was drawn from (`sig`) changes. `rank`: its next sprite's rank (`tie`); `bucket`: its
 * culling square (−1: never culled).
 */
interface Rec {
  sig: string;
  ent: number;
  rank: number;
  sprites: Sprite[];
  bucket: number;
  culled: boolean;
  shadows: Shade[];
  liftShadows: LiftShade[];
  spinner: Spinner | null;
  look: Look | null;
  pit: Pit | null;
  car: Car | null;
  seen: number;
}

const newRec = (sig: string, ent: number, rank: number, bucket: number): Rec => ({
  sig, ent, rank, sprites: [], bucket, culled: false, shadows: [], liftShadows: [], spinner: null, look: null, pit: null, car: null, seen: 0,
});

/** The children of `layer` but those in `gone`, in their order: the layer emptied and refilled in one pass. */
function removeMany(layer: Container, gone: ReadonlySet<Container>): void {
  const keep = layer.children.filter((c) => !gone.has(c));
  layer.removeChildren();
  for (const c of keep) layer.addChild(c);
}

export class BuildingsView {
  /** Each entity's sprites, by id; the skybridges' spans and the flag, as groups; the colony they show. */
  private readonly recs = new Map<number, Rec>();
  private decks: Rec | null = null;
  private flagRec: Rec | null = null;
  private of: Sim | null = null;
  private pass = 0;
  /** The record being laid: the sprites made go to it, ranked in laying order. */
  private cur: Rec | null = null;
  private readonly spinners = new Set<Spinner>();
  /** Game time of the last `animate` (s); local wind ‰ of each turbine on a grid, by graph version. */
  private lastSec = -1;
  private windVer = -1;
  private readonly windLocal = new Map<number, Producer>();
  /** Cast shadows: their sprites (iso world px), their masks, the look last applied (length, swing, quantised), the shadows laid since. */
  private readonly shadowRoot = new Container({ label: 'buildings:shadows', isRenderGroup: true });
  private readonly shadowSheet = new DynAtlas();
  private readonly shadows = new Set<Shade>();
  private fresh: Shade[] = [];
  /** The shadows of buildings standing above the floor: among the volumes (`objects`), each with its own alpha (its base, × the look's). */
  private readonly liftShadows = new Set<LiftShade>();
  private liftAlpha = -1;
  /** The shadows' container alpha as the batcher packs it (8 bits). */
  private rootAlpha = -1;
  private lookL = -1;
  private lookA = 0;
  private readonly mat = new Matrix();
  /**
   * The ribbons on the floor: their own sorted container on the ground layer (laid in rank order,
   * under the junctions' passages). It and the shadows' container are render groups (D92): the
   * terrain's chunks streaming in as the camera pans re-batch the graded world, but not the tens of
   * thousands of ribbon pieces and shadows of a big base; their own changes (a cull, a building laid)
   * re-batch only themselves.
   */
  private readonly beltRoot = new Container({ label: 'buildings:belts', isRenderGroup: true });
  /** The traction elevators' cars (iso). */
  private readonly cars = new Set<Car>();
  /** How high each car stands above its low tile's top (levels), per frame: the items view's (belt-lift.ts `carAt`). */
  carHeight: ((x: number, y: number) => number) | null = null;
  /** Entities kept out of sight across rebuilds (the intro: the Heart until it lands, D31). */
  private readonly hidden = new Set<number>();
  /** The incinerators' pits. */
  private readonly pits = new Set<Pit>();
  /** Which production buildings look at work (D83), sampled per game tick; the lights view reads it too. */
  readonly work = new WorkLook();
  /** Each watched building's look, by entity; those waiting for an unlit picture; the unlit pictures. */
  private readonly looks = new Map<number, Look>();
  private waiting: Look[] = [];
  private readonly offSheet = new DynAtlas();
  /** Culling: the records of each bucket and whether it is culled; the range of buckets shown (null: everything, until the first `cull`). */
  private readonly buckets = new Map<number, { recs: Set<Rec>; off: boolean }>();
  private range: [number, number, number, number] | null = null;
  /** Sprites laid and removed by the last update (perf, tests). */
  lastUpdate = { laid: 0, removed: 0, entities: 0 };
  /** The neighbouring bases laid (D110), by key (their hub parcel), and their flags; bumped when they are all dropped (another colony). */
  private readonly foreign = new Map<number, Rec[]>();
  /** Each neighbouring base's ribbon tiles and the record that draws each (its goods ride only on a drawn one). */
  private readonly foreignRibbons = new Map<number, Map<number, Rec>>();
  private foreignFlags: Array<{ s: Sprite; frames: FlagFrames; k: number }> = [];
  foreignEpoch = 0;

  constructor(
    beltLayer: Container,
    private readonly objectLayer: Container,
    private readonly planLayer: Container,
    private readonly atlas: Atlas,
    shadowLayer?: Container,
  ) {
    objectLayer.sortableChildren = true;
    planLayer.sortableChildren = true;
    this.beltRoot.sortableChildren = true;
    this.shadowRoot.sortableChildren = true;
    beltLayer.addChild(this.beltRoot);
    shadowLayer?.addChild(this.shadowRoot);
    this.shadowRoot.visible = false;
  }

  /**
   * After a structural change: re-draw the entities whose drawing changed (`sigOf`), drop the
   * sprites of those gone, lay the new ones; the skybridges' spans and the flag likewise. Another
   * colony (a debug base swapped in, an import) starts from nothing.
   */
  rebuild(sim: Sim): void {
    if (sim !== this.of) { this.clear(true); this.of = sim; }
    sim.ensureCompiled(); // the ribbons' bends come from the graph
    this.work.rebuild(sim);
    this.heartLv = sim.hearthLevel; // the Heart's look (D86): a new level comes with a structure event, so a rebuild
    const stands = computeStands(sim); // who stands on the mountains, how high, how it sorts (once per rebuild)
    const pass = ++this.pass;
    const gone: Rec[] = [];
    const todo: Array<{ e: Ent; sig: string; st: Stand | undefined }> = [];
    for (const e of sim.ents.sorted()) {
      const st = stands.get(e.id);
      const sig = this.sigOf(sim, e, st);
      const r = this.recs.get(e.id);
      if (r && r.sig === sig) { r.seen = pass; continue; }
      if (r) { gone.push(r); this.recs.delete(e.id); }
      todo.push({ e, sig, st });
    }
    for (const [id, r] of this.recs) if (r.seen !== pass) { gone.push(r); this.recs.delete(id); }
    const deckSig = this.deckSig(sim);
    const decksNew = deckSig !== (this.decks?.sig ?? '');
    if (decksNew && this.decks) { gone.push(this.decks); this.decks = null; }
    const flagSig = this.flagSig(sim, stands);
    const flagNew = flagSig !== (this.flagRec?.sig ?? '');
    if (flagNew && this.flagRec) { gone.push(this.flagRec); this.flagRec = null; }
    const removed = this.drop(gone);
    let laid = 0;
    for (const t of todo) {
      const r = newRec(t.sig, t.e.id, t.e.id * 16, this.bucketOf(t.e.x, t.e.y));
      this.cur = r;
      const kind = BUILDING_KIND[t.e.def]!;
      if (kind === 'belt' || kind === 'conduit') this.addBelt(sim, t.e);
      else this.addBuilding(t.e, sim.isDormant(t.e), t.st);
      this.recs.set(t.e.id, r);
      this.adopt(r);
      if (this.hidden.has(t.e.id)) for (const s of r.sprites) s.visible = false;
      r.seen = pass;
      laid += r.sprites.length;
    }
    if (decksNew && deckSig) {
      this.decks = this.cur = newRec(deckSig, -1, DECK_RANK, -1);
      this.addDecks(sim);
      this.adopt(this.decks);
      laid += this.decks.sprites.length;
    }
    if (flagNew && flagSig) {
      this.flagRec = this.cur = newRec(flagSig, sim.hearthId, FLAG_RANK, -1);
      this.addFlag(sim, stands);
      this.adopt(this.flagRec);
      laid += this.flagRec.sprites.length;
    }
    this.cur = null;
    this.kept.clear();
    if (laid || removed) this.liftAlpha = -1; // the lifted shadows' alpha and visibility, laid again
    this.shadowSheet.flush();
    this.lastUpdate = { laid, removed, entities: todo.length };
  }

  /** Throw every sprite away and draw the colony from scratch (what `rebuild` must match: the shots' check, tests). */
  rebuildAll(sim: Sim): void {
    // The neighbouring bases stay (D110): laid once, they never depend on the claim's entities.
    this.clear(sim !== this.of);
    this.of = sim;
    this.rebuild(sim);
  }

  /** Spinners of the sprites just dropped, by entity: a re-drawn building keeps its part where it was in its turn. */
  private readonly kept = new Map<number, Spinner>();
  /** The Heart's level at the last rebuild: the look its sprites wear (art `artLevelOf`, D86). */
  private heartLv = 1;

  /**
   * What an entity's sprites are drawn from: if any of it changes, the entity is re-drawn. A
   * building: its kind, place and turn, built or not, dormant or not, where it stands, the look it
   * wears (the Heart's level), the item it shows (sorters). A ribbon: its kind, place,
   * its piece (bend, turn, mirror), its inlets, its tile's height and its elevator.
   */
  private sigOf(sim: Sim, e: Ent, st: Stand | undefined): string {
    const kind = BUILDING_KIND[e.def]!;
    if (kind === 'belt' || kind === 'conduit') {
      const p = beltPiece(sim, e);
      const fed = p.corner ? 0 : (sim.graph?.feedDirs.get(tileIndex(e.x, e.y)) ?? 0) & ((1 << ((e.rot + 3) & 3)) | (1 << ((e.rot + 1) & 3)));
      const l = this.liftOf(sim, e), fl = this.fallOf(sim, e);
      return `r${e.def},${e.x},${e.y},${e.rot},${+p.corner}${p.rot}${+p.mirror},${fed},${tileTop(sim.grid, e.x, e.y)}${l?.shaft ? `,${l.rot}${+l.up},${l.x},${l.y},${l.low}` : ''}${fl ? `,f${fl.low},${fl.h}` : ''}`;
    }
    const id = BUILDING_IDS[e.def]! as BuildingId;
    const logic = buildingDef(e.def).logic;
    const item = logic === 'sorter' || logic === 'inverted' ? filterOf(e.cfg, 0) : -1;
    return `b${e.def},${e.x},${e.y},${e.rot},${+(e.builtAt !== 0)}${+sim.isDormant(e)},${st ? `${st.level},${st.z}` : ''},${artLevelOf(id, this.heartLv)},${item}`;
  }

  private liftOf(sim: Sim, e: Ent): Lift | null {
    return liftOfBelt(sim.grid, (x, y) => sim.ents.get(sim.grid.occ[tileIndex(x, y)]!)?.def ?? -1, e);
  }

  /** A conduit's fall one terrace down (D114, traction-lifts.ts `fallOfConduit`), or null. */
  private fallOf(sim: Sim, e: Ent): Fall | null {
    return fallOfConduit(sim.grid, (x, y) => sim.ents.get(sim.grid.occ[tileIndex(x, y)]!)?.def ?? -1, e);
  }

  /** The culling square of a tile. */
  private bucketOf(x: number, y: number): number {
    const bx = Math.max(0, Math.min(BUCKETS - 1, Math.floor(x / BUCKET))), by = Math.max(0, Math.min(BUCKETS - 1, Math.floor(y / BUCKET)));
    return by * BUCKETS + bx;
  }

  /** A record just laid: its parts registered, its bucket joined (culled at once if off screen). */
  private adopt(r: Rec): void {
    for (const sh of r.shadows) { this.shadows.add(sh); this.fresh.push(sh); }
    for (const l of r.liftShadows) this.liftShadows.add(l);
    if (r.spinner) this.spinners.add(r.spinner);
    if (r.look) this.looks.set(r.ent, r.look);
    if (r.pit) this.pits.add(r.pit);
    if (r.car) this.cars.add(r.car);
    this.joinBucket(r);
  }

  /** A record into its culling square (culled or shown as the square is). */
  private joinBucket(r: Rec): void {
    if (r.bucket < 0) return;
    let b = this.buckets.get(r.bucket);
    if (!b) {
      const bx = r.bucket % BUCKETS, by = (r.bucket - bx) / BUCKETS, g = this.range;
      b = { recs: new Set(), off: !!g && (bx < g[0] || bx > g[2] || by < g[1] || by > g[3]) };
      this.buckets.set(r.bucket, b);
    }
    b.recs.add(r);
    if (b.off !== r.culled) this.setCulled(r, b.off);
  }

  /** Records gone: their sprites taken off their layers (in one pass where many leave one layer) and destroyed, their parts forgotten. The sprites removed. */
  private drop(recs: readonly Rec[]): number {
    if (!recs.length) return 0;
    const byLayer = new Map<Container, Set<Container>>();
    let n = 0;
    for (const r of recs) {
      for (const s of r.sprites) {
        const p = s.parent;
        if (!p) continue;
        let set = byLayer.get(p);
        if (!set) byLayer.set(p, (set = new Set()));
        set.add(s);
        n++;
      }
      for (const sh of r.shadows) this.shadows.delete(sh);
      for (const l of r.liftShadows) this.liftShadows.delete(l);
      if (r.spinner) { this.spinners.delete(r.spinner); this.kept.set(r.ent, r.spinner); }
      if (r.look) { r.look.dead = true; if (this.looks.get(r.ent) === r.look) this.looks.delete(r.ent); }
      if (r.pit) this.pits.delete(r.pit);
      if (r.car) this.cars.delete(r.car);
      if (r.bucket >= 0) this.buckets.get(r.bucket)?.recs.delete(r);
      if (r.culled) this.nCulled--;
    }
    for (const [layer, set] of byLayer) if (set.size > BULK) removeMany(layer, set);
    for (const r of recs) for (const s of r.sprites) s.destroy();
    if (this.fresh.length) this.fresh = this.fresh.filter((sh) => this.shadows.has(sh));
    if (this.waiting.length) this.waiting = this.waiting.filter((L) => !L.dead);
    return n;
  }

  /** Forget every sprite (another colony, or a full rebuild: the neighbouring bases' only with `foreign`, another colony). */
  private clear(foreign = true): void {
    const all = [...this.recs.values()];
    if (this.decks) all.push(this.decks);
    if (this.flagRec) all.push(this.flagRec);
    if (foreign) {
      for (const rs of this.foreign.values()) all.push(...rs);
      this.foreign.clear();
      this.foreignRibbons.clear();
      this.foreignFlags = [];
      this.foreignEpoch++;
    }
    this.recs.clear();
    this.decks = null;
    this.flagRec = null;
    this.drop(all); // their moving parts kept by entity (`kept`), as they were before a full rebuild
    this.buckets.clear();
    if (!foreign) for (const rs of this.foreign.values()) for (const r of rs) this.joinBucket(r);
    this.lookL = -1;
    this.liftAlpha = -1;
  }

  /** A sprite of the record being laid, on a layer at depth key `key` (its zIndex: the key and its rank, `tie`). */
  private lay(s: Sprite, layer: Container, key: number): Sprite {
    const r = this.cur!;
    s.zIndex = tie(key, r.rank++);
    layer.addChild(s);
    r.sprites.push(s);
    return s;
  }

  /** The zIndex of the record's next sprite at a key (for sprites laid by `layBelt`). */
  private readonly z = (key: number): number => tie(key, this.cur!.rank++);

  /**
   * Per frame, with the view's tile rect: the buckets near it shown, the others culled — only when
   * the range of buckets changes (a culled sprite is not drawn, and its render group re-batches
   * once). The margin covers what stands up from its footprint (art on the mountains, lifts) and
   * the longest shadows.
   */
  cull(view: readonly [number, number, number, number]): void {
    const clampB = (v: number): number => Math.max(0, Math.min(BUCKETS - 1, Math.floor(v / BUCKET)));
    const bx0 = clampB(view[0] - CULL_MARGIN), by0 = clampB(view[1] - CULL_MARGIN);
    const bx1 = clampB(view[2] + CULL_MARGIN), by1 = clampB(view[3] + CULL_MARGIN);
    const g = this.range;
    if (g && g[0] === bx0 && g[1] === by0 && g[2] === bx1 && g[3] === by1) return;
    this.range = [bx0, by0, bx1, by1];
    for (const [b, bk] of this.buckets) {
      const bx = b % BUCKETS, by = (b - bx) / BUCKETS;
      const off = bx < bx0 || bx > bx1 || by < by0 || by > by1;
      if (off === bk.off) continue;
      bk.off = off;
      for (const r of bk.recs) this.setCulled(r, off);
    }
  }

  private setCulled(r: Rec, off: boolean): void {
    if (r.culled === off) return;
    r.culled = off;
    this.nCulled += off ? 1 : -1;
    for (const s of r.sprites) s.culled = off;
    const sp = r.spinner;
    if (!sp) return;
    sp.culled = off;
    if (!off && sp.shown !== sp.k) { sp.shown = sp.k; for (const p of sp.sprites) p.s.texture = p.tex[sp.k]!; }
  }

  /** Entities drawn, and how many of them are culled (perf, tests). */
  cullStats(): { entities: number; culled: number } {
    return { entities: this.recs.size, culled: this.nCulled };
  }
  private nCulled = 0;

  /**
   * Per frame, with the game time (s): turn the moving parts. A turbine on a grid turns with
   * the wind it sees (local ‰ × gust ‰), one on no grid idles, a machine's part turns while it
   * works; speeds ease towards their target over a second or so (a gust spins the crowns up).
   * Paused, game time stands and nothing turns. Cost: a little arithmetic per part, and a
   * texture swap when its phase changes (on screen: one culled turns on, its sprites wait).
   */
  animate(sim: Sim, seconds: number, grade?: Grade): void {
    if (grade) this.shade(grade);
    this.lookAtWork(sim);
    this.waveFlag(sim, seconds);
    // The elevators' cars, where the items view last left them.
    if (this.carHeight) for (const c of this.cars) c.s.position.y = c.y0 - this.carHeight(c.x, c.y) * LH;
    if (this.pits.size) this.burn(sim, seconds * TPS);
    const dt = this.lastSec < 0 ? 0 : seconds - this.lastSec;
    this.lastSec = seconds;
    if (!this.spinners.size || dt <= 0) return;
    const step = Math.min(dt, 0.25); // a jump (catch-up, a hidden tab) turns it no more than a frame's worth
    const g = sim.graph;
    if (g && g.version !== this.windVer) {
      this.windVer = g.version;
      this.windLocal.clear();
      for (const net of g.nets) for (const p of net.producers) if (p.kind === 'wind') this.windLocal.set(p.ent, p);
    }
    const w = weatherAt(sim.absEpoch(), sim.worldSeed, sim.mods);
    for (const sp of this.spinners) {
      let turns = 0;
      if (sp.foreign) turns = sp.wind ? windTurns(turbineWind(OPEN_DESERT, w)) : FOREIGN_TURNS; // a neighbouring base always works (D110)
      else if (sp.still || !this.work.isLit(sp.ent)) turns = 0; // switched off: nothing moves (D83)
      else if (sp.wind) {
        const p = this.windLocal.get(sp.ent);
        turns = p === undefined ? 0 : windTurns(turbineWind(p.local, w), p.curve?.cutIn, p.curve?.cutOut);
      } else {
        const node = g?.nodeByEnt.get(sp.ent);
        turns = node ? workTurns(node.status, node.net >= 0 ? sim.ctx.sat[node.net] ?? 0 : 0, node.kind === 'generator') : 0; // a generator flat out on a short grid (D114)
      }
      sp.rate += (turns * sp.sym * sp.vary - sp.rate) * Math.min(1, step * 1.5);
      sp.phase = (sp.phase + sp.rate * step) % 1;
      sp.k = Math.floor(sp.phase * sp.n) % sp.n;
      if (sp.k === sp.shown || sp.culled) continue;
      sp.shown = sp.k;
      for (const p of sp.sprites) p.s.texture = p.tex[sp.k]!;
    }
  }

  /** Moving parts in the world (perf, tests). */
  get movingCount(): number { return this.spinners.size; }

  /**
   * Per frame: the looks that flipped since the last game tick (`WorkLook.sample`), applied; the
   * buildings still waiting for their unlit picture, retried within the frame's baking budget.
   */
  private lookAtWork(sim: Sim): void {
    for (const id of this.work.sample(sim)) {
      const L = this.looks.get(id);
      if (L) this.applyLook(L, !this.work.isLit(id));
    }
    if (this.waiting.length) {
      const still = this.waiting;
      this.waiting = [];
      for (const L of still) { L.waits = false; if (L.off && !L.dead) this.applyLook(L, true); }
    }
    this.offSheet.flush();
  }

  /**
   * Show a building lit or switched off: its body sprites swap to their unlit pictures (baked now if
   * the frame's budget allows; else a grey tint stands in and it waits), its moving part is greyed.
   */
  private applyLook(L: Look, off: boolean): void {
    L.off = off;
    const base = L.dormant ? DORMANT_TINT : 0xffffff;
    let waits = false;
    for (const v of L.views) {
      const tex = off ? this.unlit(v.key, L.id, v.iso, v.rot, v.body) : this.atlas.textures.get(v.key) ?? null;
      if (tex) { if (v.s.texture !== tex) v.s.texture = tex; v.s.tint = base; }
      else { v.s.tint = L.dormant ? DORMANT_TINT : OFF_TINT; waits = true; }
    }
    for (const p of L.parts) p.tint = L.dormant ? DORMANT_TINT : off ? OFF_TINT : 0xffffff;
    if (waits && !L.waits) { L.waits = true; this.waiting.push(L); }
  }

  /**
   * A building's unlit picture for an atlas key (its whole frame, the same anchor: a texture swap),
   * baked the first time (recipes/off.ts `drawOff`). Null when this frame's baking budget is spent.
   */
  private unlit(key: string, id: BuildingId, iso: boolean, rot: Rot, body: boolean): Texture | null {
    const got = this.offSheet.get(key);
    if (got) return got.tex;
    const fr = this.atlas.frames.get(key);
    if (!fr || this.offSheet.spent > OFF_BAKE_MS) return null;
    return this.offSheet.add(key, fr.w, fr.h, fr.ox, fr.oy, (ctx) => drawOff(ctx, id, rot, iso, body, fr.w, fr.h)).tex;
  }

  /** Watched buildings, how many look switched off, how many unlit pictures are baked (debug, smoke). */
  workLook(): { watched: number; off: number; baked: number; waiting: number } {
    return { ...this.work.counts(), baked: this.offSheet.size, waiting: this.waiting.length };
  }

  /**
   * Per frame, at render tick `t`: each pit's flame from its fire (world/pits.ts) — its height and
   * flicker in iso (a texture swap on the pits' own sheet when it changes), its plan glow's alpha.
   */
  private burn(sim: Sim, t: number): void {
    const fire = pitFire(sim);
    fire.update(sim, t);
    const frames = flameFrames(), v = flicker(fire.tick);
    for (const p of this.pits) {
      const h = this.hidden.has(p.ent) ? 0 : Math.round(fire.heat(p.ent) * 40) / 40;
      const lv = flameLevel(h);
      if (lv < 0) { if (p.flame.visible) p.flame.visible = false; }
      else {
        const tex = frames[lv]![v]!.tex;
        if (p.flame.texture !== tex) p.flame.texture = tex;
        if (!p.flame.visible) p.flame.visible = true;
      }
      if (p.glow && h !== p.heat) { p.glow.alpha = 0.95 * h; p.glow.visible = h > 0.02; }
      p.heat = h;
    }
  }

  /**
   * An incinerator's pit (iso, world/pits.ts): its back at its key, its flame over it (hidden
   * until something burns), its near rim over that — an item tipping in is drawn between them.
   */
  private addPit(e: Ent, rot: Rot, wx: number, wy: number, alpha: number, tint: number, z: number): void {
    const fr = pitFrames(rot);
    const lay = (tex: Texture, ox: number, oy: number, dz: number): Sprite => {
      const s = new Sprite(tex);
      s.scale.set(PIT_ISO_K);
      s.position.set(wx - ox * PIT_ISO_K, wy - oy * PIT_ISO_K);
      s.alpha = alpha;
      s.tint = tint;
      return this.lay(s, this.objectLayer, z + dz);
    };
    lay(fr.back.tex, fr.back.ox, fr.back.oy, 0);
    const f0 = flameFrames()[0]![0]!;
    const flame = lay(f0.tex, f0.ox, f0.oy, PIT_Z.flame);
    flame.visible = false;
    flame.tint = 0xffffff;
    lay(fr.front.tex, fr.front.ox, fr.front.oy, PIT_Z.front);
    this.cur!.pit = { ent: e.id, flame, glow: null, heat: -1 };
  }

  /** The plan view's flame over a pit's plan sprite (faded in with its fire by `burn`). */
  private addPitGlow(e: Ent): void {
    const fr = planFlameFrame();
    const s = new Sprite(fr.tex);
    s.scale.set(PIT_PLAN_K);
    s.position.set(e.x - fr.ox * PIT_PLAN_K, e.y - fr.oy * PIT_PLAN_K);
    s.alpha = 0;
    s.visible = false;
    this.lay(s, this.planLayer, 0);
    const p = this.cur!.pit;
    if (p && p.ent === e.id) p.glow = s;
  }

  /**
   * The cast shadows for the time of day: their opacity (one alpha on their container, set when
   * its 8-bit value changes; none at night), and — when the sun has moved enough to show — their
   * length and swing, one matrix per sprite (a linear map about its building's foot); the shadows
   * laid since get the look of the moment.
   */
  private shade(g: Grade): void {
    const look = shadowLook(g.hour, g.night);
    const on = look.alpha > 0.01 && this.shadows.size > 0;
    this.shadowRoot.visible = on;
    // The lifted ones lie among the volumes, out of the container: their alpha one by one (few), when it shows a change.
    const la = on ? Math.round(look.alpha * 256) : 0;
    if (la !== this.liftAlpha) {
      this.liftAlpha = la;
      for (const l of this.liftShadows) { l.s.visible = la > 0 && !this.hidden.has(l.ent); l.s.alpha = (la / 256) * l.a; }
    }
    if (!on) return;
    // The container is a render group: its alpha is one uniform. Set as the batcher packed it when it
    // was a plain container (⌊α·255⌋ / 255), and only when that value moves (D92).
    const qa = Math.floor(look.alpha * 255);
    if (qa !== this.rootAlpha) { this.rootAlpha = qa; this.shadowRoot.alpha = qa / 255; }
    const L = Math.round(look.length * 80), A = Math.round(look.angle * 160);
    const all = L !== this.lookL || A !== this.lookA;
    if (!all && !this.fresh.length) return;
    this.lookL = L;
    this.lookA = A;
    const [a, b, c, d] = shadowMap(L / 80, A / 160);
    for (const sh of all ? this.shadows : this.fresh) {
      const px = sh.x - sh.cx, py = sh.y - sh.cy;
      sh.s.setFromMatrix(this.mat.set(a, b, c, d, sh.cx + a * px + c * py, sh.cy + b * px + d * py));
    }
    this.fresh = [];
  }

  /**
   * A building's shadow mask for a rotation, baked the first time (1 px per world px: half the
   * sprites' scale): only the far side of the seam through its foot (cast-shadows.ts `seamClip`),
   * so the day's stretch about the foot never pushes any of it towards the sun.
   */
  private shadowMask(id: BuildingId, rot: Rot, lv = 1): DynFrame {
    const key = `${id}:${rot}:${lv}`;
    const got = this.shadowSheet.get(key);
    if (got) return got;
    const f = shadowFrameOf(id, rot, SHADOW_DX, SHADOW_DY);
    const [fx, fy] = f.pr(f.rw / 2, f.rh / 2, 0); // the foot: the footprint's centre on the ground (atlas px)
    return this.shadowSheet.add(key, f.SW / 2, f.SH / 2, f.ox / 2, f.oy / 2, (ctx) => {
      const clip = seamClip(fx / 2, fy / 2, f.SW + f.SH);
      ctx.beginPath();
      ctx.moveTo(clip[0]![0], clip[0]![1]);
      for (const [x, y] of clip) ctx.lineTo(x, y);
      ctx.closePath();
      ctx.clip();
      ctx.scale(0.5, 0.5);
      drawBuildingShadow(id, rot, SHADOW_DX, SHADOW_DY, silhouette(ctx), lv);
    });
  }

  /**
   * A building's cast shadow (iso), anchored on its footprint, faint while it is built. On the
   * floor it lies on the ground layer, under every volume; standing above the floor (`st`) it
   * lies on the rock top at its level, among the volumes just under the building (key − 0.3:
   * after the rock it falls on, under its moving part too), hidden until the day's look is set.
   */
  private addShadow(e: Ent, id: BuildingId, rot: Rot, alpha: number, st?: Stand, look = 1): void {
    const fr = this.shadowMask(id, rot, look);
    const s = new Sprite(fr.tex);
    s.tint = SHADOW_TINT;
    const lv = st?.level ?? 0;
    const [ax, ay] = tileToIso(e.x, e.y, lv);
    const [w, h] = footprint(e.def, e.rot);
    const [cx, cy] = tileToIso(e.x + w / 2, e.y + h / 2, lv);
    s.position.set(ax - fr.ox, ay - fr.oy);
    const r = this.cur!;
    if (st) {
      s.visible = false;
      this.lay(s, this.objectLayer, st.z - 0.3);
      r.liftShadows.push({ s, a: alpha, ent: e.id });
    } else {
      s.alpha = alpha;
      this.lay(s, this.shadowRoot, 0);
    }
    r.shadows.push({ s, x: ax - fr.ox, y: ay - fr.oy, cx, cy });
  }

  /** Hide a building's sprites (both views) until `show`; it stays hidden through rebuilds. */
  hide(id: number): void {
    this.hidden.add(id);
    for (const s of this.owned(id)) s.visible = false;
  }

  show(id: number): void {
    this.hidden.delete(id);
    for (const s of this.owned(id)) s.visible = true;
  }

  isHidden(id: number): boolean {
    return this.hidden.has(id);
  }

  /** An entity's sprites, both views (the Heart's flag with the Heart). */
  private owned(id: number): Sprite[] {
    const own = this.recs.get(id)?.sprites ?? [];
    return this.flagRec && this.flagRec.ent === id ? [...own, ...this.flagRec.sprites] : own;
  }

  /**
   * Per frame: nothing to move. A skybridge's span is drawn as the buildings are — iso volumes
   * among them, plan sprites with theirs (`addDecks`) — so the layers' cross-fade carries it
   * through the morph; the frame still calls this at its place in the order.
   */
  setPlanness(t: number): void {
    void t;
  }

  /** The skybridge pairs the spans are drawn from (`addDecks`): when it changes, the spans are laid again. */
  private deckSig(sim: Sim): string {
    if (!sim.graph) return '';
    let s = '';
    for (const [t, g] of sim.graph.jumps) {
      const x = t % WORLD, y = (t - x) / WORLD;
      const e = sim.entityAt(x, y);
      if (!e || BUILDING_KIND[e.def] !== 'bridge') continue;
      const gx = g % WORLD, gy = (g - gx) / WORLD;
      const far = sim.entityAt(gx, gy);
      if (!far || BUILDING_KIND[far.def] !== 'bridge' || far.rot !== e.rot) continue;
      s += `${e.id}:${t}>${g},${e.rot},${liftOf(e)},${standOf(e)?.z ?? ''},${far.id}:${liftOf(far)},${standOf(far)?.z ?? ''};`;
    }
    return s;
  }

  /**
   * The span of every skybridge pair (an end whose graph target is the next end ahead,
   * `graph.jumps`): the start's ramp up, the deck over each square between, the far end's ramp
   * down (world/sky-decks.ts, baked on demand), at the ends' height (an end standing on rock lifts
   * its pair). Iso: volumes among the buildings — a ramp just after the end on its square (it lies
   * over the footing and draws the end's gantry over itself), a deck square after whatever stands
   * on it — so the line the bridge crosses, on the ground layers, runs under it, and the items
   * riding it are drawn over it (items view). Plan: over the plan's buildings. Shadows: with the
   * buildings', laid along the light by the day.
   */
  private addDecks(sim: Sim): void {
    if (!sim.graph) return;
    const r = this.cur!;
    const lay = (piece: SkyPiece, x: number, y: number, rot: Rot, level: number, z: number, ent: number): void => {
      const fr = skyFrames(piece, rot, SHADOW_DX, SHADOW_DY);
      const [wx, wy] = tileToIso(x, y, level);
      const iso = new Sprite(fr.iso.tex);
      iso.scale.set(ISO_K);
      iso.position.set(wx - fr.iso.ox * ISO_K, wy - fr.iso.oy * ISO_K);
      this.lay(iso, this.objectLayer, z);
      const plan = new Sprite(fr.plan.tex);
      plan.scale.set(PLAN_K);
      plan.position.set(x - fr.plan.ox * PLAN_K, y - fr.plan.oy * PLAN_K);
      this.lay(plan, this.planLayer, 0);
      const sh = new Sprite(fr.shadow.tex);
      sh.tint = SHADOW_TINT;
      sh.position.set(wx - fr.shadow.ox, wy - fr.shadow.oy);
      const [cx, cy] = tileToIso(x + 0.5, y + 0.5, level);
      if (level > 0) {
        // On the rock top, as a lifted building's shadow: among the volumes, just under the span.
        sh.visible = false;
        this.lay(sh, this.objectLayer, z - SPAN_DZ - 0.3);
        r.liftShadows.push({ s: sh, a: 1, ent });
      } else this.lay(sh, this.shadowRoot, 0);
      r.shadows.push({ s: sh, x: wx - fr.shadow.ox, y: wy - fr.shadow.oy, cx, cy });
    };
    // The pieces' keys (stand.ts, which the items riding them read too: belt-lift.ts `spanZ`).
    for (const [t, g] of sim.graph.jumps) {
      const x = t % WORLD, y = (t - x) / WORLD;
      const e = sim.entityAt(x, y);
      if (!e || BUILDING_KIND[e.def] !== 'bridge') continue; // a line through junctions: nothing to draw
      const gx = g % WORLD, gy = (g - gx) / WORLD;
      const far = sim.entityAt(gx, gy);
      if (!far || BUILDING_KIND[far.def] !== 'bridge' || far.rot !== e.rot) continue; // past junctions, no leap
      const lv = liftOf(e);
      lay('up', x, y, e.rot, lv, rampZ(e), e.id);
      const n = Math.max(Math.abs(gx - x), Math.abs(gy - y)) - 1;
      for (let k = 1; k <= n; k++) {
        const tx = x + DX[e.rot]! * k, ty = y + DY[e.rot]! * k;
        lay('deck', tx, ty, e.rot, lv, deckSquareZ(tx, ty, lv), e.id);
      }
      lay('down', gx, gy, far.rot, liftOf(far), rampZ(far), far.id);
    }
  }

  private beltSprite(tex: Texture, x: number, y: number, rot: Rot, mirror: boolean, lv: number): void {
    this.cur!.sprites.push(...layBelt(tex, x, y, rot, mirror, lv, { ground: this.beltRoot, volumes: this.objectLayer, plan: this.planLayer }, 0, this.z));
  }

  /**
   * A traction ribbon's elevator up (or down) a terrace's wall, when it hands on a step away and
   * there is room for its shaft: in iso on the low tile against the wall (`liftZ`), its three parts
   * on one frame anchored at the two tiles' top corner on the low top — the back, the car (moved
   * up and down by `animate`, from `carHeight`), the front over it; in plan its mark centred on
   * the wall, turned with the ribbon (in the marks' band, over the plan copies of the ribbons on rock).
   */
  private addLift(sim: Sim, e: Ent): void {
    const l = this.liftOf(sim, e);
    if (!l?.shaft) return;
    const fr = liftFrames(l.rot, l.up);
    const ox = Math.min(l.x, l.x + DX[l.rot]!), oy = Math.min(l.y, l.y + DY[l.rot]!);
    const [wx, wy] = tileToIso(ox, oy, l.low);
    const z = liftZ(l.lowX, l.lowY);
    const lay = (f: DynFrame, dz: number): Sprite => {
      const s = new Sprite(f.tex);
      s.scale.set(LIFT_ISO_K);
      s.position.set(wx - f.ox * LIFT_ISO_K, wy - f.oy * LIFT_ISO_K);
      return this.lay(s, this.objectLayer, z + dz);
    };
    lay(fr.back, 0);
    const car = lay(fr.car, 0.01);
    lay(fr.front, 0.02);
    this.cur!.car = { s: car, y0: car.position.y, x: l.lowX, y: l.lowY };
    const plan = new Sprite(fr.plan.tex);
    plan.setFromMatrix(new Matrix()
      .translate(-fr.plan.ox, -fr.plan.oy)
      .scale(LIFT_PLAN_K, LIFT_PLAN_K)
      .rotate((l.rot * Math.PI) / 2)
      .translate(l.x + 0.5 + DX[l.rot]! * 0.5, l.y + 0.5 + DY[l.rot]! * 0.5));
    this.lay(plan, this.planLayer, PLAN_Z.mark);
  }

  /**
   * A conduit's fall one terrace down (D114): in iso its downpipe against the wall on the low tile,
   * one sprite on the lift's frame and at the lift's depth (`liftZ`: behind the high column when the
   * wall faces away, only its hood peeking over); in plan its mark centred on the wall, turned with
   * the conduit, in the marks' band.
   */
  private addFall(sim: Sim, e: Ent): void {
    const l = this.fallOf(sim, e);
    if (!l) return;
    const fr = fallFrames(l.rot, l.h);
    const ox = Math.min(l.x, l.lowX), oy = Math.min(l.y, l.lowY);
    const [wx, wy] = tileToIso(ox, oy, l.low);
    const s = new Sprite(fr.pipe.tex);
    s.scale.set(LIFT_ISO_K);
    s.position.set(wx - fr.pipe.ox * LIFT_ISO_K, wy - fr.pipe.oy * LIFT_ISO_K);
    this.lay(s, this.objectLayer, liftZ(l.lowX, l.lowY));
    const plan = new Sprite(fr.plan.tex);
    plan.setFromMatrix(new Matrix()
      .translate(-fr.plan.ox, -fr.plan.oy)
      .scale(LIFT_PLAN_K, LIFT_PLAN_K)
      .rotate((l.rot * Math.PI) / 2)
      .translate(l.x + 0.5 + DX[l.rot]! * 0.5, l.y + 0.5 + DY[l.rot]! * 0.5));
    this.lay(plan, this.planLayer, PLAN_Z.mark);
  }

  /** The claim's flag on the Heart (heart-flag.ts): its sprites, the emblem it shows, its wave's frame. */
  private flag: { iso: Sprite; badge: Sprite; key: string; frames: FlagFrames; k: number } | null = null;

  /** What the flag is drawn from: the Heart, where it stands, the emblem (a new emblem is re-baked per frame, `waveFlag`). */
  private flagSig(sim: Sim, stands: ReadonlyMap<number, Stand>): string {
    const h = sim.ents.get(sim.hearthId);
    if (!h || BUILDING_IDS[h.def] !== 'hearth') return '';
    const st = stands.get(h.id);
    return `${h.id},${h.x},${h.y},${h.rot},${st ? `${st.level},${st.z}` : ''}`;
  }

  /**
   * The flag on the Heart's roof: the waving pole and cloth in iso (just after the Heart: it stands
   * on its roof), the emblem as a badge in plan; hidden with the Heart (the intro's landing).
   */
  private addFlag(sim: Sim, stands: ReadonlyMap<number, Stand>): void {
    this.flag = null;
    const h = sim.ents.get(sim.hearthId);
    if (!h || BUILDING_IDS[h.def] !== 'hearth') return;
    const e = sim.emblem ?? defaultEmblem(sim.playerSeed);
    const frames = flagFrames(e);
    const st = stands.get(h.id);
    const [w, hh] = footprint(h.def, h.rot);
    const [wx, wy] = tileToIso(h.x + FLAG.x, h.y + FLAG.y, (st?.level ?? 0) + FLAG.roof);
    const f0 = frames.iso[0]!;
    const iso = new Sprite(f0.tex);
    iso.scale.set(FLAG_K);
    iso.position.set(wx - f0.ox * FLAG_K, wy - f0.oy * FLAG_K);
    this.lay(iso, this.objectLayer, (st ? st.z : buildingZ(h.x, h.y, w, hh)) + 0.05);
    const badge = new Sprite(frames.badge.tex);
    const k = 0.5 / frames.badge.w; // half a tile across
    badge.scale.set(k);
    badge.position.set(h.x + FLAG.x - frames.badge.ox * k, h.y + FLAG.y - frames.badge.oy * k);
    this.lay(badge, this.planLayer, 0);
    if (this.hidden.has(h.id)) iso.visible = badge.visible = false;
    this.flag = { iso, badge, key: emblemKey(e), frames, k: 0 };
  }

  /** Per frame: the flag's wave (game time: paused, it hangs still); a new emblem re-bakes it. */
  private waveFlag(sim: Sim, seconds: number): void {
    // The neighbouring bases' flags (D110), on the same wave.
    if (this.foreignFlags.length) {
      const n = FLAG.phases, k = ((Math.floor(seconds * FLAG.wavesPerSec * n) % n) + n) % n;
      if (Number.isFinite(k)) for (const f of this.foreignFlags) if (f.k !== k && !f.s.culled) { f.k = k; f.s.texture = f.frames.iso[k]!.tex; }
    }
    const fl = this.flagRec ? this.flag : null;
    if (!fl) return;
    const e = sim.emblem ?? defaultEmblem(sim.playerSeed);
    const key = emblemKey(e);
    if (key !== fl.key) { fl.frames = flagFrames(e); fl.key = key; fl.badge.texture = fl.frames.badge.tex; fl.k = -1; }
    const n = FLAG.phases, k = ((Math.floor(seconds * FLAG.wavesPerSec * n) % n) + n) % n;
    if (k === fl.k || !Number.isFinite(k)) return;
    fl.k = k;
    fl.iso.texture = fl.frames.iso[k]!.tex;
  }

  /** Is this neighbouring base laid (D110)? */
  hasForeign(key: number): boolean { return this.foreign.has(key); }

  /** Is a ribbon of that neighbouring base drawn on tile t, and on screen (not culled)? (Its goods ride only there.) */
  foreignRibbonShown(key: number, t: number): boolean {
    const r = this.foreignRibbons.get(key)?.get(t);
    return !!r && !r.culled;
  }

  /**
   * Lay a neighbouring base (D110): its buildings (ghost entities, ids out of the claim's range, a
   * tint), its ribbons (x, y, rot per tile in the order items ride: a tile turning from the one before
   * is a bend) and its flag on the ground at (x, y) in its emblem. Each building and each ribbon is a
   * record of its own, culled with its bucket.
   */
  layForeign(key: number, ents: readonly Ent[], ribbons: readonly Int32Array[], tint: number, flag: { x: number; y: number; emblem: Emblem } | null): void {
    if (this.foreign.has(key)) return;
    const recs: Rec[] = [];
    for (const e of ents) {
      const r = (this.cur = newRec('', e.id, e.id * 16, this.bucketOf(e.x, e.y)));
      this.addBuilding(e, false, undefined, tint);
      this.adopt(r);
      recs.push(r);
    }
    const tex = { s: this.atlas.textures.get(beltKey('ribbon', false)), c: this.atlas.textures.get(beltKey('ribbon', true)), inlet: this.atlas.textures.get(inletKey('ribbon')) };
    const drawn = new Map<number, Rec>();
    // Where a line ends on another's side (a junction, world/neighbours.ts), that tile is fed from
    // there: its rail opens (an inlet), as on the claim's lines (`addBelt`).
    const rotAt = new Map<number, Rot>(), fed = new Map<number, number>();
    for (const tl of ribbons) for (let i = 0; i < tl.length; i += 3) rotAt.set(tl[i + 1]! * WORLD + tl[i]!, tl[i + 2]! as Rot);
    for (const tl of ribbons) {
      if (tl.length < 3) continue;
      const n = tl.length - 3, rot = tl[n + 2]! as Rot, ax = tl[n]! + DX[rot]!, ay = tl[n + 1]! + DY[rot]!, at = rotAt.get(ay * WORLD + ax);
      if (at !== undefined && (at & 1) !== (rot & 1)) fed.set(ay * WORLD + ax, (fed.get(ay * WORLD + ax) ?? 0) | (1 << opposite(rot)));
    }
    ribbons.forEach((tl, j) => {
      if (!tex.s || !tex.c || tl.length < 3) return;
      const id = ents.length ? ents[0]!.id + 40 + j : 0;
      // A record per stretch in one culling square (neighbour-goods.ts `ribbonRuns`): a long line
      // shows wherever it crosses the view, never culled whole with its first tile's square.
      for (const run of ribbonRuns(tl, (x, y) => this.bucketOf(x, y))) {
        const r = (this.cur = newRec('', id, id * 16, run.bucket));
        for (let t = run.from; t < run.to; t++) {
          const i = t * 3, x = tl[i]!, y = tl[i + 1]!, rot = tl[i + 2]! as Rot, enter = (i ? tl[i - 1]! : rot) as Rot;
          // A bend where the line turns (the buildings view's `beltPiece`, read from the line itself).
          if (enter !== rot) this.beltSprite(tex.c, x, y, enter, rot === ((enter + 3) & 3), 0);
          else {
            this.beltSprite(tex.s, x, y, rot, false, 0);
            const f = fed.get(y * WORLD + x) ?? 0;
            if (f && tex.inlet) {
              if (f & (1 << ((rot + 3) & 3))) this.beltSprite(tex.inlet, x, y, rot, false, 0);
              if (f & (1 << ((rot + 1) & 3))) this.beltSprite(tex.inlet, x, y, rot, true, 0);
            }
          }
          drawn.set(y * WORLD + x, r);
        }
        for (const s of r.sprites) s.tint = tint;
        this.adopt(r);
        recs.push(r);
      }
    });
    this.foreignRibbons.set(key, drawn);
    if (flag) {
      const frames = flagFrames(flag.emblem), f0 = frames.iso[0]!;
      const r = (this.cur = newRec('', ents.length ? ents[0]!.id + 39 : 0, (ents.length ? ents[0]!.id + 39 : 0) * 16, this.bucketOf(flag.x, flag.y)));
      const [wx, wy] = tileToIso(flag.x + 0.5, flag.y + 0.5, 0);
      const iso = new Sprite(f0.tex);
      iso.scale.set(FLAG_K);
      iso.position.set(wx - f0.ox * FLAG_K, wy - f0.oy * FLAG_K);
      this.lay(iso, this.objectLayer, buildingZ(flag.x, flag.y, 1, 1));
      const badge = new Sprite(frames.badge.tex);
      const k = 0.8 / frames.badge.w;
      badge.scale.set(k);
      badge.position.set(flag.x + 0.5 - frames.badge.ox * k, flag.y + 0.5 - frames.badge.oy * k);
      this.lay(badge, this.planLayer, 0);
      this.foreignFlags.push({ s: iso, frames, k: 0 });
      this.adopt(r);
      recs.push(r);
    }
    this.cur = null;
    this.shadowSheet.flush();
    this.liftAlpha = -1;
    this.foreign.set(key, recs);
  }

  /** A sprite of an atlas frame anchored at (x, y) (the frame's own anchor), on a layer at depth key `key`. */
  private place(key: string, layer: Container, x: number, y: number, alpha: number, tint: number, zKey: number): Sprite | null {
    const tex = this.atlas.textures.get(key), fr = this.atlas.frames.get(key);
    if (!tex || !fr) return null;
    const s = new Sprite(tex);
    s.scale.set(fr.k);
    s.position.set(x - fr.ox * fr.k, y - fr.oy * fr.k);
    s.alpha = alpha;
    s.tint = tint;
    return this.lay(s, layer, zKey);
  }

  /** A building's sprites; `st`: where it stands when above the floor (D44: lifted onto the rock top, sorted by its stand). */
  private addBuilding(e: Ent, dormant = false, st?: Stand, foreign?: number): void {
    const id = BUILDING_IDS[e.def]!;
    const pending = e.builtAt !== 0;
    const alpha = pending ? 0.45 : 1;
    // Dormant (its unlock given up): a grey wash, like an unpainted model; a neighbouring base's (D110): its tint.
    const tint = foreign ?? (dormant ? DORMANT_TINT : 0xffffff);
    const [w, h] = footprint(e.def, e.rot);
    const z = st ? st.z : buildingZ(e.x, e.y, w, h);
    const parts: Spinner['sprites'] = [];
    // The iso volume (on the rock top it stands on); a moving part apart, just over or under its body.
    // `lv`: the look it wears — the Heart's grows with its level (D86), every other building has one.
    const lv = artLevelOf(id as BuildingId, this.heartLv);
    const isoKey = this.atlas.frames.has(bKey(id, e.rot, lv)) ? bKey(id, e.rot, lv) : bKey(id, 0, lv);
    const [wx, wy] = tileToIso(e.x, e.y, st?.level ?? 0);
    const isoMv = this.atlas.moving.get(isoKey);
    const artRot = isoKey === bKey(id, e.rot, lv) ? e.rot : 0;
    const pit = BUILDING_KIND[e.def] === 'sink';
    this.addShadow(e, id as BuildingId, artRot, pending ? 0.35 : 1, st, lv);
    const look: Look | null = foreign === undefined && looksAtWork(e.def) ? { ent: e.id, id: id as BuildingId, dormant, views: [], parts: [], off: false, waits: false, dead: false } : null;
    if (pit) this.addPit(e, artRot, wx, wy, alpha, tint, z);
    else {
      const key = isoMv ? bodyKey(isoKey) : isoKey;
      const s = this.place(key, this.objectLayer, wx, wy, alpha, tint, z);
      if (s && look) look.views.push({ s, key, iso: true, rot: artRot, body: !!isoMv });
    }
    if (isoMv) {
      const s = this.place(partKey(isoKey, 0), this.objectLayer, wx, wy, alpha, tint, z + (isoMv.over ? 0.2 : -0.2));
      if (s) parts.push({ s, tex: this.phases(isoKey, isoMv.n) });
    }
    // The plan sprite (flat; above the floor, over its hint of height); a moving part over it.
    const topKey = this.atlas.frames.has(btKey(id, e.rot, lv)) ? btKey(id, e.rot, lv) : btKey(id, 0, lv);
    const topMv = this.atlas.moving.get(topKey);
    if (st) this.riseHint(topMv ? bodyKey(topKey) : topKey, e.x, e.y, st.level, alpha);
    const planKey = topMv ? bodyKey(topKey) : topKey;
    const plan = this.place(planKey, this.planLayer, e.x, e.y, alpha, tint, 0);
    if (plan && look) look.views.push({ s: plan, key: planKey, iso: false, rot: topKey === btKey(id, e.rot, lv) ? e.rot : 0, body: !!topMv });
    if (pit) this.addPitGlow(e);
    if (topMv) {
      const s = this.place(partKey(topKey, 0), this.planLayer, e.x, e.y, alpha, tint, 0);
      if (s) parts.push({ s, tex: this.phases(topKey, topMv.n) });
    }
    if (parts.length) this.addSpinner(e, id as BuildingId, pending || dormant, parts, foreign !== undefined);
    if (look) {
      look.parts = parts.map((p) => p.s);
      this.cur!.look = look;
      // Known switched off before this rebuild: drawn so at once, never a lit frame.
      if (!this.work.isLit(e.id)) this.applyLook(look, true);
    }
    this.addChosenItem(e, id, st);
  }

  /**
   * Plan: a building standing above the floor lays a short ink shadow on the map, down-right of
   * it as the art's shadows fall, longer the higher it stands — the plan's hint of its height.
   * Its own sprite, tinted ink, under the plan sprite.
   */
  private riseHint(key: string, x: number, y: number, level: number, alpha: number): void {
    const off = riseOffset(level);
    this.place(key, this.planLayer, x + off, y + off, RISE_ALPHA * alpha, SHADOW_TINT, 0);
  }

  /** The textures of a moving part's phases. */
  private phases(key: string, n: number): Texture[] {
    return Array.from({ length: n }, (_, k) => this.atlas.textures.get(partKey(key, k))!);
  }

  /** Register a moving part: where it was before it was re-drawn (else its own start), how it turns. */
  private addSpinner(e: Ent, id: BuildingId, still: boolean, sprites: Spinner['sprites'], foreign = false): void {
    const spec = MOVING[id];
    if (!spec) return;
    const old = this.kept.get(e.id), seed = spinSeed(e.id);
    const sp: Spinner = {
      ent: e.id, wind: BUILDING_KIND[e.def] === 'wind', still, n: spec.frames, sym: spec.sym, vary: seed.vary,
      phase: old?.phase ?? seed.phase, rate: old?.rate ?? 0, k: -1, shown: -1, culled: false, sprites, ...(foreign ? { foreign } : {}),
    };
    sp.k = sp.shown = Math.floor(sp.phase * sp.n) % sp.n;
    for (const p of sprites) p.s.texture = p.tex[sp.k]!;
    this.cur!.spinner = sp;
  }

  /** Sorters wear their chosen item on top (both views; in iso on the lid, lifted with the block). */
  private addChosenItem(e: Ent, id: string, st?: Stand): void {
    const logic = buildingDef(e.def).logic;
    if (logic !== 'sorter' && logic !== 'inverted') return;
    const item = filterOf(e.cfg, 0);
    const key = item >= 0 ? iKey(ITEM_IDS[item]!) : '';
    const tex = key ? this.atlas.textures.get(key) : undefined, fr = key ? this.atlas.frames.get(key) : undefined;
    if (!tex || !fr) return;
    // Iso: on the block's lid; plan: in its window (0.4 tile).
    const iso = new Sprite(tex);
    iso.anchor.set(0.5, 0.8); // stands in the lid's window like an object in a tray
    const [wx, wy] = tileToIso(e.x + 0.5, e.y + 0.5, st?.level ?? 0);
    iso.position.set(wx, wy - isoHead(id as BuildingId) * LH);
    iso.scale.set((0.32 * 64) / Math.max(fr.w, fr.h));
    this.lay(iso, this.objectLayer, st ? st.z + 0.4 : buildingZ(e.x, e.y, 1, 1) + 0.5);
    const plan = new Sprite(tex);
    plan.anchor.set(0.5);
    plan.position.set(e.x + 0.5, e.y + 0.5);
    plan.scale.set(0.4 / Math.max(fr.w, fr.h));
    this.lay(plan, this.planLayer, 0);
  }

  private addBelt(sim: Sim, e: Ent): void {
    const tier = tierOf(e.def) ?? 'ribbon';
    const p = beltPiece(sim, e);
    // A buried line (D109) shows a vent on the odd straight tile, by a hash of the tile: the same tiles every time.
    const vent = tier === 'camo_ribbon' && !p.corner && camoVent(e.x, e.y);
    const tex = this.atlas.textures.get(vent ? CAMO_VENT_KEY : beltKey(tier, p.corner));
    if (!tex) return;
    const lv = tileTop(sim.grid, e.x, e.y);
    this.beltSprite(tex, e.x, e.y, p.rot, p.mirror, lv);
    this.addLift(sim, e);
    this.addFall(sim, e);
    if (p.corner) return;
    // A straight piece fed from a side (a merging line, a router, a machine's outlet): open the
    // rail there so the connection reads. The inlet art comes in from the left; mirror for the right.
    const fed = sim.graph?.feedDirs.get(tileIndex(e.x, e.y)) ?? 0;
    const inlet = this.atlas.textures.get(inletKey(tier));
    if (!fed || !inlet) return;
    const left = ((e.rot + 3) & 3) as Rot, right = ((e.rot + 1) & 3) as Rot;
    if (fed & (1 << left)) this.beltSprite(inlet, e.x, e.y, e.rot, false, lv);
    if (fed & (1 << right)) this.beltSprite(inlet, e.x, e.y, e.rot, true, lv);
  }
}
