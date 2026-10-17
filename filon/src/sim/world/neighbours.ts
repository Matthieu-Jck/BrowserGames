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
// The base (`layout`) is laid out the first time something asks — a placement, the Gleaners' walk,
// the land panel, the view — on the land as its source made it (`Grid.made0`: what the claim digs
// never moves it): the hub on its first parcel (CrierBelt's lift pad, a silo, a link mast, the
// claim's flag beside the pad), then its trade's buildings (content/neighbours.ts) two or three a
// parcel, each wholly on its parcel a tile in from its edge with a tile of room round it, a drill
// on a deposit (else a sand collector), then ribbons found tile by tile (a bounded breadth-first
// search) from each working building to the next and on to the silo, carrying what the claim
// sells. Integers and total orders only: the same base for every reader, in every order asked.
//
// A parcel of a holding the claim holds (an older base's lease or grant, `systems/land.ts`
// `neighboursGiveWay`) is left out of its base: what stood there gave way. Nothing here is saved.
import { BAL } from '@/content/balance';
import type { BuildingId } from '@/content/buildings';
import { COLONY_PROFILES, COLONY_PROFILE_IDS, type ColonyProfile, type ColonyProfileId } from '@/content/colonies';
import { NEIGHBOUR_HUB, NEIGHBOUR_KITS, NEIGHBOUR_PER_PARCEL } from '@/content/neighbours';
import { BUILDING_KIND, buildingDef, buildingIdx, itemDef, itemIdx } from '@/content/registry';
import { hash32 } from '@/core/hash';
import { WORLD } from '../constants';
import { footprint } from '../entities';
import { DX, DY, isFloor, type Rot } from '../types';
import { inWorld, tileIndex, type Grid } from './grid';
import { HOME_COL, PARCEL, PARCEL_COLS, parcelAt, parcelCentre, parcelRect, ringOf, type Land } from './land';

/** A building of a neighbouring base: what it is, where it stands (its footprint's top-left tile), how it is turned. */
export interface NStruct { readonly def: number; readonly x: number; readonly y: number; readonly rot: Rot }

/** A ribbon line of a neighbouring base: its tiles in the order items ride (x, y, rot each), what it carries. */
export interface NRibbon { readonly tiles: Int32Array; readonly item: number }

/** A neighbouring base's buildings and ribbons, its flag's tile, and every tile they stand on. */
export interface NLayout {
  readonly structs: readonly NStruct[];
  readonly ribbons: readonly NRibbon[];
  readonly flag: readonly [number, number] | null;
  readonly tiles: ReadonlySet<number>;
}

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

/** Does a building of this kind take something in or hand something out on a ribbon (not the power: turbines, panels, cells, masts)? */
const works = (def: number): boolean => {
  const k = BUILDING_KIND[def];
  return k === 'drill' || k === 'machine' || k === 'lab' || k === 'server' || k === 'storage' || k === 'trade';
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

  /** Can a base stand on parcel p: past the ring round the starting square, whole, mostly open floor, nothing the land guarantees? */
  private eligible(p: number): boolean {
    if (ringOf(p) <= this.land.reach + 1) return false;
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
    if (ringOf(p) <= this.land.reach + 1) return;
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

  private lay(h: Holding): NLayout {
    const kit = NEIGHBOUR_KITS[h.profile];
    // An older base's lease or grant on its land: that part of the base is not there.
    const parcels = h.parcels.filter((p) => !this.land.holds(p));
    const allowed = new Set(parcels);
    const solid = new Set<number>(); // what stands: buildings, ribbons, the flag
    const room = new Set<number>(); // the buildings and the tile of room round each
    const structs: NStruct[] = [];
    const made = (x: number, y: number): { terrain: number; level: number; ore: number } => this.grid.made0(x, y); // the land as made: digging never moves a base
    const open = (x: number, y: number): boolean => {
      if (!inWorld(x, y) || !allowed.has(parcelAt(x, y))) return false;
      const m = made(x, y);
      return m.level === 0 && isFloor(m.terrain);
    };
    const fits = (def: number, x: number, y: number, rot: Rot, p: number, ore: boolean): boolean => {
      const [w, hh] = footprint(def, rot), r = parcelRect(p);
      if (x < r.x0 + 1 || y < r.y0 + 1 || x + w > r.x1 - 1 || y + hh > r.y1 - 1) return false;
      for (let ty = y; ty < y + hh; ty++) for (let tx = x; tx < x + w; tx++) {
        if (room.has(tileIndex(tx, ty)) || !open(tx, ty)) return false;
        if (ore) { const o = made(tx, ty).ore; if (o < 0 || itemDef(o).face) return false; }
      }
      return true;
    };
    const place = (id: BuildingId, p: number, ax: number, ay: number, salt: number): NStruct | null => {
      const def = buildingIdx(id);
      const rot = (BUILDING_KIND[def] === 'machine' ? hash32(this.land.seed, p, salt, SALT.rot) % 4 : 0) as Rot;
      const ore = wantsOre(def), [w, hh] = footprint(def, rot);
      for (const [dx, dy] of SPIRAL) {
        const x = ax + dx - (w >> 1), y = ay + dy - (hh >> 1);
        if (!fits(def, x, y, rot, p, ore)) continue;
        for (let ty = y - 1; ty <= y + hh; ty++) for (let tx = x - 1; tx <= x + w; tx++) room.add(tileIndex(tx, ty));
        for (let ty = y; ty < y + hh; ty++) for (let tx = x; tx < x + w; tx++) solid.add(tileIndex(tx, ty));
        const s: NStruct = { def, x, y, rot };
        structs.push(s);
        return s;
      }
      // A drill with no deposit to stand on: a sand collector in its stead.
      if (wantsOre(def)) return place('sand_collector', p, ax, ay, salt);
      return null;
    };
    if (!parcels.length) return { structs, ribbons: [], flag: null, tiles: solid };
    const hub = parcels[0]!, [hx, hy] = parcelCentre(hub);
    let k = 0;
    const lines: Array<{ makers: NStruct[] }> = [];
    // The hub: the lift pad in the middle, the silo and the mast beside it, then its trade's first buildings.
    const post = place(NEIGHBOUR_HUB[0]!, hub, hx, hy, 0);
    const silo = place(NEIGHBOUR_HUB[1]!, hub, hx, hy + 4, 1);
    place(NEIGHBOUR_HUB[2]!, hub, hx - 4, hy - 4, 2);
    for (const p of parcels) {
      const [cx, cy] = parcelCentre(p);
      // The other parcels' buildings gather on the side towards the hub.
      const ax = p === hub ? cx : cx + Math.sign(hx - cx) * 4, ay = p === hub ? cy : cy + Math.sign(hy - cy) * 4;
      const n = p === hub ? NEIGHBOUR_PER_PARCEL.hub : NEIGHBOUR_PER_PARCEL.other;
      const makers: NStruct[] = [];
      for (let i = 0; i < n; i++, k++) {
        const s = place(kit.works[k % kit.works.length]!, p, ax, ay, 10 + k);
        if (s && works(s.def)) makers.push(s);
      }
      lines.push({ makers });
    }
    // The claim's flag on a tile beside the pad (its north-west corner first).
    let flag: [number, number] | null = null;
    if (post) {
      const [w, hh] = footprint(post.def, post.rot);
      const around: Array<[number, number]> = [[post.x - 1, post.y - 1], [post.x + w, post.y - 1], [post.x - 1, post.y + hh], [post.x + w, post.y + hh]];
      for (const [x, y] of around) if (open(x, y) && !solid.has(tileIndex(x, y))) { flag = [x, y]; solid.add(tileIndex(x, y)); break; }
    }
    // The ribbons: each parcel's working buildings one into the next, the last into the silo (or the pad); the silo into the pad.
    const ribbons: NRibbon[] = [];
    const sink = silo ?? post;
    lines.forEach((l, i) => {
      const chain = [...l.makers.filter((s) => s !== sink && s !== post), ...(sink ? [sink] : [])];
      const item = itemIdx(kit.carries[i % kit.carries.length]!);
      for (let j = 0; j + 1 < chain.length; j++) {
        const r = this.ribbon(chain[j]!, chain[j + 1]!, open, solid);
        if (r) ribbons.push({ tiles: r, item });
      }
    });
    if (silo && post) {
      const r = this.ribbon(silo, post, open, solid);
      if (r) ribbons.push({ tiles: r, item: itemIdx(kit.carries[0]!) });
    }
    return { structs, ribbons, flag, tiles: solid };
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
