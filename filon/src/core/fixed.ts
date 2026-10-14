// fixed.ts — exact integer helpers for the engine. State is integers only (milli-items, kW,
// kW·tick, centi-ocelles, permille): conservation is exact and replays are bit-identical.
// Float division of integers below 2^53 floors exactly, so Math.floor(a / b) is safe here.

const SAFE = 9007199254740992; // 2^53

/** ⌊a / b⌋ for integers, b > 0. */
export const fdiv = (a: number, b: number): number => Math.floor(a / b);

/** ⌈a / b⌉ for integers, b > 0. */
export const ceilDiv = (a: number, b: number): number => -Math.floor(-a / b);

/** ⌊a · b / c⌋ without losing precision past 2^53 (falls back to BigInt). c > 0. */
export function mulDiv(a: number, b: number, c: number): number {
  const p = a * b;
  if (p > -SAFE && p < SAFE) return Math.floor(p / c);
  const q = (BigInt(a) * BigInt(b)) / BigInt(c);
  const r = BigInt(a) * BigInt(b) - q * BigInt(c);
  // BigInt division truncates toward zero; adjust to floor for negative quotients.
  return Number(r !== 0n && (r < 0n) !== (BigInt(c) < 0n) ? q - 1n : q);
}

/** ⌊√n⌋ for a non-negative integer, by integer Newton iteration (no Math.sqrt). */
export function isqrt(n: number): number {
  if (n < 2) return n < 0 ? 0 : n;
  let x = n;
  let y = Math.floor((x + 1) / 2);
  while (y < x) {
    x = y;
    y = Math.floor((x + Math.floor(n / x)) / 2);
  }
  return x;
}

/** Round down to a multiple of `step` (power satisfaction uses 25‰ steps). */
export const floorTo = (v: number, step: number): number => Math.floor(v / step) * step;

/** Integer clamp. */
export const clampInt = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** Apply a permille multiplier: ⌊v · m / 1000⌋. */
export const permille = (v: number, m: number): number => mulDiv(v, m, 1000);

/** Squared distance between two integer points. */
export const dist2 = (ax: number, ay: number, bx: number, by: number): number => {
  const dx = ax - bx, dy = ay - by;
  return dx * dx + dy * dy;
};

/**
 * Split `total` across claimants with caps, proportionally to integer weights, exactly:
 * water-filling (capped claimants drop out and the rest is re-shared) then the leftover
 * units go one by one from a rotating pointer. Returns the new pointer. Deterministic: the
 * claimant order is the caller's canonical order. `out[i]` receives each share.
 */
export function waterfill(
  total: number,
  caps: ArrayLike<number>,
  weights: ArrayLike<number>,
  out: Int32Array | number[],
  ptr: number,
): number {
  const n = caps.length;
  for (let i = 0; i < n; i++) out[i] = 0;
  if (n === 0 || total <= 0) return ptr;
  let rem = total;
  // At most n rounds: each round either satisfies everyone or saturates at least one claimant.
  for (let round = 0; round < n && rem > 0; round++) {
    let w = 0;
    for (let i = 0; i < n; i++) if ((out[i] as number) < caps[i]! && weights[i]! > 0) w += weights[i]!;
    if (w === 0) break;
    let given = 0;
    for (let i = 0; i < n; i++) {
      const cur = out[i] as number;
      if (cur >= caps[i]! || weights[i]! <= 0) continue;
      const share = Math.min(caps[i]! - cur, Math.floor((rem * weights[i]!) / w));
      out[i] = cur + share;
      given += share;
    }
    rem -= given;
    if (given === 0) break;
  }
  // Leftover units (from flooring): round-robin from the pointer.
  let guard = 0;
  while (rem > 0 && guard < n * 2) {
    const i = ptr % n;
    ptr = (ptr + 1) % n;
    guard++;
    if ((out[i] as number) < caps[i]! && weights[i]! > 0) {
      out[i] = (out[i] as number) + 1;
      rem--;
      guard = 0;
    }
  }
  return ptr;
}
