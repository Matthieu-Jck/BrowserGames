// cell-flow.ts — where the items on the ribbons are drawn, read straight from the engine's cells
// (D57; owner, 2026-10-13: "a case-by-case calculation, where each tick of ribbons forwards the
// item by 1 case"). Pure: no Pixi, unit-tested against the engine.
//
// A ribbon's tile holds one item or none, and an item moves one tile on its tier's step (sim
// chain.ts). So an item is drawn on its tile, eased in from where it was over one step: from the
// tile behind it (its centre to this one's), or from where it came onto the line — the feeding
// ribbon's last tile, a routing block's centre, a building's port edge — along the ribbons' own
// paths (item-flow.ts `buildPieces`: bends, a skybridge's leap and decks, a junction's hump, and
// when an item is drawn over the bridges). An item that keeps moving glides on at the line's pace;
// one that stops sits on its tile's centre. Drawn one step behind the engine (the step that moved
// it is when its glide starts), which is what makes it smooth.
//
// Out of a line's head into something that is not a ribbon (the line's `lastOut`): a building
// takes it at its edge (the item glides there and is gone), a routing block at its centre, where
// it then sits until the block hands it on (the next ribbon eases it out of the centre), an
// incinerator over its pit's lip: the item rides on at the line's pace up the chute and falls in
// (pits.ts `pitPath`: `d`, how far it has fallen, so the items view draws it sinking behind the
// near rim). Conduits carry water inside their pipes: nothing is drawn.
import { MU, WORLD } from '@/sim/constants';
import { VIA_BEHIND, type Chain } from '@/sim/flow/chain';
import { ForkNode } from '@/sim/flow/nodes';
import type { Sim } from '@/sim/state';
import { footprint } from '@/sim/entities';
import { DX, DY } from '@/sim/types';
import { lengthOf, pieceAt, type Piece, type Pt } from './item-flow';
import { PIT_WAY, pitPath } from './pits';

/** One item to draw: its item, where (tile coords) and how high (iso px), whether over the bridges, how far it has fallen into a pit (0…1). */
export interface FlowItem { item: number; x: number; y: number; z: number; o: number; d: number }

/** Where along a tile's piece its centre lies (a leap's start tile: half a tile into its way). */
const centreOf = (p: Piece): number => (p.bend ? 0.5 : 0.5 / Math.max(1, lengthOf(p)));
const len = (p: Piece): number => Math.max(1e-6, lengthOf(p));

const PT: Pt = { x: 0, y: 0, z: 0, o: 0 };
const OUT: FlowItem = { item: 0, x: 0, y: 0, z: 0, o: 0, d: 0 };
const FALL = { z: 0, d: 0 };

export class CellFlow {
  private pieces = new Map<number, Piece>();
  /** Routing blocks' centres, and the ribbons feeding each, by node index (rebuilt with the pieces). */
  private centres = new Map<number, [number, number]>();
  private feeders = new Map<number, Chain[]>();
  private graphVer = -1;

  /** New ribbon paths (after structural changes). */
  setPieces(pieces: Map<number, Piece>): void { this.pieces = pieces; this.graphVer = -1; }

  /**
   * Every item to draw at render tick `t` (fractional sim ticks), within `view` (tile rect, with a
   * tile's margin), handed to `emit` (the same object each time: copy what you keep).
   */
  each(sim: Sim, t: number, view: readonly [number, number, number, number], emit: (it: FlowItem) => void): void {
    const g = sim.graph;
    if (!g) return;
    if (g.version !== this.graphVer) this.relink(sim);
    const [vx0, vy0, vx1, vy1] = view;
    const inView = (x: number, y: number): boolean => x >= vx0 - 2 && x <= vx1 + 2 && y >= vy0 - 2 && y <= vy1 + 2;
    const out = (item: number, p: Pt, d = 0): void => {
      if (!inView(p.x, p.y)) return;
      OUT.item = item; OUT.x = p.x; OUT.y = p.y; OUT.z = p.z; OUT.o = p.o; OUT.d = d;
      emit(OUT);
    };
    // Items gliding into a routing block this step, per block (the rest it holds sit at its centre);
    // the arrivals already handed on (drawn on their way through instead), by feeding chain.
    const arriving = new Map<number, number>();
    const through = new Set<Chain>();
    for (const c of g.chains) {
      if (c.fluid) continue;
      const L = c.length;
      for (let i = 0; i < L; i++) {
        const v = c.cells[i]!;
        if (!v) continue;
        // Its glide lasts until the line's next step (a full step on the beat; less for an item put
        // onto the line between two beats; a faster tier's pace for an item handed over to it).
        const m = c.moved[i]!, f = clamp01((t - (m + 1)) / untilNext(c, m));
        const pb = this.pieces.get(c.tiles[i]!);
        if (!pb) continue;
        const via = c.via[i]!;
        if (f >= 1 || via < 0 && via !== VIA_BEHIND) { pieceAt(pb, centreOf(pb), PT); out(v - 1, PT); continue; }
        if (via === VIA_BEHIND) {
          const pa = this.pieces.get(c.tiles[i - 1]!);
          if (pa) { this.glide(pa, pb, f, PT); out(v - 1, PT); continue; }
          pieceAt(pb, centreOf(pb), PT); out(v - 1, PT); continue;
        }
        // Onto the line by edge `via`: from the feeding ribbon's last tile, a block's centre, a building's edge.
        const src = g.nodes[g.eSrc[via]!];
        if (src && src.kind === 'chain' && !(src as Chain).fluid) {
          const sc = src as Chain;
          const pa = this.pieces.get(sc.tiles[sc.length - 1]!);
          if (pa) { this.glide(pa, pb, f, PT); out(v - 1, PT); continue; }
        }
        if (src instanceof ForkNode) {
          // Out of a routing block: if a ribbon brought it in just before, all the way from that
          // ribbon's last tile through the block's centre, timed from when it went in.
          const ctr = this.centres.get(src.idx);
          const inc = ctr ? this.arrival(src.idx, v - 1, c.moved[i]!) : null;
          const pa = inc ? this.pieces.get(inc.tiles[inc.length - 1]!) : undefined;
          if (ctr && inc && pa) {
            through.add(inc);
            const t0 = inc.lastOut.tick + 1, t1 = m + 1 + untilNext(c, m);
            this.throughBlock(pa, ctr, pb, clamp01((t - t0) / Math.max(1, t1 - t0)), PT);
            out(v - 1, PT);
            continue;
          }
        }
        const from = src ? this.edgeFrom(sim, src.idx, src instanceof ForkNode, c.tiles[i]!) : null;
        this.fromPoint(from ?? [pb.ax, pb.ay], pb, f, PT);
        out(v - 1, PT);
      }
    }
    for (const c of g.chains) {
      // Its last item out, into something that is not a ribbon: to the building's edge, or a block's centre.
      if (c.fluid || through.has(c)) continue;
      const lo = c.lastOut, S = c.stepTicks;
      if (lo.item < 0 || lo.edge < 0) continue;
      const f = (t - (lo.tick + 1)) / S;
      if (f < 0 || f >= 1) continue;
      const dst = g.nodes[g.eDst[lo.edge]!];
      if (!dst || dst.kind === 'chain') continue; // the next ribbon eases it in itself
      const pa = this.pieces.get(c.tiles[c.length - 1]!);
      if (!pa) continue;
      if (dst.kind === 'sink') {
        // Into an incinerator: on over the edge to its pit's centre, a tile a step, and in.
        const e = sim.ents.get(dst.ent);
        if (!e || f >= PIT_WAY.gone) continue;
        this.toPoint(pa, [e.x + 0.5, e.y + 0.5], f, PT);
        pitPath(f, FALL);
        PT.z += FALL.z;
        out(lo.item, PT, FALL.d);
        continue;
      }
      if (dst instanceof ForkNode) {
        const ctr = this.centres.get(dst.idx);
        if (!ctr || dst.mu < MU || dst.item !== lo.item) continue; // already handed on
        arriving.set(dst.idx, (arriving.get(dst.idx) ?? 0) + 1);
        this.toPoint(pa, ctr, f, PT);
      } else {
        // Into a building: to the edge, where it goes in.
        const sa = centreOf(pa);
        pieceAt(pa, sa + (1 - sa) * f, PT);
      }
      out(lo.item, PT);
    }
    // What the routing blocks hold and is not on its way in: at their centres.
    for (const [idx, [cx, cy]] of this.centres) {
      const n = g.nodes[idx];
      if (!(n instanceof ForkNode) || n.mu < MU || n.item < 0) continue;
      const held = Math.floor(n.mu / MU) - (arriving.get(idx) ?? 0);
      for (let k = 0; k < held; k++) {
        PT.x = cx + (held > 1 ? (k - (held - 1) / 2) * 0.24 : 0); PT.y = cy; PT.z = 0; PT.o = 0;
        out(n.item, PT);
      }
    }
  }

  /** The ribbon that last brought `item` into block `fork`, no earlier than a step before tick `by` (null: none). */
  private arrival(fork: number, item: number, by: number): Chain | null {
    let best: Chain | null = null;
    for (const c of this.feeders.get(fork) ?? []) {
      const lo = c.lastOut;
      if (lo.item !== item || lo.tick > by || by - lo.tick > 2 * c.stepTicks) continue;
      if (!best || lo.tick > best.lastOut.tick) best = c;
    }
    return best;
  }

  /** From the centre of tile a's piece out of its exit, through a block's centre, into tile b's piece to its centre. */
  private throughBlock(pa: Piece, [cx, cy]: readonly [number, number], pb: Piece, f: number, o: Pt): Pt {
    const sa = centreOf(pa), la = len(pa), sb = centreOf(pb), lb = len(pb);
    const ex = pieceAt(pa, 1, { x: 0, y: 0, z: 0, o: 0 });
    const l1 = (1 - sa) * la, l2 = Math.hypot(cx - ex.x, cy - ex.y), l3 = Math.hypot(pb.ax - cx, pb.ay - cy), l4 = sb * lb;
    let d = f * (l1 + l2 + l3 + l4);
    if (d <= l1) return pieceAt(pa, sa + d / la, o);
    d -= l1;
    if (d <= l2) { const u = l2 > 0 ? d / l2 : 1; o.x = ex.x + (cx - ex.x) * u; o.y = ex.y + (cy - ex.y) * u; o.z = ex.z * (1 - u); o.o = 0; return o; }
    d -= l2;
    if (d <= l3) { const u = l3 > 0 ? d / l3 : 1; o.x = cx + (pb.ax - cx) * u; o.y = cy + (pb.ay - cy) * u; o.z = 0; o.o = 0; return o; }
    d -= l3;
    return pieceAt(pb, l4 > 0 ? (d / l4) * sb : sb, o);
  }

  /** From the centre of tile a's piece to the centre of tile b's, fraction f of the way (a's end meeting b's start; else straight across). */
  private glide(pa: Piece, pb: Piece, f: number, o: Pt): Pt {
    const sa = centreOf(pa), sb = centreOf(pb);
    const la = len(pa), lb = len(pb);
    const ex = pieceAt(pa, 1, { x: 0, y: 0, z: 0, o: 0 });
    const joined = Math.abs(ex.x - pb.ax) + Math.abs(ex.y - pb.ay) < 0.02;
    const l1 = (1 - sa) * la;
    if (!joined) {
      // A side-load into a straight tile: on a's way to its edge, then straight in to b's centre.
      const c = pieceAt(pb, sb, { x: 0, y: 0, z: 0, o: 0 });
      const l2 = Math.hypot(c.x - ex.x, c.y - ex.y);
      const d = f * (l1 + l2);
      if (d <= l1) return pieceAt(pa, sa + d / la, o);
      const u = l2 > 0 ? (d - l1) / l2 : 1;
      o.x = ex.x + (c.x - ex.x) * u; o.y = ex.y + (c.y - ex.y) * u; o.z = ex.z + (c.z - ex.z) * u; o.o = 0;
      return o;
    }
    const l2 = sb * lb;
    const d = f * (l1 + l2);
    return d <= l1 ? pieceAt(pa, sa + d / la, o) : pieceAt(pb, (d - l1) / lb, o);
  }

  /** From a point (a block's centre, a port's edge) to the centre of tile b's piece, fraction f of the way. */
  private fromPoint([x, y]: readonly [number, number], pb: Piece, f: number, o: Pt): Pt {
    const sb = centreOf(pb), lb = len(pb);
    const onPiece = Math.abs(x - pb.ax) + Math.abs(y - pb.ay) < 0.02;
    const l1 = onPiece ? 0 : Math.hypot(pb.ax - x, pb.ay - y), l2 = sb * lb;
    const d = f * (l1 + l2);
    if (d < l1) { const u = d / l1; o.x = x + (pb.ax - x) * u; o.y = y + (pb.ay - y) * u; o.z = 0; o.o = 0; return o; }
    return pieceAt(pb, l2 > 0 ? ((d - l1) / l2) * sb : sb, o);
  }

  /** From the centre of tile a's piece on to its exit, then straight to a point (a block's centre), fraction f of the way. */
  private toPoint(pa: Piece, [x, y]: readonly [number, number], f: number, o: Pt): Pt {
    const sa = centreOf(pa), la = len(pa);
    const ex = pieceAt(pa, 1, { x: 0, y: 0, z: 0, o: 0 });
    const l1 = (1 - sa) * la, l2 = Math.hypot(x - ex.x, y - ex.y);
    const d = f * (l1 + l2);
    if (d <= l1) return pieceAt(pa, sa + d / la, o);
    const u = l2 > 0 ? (d - l1) / l2 : 1;
    o.x = ex.x + (x - ex.x) * u; o.y = ex.y + (y - ex.y) * u; o.z = ex.z * (1 - u); o.o = 0;
    return o;
  }

  /**
   * Where an item fed by node `src` onto ribbon tile `tile` starts: a routing block's centre; a
   * building's port edge (the side of the tile the building stands on); null: the piece's own entry.
   */
  private edgeFrom(sim: Sim, src: number, fork: boolean, tile: number): [number, number] | null {
    if (fork) return this.centres.get(src) ?? null;
    const n = sim.graph.nodes[src];
    if (!n?.ent) return null;
    const x = tile % WORLD, y = (tile - x) / WORLD;
    for (let d = 0; d < 4; d++) {
      if (sim.grid.occ[(y + DY[d]!) * WORLD + x + DX[d]!] === n.ent) return [x + 0.5 + DX[d]! * 0.5, y + 0.5 + DY[d]! * 0.5];
    }
    return null;
  }

  /** Routing blocks' centres, by node index. */
  private relink(sim: Sim): void {
    const g = sim.graph;
    this.graphVer = g.version;
    this.centres.clear();
    this.feeders.clear();
    for (const c of g.chains) {
      const e = c.outE[0];
      const d = e === undefined ? undefined : g.nodes[g.eDst[e]!];
      if (d instanceof ForkNode) { let arr = this.feeders.get(d.idx); if (!arr) this.feeders.set(d.idx, (arr = [])); arr.push(c); }
    }
    for (const n of g.nodes) {
      if (!(n instanceof ForkNode)) continue;
      const e = sim.ents.get(n.ent);
      if (!e) continue;
      const [w, h] = footprint(e.def, e.rot);
      this.centres.set(n.idx, [e.x + w / 2, e.y + h / 2]);
    }
  }
}

const clamp01 = (v: number): number => (v <= 0 ? 0 : v >= 1 ? 1 : v);

/** Ticks from tick `m` to the line's next step after it (1 to its longest gap between beats). */
function untilNext(c: Chain, m: number): number {
  for (let d = 1; d <= 600; d++) if (c.steps(m + d)) return d;
  return c.stepTicks;
}
