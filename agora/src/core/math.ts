// math.ts — small numeric helpers shared across the engine and renderers.

export const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

// inverse lerp: where does v sit between a and b? (0..1, unclamped)
export const invLerp = (a: number, b: number, v: number): number =>
  a === b ? 0 : (v - a) / (b - a);

// remap v from [inLo,inHi] onto [outLo,outHi]
export const remap = (
  v: number, inLo: number, inHi: number, outLo: number, outHi: number,
): number => lerp(outLo, outHi, invLerp(inLo, inHi, v));

export const roundTo = (v: number, dp = 0): number => {
  const p = 10 ** dp;
  return Math.round(v * p) / p;
};

export const approxEq = (a: number, b: number, eps = 1e-6): boolean =>
  Math.abs(a - b) <= eps;

export const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);

export const mean = (xs: readonly number[]): number =>
  xs.length === 0 ? 0 : sum(xs) / xs.length;

export const variance = (xs: readonly number[]): number => {
  if (xs.length === 0) return 0;
  const m = mean(xs);
  return mean(xs.map((x) => (x - m) ** 2));
};
