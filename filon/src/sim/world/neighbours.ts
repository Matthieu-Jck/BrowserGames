// neighbours.ts — the neighbouring bases (D110; owner, 2026-10-17: « Pourquoi "sister claim" ?
// Enlève ça. S'il y a un endroit possédé par un PNJ, il faut qu'il y ait vraiment une base, et
// appelle-ça d'un nom plus logique »): the parcels another claim of the Crier holds beside the
// player's (one of the market's colonies: the base next door is one the player trades with at the
// Crier), and the small working base standing on them. Never for sale nor lease (docs/land.md).
//
// Who holds what (`holdingOf`) follows from the land's seed and its source alone, never from play:
// - map 4 (`TerrainSource.holdings`): the parcel grid is cut in `block` × `block` squares round the
//   Heart's parcel; `chance` ‰ of them hold one base of `size` parcels side by side, grown from a
//   seed parcel inside its square, so each base reads as one. Its colony comes from a seeded
//   shuffle of the colonies, read along the squares so bases side by side differ;
// - maps 1–3 and test worlds: the sister claims' scattered parcels as they were (one in `scatter` ‰
//   past the ring round the starting square, the same hash and the same colony), one base each.
// A parcel takes part only where a base stands: at least `floor` ‰ of `samples`² points on open
// floor (`TerrainSource.floorAt`, no chunk made) and nothing the land guarantees the claim on it
// (`keepsClear`: a site, the copper field, a vent, the vein, a corridor). Past the ring round the
// starting square only, and never cut by the world's edge.
//
// The base (`layout`) is laid out the first time something asks — a placement, the land panel, the
// view — on the land as its source made it (`Grid.made0`: what the claim digs never moves it), as a
// working chain that fits its trade (content/neighbours.ts; owner, 2026-10-17: « leurs bases sont
// vraiment nulles, il n'y a rien qui marche, même pas de câble électrique ») — extractors on its
// outer parcels, makers round the hub, the store and CrierBelt's lift pad in its middle — linked
// by ribbons found tile by tile (a bounded breadth-first search), powered from its own sources
// through masts by the claim's own rule of reach (sim/power/links.ts), its flag and banner poles by
// the pad, covered depots, cairns along its edge (`lay`). Integers and total orders only: the same
// base for every reader, in every order asked. None stands within `minRing` − 1 rings of the
// Heart's parcel (owner, 2026-10-17: « Il y a trop de bases de PNJ autour de moi »).
//
// A parcel of a holding the claim holds (an older base's lease or grant, `systems/land.ts`
// `neighboursGiveWay`) is left out of its base: what stood there gave way. Nothing here is saved.
import { BAL } from '@/content/balance';
import type { BuildingId } from '@/content/buildings';
import { COLONY_PROFILES, COLONY_PROFILE_IDS, type ColonyProfile, type ColonyProfileId } from '@/content/colonies';
import { NEIGHBOUR_CAIRN_STEP, NEIGHBOUR_CORE, NEIGHBOUR_KITS, NEIGHBOUR_LEANS, NEIGHBOUR_MAST, NEIGHBOUR_PAD, NEIGHBOUR_TENT } from '@/content/neighbours';
import { BUILDING_IDS, BUILDING_KIND, ITEM_IDS, buildingDef, buildingIdx, itemDef, itemIdx } from '@/content/registry';
import { RECIPES } from '@/content/recipes';
import type { RecipeDef } from '@/content/types';
import { isqrt } from '@/core/fixed';
import { hash32 } from '@/core/hash';
import { WORLD } from '../constants';
import { footprint, worldPorts, type WorldPort } from '../entities';
import { gap2, linkable } from '../power/links';
import { DX, DY, isFloor, opposite, T, type Rot } from '../types';
import { inWorld, tileIndex, type Grid } from './grid';
import { mainInput, planChain, runs, type Stage } from './neighbour-chain';
import { HOME_COL, PARCEL, PARCEL_COLS, parcelAt, parcelCentre, parcelRect, ringOf, type Land } from './land';

/** What a building is to its base: its Core, its trade post, its store, an extractor, a maker, its power, a mast, something beside. */
export type NRole = 'core' | 'post' | 'store' | 'extract' | 'make' | 'power' | 'mast' | 'extra';

/**
 * A building of a neighbouring base: what it is, where it stands (its footprint's top-left tile), how
 * it is turned; its role, the recipe it runs (a maker), what it puts out or holds (item indices).
 */
export interface NStruct { readonly def: number; readonly x: number; readonly y: number; readonly rot: Rot; readonly role?: NRole; readonly recipe?: string; readonly items?: readonly number[]; readonly stage?: number }

/**
 * A ribbon line of a neighbouring base: its tiles in the order items ride (x, y, rot each), what it
 * carries (`item`, and `items` when it carries several: the store's lines), from which struct's outlet
 * to which struct's intake (`port`: that intake's port index) — or joining, from its side, a line that
 * goes there.
 */
export interface NRibbon { readonly tiles: Int32Array; readonly item: number; readonly items: readonly number[]; readonly from: number; readonly to: number; readonly port: number }

/**
 * A neighbouring base's buildings (its masts among them), ribbons and wires (struct indices, the
 * lower first), its flag's tile and its banner poles', its covered depots (`NEIGHBOUR_TENT` tiles a
 * side, top-left), the cairns along its edge, and every tile any of it stands on.
 */
export interface NLayout {
  readonly structs: readonly NStruct[];
  /** The goods it sells at its trade post (item indices). */
  readonly products: readonly number[];
  /**
   * What it does, a line per good it sells (its products' order), raw good first, as its ribbons carry
   * it: back from the store through each machine's main input to the mine (item indices: « minerai de
   * fer → plaque de fer → engrenage »). What its card says (D134).
   */
  readonly lines: ReadonlyArray<readonly number[]>;
  /** Its main line (`lines`' first); empty: nothing. */
  readonly story: readonly number[];
  /** Its Core among `structs` (laid as `NEIGHBOUR_CORE`'s footprint; the render draws its own); −1: none. */
  readonly core: number;
  readonly ribbons: readonly NRibbon[];
  readonly wires: ReadonlyArray<readonly [number, number]>;
  readonly flag: readonly [number, number] | null;
  readonly banners: ReadonlyArray<readonly [number, number]>;
  readonly tents: ReadonlyArray<readonly [number, number]>;
  readonly cairns: ReadonlyArray<readonly [number, number]>;
  readonly tiles: ReadonlySet<number>;
}

const EMPTY_LAYOUT: NLayout = { structs: [], core: -1, products: [], lines: [], story: [], ribbons: [], wires: [], flag: null, banners: [], tents: [], cairns: [], tiles: new Set() };

/** A neighbouring base's land: its colony (the Crier's, by index), its trade, its parcels (the hub's first). */
export interface Holding {
  /** Its first parcel, the hub's: the holding's id. */
  readonly hub: number;
  readonly colony: number;
  readonly profile: ColonyProfileId;
  readonly parcels: readonly number[];
}

/** The colonies of the Crier, in market order (content/colonies.ts: by profile, then rank), with their profile. */
const PROFILE_OF: readonly ColonyProfileId[] = COLONY_PROFILE_IDS.flatMap((pid) => Array.from({ length: (COLONY_PROFILES[pid] as ColonyProfile).count }, () => pid));
/** Every colony (the sister claims' draw, maps 1–3). */
const COLONIES = PROFILE_OF.length;

/** Where a base's Core may stand round a parcel's middle when its hub's middle is a pocket (`lay`). */
const CORE_TRIES: ReadonlyArray<readonly [number, number]> = [[0, 0], [-6, 0], [6, 0], [0, -6], [0, 6], [-6, -6], [6, -6], [-6, 6], [6, 6]];

/** Salts of the draws. */
const SALT = { block: 0xb10c, grow: 0x6a0e, perm: 0x9e7a, rot: 0x7a0e, scatter: 0x1a4d } as const;

/** Offsets round an anchor, nearest first (then by row, then by column): where a building is tried, in order. */
const SPIRAL: ReadonlyArray<readonly [number, number]> = (() => {
  const R = PARCEL >> 1, out: Array<[number, number]> = [];
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) if (dx * dx + dy * dy <= R * R) out.push([dx, dy]);
  return out.sort((a, b) => a[0] * a[0] + a[1] * a[1] - (b[0] * b[0] + b[1] * b[1]) || a[1] - b[1] || a[0] - b[0]);
})();

/** The same round a farther anchor (a drill looks for its ore up to here). */
const SPIRAL_FAR: ReadonlyArray<readonly [number, number]> = (() => {
  const R = PARCEL + (PARCEL >> 1), out: Array<[number, number]> = [];
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) if (dx * dx + dy * dy <= R * R) out.push([dx, dy]);
  return out.sort((a, b) => a[0] * a[0] + a[1] * a[1] - (b[0] * b[0] + b[1] * b[1]) || a[1] - b[1] || a[0] - b[0]);
})();

/** The rotation whose front faces (dx, dy) — one axis (N 0, E 1, S 2, W 3: content `PortDef`'s rot-0 front faces N). */
const dirOf = (dx: number, dy: number): Rot => (dy < 0 ? 0 : dx > 0 ? 1 : dy > 0 ? 2 : 3) as Rot;

/** The longest ribbon a base lays (tiles). */
const RIBBON_MAX = 96;

const floorDiv = (a: number, b: number): number => Math.floor(a / b);
const mod = (a: number, n: number): number => ((a % n) + n) % n;
/** Do two parcels share a side? */
const sideBySide = (p: number, q: number): boolean => {
  const pc = p % PARCEL_COLS, qc = q % PARCEL_COLS;
  return (Math.abs(p - q) === 1 && Math.floor(p / PARCEL_COLS) === Math.floor(q / PARCEL_COLS)) || (Math.abs(p - q) === PARCEL_COLS && pc === qc);
};

/** Does a drill of this def want a deposit under it (not a sand collector, not a face cutter)? */
const wantsOre = (def: number): boolean => {
  const d = buildingDef(def).drill;
  return BUILDING_KIND[def] === 'drill' && !!d && !d.ground && !d.face;
};

export class Neighbours {
  /** Per parcel: −2 not drawn yet, −1 nobody's, else its holding's hub. */
  private readonly ofParcel = new Int32Array(PARCEL_COLS * PARCEL_COLS).fill(-2);
  private readonly holdings = new Map<number, Holding>();
  private readonly layouts = new Map<number, NLayout>();
  /** Each base's survey for its tries (`lay`): its Core's place, its floor, what that floor gives and how many drills each ore of it holds. */
  private readonly surveys = new Map<string, { hub: number; hx: number; hy: number; region: Set<number>; raws: ReadonlySet<string>; oreAt: Map<string, [number, number]>; drills: Map<string, number> }>();
  /** The colonies the holdings take, shuffled from the seed (map 4); every colony but the drifter guilds' (very far). */
  private readonly perm: number[];

  constructor(private readonly land: Land, private readonly grid: Grid) {
    const ids = PROFILE_OF.map((_, i) => i).filter((i) => PROFILE_OF[i] !== 'drifter');
    for (let i = ids.length - 1; i > 0; i--) {
      const j = hash32(land.seed, i, SALT.perm) % (i + 1);
      [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    }
    this.perm = ids;
  }

  /** The neighbouring base whose land the parcel is, whoever holds it now (null: none: CrierBelt's or the claim's grant). */
  holdingOf(p: number): Holding | null {
    if (!Number.isInteger(p) || p < 0 || p >= this.ofParcel.length) return null;
    if (this.ofParcel[p] === -2) this.draw(p);
    const h = this.ofParcel[p]!;
    return h >= 0 ? this.holdings.get(h)! : null;
  }

  /** A base's buildings and ribbons (laid out on first need). */
  layout(h: Holding): NLayout {
    let L = this.layouts.get(h.hub);
    if (!L) { L = this.layChecked(h); this.layouts.set(h.hub, L); this.surveys.clear(); }
    return L;
  }

  /**
   * A base laid out until it checks (`neighbourProblems`): each try again with the pad on the Core's
   * other side, then its lines laid from the mines down (each side); then fewer copies of its chain; one product only, as many copies again then fewer;
   * then a raw good whose extractor or line could not be laid is given up and the chain planned again
   * without it; at last its plainest chain (glass from sand…). None checks: the best try, what still
   * does not check taken away (`prune`) — the fewest problems left, then the most machines.
   */
  private layChecked(h: Holding): NLayout {
    const ban = new Set<string>();
    let products = 2, copies = 4, side = 1, mineFirst = false;
    let best: NLayout = EMPTY_LAYOUT, bestScore = -Infinity;
    for (let k = 0; k < 64; k++) {
      const { layout: L, raws, unplaced } = this.lay(h, ban, products, copies, side, mineFirst);
      const probs = neighbourProblems(this.grid, L);
      if (!probs.length && !unplaced.length) return L;
      const P = prune(L, this.grid), left = neighbourProblems(this.grid, P).length;
      // A spare drill or a copy that found no way taken away and everything else standing: that base,
      // laid again without them (its lines and its grid for what stands).
      if (!left && P.products.length === L.products.length && P.products.length) {
        const kept = new Set(P.structs.map((q) => q.stage).filter((q): q is number => q !== undefined));
        const skip = new Set(L.structs.map((q) => q.stage).filter((q): q is number => q !== undefined && !kept.has(q)));
        const R = this.lay(h, ban, products, copies, side, mineFirst, skip);
        if (!neighbourProblems(this.grid, R.layout).length && R.layout.products.length === L.products.length) return R.layout;
      }
      const score = -1000 * left + 10 * P.products.length + P.structs.filter((q) => q.role === 'make' || q.role === 'extract').length;
      if (score > bestScore) { best = P; bestScore = score; }
      // A line or a piece that found no way: the pad on the Core's other side, then the lines laid
      // from the mines down. Only an extractor without ground: no line's fault, straight to fewer copies.
      const lines = probs.some((q) => !/ is not on | sends its .* nowhere$/.test(q.what) || !unplaced.length);
      if (lines && side > 0) { side = -1; continue; }
      side = 1;
      if (lines && !mineFirst && copies === 1) { mineFirst = true; continue; }
      mineFirst = false;
      // Fewer copies first (its deposit may hold drills for one: 4, 2, 1), then one good, then a raw
      // good it could not lay given up, at last its plainest chain.
      if (copies > 1) { copies = copies > 2 ? 2 : 1; continue; }
      if (products > 1) { products = 1; copies = 4; continue; }
      let gave = false;
      for (const it of [...unplaced, ...probs.map((q) => q.item ?? '')]) if (it && it !== 'sand' && raws.has(it) && !ban.has(it)) { ban.add(it); gave = true; }
      if (gave) { copies = 4; continue; }
      if (!ban.has('*')) ban.add('*'); else break;
    }
    return best;
  }

  /** Does a neighbouring base's building, ribbon or flag stand on tile (x, y)? */
  at(x: number, y: number): boolean {
    if (!inWorld(x, y)) return false;
    const p = parcelAt(x, y);
    if (this.land.holds(p)) return false; // the claim's: no base there (`lay`)
    const h = this.holdingOf(p);
    return !!h && this.layout(h).tiles.has(tileIndex(x, y));
  }

  /** The same, by tile index. */
  atTile(t: number): boolean {
    const x = t % WORLD;
    return this.at(x, (t - x) / WORLD);
  }

  /** The bases with land in the tile rect [x0, x1) × [y0, y1), by hub. */
  inRect(x0: number, y0: number, x1: number, y1: number): Holding[] {
    const out = new Map<number, Holding>();
    const a = parcelAt(Math.max(0, x0), Math.max(0, y0)), b = parcelAt(Math.min(WORLD - 1, x1 - 1), Math.min(WORLD - 1, y1 - 1));
    const c0 = a % PARCEL_COLS, r0 = Math.floor(a / PARCEL_COLS), c1 = b % PARCEL_COLS, r1 = Math.floor(b / PARCEL_COLS);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      const h = this.holdingOf(r * PARCEL_COLS + c);
      if (h) out.set(h.hub, h);
    }
    return [...out.values()].sort((p, q) => p.hub - q.hub);
  }

  /** A base's buildings standing on a parcel (their top-left tile on it). */
  structsOn(p: number): NStruct[] {
    const h = this.holdingOf(p);
    return h ? this.layout(h).structs.filter((s) => parcelAt(s.x, s.y) === p) : [];
  }

  /** Forget the layouts (the claim's land changed under a base: an older save given way to, `neighboursGiveWay`). */
  forget(): void { this.layouts.clear(); this.surveys.clear(); }

  // ── who holds what ────────────────────────────────────────────────────────

  private draw(p: number): void {
    if (this.grid.source.holdings) {
      const col = p % PARCEL_COLS, row = Math.floor(p / PARCEL_COLS), B = BAL.land.neighbours.block, off = B >> 1;
      this.drawBlock(floorDiv(col - HOME_COL + off, B), floorDiv(row - HOME_COL + off, B));
    } else this.drawScatter(p);
  }

  /** Can a base stand on parcel p: from `minRing` out, whole, mostly open floor, nothing the land guarantees? */
  private eligible(p: number): boolean {
    if (ringOf(p) < BAL.land.neighbours.minRing) return false;
    const r = parcelRect(p);
    if (r.x1 - r.x0 < PARCEL || r.y1 - r.y0 < PARCEL) return false;
    const src = this.grid.source;
    if (src.keepsClear?.(r.x0, r.y0, r.x1, r.y1)) return false;
    if (!src.floorAt) return true;
    const K = BAL.land.neighbours.samples;
    let n = 0;
    for (let j = 0; j < K; j++) for (let i = 0; i < K; i++) {
      if (src.floorAt(r.x0 + Math.floor(((2 * i + 1) * PARCEL) / (2 * K)), r.y0 + Math.floor(((2 * j + 1) * PARCEL) / (2 * K)))) n++;
    }
    return n * 1000 >= BAL.land.neighbours.floor * K * K;
  }

  /** Maps 1–3 (and test worlds): the sister claims' parcels as they were, a base on each where one fits. */
  private drawScatter(p: number): void {
    this.ofParcel[p] = -1;
    if (ringOf(p) < BAL.land.neighbours.minRing) return;
    const h = hash32(this.land.seed, p, SALT.scatter);
    if (h % 1000 >= BAL.land.neighbours.scatter || !this.eligible(p)) return;
    const colony = (h >>> 10) % COLONIES;
    this.add({ hub: p, colony, profile: PROFILE_OF[colony]!, parcels: [p] });
  }

  /** Map 4: a square of `block` × `block` parcels, and the base it holds, if any. */
  private drawBlock(bx: number, by: number): void {
    const N = BAL.land.neighbours, B = N.block, off = B >> 1;
    const cells: number[] = [];
    for (let j = 0; j < B; j++) for (let i = 0; i < B; i++) {
      const c = HOME_COL - off + bx * B + i, r = HOME_COL - off + by * B + j;
      if (c >= 0 && r >= 0 && c < PARCEL_COLS && r < PARCEL_COLS) cells.push(r * PARCEL_COLS + c);
    }
    cells.sort((a, b) => a - b);
    for (const p of cells) this.ofParcel[p] = -1;
    const h = hash32(this.land.seed, bx + 1024, by + 1024, SALT.block);
    if (h % 1000 >= Math.max(N.chance, N.chanceOre)) return;
    const ok = cells.filter((p) => this.eligible(p));
    if (!ok.length) return;
    // On the square's ore (owner, 2026-10-18: « Elle commande de la pierre, la transforme en minerai de
    // fer et la revend ? »: a base mines what it makes): its first parcel the one whose deposits on
    // open floor are the largest (`depositsIn`, no chunk made: their radii² summed — a big deposit
    // holds the drills of a real base, D134), grown towards the next richest; among equals, the draw.
    const src = this.grid.source, ore = new Map<number, number>();
    for (const p of ok) {
      const r = parcelRect(p);
      ore.set(p, (src.depositsIn?.(r.x0 + 3, r.y0 + 3, r.x1 - 3, r.y1 - 3) ?? []).filter((d) => !src.floorAt || src.floorAt(d.cx, d.cy)).reduce((t, d) => t + d.r2, 0));
    }
    // A square with a deposit holds a base more often than bare ground (`chanceOre` against `chance` ‰).
    if (h % 1000 >= (ok.some((p) => ore.get(p)! > 0) ? N.chanceOre : N.chance)) return;
    const richest = (from: readonly number[], draw: number): number => {
      const most = Math.max(...from.map((p) => ore.get(p)!)), top = from.filter((p) => ore.get(p) === most);
      return top[draw % top.length]!;
    };
    const parcels = [richest(ok, h >>> 10)];
    const size = N.size[0]! + ((h >>> 20) % (N.size[1]! - N.size[0]! + 1));
    for (let k = 1; k < size; k++) {
      const front = ok.filter((p) => !parcels.includes(p) && parcels.some((q) => sideBySide(p, q)));
      if (!front.length) break;
      parcels.push(richest(front, hash32(this.land.seed, parcels[0]!, k, SALT.grow)));
    }
    if (parcels.length < N.size[0]!) return; // a real base, two parcels at least (owner: « c'est tout petit »)
    const colony = this.perm[mod(bx * 7 + by * 3, this.perm.length)]!;
    this.add({ hub: parcels[0]!, colony, profile: PROFILE_OF[colony]!, parcels });
  }

  private add(h: Holding): void {
    this.holdings.set(h.hub, h);
    for (const p of h.parcels) this.ofParcel[p] = h.hub;
  }

  // ── the base ──────────────────────────────────────────────────────────────

  /**
   * A base laid out as a chain that fits its trade (content/neighbours.ts): its Core in its hub's
   * middle (D110: a smaller one of its own), CrierBelt's lift pad and the store beside it; its makers round the hub, on the side towards its other
   * parcels; its extractors at the chain's head, out on those parcels (a drill on a deposit, else a
   * sand collector); its power sources and extras on the hub's far side; its covered depots by the
   * pad. Every building wholly on its parcel a tile in from the edge, with a tile of room round it.
   * Then the flag and two banner poles at the pad's corners, the ribbons the goods ride (each
   * extractor into the first maker, maker into maker, the last into the store, the store into the
   * Core), the masts and wires of its own grid from the Core (the claim's rule of reach: a mast at one end, its
   * range and slots), and the cairns along its outer edge.
   */
  private lay(h: Holding, ban: ReadonlySet<string> = new Set(), maxProducts = 2, copies = 4, side = 1, mineFirst = false, skip: ReadonlySet<number> = new Set()): { layout: NLayout; raws: ReadonlySet<string>; unplaced: string[] } {
    const kit = NEIGHBOUR_KITS[h.profile];
    const unplaced: string[] = [];
    // An older base's lease or grant on its land: that part of the base is not there.
    const parcels = h.parcels.filter((p) => !this.land.holds(p));
    const allowed = new Set(parcels);
    const solid = new Set<number>(); // what stands: buildings, ribbons, masts, the flag, poles, tents, cairns
    const room = new Set<number>(); // the buildings and the tile of room round each
    const drillRoom = new Set<number>(), otherRoom = new Set<number>(); // that room: the drills', everything else's
    const fronts = new Set<number>(); // the tile before each port of what stands: never built on
    const structs: NStruct[] = [];
    const made = (x: number, y: number): { terrain: number; level: number; ore: number } => this.grid.made0(x, y); // the land as made: digging never moves a base
    const open = (x: number, y: number): boolean => {
      if (!inWorld(x, y) || !allowed.has(parcelAt(x, y))) return false;
      const m = made(x, y);
      return m.level === 0 && isFloor(m.terrain);
    };
    const free = (x: number, y: number): boolean => open(x, y) && !solid.has(tileIndex(x, y));
    // The floor the pad stands on, joined to it (4-neighbours, on the base's parcels): every other
    // building stands there, so a ribbon can always find its way between them.
    let region = new Set<number>();
    const fits = (w: number, hh: number, x: number, y: number, p: number, ore: boolean, joined: boolean, bare = false): boolean => {
      const r = parcelRect(p);
      if (x < r.x0 + 1 || y < r.y0 + 1 || x + w > r.x1 - 1 || y + hh > r.y1 - 1) return false;
      for (let ty = y; ty < y + hh; ty++) for (let tx = x; tx < x + w; tx++) {
        const t = tileIndex(tx, ty);
        // A drill on its deposit may stand in the room round what stands beside it (D134: a deposit is
        // the drills' — a small one by the Core held none), never before a port.
        if ((room.has(t) && !ore) || fronts.has(t) || solid.has(t) || !open(tx, ty) || (joined && region.size && !region.has(t))) return false;
        if (ore) { const o = made(tx, ty).ore; if (o < 0 || itemDef(o).face) return false; }
        else { const o = made(tx, ty).ore; if (o >= 0 && !itemDef(o).face) return false; } // a deposit is for the drills
        if (bare) { const m = made(tx, ty); if (m.ore >= 0 || m.terrain !== T.Sand) return false; } // a sand collector: on bare sand
      }
      return true;
    };
    /** The nearest place on parcel p round (ax, ay) where a w × hh footprint fits, its room claimed; null: none. */
    const spot = (w: number, hh: number, p: number, ax: number, ay: number, ore = false, joined = true, bare = false, wide = false, ports?: { def: number; rot: Rot }, need?: (x: number, y: number, w: number, h: number) => boolean): [number, number] | null => {
      for (const [dx, dy] of wide ? SPIRAL_FAR : SPIRAL) {
        const x = ax + dx - (w >> 1), y = ay + dy - (hh >> 1);
        if (!fits(w, hh, x, y, p, ore, joined, bare) || (need && !need(x, y, w, hh))) continue;
        // Every port before open floor (of the pad's floor): a line can leave it or come in.
        if (ports && worldPorts({ def: ports.def, x, y, rot: ports.rot }).some((q) => !free(q.fx, q.fy) || (joined && region.size && !region.has(tileIndex(q.fx, q.fy))))) continue;
        for (let ty = y - 1; ty <= y + hh; ty++) for (let tx = x - 1; tx <= x + w; tx++) { room.add(tileIndex(tx, ty)); otherRoom.add(tileIndex(tx, ty)); }
        for (let ty = y; ty < y + hh; ty++) for (let tx = x; tx < x + w; tx++) solid.add(tileIndex(tx, ty));
        return [x, y];
      }
      return null;
    };
    /** An excavator's place: rock (what it digs) within its reach of its footprint. */
    const byRock = (x: number, y: number, w: number, hh: number): boolean => {
      const R = buildingDef(buildingIdx('excavator')).excavator?.reach ?? 3;
      for (let ty = y - R; ty < y + hh + R; ty++) for (let tx = x - R; tx < x + w + R; tx++) { const m = made(tx, ty); if (m.level > 0 || !isFloor(m.terrain)) return true; }
      return false;
    };
    /**
     * A building on one of `ps` (in order) round (ax, ay); a drill wants a deposit, else a sand
     * collector stands in; `joined`: on the pad's floor (the chain's pieces). Its index, or −1.
     */
    const put = (id: BuildingId, ps: readonly number[], ax: number, ay: number, salt: number, joined = true, turn?: Rot, wide = false): number => {
      const def = buildingIdx(id), need = buildingDef(def).excavator ? byRock : undefined;
      const rot = (turn ?? (BUILDING_KIND[def] === 'machine' ? hash32(this.land.seed, h.hub, salt, SALT.rot) % 4 : 0)) as Rot;
      const bare = !!buildingDef(def).drill?.ground;
      // The parcel it is aimed at first (the flow crosses parcels), then the others in order.
      const pa = inWorld(ax, ay) ? parcelAt(ax, ay) : -1;
      for (const p of ps.includes(pa) ? [pa, ...ps.filter((q) => q !== pa)] : ps) {
        const at = spot(...footprint(def, rot), p, ax, ay, false, joined, bare, wide, { def, rot }, need);
        if (at) { structs.push({ def, x: at[0], y: at[1], rot }); for (const q of worldPorts(structs[structs.length - 1]!)) fronts.add(tileIndex(q.fx, q.fy)); return structs.length - 1; }
      }
      return -1;
    };
    /** A drill on a deposit of `ore` (all its tiles), the nearest round (ax, ay) on the base's floor, turned by `turn(x, y)`; −1: none. */
    const putOn = (id: BuildingId, ore: number, ps: readonly number[], ax: number, ay: number, turn: (x: number, y: number) => Rot): number => {
      const def = buildingIdx(id), [w, hh] = footprint(def, 0);
      for (const [dx, dy] of SPIRAL_FAR) for (const p of ps) {
        const x = ax + dx - (w >> 1), y = ay + dy - (hh >> 1);
        if (parcelAt(x, y) !== p || !fits(w, hh, x, y, p, true, true)) continue;
        let all = true;
        for (let ty = y; ty < y + hh && all; ty++) for (let tx = x; tx < x + w && all; tx++) all = made(tx, ty).ore === ore;
        if (!all) continue;
        // Turned towards what it feeds, else the next way round whose outlet opens on its floor.
        const want = turn(x + w / 2, y + hh / 2);
        const rot = ([0, 1, 3, 2] as const).map((k) => ((want + k) & 3) as Rot).find((q) => !worldPorts({ def, x, y, rot: q }).some((o) => !free(o.fx, o.fy) || !region.has(tileIndex(o.fx, o.fy))));
        if (rot === undefined) continue;
        for (let ty = y - 1; ty <= y + hh; ty++) for (let tx = x - 1; tx <= x + w; tx++) { room.add(tileIndex(tx, ty)); drillRoom.add(tileIndex(tx, ty)); }
        for (let ty = y; ty < y + hh; ty++) for (let tx = x; tx < x + w; tx++) solid.add(tileIndex(tx, ty));
        structs.push({ def, x, y, rot });
        for (const q of worldPorts({ def, x, y, rot })) fronts.add(tileIndex(q.fx, q.fy));
        return structs.length - 1;
      }
      return -1;
    };
    /** What each struct is to the base: its role, its recipe, what it puts out or holds. */
    const meta = new Map<number, { role: NRole; recipe?: string; items?: readonly string[]; stage?: number }>();
    if (!parcels.length) return { layout: EMPTY_LAYOUT, raws: new Set(), unplaced };
    // 1. Its Core in the hub's middle, and the floor it stands on: every piece of its chain stands there,
    // so a ribbon can always find its way between them. A middle on a pocket of floor too small for a
    // base (less than `BAL.land.neighbours.pocket` tiles joined to it): the spot of its parcels, round
    // their middles, with the most.
    const flood = (x0: number, y0: number, into: Set<number>): number => {
      const q: number[] = [tileIndex(x0, y0)];
      into.add(q[0]!);
      for (let k = 0; k < q.length; k++) {
        const t = q[k]!, x = t % WORLD, y = (t - x) / WORLD;
        for (let d = 0; d < 4; d++) {
          const nx = x + DX[d]!, ny = y + DY[d]!, n = tileIndex(nx, ny);
          if (into.has(n) || !open(nx, ny)) continue;
          into.add(n);
          q.push(n);
        }
      }
      return into.size;
    };
    const [cw0, ch0] = footprint(buildingIdx(NEIGHBOUR_CORE), 0);
    const floorAt = (p: number, ax: number, ay: number): number => (fits(cw0, ch0, ax - (cw0 >> 1), ay - (ch0 >> 1), p, false, false) ? flood(ax - (cw0 >> 1), ay - (ch0 >> 1), new Set()) : -1);
    let hub = parcels[0]!, [hx, hy] = parcelCentre(hub);
    let raws: Set<string>, oreAt: Map<string, [number, number]>, drills: Map<string, number>;
    // The survey (its Core's place, its floor, what that floor gives) is the same for every try: once a base.
    const key = `${h.hub}:${parcels.join(',')}`, sv = this.surveys.get(key);
    if (sv) ({ hub, hx, hy, region, raws, oreAt, drills } = { ...sv, raws: new Set(sv.raws) });
    else {
    let most = floorAt(hub, hx, hy);
    if (most < BAL.land.neighbours.pocket) for (const p of parcels) for (const [dx, dy] of CORE_TRIES) {
      const [cx, cy] = parcelCentre(p), n = floorAt(p, cx + dx, cy + dy);
      if (n > most) { most = n; hub = p; hx = cx + dx; hy = cy + dy; }
    }
    // Its Core's place on the hub round (hx, hy) (laid below, once its flow is known): the floor joined to it is the base's.
    for (const [dx, dy] of SPIRAL) {
      const x = hx + dx - (cw0 >> 1), y = hy + dy - (ch0 >> 1);
      if (fits(cw0, ch0, x, y, hub, false, false)) { flood(x, y, region); break; }
    }
    // 2. What its land gives it: sand everywhere, each ore with room for a drill on it on that floor.
    // Sand where that floor has room for its collectors: `BAL.land.neighbours.sand` places of 2 × 2 bare sand.
    raws = new Set<string>();
    const bare = (x: number, y: number): boolean => { const m = made(x, y); return m.ore < 0 && m.terrain === T.Sand && region.has(tileIndex(x, y)); };
    let sandSpots = 0;
    for (const t of region) {
      const x = t % WORLD, y = (t - x) / WORLD;
      if ((x & 1) || (y & 1)) continue; // one place in four tiles: 2 × 2 places that do not overlap
      if (bare(x, y) && bare(x + 1, y) && bare(x, y + 1) && bare(x + 1, y + 1)) sandSpots++;
    }
    if (sandSpots >= BAL.land.neighbours.sand) raws.add('sand');
    oreAt = new Map<string, [number, number]>(); // each ore's drill place nearest the Core's
    // How many drills each ore holds (D134: a small copper deposit, two — a chain never wants more):
    // its 2 × 2 places taken in reading order, a tile of room between two (for their lines out).
    drills = new Map<string, number>();
    const taken = new Set<number>();
    for (const p of parcels) {
      const r = parcelRect(p);
      for (let y = r.y0 + 1; y < r.y1 - 2; y++) for (let x = r.x0 + 1; x < r.x1 - 2; x++) {
        const o = made(x, y).ore;
        if (o < 0 || itemDef(o).face) continue;
        if ([[1, 0], [0, 1], [1, 1]].every(([dx, dy]) => made(x + dx!, y + dy!).ore === o) && [[0, 0], [1, 0], [0, 1], [1, 1]].every(([dx, dy]) => region.has(tileIndex(x + dx!, y + dy!)))) {
          const id = ITEM_IDS[o]!, was = oreAt.get(id), d = (x - hx) * (x - hx) + (y - hy) * (y - hy);
          raws.add(id);
          if (!was || d < (was[0] - hx) * (was[0] - hx) + (was[1] - hy) * (was[1] - hy)) oreAt.set(id, [x + 1, y + 1]);
          if ([[0, 0], [1, 0], [0, 1], [1, 1]].some(([dx, dy]) => taken.has(tileIndex(x + dx!, y + dy!)))) continue;
          drills.set(id, (drills.get(id) ?? 0) + 1);
          for (let ty = y - 1; ty <= y + 2; ty++) for (let tx = x - 1; tx <= x + 2; tx++) taken.add(tileIndex(tx, ty));
        }
      }
    }
    // A mining camp quarries its rock: stone where an excavator's place on that floor has rock within its reach.
    if (NEIGHBOUR_LEANS[h.profile]?.includes('stone')) {
      const [ew, eh] = footprint(buildingIdx('excavator'), 0);
      search: for (const p of parcels) {
        const r = parcelRect(p);
        for (let y = r.y0 + 1; y + eh <= r.y1 - 1; y += 2) for (let x = r.x0 + 1; x + ew <= r.x1 - 1; x += 2) {
          if (fits(ew, eh, x, y, p, false, true) && byRock(x, y, ew, eh)) { raws.add('stone'); break search; }
        }
      }
    }
    this.surveys.set(key, { hub, hx, hy, region, raws: new Set(raws), oreAt, drills });
    }
    // 3. What it makes (world/neighbour-chain.ts): its trade's goods, back-chained to that land (less
    // what an earlier try could not lay: `layChecked`).
    for (const b of ban) raws.delete(b);
    // Its plainest: glass from its sand, else a mine on its largest deposit.
    if (ban.has('*')) {
      const keep = raws.has('sand') ? 'sand' : [...raws].sort((a, b) => (drills.get(b) ?? 0) - (drills.get(a) ?? 0) || (a < b ? -1 : a > b ? 1 : 0))[0];
      for (const r of [...raws]) if (r !== keep) raws.delete(r);
    }
    const chain = planChain(h.profile, raws, maxProducts, ban.has('*'), copies, drills);
    // The way its goods flow: from the deposit its main line starts at (upstream) to the Core — its
    // drills on the ore, its machines between, one flow towards the pad; else from its other parcels
    // (north when it stands alone).
    const others = parcels.filter((p) => p !== hub);
    const [ox, oy] = oreAt.get(chain.story[0] ?? '') ?? (others.length ? parcelCentre(others[0]!) : [hx, hy - 1]);
    const sx = Math.sign(ox - hx), sy = Math.sign(oy - hy);
    const ux = Math.abs(ox - hx) >= Math.abs(oy - hy) ? sx || 1 : 0, uy = ux ? 0 : sy || -1; // upstream, on one axis
    const down = dirOf(-ux, -uy); // the way its goods leave: to the pad
    const hubFirst = [hub, ...others], othersFirst = others.length ? [...others, hub] : [hub];
    // Its Core, its intakes (its back) towards the pad's side, where its store stands.
    const core = put(NEIGHBOUR_CORE, [hub], hx, hy, 0, true, dirOf(-uy * side, -ux * side));
    if (core >= 0) meta.set(core, { role: 'core' });
    // 4. CrierBelt's trade post downstream of the Core, its back (its intake) upstream; the silo before
    // its intake, its front (its outlets) towards it.
    // Beside the Core (across the flow), so the chain comes in from upstream with nothing in its way.
    const L7 = 7 * side; // across the flow: the pad's side of the Core (the other on a retry)
    const post = put(NEIGHBOUR_PAD, hubFirst, hx - ux * 2 + uy * L7, hy - uy * 2 + ux * L7, 1, true, down, true);
    if (post >= 0) meta.set(post, { role: 'post', items: chain.products });
    const postIn = post >= 0 ? worldPorts(structs[post]!).find((q) => q.io === 'in') : undefined;
    // Its outlets side by side across the flow: one before the pad's intake, the other on the Core's side.
    const csx = -uy * side, csy = -ux * side;
    const store = put('silo', hubFirst, (postIn?.fx ?? hx) + ux * 2 + Math.max(0, csx), (postIn?.fy ?? hy) + uy * 2 + Math.max(0, csy), 2, true, down);
    if (store >= 0) meta.set(store, { role: 'store', items: chain.products });
    // 5. Its chain, consumers first: each stage upstream of what it feeds, its front (its outlet) towards
    // it; an extractor on its own ground (a drill on its ore, anywhere on the base's floor).
    const at = new Map<number, number>(); // stage → struct
    const feeds = new Map<number, number>(); // stage → the stage it feeds (−1: the store)
    for (const st of chain.stages) for (const i of st.ins) feeds.set(i.from, st.id);
    for (const st of chain.stages) if (!feeds.has(st.id)) feeds.set(st.id, -1);
    const centreOf = (k: number): [number, number] => { const q = structs[k]!, [w, hh] = footprint(q.def, q.rot); return [q.x + w / 2, q.y + hh / 2]; };
    const towards = (x: number, y: number, k: number): Rot => { const [cx, cy] = centreOf(k); return Math.abs(cx - x) >= Math.abs(cy - y) ? dirOf(Math.sign(cx - x) || 1, 0) : dirOf(0, Math.sign(cy - y) || 1); };
    // Turned so its outlet faces `want` (an excavator's stone leaves at its back).
    const aim = (id: BuildingId, want: Rot): Rot => ((want - (worldPorts({ def: buildingIdx(id), x: 0, y: 0, rot: 0 }).find((q) => q.io === 'out')?.dir ?? 0) + 4) & 3) as Rot;
    // Each stage's depth (steps from the store) and the deposit its main line comes from: a machine
    // stands on the way from that deposit to the store, by its depth (one main flow, short lines),
    // its drills on the deposit; a chain of sand or stone, out from what it feeds along the flow.
    const depth = new Map<number, number>();
    const depthOf = (id: number): number => { let d = depth.get(id); if (d === undefined) { const to = feeds.get(id)!; depth.set(id, (d = to < 0 ? 1 : depthOf(to) + 1)); } return d; };
    const rawOf = (st: Stage): string => {
      if (st.role !== 'make') return st.item;
      const main = mainInput(RECIPES[st.recipe as keyof typeof RECIPES] as RecipeDef);
      const f = st.ins.find((i) => i.item === main);
      return f ? rawOf(chain.stages[f.from]!) : st.item;
    };
    const deepest = Math.max(1, ...chain.stages.map((st) => depthOf(st.id)));
    const missed: Stage[] = [];
    // The drills first, on their deposits, turned towards the store (D134: a small deposit by the
    // Core held no drill once a machine stood before it); then the rest, consumers first.
    const drill = (st: Stage): boolean => st.role === 'extract' && !!st.building && wantsOre(buildingIdx(st.building));
    const order = [...chain.stages].reverse();
    for (const st of [...order.filter(drill), ...order.filter((o) => !drill(o))]) {
      if (!st.building || skip.has(st.id)) continue;
      if (drill(st)) {
        const dep = oreAt.get(st.item);
        const idx = store >= 0 && dep ? putOn(st.building, itemIdx(st.item), othersFirst, dep[0], dep[1], (x, y) => aim(st.building!, towards(x, y, store))) : -1;
        if (idx < 0) { missed.push(st); continue; }
        at.set(st.id, idx);
        meta.set(idx, { role: 'extract', items: [st.item], stage: st.id });
        continue;
      }
      const to = feeds.get(st.id)!, target = to < 0 ? store : at.get(to) ?? -1;
      if (target < 0) continue;
      const sibs = chain.stages.filter((o) => feeds.get(o.id) === to), k = sibs.findIndex((o) => o.id === st.id);
      const [tx, ty] = centreOf(target), lat = (k - (sibs.length - 1) / 2) * 4, far = st.role === 'extract' ? 9 : 6;
      const dep = oreAt.get(rawOf(st)), [sx0, sy0] = store >= 0 ? centreOf(store) : [hx, hy];
      const f = depthOf(st.id) / deepest;
      const ax = dep ? Math.round(sx0 + (dep[0] - sx0) * f + uy * lat) : Math.round(tx + ux * far + uy * lat);
      const ay = dep ? Math.round(sy0 + (dep[1] - sy0) * f + ux * lat) : Math.round(ty + uy * far + ux * lat);
      // An extractor (a sand collector, an excavator) looks farther for its ground.
      const idx = put(st.building, st.role === 'extract' ? othersFirst : hubFirst, ax, ay, 10 + st.id, true, aim(st.building, towards(ax, ay, target)), st.role === 'extract');
      if (idx < 0) { missed.push(st); continue; }
      at.set(st.id, idx);
      meta.set(idx, { role: st.role === 'extract' ? 'extract' : 'make', recipe: st.recipe ?? undefined, items: [st.item], stage: st.id });
    }
    // An extractor that found no ground is given up when another of its kind feeds the same machine.
    for (const st of missed) if (st.role !== 'extract' || !chain.stages.some((o) => o.role === 'extract' && o.item === st.item && feeds.get(o.id) === feeds.get(st.id) && at.has(o.id))) unplaced.push(st.item);
    // 6. The ribbons, port to port, nearest the pad first: the silo into the pad, then each stage into
    // what it feeds (a second producer of one input joins the first's line from its side), the silo
    // into the Core last. Nothing leaves the pad but by CrierBelt's lift: the base buys nothing.
    // Every port's outside tile is kept for its own line.
    const ribbons: NRibbon[] = [];
    const edges: Array<{ from: number; outPort: number; to: number; inPort: number; items: string[] }> = [];
    // The silo's outlet before the pad's intake runs into it, the other into the Core: their lines never cross.
    const storeOuts = store >= 0 ? worldPorts(structs[store]!).filter((q) => q.io === 'out') : [];
    const gapTo = (q: WorldPort | undefined): number => (q && postIn ? Math.abs(q.fx - postIn.fx) + Math.abs(q.fy - postIn.fy) : 0);
    const toCore = storeOuts.length > 1 && gapTo(storeOuts[0]) <= gapTo(storeOuts[1]) ? 1 : 0;
    if (store >= 0 && post >= 0) edges.push({ from: store, outPort: 1 - toCore, to: post, inPort: 0, items: [...chain.products] });
    const inPortOf = new Map<number, Map<string, number>>(); // struct → item → its in-port (in order)
    for (const st of mineFirst ? chain.stages : [...chain.stages].reverse()) {
      const to = feeds.get(st.id)!, target = to < 0 ? store : at.get(to) ?? -1;
      const from = at.get(st.id) ?? -1;
      if (target < 0 || from < 0) continue;
      const ins = worldPorts(structs[target]!).filter((q) => q.io === 'in');
      let byItem = inPortOf.get(target);
      if (!byItem) inPortOf.set(target, (byItem = new Map()));
      if (!byItem.has(st.item)) byItem.set(st.item, Math.min(byItem.size, ins.length - 1));
      edges.push({ from, outPort: 0, to: target, inPort: byItem.get(st.item)!, items: [st.item] });
    }
    // The silo's second outlet into the Core, last: its line keeps out of the chain's way.
    if (store >= 0 && core >= 0) edges.push({ from: store, outPort: toCore, to: core, inPort: -1, items: [...chain.products] });
    const keep = new Set<number>();
    const portTile = (k: number, io: 'in' | 'out', n: number): WorldPort | undefined => worldPorts(structs[k]!).filter((q) => q.io === io)[n];
    for (const e of edges) {
      const o = portTile(e.from, 'out', e.outPort);
      if (o) keep.add(tileIndex(o.fx, o.fy));
      const i = e.inPort >= 0 ? portTile(e.to, 'in', e.inPort) : undefined;
      if (i) keep.add(tileIndex(i.fx, i.fy));
    }
    for (const e of edges) {
      const o = portTile(e.from, 'out', e.outPort);
      if (!o || !e.items.length) continue;
      // Into the Core: its nearest intake, else the next.
      const intakes = e.inPort >= 0 ? [portTile(e.to, 'in', e.inPort)] : worldPorts(structs[e.to]!).filter((q) => q.io === 'in').sort((a, b) => Math.abs(a.fx - o.fx) + Math.abs(a.fy - o.fy) - (Math.abs(b.fx - o.fx) + Math.abs(b.fy - o.fy)) || a.idx - b.idx);
      for (const i of intakes) {
        if (!i) continue;
        const joins = ribbons.filter((r) => r.to === e.to && r.port === i.idx);
        const tl = this.line(o, i, joins, open, solid, keep);
        if (tl) { ribbons.push({ tiles: tl, item: itemIdx(e.items[0]!), items: e.items.map(itemIdx), from: e.from, to: e.to, port: i.idx }); break; }
      }
    }
    // 7. Its power and extras on the hub's far side; its covered depots by the Core.
    const power = kit.power.map((id, j) => put(id, hubFirst, hx + uy * L7 - ux * 2, hy + ux * L7 - uy * 2, 30 + j, false)).filter((i) => i >= 0);
    for (const k of power) meta.set(k, { role: 'power' });
    kit.extra.forEach((id, j) => { const k = put(id, hubFirst, hx - uy * L7, hy - ux * L7, 40 + j, false); if (k >= 0) meta.set(k, { role: 'extra' }); });
    const tents: Array<[number, number]> = [];
    for (let j = 0; j < kit.tents; j++) {
      const at = spot(NEIGHBOUR_TENT, NEIGHBOUR_TENT, hub, hx - uy * 6 * side + ux * 3, hy - ux * 6 * side + uy * 3, false, false);
      if (at) tents.push(at);
    }
    // A parcel still bare (its floor cut off from the pad's by the land): a turbine on the base's grid, else a depot.
    for (const p of parcels) {
      if (structs.some((s) => parcelAt(s.x, s.y) === p) || tents.some(([x, y]) => parcelAt(x, y) === p)) continue;
      const [cx, cy] = parcelCentre(p);
      const k = put('wind_flower', [p], cx, cy, 50, false);
      if (k >= 0) { power.push(k); meta.set(k, { role: 'power' }); continue; }
      const at = spot(NEIGHBOUR_TENT, NEIGHBOUR_TENT, p, cx, cy, false, false);
      if (at) tents.push(at);
    }
    // 8. The flag and two banner poles round its Core.
    let flag: [number, number] | null = null;
    const banners: Array<[number, number]> = [];
    if (core >= 0) {
      const s = structs[core]!, [w, hh] = footprint(s.def, s.rot);
      // The tiles round the Core, its corners first, then along its sides from their middles.
      const ring: Array<[number, number]> = [[s.x - 1, s.y - 1], [s.x + w, s.y - 1], [s.x - 1, s.y + hh], [s.x + w, s.y + hh]];
      for (let k = 0; k <= Math.max(w, hh); k++) for (const sg of [1, -1]) {
        const i = (w >> 1) + sg * k, j = (hh >> 1) + sg * k;
        if (i >= 0 && i < w) ring.push([s.x + i, s.y - 1], [s.x + i, s.y + hh]);
        if (j >= 0 && j < hh) ring.push([s.x - 1, s.y + j], [s.x + w, s.y + j]);
      }
      for (const [x, y] of ring) {
        if (flag && banners.length >= 2) break;
        if (!free(x, y)) continue;
        solid.add(tileIndex(x, y));
        if (!flag) flag = [x, y];
        else banners.push([x, y]);
      }
    }
    // 9. Its grid: every building that takes part in power, wired from its Core through masts.
    const wires = this.wire(structs, core >= 0 ? core : power[0] ?? -1, solid, free);
    // 8. The cairns along its outer edge, a gap between each two.
    const cairns: Array<[number, number]> = [];
    for (const p of parcels) {
      const r = parcelRect(p), col = p % PARCEL_COLS, row = Math.floor(p / PARCEL_COLS);
      const out = (c: number, rr: number): boolean => c < 0 || rr < 0 || c >= PARCEL_COLS || rr >= PARCEL_COLS || !allowed.has(rr * PARCEL_COLS + c);
      const edges: Array<[number, number, number, number]> = [];
      if (out(col, row - 1)) edges.push([r.x0, r.y0, 1, 0]);
      if (out(col, row + 1)) edges.push([r.x0, r.y1 - 1, 1, 0]);
      if (out(col - 1, row)) edges.push([r.x0, r.y0, 0, 1]);
      if (out(col + 1, row)) edges.push([r.x1 - 1, r.y0, 0, 1]);
      for (const [x0, y0, dx, dy] of edges) for (let k = 2; k < PARCEL - 1; k += NEIGHBOUR_CAIRN_STEP) {
        const x = x0 + dx * k, y = y0 + dy * k;
        if (!free(x, y) || room.has(tileIndex(x, y))) continue;
        solid.add(tileIndex(x, y));
        cairns.push([x, y]);
      }
    }
    for (const [k, m] of meta) structs[k] = { ...structs[k]!, role: m.role, ...(m.recipe ? { recipe: m.recipe } : {}), ...(m.items ? { items: m.items.map(itemIdx) } : {}), ...(m.stage !== undefined ? { stage: m.stage } : {}) };
    for (let k = 0; k < structs.length; k++) if (!structs[k]!.role) structs[k] = { ...structs[k]!, role: structs[k]!.def === buildingIdx(NEIGHBOUR_MAST) ? 'mast' : 'extra' };
    const products = chain.products.map(itemIdx), lines = linesOf(structs, ribbons, products);
    return { layout: { structs, core, products, lines, story: lines[0] ?? [], ribbons, wires, flag, banners, tents, cairns, tiles: solid }, raws, unplaced };
  }

  /**
   * A base's grid (the claim's rule of reach, sim/power/links.ts: a wire needs a mast at one end,
   * no longer than its range edge to edge, at most its slots on it): from its Core, every
   * other building that takes part in power is joined, nearest the Core first, by a wire from a
   * mast of the grid within reach, else through new masts stepping towards the grid. Masts go on free
   * open floor. Returns the wires (struct indices, the lower first); the masts join `structs`.
   */
  private wire(structs: NStruct[], root: number, solid: Set<number>, free: (x: number, y: number) => boolean): Array<[number, number]> {
    const wires: Array<[number, number]> = [];
    if (root < 0) return wires;
    const mastDef = buildingIdx(NEIGHBOUR_MAST), pole = buildingDef(mastDef).pole!, R2 = pole.range * pole.range;
    const deg = new Map<number, number>();
    const isMast = (i: number): boolean => structs[i]!.def === mastDef;
    const ok = (i: number, j: number): boolean => (isMast(i) || isMast(j)) && gap2(structs[i]!, structs[j]!) <= R2
      && (!isMast(i) || (deg.get(i) ?? 0) < pole.slots) && (!isMast(j) || (deg.get(j) ?? 0) < pole.slots);
    const link = (i: number, j: number): void => {
      wires.push(i < j ? [i, j] : [j, i]);
      deg.set(i, (deg.get(i) ?? 0) + 1); deg.set(j, (deg.get(j) ?? 0) + 1);
    };
    const mid = (i: number): [number, number] => { const s = structs[i]!, [w, h] = footprint(s.def, s.rot); return [s.x + (w >> 1), s.y + (h >> 1)]; };
    const d2 = (a: [number, number], b: [number, number]): number => (a[0] - b[0]) * (a[0] - b[0]) + (a[1] - b[1]) * (a[1] - b[1]);
    /** A new mast on free floor near (tx, ty), within reach of struct i; its index, or −1. */
    const mastNear = (i: number, tx: number, ty: number): number => {
      for (const [dx, dy] of SPIRAL) {
        if (dx * dx + dy * dy > 16) break;
        const x = tx + dx, y = ty + dy;
        if (!free(x, y)) continue;
        if (gap2(structs[i]!, { def: mastDef, x, y, rot: 0 }) > R2) continue;
        structs.push({ def: mastDef, x, y, rot: 0 });
        solid.add(tileIndex(x, y));
        return structs.length - 1;
      }
      return -1;
    };
    const net = new Set<number>([root]);
    const at0 = mid(root);
    const todo = structs.map((s, i) => i).filter((i) => i !== root && linkable(structs[i]!.def) && !isMast(i))
      .sort((a, b) => d2(mid(a), at0) - d2(mid(b), at0) || a - b);
    for (const i of todo) {
      // A chain from this building towards the grid; joined only if it gets there, else undone.
      const w0 = wires.length, s0 = structs.length, chain = [i];
      let cur = i, joined = false;
      for (let step = 0; step < 14 && !joined; step++) {
        // A node of the grid this one may be wired to, nearest first.
        const near = [...net].sort((a, b) => gap2(structs[cur]!, structs[a]!) - gap2(structs[cur]!, structs[b]!) || a - b);
        const j = near.find((n) => ok(cur, n));
        if (j !== undefined) { link(cur, j); joined = true; break; }
        // Else a mast towards the nearest node of the grid, within reach of this one, nearer the grid.
        const [cx, cy] = mid(cur), [gx, gy] = mid(near[0]!);
        const d = Math.max(1, isqrt(d2([cx, cy], [gx, gy]))), k = Math.min(pole.range - 1, d - 1);
        const m = mastNear(cur, cx + Math.trunc(((gx - cx) * k) / d), cy + Math.trunc(((gy - cy) * k) / d));
        if (m < 0 || !ok(cur, m)) break;
        link(cur, m);
        chain.push(m);
        cur = m;
      }
      if (joined) { for (const c of chain) net.add(c); continue; }
      // It never reached the grid: its wires and new masts taken back (an island would read as wired).
      for (const [a, b] of wires.splice(w0)) { deg.set(a, deg.get(a)! - 1); deg.set(b, deg.get(b)! - 1); }
      for (const s of structs.splice(s0)) solid.delete(tileIndex(s.x, s.y));
    }
    return wires;
  }

  /**
   * A ribbon from an outlet to an intake over open, free tiles (breadth-first, N E S W): from the
   * tile the outlet faces to the tile the intake faces, its last tile turned into the intake — or,
   * when `joins` already go there, onto the side of one of their tiles (never head on, never from
   * behind its own feeder), so two producers of one input share one line. The outside tiles of the
   * other ports are kept clear (`keep`). x, y, rot per tile, each turned to the next; its tiles taken.
   * Null when no way of at most `RIBBON_MAX` tiles exists.
   */
  private line(o: WorldPort, i: WorldPort, joins: readonly NRibbon[], open: (x: number, y: number) => boolean, solid: Set<number>, keep: ReadonlySet<number>): Int32Array | null {
    const start = tileIndex(o.fx, o.fy), goal = tileIndex(i.fx, i.fy);
    const ok = (t: number): boolean => { const x = t % WORLD; return open(x, (t - x) / WORLD) && !solid.has(t) && (!keep.has(t) || t === start || t === goal); };
    if (!ok(start)) return null;
    // Where a join may land: a joined line's tiles, each with its own way (the new line enters it from a side).
    const onto = new Map<number, number>();
    for (const r of joins) for (let k = 0; k < r.tiles.length; k += 3) onto.set(tileIndex(r.tiles[k]!, r.tiles[k + 1]!), r.tiles[k + 2]!);
    const from = new Map<number, number>(), depth = new Map<number, number>();
    const queue = [start];
    from.set(start, -1); depth.set(start, 1);
    let end = -1, into = -1; // the last tile, and the way it turns (into the intake, or onto a joined line)
    for (let q = 0; q < queue.length && end < 0; q++) {
      const t = queue[q]!, x = t % WORLD, y = (t - x) / WORLD;
      if (t === goal) { end = t; into = opposite(i.dir); break; }
      for (let d = 0; d < 4 && joins.length; d++) {
        const n = tileIndex(x + DX[d]!, y + DY[d]!), way = onto.get(n);
        if (way !== undefined && (way & 1) !== (d & 1)) { end = t; into = d; break; } // onto its side
      }
      if (end >= 0) break;
      const dd = depth.get(t)!;
      if (dd >= RIBBON_MAX) continue;
      for (let d = 0; d < 4; d++) {
        const nx = x + DX[d]!, ny = y + DY[d]!, n = tileIndex(nx, ny);
        if (from.has(n) || !ok(n)) continue;
        from.set(n, t); depth.set(n, dd + 1); queue.push(n);
      }
    }
    if (end < 0) return null;
    const path: number[] = [];
    for (let t = end; t >= 0; t = from.get(t)!) path.push(t);
    path.reverse();
    const out = new Int32Array(path.length * 3);
    path.forEach((t, k) => {
      const x = t % WORLD, y = (t - x) / WORLD;
      let rot = into;
      if (k + 1 < path.length) {
        const n = path[k + 1]!, nx = n % WORLD, ny = (n - nx) / WORLD;
        for (let r = 0; r < 4; r++) if (x + DX[r]! === nx && y + DY[r]! === ny) rot = r;
      }
      out[k * 3] = x; out[k * 3 + 1] = y; out[k * 3 + 2] = rot;
      solid.add(t);
    });
    return out;
  }
}

/**
 * What a base's layout gets wrong against the content and its own geometry (empty: nothing) — the
 * owner's « du charbon rentre dans des fileuses… rien n'est jamais envoyé par trade post », then
 * « Elle commande de la pierre, la transforme en minerai de fer et la revend ? » (D134):
 * - a maker whose building cannot run its recipe, that does not put out what it claims, that misses
 *   one of its recipe's inputs, is fed something its recipe does not take, or sends its goods nowhere;
 *   one that is no business (no value added, a raw good made: a sifter's stone → ore);
 * - anything leaving its trade post by a ribbon (the post ships what the base makes; it buys nothing);
 * - an extractor not on its own ground (a drill off its ore, a collector off bare sand), or idle;
 * - a ribbon that does not leave its producer's outlet, carries what its producer does not put out, or
 *   ends neither in its consumer's intake (turned into it) nor on the side of a line going there;
 * - nothing reaching the trade post, or a good it sells never reaching the store before it.
 * Each problem names the item it is about, when there is one (the retry gives that raw good up).
 */
const NO_POST = 'nothing goes to the trade post';

export function neighbourProblems(grid: Grid, L: NLayout): Array<{ what: string; item?: string }> {
  const out: Array<{ what: string; item?: string }> = [];
  const name = (k: number): string => `${BUILDING_IDS[L.structs[k]!.def]}#${k}`;
  const into = (k: number): NRibbon[] => L.ribbons.filter((r) => r.to === k);
  const from = (k: number): NRibbon[] => L.ribbons.filter((r) => r.from === k);
  L.structs.forEach((s, k) => {
    if (s.role === 'make') {
      const r = RECIPES[s.recipe as keyof typeof RECIPES] as RecipeDef | undefined, item = ITEM_IDS[s.items?.[0] ?? -1];
      if (!r) { out.push({ what: `${name(k)}: no recipe ${s.recipe}` }); return; }
      if (!r.machines.includes(BUILDING_IDS[s.def]!)) out.push({ what: `${name(k)} cannot run ${s.recipe}` });
      if (!item || !r.outs.some(([o]) => o === item)) out.push({ what: `${name(k)}: ${s.recipe} does not make ${item}` });
      for (const [n] of r.ins) if (!into(k).some((rb) => rb.items.includes(itemIdx(n)))) out.push({ what: `${name(k)} (${s.recipe}) gets no ${n}`, item: n });
      for (const rb of into(k)) for (const it of rb.items) if (!r.ins.some(([n]) => n === ITEM_IDS[it])) out.push({ what: `${name(k)} (${s.recipe}) fed ${ITEM_IDS[it]}, which it does not take` });
      if (!from(k).length) out.push({ what: `${name(k)} (${s.recipe}) sends its ${item} nowhere`, item });
      // A business: every step adds value, none makes a raw good (neighbour-chain.ts `runs`).
      if (!runs(r)) out.push({ what: `${name(k)} (${s.recipe}) is no business: no value added, a raw good made, or a fluid` });
    } else if (s.role === 'post') {
      // Its trade post ships what the base makes; nothing comes in through it (D134).
      for (const rb of from(k)) out.push({ what: `${name(k)} (its trade post) hands out ${rb.items.map((i) => ITEM_IDS[i]).join('+')}`, item: ITEM_IDS[rb.item] });
    } else if (s.role === 'extract') {
      const item = s.items?.[0] ?? -1, [w, h] = footprint(s.def, s.rot), d = buildingDef(s.def).drill, ex = buildingDef(s.def).excavator;
      // An excavator digs the rock within its reach (it stands on floor beside it).
      if (ex) {
        let rock = false;
        for (let y = s.y - ex.reach; y < s.y + h + ex.reach && !rock; y++) for (let x = s.x - ex.reach; x < s.x + w + ex.reach && !rock; x++) { const m = grid.made0(x, y); rock = m.level > 0 || !isFloor(m.terrain); }
        if (!rock) out.push({ what: `${name(k)} has no rock to dig`, item: ITEM_IDS[item] });
      } else for (let y = s.y; y < s.y + h; y++) for (let x = s.x; x < s.x + w; x++) {
        const m = grid.made0(x, y);
        if (d?.ground ? m.ore >= 0 || m.terrain !== T.Sand : m.ore !== item) { out.push({ what: `${name(k)} is not on its ${ITEM_IDS[item]}`, item: ITEM_IDS[item] }); y = s.y + h; break; }
      }
      if (!from(k).length) out.push({ what: `${name(k)} sends its ${ITEM_IDS[item]} nowhere`, item: ITEM_IDS[item] });
    }
  });
  for (const rb of L.ribbons) {
    const a = L.structs[rb.from], b = L.structs[rb.to];
    if (!a || !b) { out.push({ what: 'a ribbon between nothing' }); continue; }
    if (!worldPorts(a).some((q) => q.io === 'out' && q.fx === rb.tiles[0] && q.fy === rb.tiles[1])) out.push({ what: `a ribbon from ${name(rb.from)} leaves no outlet` });
    if ((a.role === 'make' || a.role === 'extract') && !rb.items.every((it) => a.items?.includes(it))) out.push({ what: `a ribbon from ${name(rb.from)} carries what it does not put out` });
    const n = rb.tiles.length - 3, x = rb.tiles[n]!, y = rb.tiles[n + 1]!, rot = rb.tiles[n + 2]! as Rot;
    const intake = worldPorts(b).some((q) => q.io === 'in' && q.idx === rb.port && q.fx === x && q.fy === y && opposite(q.dir) === rot);
    if (!intake) {
      const ax = x + DX[rot]!, ay = y + DY[rot]!;
      const onto = L.ribbons.some((o) => o !== rb && o.to === rb.to && o.port === rb.port && Array.from({ length: o.tiles.length / 3 }, (_, k) => k).some((k) => o.tiles[k * 3] === ax && o.tiles[k * 3 + 1] === ay && (o.tiles[k * 3 + 2]! & 1) !== (rot & 1)));
      if (!onto) out.push({ what: `a ribbon from ${name(rb.from)} to ${name(rb.to)} ends nowhere`, item: ITEM_IDS[rb.item] });
    }
  }
  if (L.structs.length && !L.ribbons.some((rb) => L.structs[rb.to]?.role === 'post')) out.push({ what: NO_POST });
  if (L.core >= 0 && L.products.length && !L.ribbons.some((rb) => rb.to === L.core)) out.push({ what: 'nothing goes into its Core' });
  for (const p of L.products) if (!L.ribbons.some((rb) => L.structs[rb.to]?.role === 'store' && rb.items.includes(p))) out.push({ what: `its ${ITEM_IDS[p]} never reaches its store`, item: ITEM_IDS[p] });
  return out;
}

/**
 * A layout that still does not check, made to stand to reason: a maker missing an input or sending
 * nowhere, an extractor off its ground or idle, taken away with their lines, again until nothing else
 * goes; then a mast left at the end of a wire to nothing (it led to what went); what it sold and no
 * longer reaches its store is no longer sold. A base keeps its Core, store, pad and power, never a
 * machine that cannot run.
 */
function prune(L: NLayout, grid: Grid): NLayout {
  let cur = L;
  for (let k = 0; k < 8; k++) {
    const bad = new Set<number>();
    for (const q of neighbourProblems(grid, cur)) {
      const m = /#(\d+)/.exec(q.what);
      const i = m ? Number(m[1]) : -1;
      if (i >= 0 && (cur.structs[i]?.role === 'make' || cur.structs[i]?.role === 'extract')) bad.add(i);
    }
    if (!bad.size) break;
    cur = without(cur, bad);
  }
  for (let k = 0; k < 64; k++) {
    const deg = new Map<number, number>();
    for (const [a, b] of cur.wires) { deg.set(a, (deg.get(a) ?? 0) + 1); deg.set(b, (deg.get(b) ?? 0) + 1); }
    const bad = new Set<number>();
    cur.structs.forEach((q, i) => { if (q.role === 'mast' && (deg.get(i) ?? 0) <= 1) bad.add(i); });
    if (!bad.size) break;
    cur = without(cur, bad);
  }
  const products = cur.products.filter((p) => cur.ribbons.some((rb) => cur.structs[rb.to]?.role === 'store' && rb.items.includes(p) && cur.structs[rb.from]?.role !== 'store'));
  // What it no longer makes leaves its store's lines, its store and its pad too.
  const sold = (it: number): boolean => products.includes(it);
  const ribbons = cur.ribbons.map((rb) => (cur.structs[rb.from]?.role === 'store' ? { ...rb, items: rb.items.filter(sold), item: rb.items.find(sold) ?? rb.item } : rb)).filter((rb) => rb.items.length);
  const structs = cur.structs.map((q) => (q.role === 'store' || q.role === 'post' ? { ...q, items: (q.items ?? []).filter(sold) } : q));
  // Its lines told again of what it still sells, as what stands carries it.
  const lines = linesOf(structs, ribbons, products);
  return { ...cur, structs, ribbons, products, lines, story: lines[0] ?? [] };
}

/**
 * What a laid base does, a line per good it sells, raw good first, read off what stands: from the
 * maker whose ribbon brings the good into the store, back through each maker's main input (neighbour-
 * chain.ts `mainInput`, among the inputs its ribbons bring) to the extractor at the head — so the card
 * says what the ribbons carry, even of a base a try cut short.
 */
function linesOf(structs: readonly NStruct[], ribbons: readonly NRibbon[], products: readonly number[]): number[][] {
  const role = (k: number): NRole | undefined => structs[k]?.role;
  return products.map((p) => {
    const line = [p];
    let rb = ribbons.find((r) => role(r.to) === 'store' && role(r.from) !== 'store' && r.items.includes(p));
    for (let k = 0; rb && k < 8; k++) {
      const s = structs[rb.from]!;
      if (s.role !== 'make' || !s.recipe) break;
      const feeds = ribbons.filter((q) => q.to === rb!.from && (role(q.from) === 'make' || role(q.from) === 'extract'));
      const main = mainInput(RECIPES[s.recipe as keyof typeof RECIPES] as RecipeDef, (i) => feeds.some((q) => q.item === itemIdx(i)));
      if (main === undefined) break;
      line.unshift(itemIdx(main));
      rb = feeds.find((q) => q.item === itemIdx(main));
    }
    return line;
  });
}

/** A layout less some of its structures, with their lines and wires; the rest renumbered. */
function without(cur: NLayout, bad: ReadonlySet<number>): NLayout {
  const keep = cur.structs.map((_, i) => !bad.has(i));
  const remap = new Map<number, number>();
  cur.structs.forEach((_, i) => { if (keep[i]) remap.set(i, remap.size); });
  const tiles = new Set(cur.tiles);
  for (const i of bad) { const s = cur.structs[i]!, [w, h] = footprint(s.def, s.rot); for (let y = s.y; y < s.y + h; y++) for (let x = s.x; x < s.x + w; x++) tiles.delete(tileIndex(x, y)); }
  const ribbons = cur.ribbons.filter((r) => keep[r.from] && keep[r.to]);
  for (const r of cur.ribbons) if (!(keep[r.from] && keep[r.to])) for (let k = 0; k < r.tiles.length; k += 3) tiles.delete(tileIndex(r.tiles[k]!, r.tiles[k + 1]!));
  return {
    ...cur,
    structs: cur.structs.filter((_, i) => keep[i]),
    core: cur.core >= 0 ? remap.get(cur.core) ?? -1 : -1,
    ribbons: ribbons.map((r) => ({ ...r, from: remap.get(r.from)!, to: remap.get(r.to)! })),
    wires: cur.wires.filter(([a, b]) => keep[a] && keep[b]).map(([a, b]) => [remap.get(a)!, remap.get(b)!] as [number, number]),
    tiles,
  };
}
