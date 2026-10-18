// wire-geom.ts — the shape of a power wire (D25), pure maths for the wires view and its tests:
// where a wire meets a building — its terminal, a point its art draws (an insulator on a roof's
// service mast, a pole's crossarm pin, the Heart's link mast: art/terminals.ts), turned with the
// art and lifted with the building when it stands on the mountains (D44, world/stand.ts: a wire
// runs from a pole on the floor up to a turbine on the ridge) — and the gentle catenary it hangs in
// between, in iso world px. No Pixi.
import { BUILDING_IDS, buildingDef } from '@/content/registry';
import type { BuildingId } from '@/content/buildings';
import { footprint } from '@/sim/entities';
import type { Ent } from '@/sim/types';
import { artRot, rotLocal, terminalsOf } from '../art/terminals';
import { LH, tileToIso } from '../iso';
import { MAX_LEVEL, SHIFT, tileTop, type ReliefLand } from '../relief';
import { liftOf } from './stand';

/** Where a wire meets a building: tile coords of the point it hangs from, and its height (levels, from the floor). */
export interface Anchor { x: number; y: number; z: number }

type Placed = Pick<Ent, 'def' | 'x' | 'y' | 'rot'>;

/** Footprint centre of a placed building (tiles; the rotated footprint). */
export function footCentre(e: Placed): [number, number] {
  const [w, h] = footprint(e.def, e.rot);
  return [e.x + w / 2, e.y + h / 2];
}

/**
 * A building's terminals in world tiles: its table's points (art/terminals.ts) turned as its art
 * is turned (`artRot`: a building drawn once keeps its rot-0 points), each with its pick bias,
 * and lifted by the level it stands at (`liftOf`: the rock top under a building on the mountains).
 */
export function terminalsAt(e: Placed): Array<Anchor & { bias: number }> {
  const id = BUILDING_IDS[e.def] as BuildingId, def = buildingDef(e.def), rot = artRot(id, e.rot), lift = liftOf(e);
  return terminalsOf(id).map((t) => {
    const [rx, ry] = rotLocal(t.x, t.y, def.w, def.h, rot);
    return { x: e.x + rx, y: e.y + ry, z: lift + t.z, bias: t.bias ?? 0 };
  });
}

/** Where the Link tool's refused preview ends on a building with no terminal (no part in power): over its middle (levels). */
const NO_TERMINAL_Z = 1.2;

/**
 * The terminal a wire from `e` towards the point (tx, ty) hangs from: the nearest one, less its
 * bias (a pole's top pin takes the wires that run across its crossarm, the pins at the ends of
 * the arm the ones that run along it; the Heart's nearer link mast). Ties go to the first. A
 * building with none (it takes no part in power: only a refused preview points at it) gives its
 * footprint centre.
 */
export function wireAnchor(e: Placed, tx: number, ty: number): Anchor {
  let best: Anchor | null = null, bestD = Infinity;
  for (const t of terminalsAt(e)) {
    const d = Math.hypot(t.x - tx, t.y - ty) - t.bias;
    if (d < bestD - 1e-9) { bestD = d; best = { x: t.x, y: t.y, z: t.z }; }
  }
  if (best) return best;
  const [cx, cy] = footCentre(e);
  return { x: cx, y: cy, z: liftOf(e) + NO_TERMINAL_Z };
}

/**
 * Both ends of a wire between `a` and `b`: a's terminal picked towards b's footprint centre,
 * b's towards that terminal, then a's again towards b's — so a pole beside the Heart turns to
 * the link mast the wire really leaves from. The view passes the lower id as `a` (the wire
 * table's order), the Link tool's preview too, so a wire keeps its ends once made.
 */
export function wireEnds(a: Placed, b: Placed): [Anchor, Anchor] {
  const [bx, by] = footCentre(b);
  const A0 = wireAnchor(a, bx, by);
  const B = wireAnchor(b, A0.x, A0.y);
  return [wireAnchor(a, B.x, B.y), B];
}

/**
 * How deep a wire sags at mid-span (iso px): about a third of a level per tile of span, at
 * most 2.5 levels, and never so low that it would touch the ground (half a level of room under
 * the lower anchor).
 */
export function sagPx(spanTiles: number, lowZ: number): number {
  const want = Math.min(2.5 * LH, 0.32 * LH * spanTiles + 2);
  return Math.max(0, Math.min(want, (lowZ - 0.5) * LH));
}

/** How many straight pieces draw a wire of this span (more for longer, sagging ones). */
export const wireSegments = (spanTiles: number): number => Math.max(6, Math.min(20, Math.round(spanTiles * 1.5)));

/**
 * The wire from A to B in iso world px: a parabola (a shallow catenary) through both anchors,
 * `sag` px below the chord at mid-span (screen-down). Returns x, y pairs (n + 1 points).
 */
export function catenary(a: Anchor, b: Anchor, sag: number, n: number): Float32Array {
  const [ax, ay] = tileToIso(a.x, a.y, a.z), [bx, by] = tileToIso(b.x, b.y, b.z);
  const out = new Float32Array((n + 1) * 2);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    out[i * 2] = ax + (bx - ax) * t;
    out[i * 2 + 1] = ay + (by - ay) * t + sag * 4 * t * (1 - t);
  }
  return out;
}

/** A wire's iso polyline between two anchors, sagging as `sagPx` says for its span. */
export function wireCurve(A: Anchor, B: Anchor): Float32Array {
  const span = Math.hypot(B.x - A.x, B.y - A.y);
  return catenary(A, B, sagPx(span, Math.min(A.z, B.z)), wireSegments(span));
}

/** How far a view ray is walked between two looks at the relief (tiles along +x +y: half a level up; a few hundred looks a wire, on a rebuild only). */
const RAY_STEP = SHIFT / 2;

/**
 * Is the point of the wire from A to B at `t` ∈ [0, 1] hidden by the relief in front of it? Its
 * ground point and height (levels, the sag taken off) give its view ray: a point `lv` levels up
 * lies `lv·SHIFT` tiles along +x +y towards the viewer, as `surfaceTile` walks it. Hidden when
 * the ray meets a tile whose top (`tileTop`) stands higher before it rises over the highest relief.
 */
function hiddenAt(A: Anchor, B: Anchor, sag: number, t: number, land: ReliefLand): boolean {
  const px = A.x + (B.x - A.x) * t, py = A.y + (B.y - A.y) * t;
  const hz = A.z + (B.z - A.z) * t - (sag * 4 * t * (1 - t)) / LH;
  for (let d = 0; hz + d / SHIFT <= MAX_LEVEL; d += RAY_STEP) {
    if (tileTop(land, Math.floor(px + d), Math.floor(py + d)) > hz + d / SHIFT) return true;
  }
  return false;
}

/**
 * The stretches of a wire the relief in front leaves in view (owner, 2026-10-18: « some electrical
 * wires are shown above the cliff that's in front »): the wires are drawn over every volume (one
 * batched stroke a style, D92), so a wire hung behind a cliff showed across it. Each point of its
 * curve is looked at (`hiddenAt`); where it passes behind the rock, the curve is cut at the cliff's
 * edge (found by halving the piece that crosses it). Returns the shown runs as iso polylines (the
 * whole curve when nothing hides it, none when all of it is) and the hidden spans as pairs of the
 * curve's parameter (the glints skip them). No land: nothing hidden.
 */
export function wireRuns(A: Anchor, B: Anchor, land: ReliefLand | null): { runs: Float32Array[]; hidden: number[] } {
  const span = Math.hypot(B.x - A.x, B.y - A.y), sag = sagPx(span, Math.min(A.z, B.z)), n = wireSegments(span);
  const pts = catenary(A, B, sag, n);
  if (!land) return { runs: [pts], hidden: [] };
  const seen: boolean[] = [];
  for (let i = 0; i <= n; i++) seen.push(!hiddenAt(A, B, sag, i / n, land));
  if (seen.every(Boolean)) return { runs: [pts], hidden: [] };
  const [ax, ay] = tileToIso(A.x, A.y, A.z), [bx, by] = tileToIso(B.x, B.y, B.z);
  const at = (t: number): [number, number] => [ax + (bx - ax) * t, ay + (by - ay) * t + sag * 4 * t * (1 - t)];
  /** Where the view turns between t0 (seen as `s0`) and t1: halved six times. */
  const edge = (t0: number, t1: number, s0: boolean): number => {
    for (let k = 0; k < 6; k++) { const m = (t0 + t1) / 2; if (!hiddenAt(A, B, sag, m, land) === s0) t0 = m; else t1 = m; }
    return (t0 + t1) / 2;
  };
  const runs: Float32Array[] = [], hidden: number[] = [];
  let cur: number[] | null = seen[0] ? [pts[0]!, pts[1]!] : null;
  if (!seen[0]) hidden.push(0);
  for (let i = 1; i <= n; i++) {
    const t0 = (i - 1) / n, t1 = i / n;
    if (seen[i] && cur) { cur.push(pts[i * 2]!, pts[i * 2 + 1]!); continue; }
    if (!seen[i] && !cur) continue;
    const e = edge(t0, t1, seen[i - 1]!), [ex, ey] = at(e);
    if (cur) { cur.push(ex, ey); runs.push(Float32Array.from(cur)); cur = null; hidden.push(e); }
    else { cur = [ex, ey, pts[i * 2]!, pts[i * 2 + 1]!]; hidden.push(e); }
  }
  if (cur) runs.push(Float32Array.from(cur));
  else hidden.push(1);
  return { runs: runs.filter((r) => r.length >= 4), hidden };
}

/** Is the fraction `f` of a wire within one of its hidden spans (`wireRuns`)? */
export const inHidden = (hidden: readonly number[], f: number): boolean => {
  for (let k = 0; k + 1 < hidden.length; k += 2) if (f >= hidden[k]! && f <= hidden[k + 1]!) return true;
  return false;
};

/** Cumulative lengths along a polyline of x, y pairs (first 0, last the whole length). */
export function polyLengths(pts: Float32Array): Float32Array {
  const n = pts.length / 2;
  const out = new Float32Array(n);
  for (let i = 1; i < n; i++) {
    const dx = pts[i * 2]! - pts[i * 2 - 2]!, dy = pts[i * 2 + 1]! - pts[i * 2 - 1]!;
    out[i] = out[i - 1]! + Math.hypot(dx, dy);
  }
  return out;
}

/** The point a fraction `f` of the way along a polyline (by length), written into `out`. */
export function pointAlong(pts: Float32Array, lens: Float32Array, f: number, out: { x: number; y: number }): void {
  const n = lens.length;
  const total = lens[n - 1]!;
  const d = Math.max(0, Math.min(1, f)) * total;
  let i = 1;
  while (i < n - 1 && lens[i]! < d) i++;
  const l0 = lens[i - 1]!, l1 = lens[i]!;
  const t = l1 > l0 ? (d - l0) / (l1 - l0) : 0;
  out.x = pts[i * 2 - 2]! + (pts[i * 2]! - pts[i * 2 - 2]!) * t;
  out.y = pts[i * 2 - 1]! + (pts[i * 2 + 1]! - pts[i * 2 - 1]!) * t;
}

/**
 * Each wire's way: from the end nearer a generator (in wires, over the wire graph) to the farther
 * one — power runs out from the sources to what they feed. Ends as near as each other: 0.
 */
export function flowWays(wires: ReadonlyArray<{ a: number; b: number; way: number }>, isSource: (id: number) => boolean): void {
  const adj = new Map<number, number[]>();
  const add = (u: number, v: number): void => { let l = adj.get(u); if (!l) adj.set(u, (l = [])); l.push(v); };
  for (const w of wires) { add(w.a, w.b); add(w.b, w.a); }
  const hops = new Map<number, number>();
  const queue: number[] = [];
  for (const id of adj.keys()) if (isSource(id)) { hops.set(id, 0); queue.push(id); }
  for (let i = 0; i < queue.length; i++) {
    const u = queue[i]!, d = hops.get(u)! + 1;
    for (const v of adj.get(u)!) if (!hops.has(v)) { hops.set(v, d); queue.push(v); }
  }
  for (const w of wires as Array<{ a: number; b: number; way: number }>) {
    const da = hops.get(w.a), db = hops.get(w.b);
    w.way = da === undefined || db === undefined || da === db ? 0 : da < db ? 1 : -1;
  }
}
