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
import { NEIGHBOUR_CAIRN_STEP, NEIGHBOUR_CORE, NEIGHBOUR_KITS, NEIGHBOUR_MAST, NEIGHBOUR_PAD, NEIGHBOUR_TENT } from '@/content/neighbours';
import { BUILDING_KIND, buildingDef, buildingIdx, itemDef, itemIdx } from '@/content/registry';
import { isqrt } from '@/core/fixed';
import { hash32 } from '@/core/hash';
import { WORLD } from '../constants';
import { footprint } from '../entities';
import { gap2, linkable } from '../power/links';
import { DX, DY, isFloor, type Rot } from '../types';
import { inWorld, tileIndex, type Grid } from './grid';
import { HOME_COL, PARCEL, PARCEL_COLS, parcelAt, parcelCentre, parcelRect, ringOf, type Land } from './land';

/** A building of a neighbouring base: what it is, where it stands (its footprint's top-left tile), how it is turned. */
export interface NStruct { readonly def: number; readonly x: number; readonly y: number; readonly rot: Rot }

/** A ribbon line of a neighbouring base: its tiles in the order items ride (x, y, rot each), what it carries. */
export interface NRibbon { readonly tiles: Int32Array; readonly item: number }

/**
 * A neighbouring base's buildings (its masts among them), ribbons and wires (struct indices, the
 * lower first), its flag's tile and its banner poles', its covered depots (`NEIGHBOUR_TENT` tiles a
 * side, top-left), the cairns along its edge, and every tile any of it stands on.
 */
export interface NLayout {
  readonly structs: readonly NStruct[];
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

const EMPTY_LAYOUT: NLayout = { structs: [], core: -1, ribbons: [], wires: [], flag: null, banners: [], tents: [], cairns: [], tiles: new Set() };

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

/** Salts of the draws. */
const SALT = { block: 0xb10c, grow: 0x6a0e, perm: 0x9e7a, rot: 0x7a0e, scatter: 0x1a4d } as const;

/** Offsets round an anchor, nearest first (then by row, then by column): where a building is tried, in order. */
const SPIRAL: ReadonlyArray<readonly [number, number]> = (() => {
  const R = PARCEL >> 1, out: Array<[number, number]> = [];
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) if (dx * dx + dy * dy <= R * R) out.push([dx, dy]);
  return out.sort((a, b) => a[0] * a[0] + a[1] * a[1] - (b[0] * b[0] + b[1] * b[1]) || a[1] - b[1] || a[0] - b[0]);
})();

/** The longest ribbon a base lays (tiles). */
const RIBBON_MAX = 72;

const floorDiv = (a: number, b: number): number => Math.floor(a / b);
const mod = (a: number, n: number): number => ((a % n) + n) % n;
/** Do two parcels share a side? */
const sideBySide = (p: number, q: number): boolean => {
  const pc = p % PARCEL_COLS, qc = q % PARCEL_COLS;
  return (Math.abs(p - q) === 1 && Math.floor(p / PARCEL_COLS) === Math.floor(q / PARCEL_COLS)) || (Math.abs(p - q) === PARCEL_COLS && pc === qc);
};

/** Does a drill of this def want a deposit under it (not a sand or data collector, not a face cutter)? */
const wantsOre = (def: number): boolean => {
  const d = buildingDef(def).drill;
  return BUILDING_KIND[def] === 'drill' && !!d && !d.ground && !d.anywhere && !d.face;
};

export class Neighbours {
  /** Per parcel: −2 not drawn yet, −1 nobody's, else its holding's hub. */
  private readonly ofParcel = new Int32Array(PARCEL_COLS * PARCEL_COLS).fill(-2);
  private readonly holdings = new Map<number, Holding>();
  private readonly layouts = new Map<number, NLayout>();
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
    if (!L) { L = this.lay(h); this.layouts.set(h.hub, L); }
    return L;
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
  forget(): void { this.layouts.clear(); }

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
    if (h % 1000 >= N.chance) return;
    const ok = cells.filter((p) => this.eligible(p));
    if (!ok.length) return;
    const parcels = [ok[(h >>> 10) % ok.length]!];
    const size = N.size[0]! + ((h >>> 20) % (N.size[1]! - N.size[0]! + 1));
    for (let k = 1; k < size; k++) {
      const front = ok.filter((p) => !parcels.includes(p) && parcels.some((q) => sideBySide(p, q)));
      if (!front.length) break;
      parcels.push(front[hash32(this.land.seed, parcels[0]!, k, SALT.grow) % front.length]!);
    }
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
  private lay(h: Holding): NLayout {
    const kit = NEIGHBOUR_KITS[h.profile];
    // An older base's lease or grant on its land: that part of the base is not there.
    const parcels = h.parcels.filter((p) => !this.land.holds(p));
    const allowed = new Set(parcels);
    const solid = new Set<number>(); // what stands: buildings, ribbons, masts, the flag, poles, tents, cairns
    const room = new Set<number>(); // the buildings and the tile of room round each
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
    const region = new Set<number>();
    const fits = (w: number, hh: number, x: number, y: number, p: number, ore: boolean, joined: boolean): boolean => {
      const r = parcelRect(p);
      if (x < r.x0 + 1 || y < r.y0 + 1 || x + w > r.x1 - 1 || y + hh > r.y1 - 1) return false;
      for (let ty = y; ty < y + hh; ty++) for (let tx = x; tx < x + w; tx++) {
        const t = tileIndex(tx, ty);
        if (room.has(t) || solid.has(t) || !open(tx, ty) || (joined && region.size && !region.has(t))) return false;
        if (ore) { const o = made(tx, ty).ore; if (o < 0 || itemDef(o).face) return false; }
      }
      return true;
    };
    /** The nearest place on parcel p round (ax, ay) where a w × hh footprint fits, its room claimed; null: none. */
    const spot = (w: number, hh: number, p: number, ax: number, ay: number, ore = false, joined = true): [number, number] | null => {
      for (const [dx, dy] of SPIRAL) {
        const x = ax + dx - (w >> 1), y = ay + dy - (hh >> 1);
        if (!fits(w, hh, x, y, p, ore, joined)) continue;
        for (let ty = y - 1; ty <= y + hh; ty++) for (let tx = x - 1; tx <= x + w; tx++) room.add(tileIndex(tx, ty));
        for (let ty = y; ty < y + hh; ty++) for (let tx = x; tx < x + w; tx++) solid.add(tileIndex(tx, ty));
        return [x, y];
      }
      return null;
    };
    /**
     * A building on one of `ps` (in order) round (ax, ay); a drill wants a deposit, else a sand
     * collector stands in; `joined`: on the pad's floor (the chain's pieces). Its index, or −1.
     */
    const put = (id: BuildingId, ps: readonly number[], ax: number, ay: number, salt: number, joined = true): number => {
      let def = buildingIdx(id);
      if (wantsOre(def)) {
        for (const p of ps) {
          const at = spot(...footprint(def, 0), p, ax, ay, true, joined);
          if (at) { structs.push({ def, x: at[0], y: at[1], rot: 0 }); return structs.length - 1; }
        }
        def = buildingIdx('sand_collector');
      }
      const rot = (BUILDING_KIND[def] === 'machine' ? hash32(this.land.seed, h.hub, salt, SALT.rot) % 4 : 0) as Rot;
      for (const p of ps) {
        const at = spot(...footprint(def, rot), p, ax, ay, false, joined);
        if (at) { structs.push({ def, x: at[0], y: at[1], rot }); return structs.length - 1; }
      }
      return -1;
    };
    if (!parcels.length) return EMPTY_LAYOUT;
    const hub = parcels[0]!, [hx, hy] = parcelCentre(hub), others = parcels.slice(1);
    // The side of the hub towards the other parcels (north when it stands alone).
    const [ox, oy] = others.length ? parcelCentre(others[0]!) : [hx, hy - 1];
    const sx = Math.sign(ox - hx), sy = Math.sign(oy - hy);
    const hubFirst = [hub, ...others], othersFirst = others.length ? [...others, hub] : [hub];
    // 1. Its Core in the hub's middle and the floor it stands on; CrierBelt's lift pad set beside
    // it, away from the other parcels; the store beside it the other way.
    const core = put(NEIGHBOUR_CORE, [hub], hx, hy, 0);
    if (core >= 0) {
      const s = structs[core]!, q: number[] = [tileIndex(s.x, s.y)];
      region.add(q[0]!);
      for (let k = 0; k < q.length; k++) {
        const t = q[k]!, x = t % WORLD, y = (t - x) / WORLD;
        for (let d = 0; d < 4; d++) {
          const nx = x + DX[d]!, ny = y + DY[d]!, n = tileIndex(nx, ny);
          if (region.has(n) || !open(nx, ny)) continue;
          region.add(n);
          q.push(n);
        }
      }
    }
    put(NEIGHBOUR_PAD, hubFirst, hx - sx * 5, hy - (sy || -1) * 5, 1);
    const store = put(kit.store, hubFirst, hx - sy * 4, hy + sx * 4, 2);
    // 2. Its makers round the hub, towards the other parcels.
    const makers = kit.makers.map((id, j) => put(id, hubFirst, hx + sx * 6, hy + sy * 6, 10 + j)).filter((i) => i >= 0);
    // 3. Its extractors out on the other parcels, round their middles (towards the hub).
    const extract: number[] = [];
    for (let i = 0; i < kit.extractN; i++) {
      const p = othersFirst[i % othersFirst.length]!, [cx, cy] = parcelCentre(p);
      const k = put(kit.extract, [p, ...othersFirst.filter((q) => q !== p)], cx - Math.sign(cx - hx) * 3, cy - Math.sign(cy - hy) * 3, 20 + i);
      if (k >= 0) extract.push(k);
    }
    // 4. The ribbons the goods ride, carrying what each stage hands on — laid before anything else
    // stands in their way.
    const ribbons: NRibbon[] = [];
    const lay = (a: number, b: number, item: string | number): void => {
      if (a < 0 || b < 0) return;
      const r = this.ribbon(structs[a]!, structs[b]!, open, solid);
      if (r) ribbons.push({ tiles: r, item: typeof item === 'number' ? item : itemIdx(item) });
    };
    const stage = (j: number): string => kit.carries[Math.min(j, kit.carries.length - 1)]!;
    const head = makers.length ? makers[0]! : store;
    for (const e of extract) {
      const s = structs[e]!, o = made(s.x, s.y).ore;
      lay(e, head, wantsOre(s.def) && o >= 0 ? o : stage(0));
    }
    makers.forEach((m, j) => lay(m, j + 1 < makers.length ? makers[j + 1]! : store, stage(j + 1)));
    lay(store, core, stage(kit.carries.length - 1)); // into the Core: what it holds leaves from the pad beside it
    // 5. Its power and extras on the hub's far side; its covered depots by the Core.
    const power = kit.power.map((id, j) => put(id, hubFirst, hx - sx * 6 + sy * 3, hy - sy * 6 + sx * 3, 30 + j, false)).filter((i) => i >= 0);
    kit.extra.forEach((id, j) => put(id, hubFirst, hx + sx * 4 - sy * 5, hy + sy * 4 + sx * 5, 40 + j, false));
    const tents: Array<[number, number]> = [];
    for (let j = 0; j < kit.tents; j++) {
      const at = spot(NEIGHBOUR_TENT, NEIGHBOUR_TENT, hub, hx + sy * 6, hy - sx * 6, false, false);
      if (at) tents.push(at);
    }
    // A parcel still bare (its floor cut off from the pad's by the land): a turbine on the base's grid, else a depot.
    for (const p of parcels) {
      if (structs.some((s) => parcelAt(s.x, s.y) === p) || tents.some(([x, y]) => parcelAt(x, y) === p)) continue;
      const [cx, cy] = parcelCentre(p);
      const k = put('wind_flower', [p], cx, cy, 50, false);
      if (k >= 0) { power.push(k); continue; }
      const at = spot(NEIGHBOUR_TENT, NEIGHBOUR_TENT, p, cx, cy, false, false);
      if (at) tents.push(at);
    }
    // 6. The flag and two banner poles round the pad's corners.
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
    // 7. Its grid: every building that takes part in power, wired from its Core through masts.
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
    return { structs, core, ribbons, wires, flag, banners, tents, cairns, tiles: solid };
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
   * A ribbon from building a to building b over open, free tiles (breadth-first, N E S W, from the
   * tiles beside a in order): x, y, rot per tile, each turned to the next, the last into b; its
   * tiles marked taken. Null when no way of at most `RIBBON_MAX` tiles exists.
   */
  private ribbon(a: NStruct, b: NStruct, open: (x: number, y: number) => boolean, solid: Set<number>): Int32Array | null {
    const side = (s: NStruct): number[] => {
      const [w, h] = footprint(s.def, s.rot), out: number[] = [];
      for (let x = s.x; x < s.x + w; x++) out.push(tileIndex(x, s.y - 1), tileIndex(x, s.y + h));
      for (let y = s.y; y < s.y + h; y++) out.push(tileIndex(s.x - 1, y), tileIndex(s.x + w, y));
      return out.filter((t) => { const x = t % WORLD; return open(x, (t - x) / WORLD) && !solid.has(t); });
    };
    const [bw, bh] = footprint(b.def, b.rot);
    const inB = (x: number, y: number): boolean => x >= b.x && y >= b.y && x < b.x + bw && y < b.y + bh;
    const ends = new Set(side(b));
    const from = new Map<number, number>();
    const depth = new Map<number, number>();
    const queue: number[] = [];
    for (const t of side(a)) if (!from.has(t)) { from.set(t, -1); depth.set(t, 1); queue.push(t); }
    let end = -1;
    for (let q = 0; q < queue.length && end < 0; q++) {
      const t = queue[q]!;
      if (ends.has(t)) { end = t; break; }
      const d = depth.get(t)!;
      if (d >= RIBBON_MAX) continue;
      const x = t % WORLD, y = (t - x) / WORLD;
      for (let r = 0; r < 4; r++) {
        const nx = x + DX[r]!, ny = y + DY[r]!, n = tileIndex(nx, ny);
        if (from.has(n) || !open(nx, ny) || solid.has(n)) continue;
        from.set(n, t); depth.set(n, d + 1); queue.push(n);
      }
    }
    if (end < 0) return null;
    const path: number[] = [];
    for (let t = end; t >= 0; t = from.get(t)!) path.push(t);
    path.reverse();
    const out = new Int32Array(path.length * 3);
    path.forEach((t, i) => {
      const x = t % WORLD, y = (t - x) / WORLD;
      let rot = 0;
      if (i + 1 < path.length) {
        const n = path[i + 1]!, nx = n % WORLD, ny = (n - nx) / WORLD;
        for (let r = 0; r < 4; r++) if (x + DX[r]! === nx && y + DY[r]! === ny) rot = r;
      } else for (let r = 0; r < 4; r++) if (inB(x + DX[r]!, y + DY[r]!)) { rot = r; break; }
      out[i * 3] = x; out[i * 3 + 1] = y; out[i * 3 + 2] = rot;
      solid.add(t);
    });
    return out;
  }
}
