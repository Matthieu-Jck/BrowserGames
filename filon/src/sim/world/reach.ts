// reach.ts — where the Gleaners walk (D103), and so which ribbon tiles they reach at night.
//
// The Gleaners are a small people of the open desert: they walk its floor and nothing else — level 0
// floor past the Crown, never rock, terraces, mountains, water, chasms or rivers — and they never
// come into the cirque (the floor within the Crown's foot, `TerrainSource.crownOuter`, is not
// theirs even where it lies open). Anything standing on a tile — a building, a ribbon, a pole, a
// fence (D103) — is in their way too: a ribbon line across the desert is a wall to them, and a
// fence across the line home closes an outpost in.
//
// Reach is a flood over that floor, bounded: a pocket of floor of at most `pocket` tiles closed in
// by what they cannot cross (rock, water, buildings, fences) is out of their reach; anything larger
// is the open desert. The verdict is the pocket's — the same from any of its tiles — so the order
// the flood runs in changes nothing (determinism), and each tile is flooded once per call (`memo`).
// A ribbon tile is **exposed** when a tile beside it (4-neighbours) is reachable floor; a glazed
// ribbon beside reachable floor, or a ribbon beside a fenced pocket, is **guarded** (what the
// Logistique view marks as protected). For the views' night (render only), two more lists: the
// glazed tiles they would reach but for the glass (`glass`: one may come and tap it), and the open
// floor along a fence (`prowl`: they pace outside it). Derived state: rebuilt with the flow graph on
// every structural change (compile.ts), never saved.
import { CENTER, CHUNK, WORLD } from '../constants';
import { isFloor } from '../types';
import type { Grid } from './grid';

export interface GleanLand {
  /** Ribbon tiles the Gleaners reach at night: a free floor tile beside them is open desert. Ascending. */
  readonly exposed: Int32Array;
  /** Ribbon tiles beside desert floor that are safe all the same: under glass, or the floor beside them fenced in. Ascending. */
  readonly guarded: Int32Array;
  /** Glazed ribbon tiles beside open desert floor (they would be exposed but for the glass). Ascending. */
  readonly glass: Int32Array;
  /** Open desert floor beside a fence: where they prowl outside it. Ascending. */
  readonly prowl: Int32Array;
}

const NONE = new Int32Array(0);
export const NO_GLEAN_LAND: GleanLand = { exposed: NONE, guarded: NONE, glass: NONE, prowl: NONE };

const NB = [-WORLD, 1, WORLD, -1] as const; // N E S W, as tile index offsets
const N = WORLD * WORLD;

// Scratch shared by every call (allocated on the first land that has Gleaners; never state): which
// tiles a flood has seen (`seenAt` = the flood's stamp) and each flooded tile's verdict for this call
// (`memoAt` = the call's stamp, `memoVal` 1 open / 0 closed). Stamps, not clearing: a compile floods
// a few thousand tiles of a million. A compile of the late base runs it in well under a millisecond.
let seenAt: Uint16Array | null = null;
let memoAt: Uint16Array | null = null;
let memoVal: Uint8Array | null = null;
let seenGen = 0, memoGen = 0;
let queue = new Int32Array(4096);

/**
 * The Gleaners' land round a set of ribbon tiles (ascending tile indices).
 * - `rim`: the Crown's foot from the centre (tiles): no floor within it is theirs; none: no Gleaners on this land (a test world).
 * - `glazed(t)`: the ribbon on tile t is under glass.
 * - `pocket`: the largest pocket of floor, closed in, that is out of their reach (tiles).
 * - `fences`: the fence tiles (ascending), for `prowl`.
 */
export function gleanLand(grid: Grid, ribbons: readonly number[], glazed: (t: number) => boolean, rim: number | undefined, pocket: number, fences: readonly number[] = []): GleanLand {
  if (rim === undefined || !ribbons.length) return NO_GLEAN_LAND;
  if (!seenAt) { seenAt = new Uint16Array(N); memoAt = new Uint16Array(N); memoVal = new Uint8Array(N); }
  const seen = seenAt, mAt = memoAt!, mVal = memoVal!;
  if (++memoGen > 0xffff) { mAt.fill(0); memoGen = 1; }
  const call = memoGen;
  if (queue.length < pocket + 8) queue = new Int32Array(pocket + 8);
  const rim2 = rim * rim;
  const occ = grid.occ;
  /** May a Gleaner stand on tile t? Free floor at level 0, past the Crown's foot. */
  const walkable = (t: number): boolean => {
    if (t < 0 || t >= N || occ[t]) return false;
    const x = t % WORLD, y = (t - x) / WORLD;
    const dx = x - CENTER, dy = y - CENTER;
    if (dx * dx + dy * dy < rim2) return false;
    const c = grid.chunkAt(x >> 5, y >> 5), i = (y & 31) * CHUNK + (x & 31);
    return c.level[i] === 0 && isFloor(c.terrain[i]!);
  };
  /** Is walkable tile t part of the open desert? Floods its pocket once (bounded by `pocket`). */
  const open = (t: number): boolean => {
    if (mAt[t] === call) return mVal[t] === 1;
    if (++seenGen > 0xffff) { seen.fill(0); seenGen = 1; }
    const g = seenGen;
    const q = queue;
    let n = 0;
    seen[t] = g;
    q[n++] = t;
    let verdict = 0;
    for (let k = 0; k < n && verdict === 0; k++) {
      const u = q[k]!;
      const x = u % WORLD;
      for (let d = 0; d < 4; d++) {
        // No wrapping round the world's sides.
        if ((d === 1 && x === WORLD - 1) || (d === 3 && x === 0)) continue;
        const v = u + NB[d]!;
        if (v < 0 || v >= N || seen[v] === g || !walkable(v)) continue;
        if (mAt[v] === call && mVal[v] === 1) { verdict = 1; break; } // it joins ground already known open
        seen[v] = g;
        if (n > pocket) { verdict = 1; break; }
        q[n++] = v;
      }
    }
    // A flood cut short is open; one that ran dry has seen its whole pocket: closed.
    for (let k = 0; k < n; k++) { const v = q[k]!; mAt[v] = call; mVal[v] = verdict; }
    return verdict === 1;
  };
  const exposed: number[] = [], guarded: number[] = [], glass: number[] = [];
  for (const t of ribbons) {
    let reach = false, beside = false;
    const x = t % WORLD;
    for (let k = 0; k < 4 && !reach; k++) {
      if ((k === 1 && x === WORLD - 1) || (k === 3 && x === 0)) continue;
      const v = t + NB[k]!;
      if (!walkable(v)) continue;
      beside = true;
      if (open(v)) reach = true;
    }
    if (reach && !glazed(t)) exposed.push(t);
    else if (beside) guarded.push(t);
    if (reach && glazed(t)) glass.push(t);
  }
  const prowl = new Set<number>();
  for (const t of fences) {
    const x = t % WORLD;
    for (let k = 0; k < 4; k++) {
      if ((k === 1 && x === WORLD - 1) || (k === 3 && x === 0)) continue;
      const v = t + NB[k]!;
      if (walkable(v) && open(v)) prowl.add(v);
    }
  }
  return { exposed: Int32Array.from(exposed), guarded: Int32Array.from(guarded), glass: Int32Array.from(glass), prowl: Int32Array.from([...prowl].sort((a, b) => a - b)) };
}
