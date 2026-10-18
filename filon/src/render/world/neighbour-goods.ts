// neighbour-goods.ts — where a neighbouring base's ribbons are drawn and where the goods on them ride
// (D110; owner, 2026-10-17: « visual glitch where a ribbon from a PNJ base disappears »: its goods
// ran on across bare sand where no ribbon showed). Pure maths, no Pixi, shared by the buildings view
// (which draws a line) and the neighbours view (which moves its goods), so both read one line:
// - `ribbonRuns`: a line cut where it crosses from one culling square to the next (the buildings
//   view's 16-tile buckets, D92), so each stretch shows and hides with its own square — a line laid
//   as one record took its first tile's square, and vanished whole when that square left the view;
// - `goodAt`: a good's place along a line, from the game's clock, always between the centres of two
//   of its consecutive tiles, so on one of them.
export interface Run { readonly bucket: number; readonly from: number; readonly to: number }

/** A line's tiles (x, y, rot per tile) in runs of consecutive tiles in one culling square: [from, to) tile indices. */
export function ribbonRuns(tiles: Int32Array, bucketOf: (x: number, y: number) => number): Run[] {
  const n = tiles.length / 3, out: Run[] = [];
  let from = 0, b = n ? bucketOf(tiles[0]!, tiles[1]!) : -1;
  for (let i = 1; i <= n; i++) {
    const bi = i < n ? bucketOf(tiles[i * 3]!, tiles[i * 3 + 1]!) : -1;
    if (i < n && bi === b) continue;
    out.push({ bucket: b, from, to: i });
    from = i; b = bi;
  }
  return out;
}

/** How many goods ride a line of `len` tiles, one every `gap` tiles. */
export const goodsOn = (len: number, gap: number): number => (len < 2 ? 0 : Math.max(1, Math.floor(len / gap)));

/**
 * Good `k` of `n` on a line at game time `seconds` (moving `speed` tiles a second, its loop shifted by
 * `phase` ∈ [0, 1)): its place in tile units, between the centres of tiles i and i + 1, and the tile
 * it is on. Null for a line too short to ride.
 */
export function goodAt(tiles: Int32Array, phase: number, k: number, n: number, seconds: number, speed: number): { x: number; y: number; tile: number } | null {
  const len = tiles.length / 3;
  if (len < 2 || n < 1) return null;
  const u = ((((seconds * speed) / len + phase + k / n) % 1) + 1) % 1;
  const s = u * (len - 1), i = Math.min(len - 2, Math.floor(s)), f = s - i;
  const ax = tiles[i * 3]! + 0.5, ay = tiles[i * 3 + 1]! + 0.5, bx = tiles[(i + 1) * 3]! + 0.5, by = tiles[(i + 1) * 3 + 1]! + 0.5;
  const x = ax + (bx - ax) * f, y = ay + (by - ay) * f;
  // The tile it stands on: the one its place falls in (one of the two: they are side by side).
  const onA = Math.floor(x) === tiles[i * 3] && Math.floor(y) === tiles[i * 3 + 1];
  return { x, y, tile: onA ? i : i + 1 };
}
