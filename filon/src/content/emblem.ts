// emblem.ts — the claim's emblem, which the player designs on CrierBelt's register at the very
// start and the Heart flies as its flag (owner, 2026-10-13: "let's make the player design its logo
// at the very beginning, and the heart will have a flag with the logo on it"). An emblem is a
// shape, a symbol on it and two colours, all by id from the lists below, so a save keeps meaning
// whatever is added later (art/emblem.ts draws them; the colours are art tokens by name). A claim
// with none yet (a base founded without the intro, a debug base) flies the one its player seed
// picks (`defaultEmblem`).

export const EMBLEM_SHAPES = ['shield', 'round', 'pennant', 'diamond'] as const;
export const EMBLEM_SYMBOLS = ['star', 'gear', 'wave', 'peak', 'eye', 'bird', 'sun', 'bolt'] as const;
/** The palette: art tokens (render/art/tokens.ts `C`), the field's and the symbol's. */
export const EMBLEM_COLORS = ['coral', 'turq', 'lilac', 'brass', 'teal', 'violet', 'ink', 'paper'] as const;

export type EmblemShape = (typeof EMBLEM_SHAPES)[number];
export type EmblemSymbol = (typeof EMBLEM_SYMBOLS)[number];
export type EmblemColor = (typeof EMBLEM_COLORS)[number];

export interface Emblem { shape: EmblemShape; symbol: EmblemSymbol; field: EmblemColor; ink: EmblemColor }

/** Is it an emblem made of known parts, with a symbol that shows on its field? */
export function isEmblem(e: unknown): e is Emblem {
  if (!e || typeof e !== 'object') return false;
  const o = e as Record<string, unknown>;
  return (EMBLEM_SHAPES as readonly unknown[]).includes(o.shape) && (EMBLEM_SYMBOLS as readonly unknown[]).includes(o.symbol)
    && (EMBLEM_COLORS as readonly unknown[]).includes(o.field) && (EMBLEM_COLORS as readonly unknown[]).includes(o.ink) && o.field !== o.ink;
}

/** The emblem a claim flies until its player designs one: picked from its seed (integers only). */
export function defaultEmblem(seed: number): Emblem {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  const next = (n: number): number => { h = (Math.imul(h, 0x45d9f3b) + 0x3c6ef372) >>> 0; return (h >>> 8) % n; };
  const field = EMBLEM_COLORS[next(6)]!; // a colour, not ink or paper
  return { shape: EMBLEM_SHAPES[next(EMBLEM_SHAPES.length)]!, symbol: EMBLEM_SYMBOLS[next(EMBLEM_SYMBOLS.length)]!, field, ink: next(2) ? 'paper' : 'ink' };
}

/** A key per emblem (the views bake one texture per key). */
export const emblemKey = (e: Emblem): string => `${e.shape}:${e.symbol}:${e.field}:${e.ink}`;
